#!/usr/bin/env bash
# =============================================================================
# cw-next-change.sh —— 选出「下一个该推进的 change」及其首张可开工票
#
# 用法: ./scripts/cw-next-change.sh [--json]
# 退出码: 0 = 给出推荐（打印 change + 票 + 理由）
#         1 = 无候选（队列空 / 只剩已收口 change）→ 该结束或走 G4
#         2 = 歧义（多个 change 最近推进时间差 < 1 小时）→ 需人工选
#         3 = 环境缺（gh 不可用）或 conf 读取失败
#
# 为什么需要它（2026-10-26 事故）:
#   SKILL.md 曾把「G4 收口后队列盘点」写成「列出清单 + 给出建议 + 询问是否继续」，
#   而 agent 一旦以提问结束回合，流程就终止了——提问本身成了终点，没有东西在
#   用户回答后唤醒下一票。连续 5 个 change 只走到 push+merge 就是这么来的。
#   判据机械化：清单非空即自动选出下一票，只在「并列」和「队列空」时停。
#
# 选取规则（与 SKILL.md「会话启动」节 + §G3「frontier 自动推进」同语义）:
#   1. 取所有 `LABEL_READY` 标签的 open 子票，按标题前缀 `[change=<名>/` 归组
#   2. 组内有 Blocked by 未 closed 的票 → 不可开工（该组可能整体阻塞）
#   3. 候选 change 按「子票最近更新时间」倒序；第一名与第二名相差 < 1h → 歧义退 2
#   4. 输出该 change 的首张可开工票（按其 issue 号升序 = frontier 顺序）
#
# 范围边界：本脚本只看 `LABEL_READY` 的 open 票。一个 change 若子票全关闭，
# 其 signal 由 `change-closure-signal.yml` 打 `LABEL_CLOSURE_PENDING` 标签驱动 G4，
# 不经本脚本——「已收口的 change」不是「下一个要推进的 change」。
#
# 本脚本只读、只推荐，不改任何 GitHub 状态。
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

JSON=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON=1; shift ;;
    -h|--help) sed -n '3,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "❌ 未知参数: $1" >&2; exit 1 ;;
  esac
done

command -v gh >/dev/null 2>&1 || { echo "⚠️ 缺 gh（无法查询 issue）" >&2; exit 3; }

# conf 读取：与 cw-update.sh / pr-automation.sh / cw-greploop.sh 逐字同语义（F6+F8）。
# 不 source conf（RCE 边界）：conf 不受管，恶意 PR 可追加 shell。
conf_get() {
  local key="$1" line v q inner rest
  local CONF="$REPO_ROOT/.change-workflow.conf"
  [[ -f "$CONF" ]] || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in \#*) continue ;; esac
    case "$line" in "$key"=*) v="${line#*=}" ;; *) continue ;; esac
    v="${v%$'\r'}"
    q="${v:0:1}"
    if [[ "$q" == '"' || "$q" == "'" ]] && [[ "${v:1}" == *"$q"* ]]; then
      inner="${v#"$q"}"; rest="${inner#*"$q"}"
      case "${rest#"${rest%%[![:space:]]*}"}" in
        ''|'#'*) v="${inner%%"$q"*}" ;;
        *) v="${v%%[[:space:]]#*}" ;;
      esac
    else
      v="${v%%[[:space:]]#*}"
    fi
    v="${v%"${v##*[![:space:]]}"}"
    printf '%s\n' "$v"
    return 0
  done < "$CONF"
  return 1
}

LABEL_READY="$(conf_get LABEL_READY || true)"; LABEL_READY="${LABEL_READY:-ready-for-agent}"

ISSUES_JSON="$(gh issue list --label "$LABEL_READY" --state open --limit 200 \
  --json number,title,body,updatedAt,labels 2>/dev/null)" \
  || { echo "⚠️ gh issue list 失败（凭证/网络）" >&2; exit 3; }

