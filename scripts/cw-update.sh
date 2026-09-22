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
if [[ -n "${CHANGE_WORKFLOW_HOME:-}" ]]; then
  CACHE_DIR="$CHANGE_WORKFLOW_HOME"
elif [[ -d "$HOME/.change-workflow/.git" ]]; then
  CACHE_DIR="$HOME/.change-workflow"
else
  CACHE_DIR="$HOME/.cache/change-workflow"
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
# shellcheck disable=SC1090
source "$CONF"

SOURCE="${TOOLKIT_SOURCE:-$DEFAULT_SOURCE}"
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
