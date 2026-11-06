.PHONY: cw-update cw-check cw-ack-local help

cw-update:  ## 更新 change-workflow 工具包
	./scripts/cw-update.sh

cw-check:  ## 检查工具包是否有新版本（含 LOCAL 文件上游漂移告警）
	./scripts/cw-update.sh --check

cw-ack-local:  ## 回执 LOCAL 基线（人工移植上游改动后清告警）：make cw-ack-local FILE=<path>
	@test -n "$(FILE)" || { echo "用法: make cw-ack-local FILE=<path>"; exit 1; }
	./scripts/cw-update.sh --ack-local $(FILE)

help:  ## 显示可用命令
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'
