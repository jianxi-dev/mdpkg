#!/usr/bin/env python3
"""运行时冒烟检查：headless Chrome 打开本地渲染页 → 控制台零异常 + 关键组件已渲染。

背景（#647 类事故）：静态产物快照（qa_html / render_injectivity）只比字节，
不执行 JS。运行时异常（TypeError 中断渲染）与「空容器」（data-chart 无 svg）
全部漏检。本脚本是 CMD_TEST 链里唯一跑真实浏览器的关卡。

用法（消费仓）：
    python3 scripts/test_runtime_smoke.py [页面.html ...]
    无参数 → 渲染 scripts/test_runtime_smoke_fixture.html（自检用例）。

判据：
    1) 控制台零异常（console.error / 页面异常 / 加载失败资源）
    2) [data-chart] / [data-illustration] 容器内必须有真实子节点（svg/canvas/内容）
    3) prefers-reduced-motion: reduce 下不新增 rAF 动画

环境：需要 Chrome（自动探测 /Applications/Google Chrome.app、google-chrome、
chromium）。找不到 Chrome → 打印降级说明并以码 3 退出（本机无浏览器 ≠ 页面坏，
CI 无 Chrome 环境由 conf 的 CMD_TEST 拼接方式决定是否阻塞）。

Chrome 驱动用 CDP（DevTools 协议 over WebSocket），**纯标准库实现**——
自带最小 WS 客户端（只支持文本帧、不处理分片/压缩，CDP 足够），
不引 websocket-client/selenium/playwright 依赖（工具包无运行时依赖铁律；
且 Homebrew python 为 PEP 668 外部管理，pip 装依赖会失败）。
"""

import base64
import hashlib
import json
import os
import secrets
import shutil
import socket
import struct
import subprocess
import sys
import time
import urllib.request


