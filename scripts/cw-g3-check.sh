#!/usr/bin/env bash
# =============================================================================
# cw-g3-check.sh —— G3 收尾门禁（learn / sync-gbrain / decisions-log 是否真跑过）
#
# 用法: ./scripts/cw-g3-check.sh [--change <名>] [--json]
# 退出码: 0 = 三项都新鲜；1 = 有陈旧项（打印补齐命令）；3 = 环境缺（无 gbrain / 无 python3）
#
# 为什么需要它（2026-10-25 事故）:
#   change-workflow 把 learn → sync-gbrain → decisions-log 定为 G3 **必调**，
#   但全靠自觉。实际连续 4 个 change 只跑了 push+merge，三者全跳：
#   gbrain 索引停在 10-21，decisions.tsv 停在 10-21，learnings 只写进了
#   本仓 gitignore 的 .omo/ 目录——等于下一个会话什么都查不到。
#   判据必须机械化，否则「必调」只是一句话。
#
# 三项判据:
#   1) gbrain 源 last_sync_at >= 本仓最后一次提交时间
#   2) .artifacts/decisions.tsv 存在，且其 mtime >= 最后一次提交时间
#   3) 若给了 --change：<change>/tasks.md 的 mtime <= decisions.tsv mtime（收口时记过账）
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CHANGE="" JSON=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --change) [[ $# -ge 2 ]] || { echo "❌ --change 需要一个值" >&2; exit 1; }; CHANGE="$2"; shift 2 ;;
    --json) JSON=1; shift ;;
    -h|--help) sed -n '3,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "❌ 未知参数: $1" >&2; exit 1 ;;
  esac
done

command -v python3 >/dev/null 2>&1 || { echo "⚠️ 缺 python3（降级，不判绿）" >&2; exit 3; }
command -v gbrain >/dev/null 2>&1 || { echo "⚠️ 缺 gbrain（降级，不判绿）" >&2; exit 3; }

HEAD_TS="$(git log -1 --format=%ct)"
HEAD_ISO="$(git log -1 --format=%cI)"
DEC_LOG=".artifacts/decisions.tsv"

python3 - "$REPO_ROOT" "$HEAD_TS" "$HEAD_ISO" "$DEC_LOG" "$CHANGE" "$JSON" <<'PY'
import calendar, json, os, subprocess, sys, time

root, head_ts, head_iso, dec_log, change, as_json = sys.argv[1:7]
head_ts = int(head_ts)
problems, notes = [], []

# 1) gbrain 源新鲜度
last_sync = None
try:
    out = subprocess.run(["gbrain", "sources", "list", "--json"],
                         capture_output=True, text=True, timeout=60).stdout
    start = out.find("{")
    data = json.loads(out[start:]) if start >= 0 else {}
    for s in data.get("sources", []):
        if s.get("local_path") and os.path.realpath(s["local_path"]) == os.path.realpath(root):
            last_sync = s.get("last_sync_at")
            break
except Exception as e:
    notes.append("gbrain sources 读取失败：%s" % e)

if last_sync is None:
    problems.append("gbrain 未登记本仓（或读不到 last_sync_at）→ 先跑 `gbrain sources add --path .`")
else:
    sync_ts = calendar.timegm(time.strptime(last_sync[:19], "%Y-%m-%dT%H:%M:%S"))  # UTC，勿用 mktime
    # 容忍 5 分钟（提交与同步的时钟/流程延迟）
    if sync_ts + 300 < head_ts:
        problems.append("gbrain 索引陈旧：last_sync=%s < HEAD=%s → 跑 `gbrain sync --repo . && gbrain embed --stale --source <本仓源>`" % (last_sync, head_iso))

# 2) decisions 日志新鲜度
if not os.path.exists(dec_log):
    problems.append("缺 %s → 跑 ./scripts/decisions-log.sh add ..." % dec_log)
else:
    mtime = os.path.getmtime(dec_log)
    if mtime + 300 < head_ts:
        problems.append("决策日志陈旧：mtime=%s < HEAD=%s → 补记本轮决策" %
                        (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(mtime)), head_iso))

# 3) change 收口记账
if change:
    tasks = os.path.join(root, "openspec", "changes", change, "tasks.md")
    if os.path.exists(tasks) and os.path.exists(dec_log):
        if os.path.getmtime(tasks) > os.path.getmtime(dec_log):
            problems.append("%s 的 tasks.md 比决策日志新 → 收口前补记一条 G4 决策" % change)

if as_json == "1":
    print(json.dumps({"ok": not problems, "problems": problems, "notes": notes,
                      "head": head_iso, "gbrain_last_sync": last_sync}, ensure_ascii=False, indent=2))
else:
    print("==> G3 收尾检查")
    print("  HEAD        : %s" % head_iso)
    print("  gbrain 同步 : %s" % (last_sync or "（未登记）"))
    print("  决策日志    : %s" % (dec_log if os.path.exists(dec_log) else "（缺失）"))
    for n in notes:
        print("  ⚠ %s" % n)
    if problems:
        print("  ❌ %d 项未完成：" % len(problems))
        for p in problems:
            print("     - %s" % p)
    else:
        print("  ✅ learn / sync-gbrain / decisions-log 三项均新鲜")

sys.exit(0 if not problems else 1)
PY
