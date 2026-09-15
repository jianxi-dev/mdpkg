# conformance Specification (delta)

## ADDED Requirements

### Requirement: 宽容打开用例约定
conformance fixtures 可使用无 manifest 的输入包（`input/` 目录内无 `manifest.json`，或 `input.mdpkg` 为裸 zip）验证 lenient-open 能力。此类用例 MUST 在 `case.json` 中以显式字段声明（如 `lenient: true`），并使用 `expect` 断言入口推断结果（`entry`）与降级标注（新增断言字段，如 `degraded: true`）。既有 fixtures 规则与断言字段 MUST 保持不变。

#### Scenario: 裸 zip 用例声明与断言
- **WHEN** 一个用例声明 `lenient: true` 且输入为无 manifest 的 zip
- **THEN** 断言其 `expect.entry` 等于推断入口、`expect.degraded` 为真

#### Scenario: 既有用例不受影响
- **WHEN** 用例未声明 `lenient`
- **THEN** 按既有断言规则执行，不出现降级标注断言