printf '%s' "${ISSUES_JSON:-[]}" | python3 -c '
import json, re, subprocess, sys
from datetime import datetime, timezone

as_json = sys.argv[1] == "1"
issues = json.load(sys.stdin)

TIE_WINDOW = 3600  # 秒：两个候选 change 更新时间差小于此值 → 判并列

def parse_ts(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()

def blocked_by(body):
    """返回 Blocked by 段里引用的 issue 号集合（宽松匹配 `Blocked by: #1, #2` / `- #1`）。"""
    nums = set()
    for line in (body or "").splitlines():
        if re.search(r"blocked\s*by", line, re.I):
            nums.update(int(n) for n in re.findall(r"#(\d+)", line))
    return nums

groups = {}   # change -> {"tasks": [issue...], "latest": ts}
for it in issues:
    m = re.match(r"\[change=([^/\]]+)/", it["title"])
    if not m:
        continue
    groups.setdefault(m.group(1), {"tasks": [], "latest": 0})["tasks"].append(it)
    groups[m.group(1)]["latest"] = max(groups[m.group(1)]["latest"], parse_ts(it["updatedAt"]))

# 已 closed 的 issue 集合（用于 Blocked by 判定）
all_refs = set()
for g in groups.values():
    for t in g["tasks"]:
        all_refs |= blocked_by(t.get("body"))
closed = set()
if all_refs:
    out = subprocess.run(
        ["gh", "issue", "list", "--state", "closed", "--limit", "500", "--json", "number"],
        capture_output=True, text=True).stdout or "[]"
    try:
        closed = {i["number"] for i in json.loads(out)}
    except Exception:
        closed = set()

candidates = []
for change, g in groups.items():
    ready = [t for t in g["tasks"] if not (blocked_by(t.get("body")) - closed)]
    if not ready:
        continue
    candidates.append({"change": change, "latest": g["latest"],
                       "task": sorted(ready, key=lambda t: t["number"])[0],
                       "open": len(g["tasks"])})

if not candidates:
    msg = "（无候选）open 子票中不存在可开工的 change"
    if as_json:
        print(json.dumps({"ok": False, "reason": "no-candidate", "message": msg}, ensure_ascii=False))
    else:
        print("==> 下一 change 推荐")
        print("  " + msg)
    sys.exit(1)

candidates.sort(key=lambda c: c["latest"], reverse=True)
top = candidates[0]
tie = [c for c in candidates[1:] if top["latest"] - c["latest"] < TIE_WINDOW]

if tie:
    names = [top["change"]] + [c["change"] for c in tie]
    if as_json:
        print(json.dumps({"ok": False, "reason": "ambiguous", "candidates": names},
                         ensure_ascii=False))
    else:
        print("==> 下一 change 推荐：⚠️ 并列，需人工选")
        print("  以下 change 最近推进时间差 < 1 小时：")
        for c in [top] + tie:
            print("    - %s（open %d 票，最近更新 %s）" %
                  (c["change"], c["open"],
                   datetime.fromtimestamp(c["latest"], timezone.utc).strftime("%Y-%m-%d %H:%M UTC")))
        print("  选定后执行：./scripts/pr-automation.sh --role feat --issue <%d>" %
              [c["task"]["number"] for c in [top] + tie][0])
    sys.exit(2)

t = top["task"]
if as_json:
    print(json.dumps({"ok": True, "change": top["change"], "issue": t["number"],
                      "title": t["title"], "open_tasks": top["open"]}, ensure_ascii=False))
else:
    print("==> 下一 change 推荐")
    print("  change  : %s（open %d 票）" % (top["change"], top["open"]))
    print("  首张票  : #%d %s" % (t["number"], t["title"]))
    print("  理由    : 该 change 子票最近更新 %s，为所有可开工 change 中最新" %
          datetime.fromtimestamp(top["latest"], timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
    print("  下一步  : 直接进入该票 G1（不询问）；收口脚本 ./scripts/pr-automation.sh --role feat --issue %d"
          % t["number"])
' "$JSON"