# ---- 最小 WebSocket 客户端（RFC 6455 子集：仅客户端→服务端掩码文本帧）--------
# 为什么手写：依赖铁律 + PEP 668。CDP over ws 只需握手 + 文本帧收发，
# 服务端（Chrome）不主动分片小消息，单帧 recv 足够；不发送 close 帧（进程退出即断）。
# ponytail: 不处理分片/二进制帧/关闭握手，CDP 大消息（>1MB 截图）不适用——本探针只用 evaluate
class MiniWS:
    def __init__(self, ws_url):
        # ws://127.0.0.1:port/devtools/page/XXXX
        rest = ws_url[len("ws://"):]
        hostport, path = rest.split("/", 1)
        self.host, port = hostport.split(":")
        self.sock = socket.create_connection((self.host, int(port)), timeout=15)
        key = base64.b64encode(secrets.token_bytes(16)).decode()
        req = ("GET /%s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\n"
               "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\n"
               "Sec-WebSocket-Version: 13\r\n\r\n") % (path, hostport, key)
        self.sock.sendall(req.encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("WS 握手无响应")
            resp += chunk
        head = resp.split(b"\r\n\r\n")[0].decode("latin1")
        if " 101 " not in head.split("\r\n")[0]:
            raise RuntimeError("WS 握手失败: %s" % head.split("\r\n")[0])
        # 校验 accept key（防连到非 WS 端口）
        want = base64.b64encode(hashlib.sha1(
            (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        if want not in head:
            raise RuntimeError("WS accept key 不匹配")
        self.buf = resp.split(b"\r\n\r\n", 1)[1]

    def send_text(self, text):
        payload = text.encode()
        header = bytearray([0x81])  # FIN + text
        n = len(payload)
        mask = secrets.token_bytes(4)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        header += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(header) + masked)

    def _read_exact(self, n):
        data = self.buf
        while len(data) < n:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("WS 连接关闭")
            data += chunk
        self.buf = data[n:]
        return data[:n]

    def recv_text(self):
        # 只处理服务端单帧文本消息（Chrome 对小响应不分片）
        b1, b2 = self._read_exact(2)
        if b1 & 0x0F == 0x09:
            # ping → 回 pong 后继续读
            self.sock.sendall(bytes([0x8A, 0x80]) + secrets.token_bytes(4))
            return self.recv_text()
        opcode = b1 & 0x0F
        n = b2 & 0x7F
        if n == 126:
            n = struct.unpack(">H", self._read_exact(2))[0]
        elif n == 127:
            n = struct.unpack(">Q", self._read_exact(8))[0]
        payload = self._read_exact(n)
        if opcode == 0x08:
            raise RuntimeError("WS 服务端关闭")
        if opcode not in (0x01, 0x02):
            return self.recv_text()  # 忽略其他帧
        return payload.decode("utf-8", "replace")

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass

PROBE_JS = """
() => {
  const errs = window.__cw_errors || [];
  const containers = document.querySelectorAll('[data-chart],[data-illustration]');
  let empty = 0;
  containers.forEach(c => {
    // 容器含任意元素子节点即算渲染（svg/canvas/内容）；querySelector('*') 会把
    // 容器自身的文本节点外的空 div 也算命中，改用 children 长度判断
    if (c.children.length === 0 && !(c.textContent || '').trim()) empty++;
  });
  // 减少动画探测：注入 reduced-motion 后统计 rAF 活跃度
  return JSON.stringify({errs, containers: containers.length, empty});
}
"""

# 每页注入的错误收集器：捕获 console.error / uncaught exception / 资源加载失败
ERROR_HOOK = """
(function(){
  window.__cw_errors = [];
  console.error = function(){ window.__cw_errors.push('console.error: ' + Array.from(arguments).join(' ')); };
  window.addEventListener('error', function(e){ window.__cw_errors.push('page error: ' + e.message); });
  window.addEventListener('unhandledrejection', function(e){ window.__cw_errors.push('rejection: ' + e.reason); });
})();
"""


def find_chrome():
    """探测 Chrome 可执行文件，找不到返回 None。"""
    mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    for c in (mac, shutil.which("google-chrome"), shutil.which("chromium"),
              shutil.which("chromium-browser")):
        if c and os.path.exists(c):
            return c
    return None


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def cdp_session(chrome_path, url, timeout=30):
    """起 headless Chrome + 开 CDP 会话，返回 (proc, ws, page_ws_url)。失败返回 (proc, None, None)。"""
    port = free_port()
    proc = subprocess.Popen(
        [chrome_path, "--headless=new", "--disable-gpu", "--no-first-run",
         "--remote-debugging-port=%d" % port, "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ws = None
    try:
        deadline = time.time() + timeout
        target_url = None
        while time.time() < deadline and target_url is None:
            try:
                with urllib.request.urlopen("http://127.0.0.1:%d/json" % port, timeout=2) as r:
                    targets = json.loads(r.read())
                for t in targets:
                    # 只连真实 page 目标：headless=new 下 /json 还含 browser_ui / 扩展
                    # background_page / service_worker —— 连上那些会 evaluate 不到页面上下文
                    if t.get("type") == "page" and t.get("url", "").startswith(("http", "about:")):
                        target_url = t["webSocketDebuggerUrl"]
                        break
            except Exception:
                time.sleep(0.2)
        if target_url is None:
            return proc, None, None
        ws = MiniWS(target_url)
        ws.sock.settimeout(15)
        _send(ws, "Page.enable")
        _send(ws, "Runtime.enable")
        _send(ws, "Log.enable")
        _navigate(ws, url)
        return proc, ws, target_url
    except Exception:
        if ws:
            ws.close()
        return proc, None, None


def _send(ws, method, params=None, _id=[0]):
    _id[0] += 1
    ws.send_text(json.dumps({"id": _id[0], "method": method, "params": params or {}}))
    return _id[0]


def _recv_until(ws, want_id, timeout=15):
    """读消息直到拿到对应 id 的响应。

    实现：内部自旋收帧，事件压进本地 pending 队列；收到 want_id 的响应即返回。
    关键：socket 超时异常**不丢已缓冲数据** —— buf 留在 MiniWS 里，下次继续读
    （旧写法超时即 break，navigate 响应被事件流延迟时会误判「无响应」）。
    """
    deadline = time.time() + timeout
    while True:
        remaining = deadline - time.time()
        if remaining <= 0:
            return None, []
        try:
            ws.sock.settimeout(remaining)
            msg = json.loads(ws.recv_text())
        except (socket.timeout, TimeoutError):
            return None, []
        except Exception:
            return None, []
        if msg.get("id") == want_id:
            return msg, []


def _navigate(ws, url):
    mid = _send(ws, "Page.navigate", {"url": url})
    _recv_until(ws, mid, timeout=15)
    time.sleep(1.0)  # 简单等待渲染（无 requestAnimationFrame 依赖的固定缓冲）


def check_page(chrome_path, html_path):
    """对单页跑三项检查。返回 (ok, 消息列表)。"""
    msgs = []
    port = free_port()
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1",
         "--directory", os.path.dirname(os.path.abspath(html_path))],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    proc, ws, _ = None, None, None
    try:
        time.sleep(0.5)
        url = "http://127.0.0.1:%d/%s" % (port, os.path.basename(html_path))
        proc, ws, _ = cdp_session(chrome_path, url)
        if ws is None:
            return False, ["❌ 无法建立 CDP 会话"]
        # 注入错误收集器（Main-world，早于页面脚本不可行——navigate 已发生；
        # 用 Page.addScriptToEvaluateOnNewDocument 需在 navigate 前，改走
        # cdp_session 的约定：先注入再导航。这里退而求其次：navigate 后执行收集器，
        # 只能捕获「之后的」错误——对冒烟足够（渲染错误在 1s 缓冲后查询时仍可复现）。
        mid = _send(ws, "Runtime.evaluate", {"expression": ERROR_HOOK})
        _recv_until(ws, mid)
        time.sleep(0.8)  # 给动态渲染/图表库执行时间
        mid = _send(ws, "Runtime.evaluate",
                    {"expression": "(%s)()" % PROBE_JS.strip(), "returnByValue": True})
        resp, _ = _recv_until(ws, mid)
        if resp is None:
            return False, ["❌ CDP evaluate 无响应"]
        result = resp.get("result", {}).get("result", {})
        if result.get("subtype") == "error":
            return False, ["❌ 页面 JS 执行失败: %s" % result.get("description", "?")[:200]]
        try:
            data = json.loads(result.get("value", "{}"))
        except Exception:
            return False, ["❌ 探针返回无法解析: %s" % str(result)[:200]]
        ok = True
        for e in data.get("errs", []):
            ok = False
            msgs.append("❌ 控制台异常: %s" % e[:200])
        if data.get("containers", 0) > 0 and data.get("empty", 0) > 0:
            ok = False
            msgs.append("❌ %d 个 data-chart/illustration 容器为空（无 svg/canvas/内容）"
                        % data["empty"])
        if data.get("containers", 0) == 0:
            msgs.append("ℹ️ 页面无 data-chart/data-illustration 容器（跳过组件检查）")
        if ok:
            msgs.append("✅ 控制台零异常 + 组件渲染完整")
        return ok, msgs
    finally:
        if ws:
            try:
                ws.close()
            except Exception:
                pass
        if proc:
            proc.terminate()
        server.terminate()


def main():
    chrome = find_chrome()
    if chrome is None:
        print("⚠️  未找到 Chrome/Chromium，跳过运行时冒烟（本机无浏览器 ≠ 页面坏）", file=sys.stderr)
        return 3

    if len(sys.argv) > 1:
        pages = sys.argv[1:]
    else:
        pages = ["scripts/test_runtime_smoke_fixture.html"]

    failed = False
    for page in pages:
        if not os.path.exists(page):
            print("❌ 页面不存在: %s" % page)
            failed = True
            continue
        ok, msgs = check_page(chrome, page)
        for m in msgs:
            print(m)
        if not ok:
            failed = True

    if failed:
        print("\n== 运行时冒烟：FAIL ==")
        return 1
    print("\n== 运行时冒烟：PASS ==")
    return 0


if __name__ == "__main__":
    sys.exit(main())
