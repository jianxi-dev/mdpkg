#!/usr/bin/env bash
# =============================================================================
# change-workflow 项目自升级命令（由工具包安装到 scripts/cw-update.sh）
#
# 用法: ./scripts/cw-update.sh [--target <dir>] [同 update.sh 的其它参数]
#
# 行为:
#   1. 读 .change-workflow.conf 的 TOOLKIT_SOURCE，定位工具包仓库
#   2. 确保本地有工具包副本（复用 ~/.change-workflow 或克隆到缓存，随后 pull）
#   3. 用该副本的 update.sh 对目标项目执行升级
#
# 目标项目因此"自包含"：换机器/新同事只需 clone 项目本身，
# 无需知道工具包在哪 —— 来源记录在项目自己的 conf 里。
# =============================================================================
set -euo pipefail

DEFAULT_SOURCE="https://github.com/jianxi-dev/change-workflow.git"

# 缓存目录优先级：CHANGE_WORKFLOW_HOME > ~/.change-workflow（既有手动 clone）> ~/.cache/change-workflow
# ${HOME:-}：set -u 下 HOME 未定义时回退空根路径而不是直接崩（容器/受限环境曾炸）
if [[ -n "${CHANGE_WORKFLOW_HOME:-}" ]]; then
  CACHE_DIR="$CHANGE_WORKFLOW_HOME"
elif [[ -d "${HOME:-}/.change-workflow/.git" ]]; then
  CACHE_DIR="${HOME:-}/.change-workflow"
else
  CACHE_DIR="${HOME:-}/.cache/change-workflow"
fi

TARGET="$(pwd)"
ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --help|-h)
      sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

cd "$TARGET" || { echo "❌ 目标目录不存在: $TARGET" >&2; exit 1; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo "❌ $TARGET 不是 git 仓库" >&2; exit 1; }

CONF=".change-workflow.conf"
if [[ ! -f "$CONF" ]]; then
  echo "❌ 未找到 $CONF —— 请先运行工具包 setup.sh 安装" >&2
  exit 1
fi
# 不 source conf：该文件提交进消费仓，恶意 PR 在其中追加 shell 后即被执行（RCE）。
# 白名单逐键解析（bash 3.2 兼容）：只取 TOOLKIT_SOURCE 字面值，不求值、不执行任何内容。
# 统一规范（F6+F8，与 lib/render.sh 的 cw_conf_get 及 pr-automation.sh / cw-greploop.sh 的
# conf_get 逐字同语义，改一处必同步四处，回归锁在 e2e 用例 22）：
#   1) `#` 开头的整行注释跳过；2) 原始值 = 首个 `=` 之后的全部文本；3) 去尾部 \r；
#   4) 值以 " 或 ' 开头且**后方存在同名闭引号** → 取首对引号之间的内值（内部 # 原样保留），
#      但闭引号之后只允许「空白」或「空白 + # 注释」（红证：`"val" # c` 旧「首尾同引号」
#      判定被尾注释破坏 → 引号存活返回 `"val"`）；引号后有杂质 → 整值按无引号处理；
#      无引号时仅在「空白 + #」处截断行内注释（`x # c` → `x`；无空白的 `r#frag` 保留）；
#   5) 去尾部空白；6) 输出。键不存在返回 1。
conf_get() {
  local key="$1" line v q inner rest
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      \#*) continue ;;
    esac
    # 锚定行首（1.3.1 QA ISSUE-002）：子串匹配 *"$key="* 会被诱饵行误命中
    # （如 OLD_REPO= 在 REPO= 之前先子串命中 REPO=），故键必须位于行首。
    case "$line" in
      "$key"=*) v="${line#*=}" ;;
      *) continue ;;
    esac
    v="${v%$'\r'}"
    q="${v:0:1}"
    if [[ "$q" == '"' || "$q" == "'" ]] && [[ "${v:1}" == *"$q"* ]]; then
      # 同名闭引号存在 → 取首对引号之间的内值；但闭引号之后只允许「空白」或
      # 「空白 + # 注释」（红证：`"val" # c` 旧「首尾同引号」判定被尾注释破坏 →
      # 引号存活返回 `"val"`，统一前的旧实现返回 val）。引号后有杂质 → 按无引号处理。
      inner="${v#"$q"}"
      rest="${inner#*"$q"}"
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
TOOLKIT_SOURCE="$(conf_get TOOLKIT_SOURCE || true)"
SOURCE="${TOOLKIT_SOURCE:-$DEFAULT_SOURCE}"
# 信任门（C1 安全边界）：conf 提交进消费仓，恶意 PR 可把 TOOLKIT_SOURCE 改成攻击者仓库，
# 其 update.sh 在下方 exec 时即被执行（RCE 红证：marker 落地）。故非默认源仅在
# (a) 显式授权 CW_UPDATE_ALLOW_SOURCE=1，或 (b) 与既有缓存来源一致时采用；
# 否则 fail-closed 拒绝 —— 绝不静默回退默认源（回退会让用户误以为升级成功）。
if [[ -n "$TOOLKIT_SOURCE" && "$TOOLKIT_SOURCE" != "$DEFAULT_SOURCE" ]]; then
  if [[ "${CW_UPDATE_ALLOW_SOURCE:-}" == "1" ]]; then
    : # 显式授权
  elif [[ -d "$CACHE_DIR/.git" && "$(git -C "$CACHE_DIR" remote get-url origin 2>/dev/null || true)" == "$TOOLKIT_SOURCE" ]]; then
    : # 与既有缓存来源一致（缓存是上次信任过的来源克隆的）
  else
    echo "❌ 拒绝使用非默认工具包来源: $TOOLKIT_SOURCE" >&2
    echo "   conf 中的 TOOLKIT_SOURCE 与默认源不同，且未获信任。" >&2
    echo "   若确需使用该来源，请显式授权: export CW_UPDATE_ALLOW_SOURCE=1" >&2
    exit 1
  fi
fi
echo "==> 工具包来源: $SOURCE"

# 确保本地有工具包副本
if [[ -d "$CACHE_DIR/.git" ]]; then
  echo "==> 更新本地工具包缓存: $CACHE_DIR"
  git -C "$CACHE_DIR" pull --ff-only -q 2>/dev/null \
    || echo "⚠️  缓存更新失败，使用现有副本（可稍后重试）"
else
  echo "==> 首次克隆工具包到: $CACHE_DIR"
  mkdir -p "$(dirname "$CACHE_DIR")"
  git clone -q "$SOURCE" "$CACHE_DIR"
fi

echo "==> 执行升级（目标: ${TARGET}）"
if [[ "${#ARGS[@]}" -gt 0 ]]; then
  exec "$CACHE_DIR/update.sh" --target "$TARGET" "${ARGS[@]}"
else
  exec "$CACHE_DIR/update.sh" --target "$TARGET"
fi
