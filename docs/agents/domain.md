# 领域文档

> 最后更新：2026-09-07

工程 skill 在探索代码库前应如何消费本仓库的领域文档。

## 探索前优先阅读

- 仓库根目录的 **`CONTEXT.md`**（如果存在）；目前尚未创建，可临时以 **`AGENTS.md`** 作为项目知识库。
- **`docs/adr/`** — 探索某区域前，阅读相关的 ADR。

如果这些文件都不存在，静默继续，不要提前建议创建。

## 文件结构

单上下文仓库：

```
/
├── AGENTS.md              ← 当前项目知识库
├── CONTEXT.md             ← 待 /domain-modeling 按需创建
├── docs/adr/
│   └── 0002-editing-paradigm-and-shared-renderer.md
├── apps/web/
├── packages/editor/
└── packages/renderer/
```

## 使用术语表词汇

当输出涉及领域概念（issue 标题、重构提案、测试名）时，使用 `CONTEXT.md` / `AGENTS.md` 中定义的术语，不要随意使用同义词。

## 标记 ADR 冲突

如果输出与现有 ADR 矛盾，应显式指出，而不是静默覆盖。
