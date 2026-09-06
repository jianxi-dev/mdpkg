# mdpkg — Markdown Enhanced

<p align="center">
  <a href="https://jianxi-dev.github.io/mdpkg/"><img src="https://img.shields.io/badge/format-v1.0-blue" alt="格式版本 v1.0"></a>
  <a href="https://github.com/jianxi-dev/mdpkg/actions"><img src="https://img.shields.io/github/actions/workflow/status/jianxi-dev/mdpkg/test.yml" alt="CI 测试"></a>
  <a href="https://github.com/jianxi-dev/mdpkg/blob/main/LICENSE"><img src="https://img.shields.io/badge/code-MIT-blue" alt="代码许可证 MIT"></a>
  <a href="https://github.com/jianxi-dev/mdpkg/blob/main/spec/mdpkg-format-spec.md"><img src="https://img.shields.io/badge/spec-CC%20BY%204.0-lightgrey" alt="规范许可证 CC BY 4.0"></a>
  <a href="https://github.com/jianxi-dev/mdpkg"><img src="https://img.shields.io/github/stars/jianxi-dev/mdpkg" alt="GitHub Stars"></a>
  <a href="https://jianxi-dev.github.io/mdpkg/"><img src="https://img.shields.io/badge/website-jianxi--dev.github.io%2Fmdpkg-orange" alt="官方站点"></a>
</p>

[English](README.md) · **简体中文**

把一篇带图、分章节的 Markdown 文档，打包成**一个可校验、可离线打开、可重复构建的 `.mdpkg` 文件**。

```bash
mdpkg pack   ./my-doc  -o doc.mdpkg     # 打包（图片随包）
mdpkg validate doc.mdpkg                # 校验（结构 + 哈希 + 引用闭包）
mdpkg render doc.mdpkg   -o doc.html    # 渲染（单文件自包含 HTML，图片已内联）
```

## 它解决什么

普通 Markdown 的图片是引用，传一个文件就会丢附件。mdpkg 提供三项能力：

| 能力     | 说明                                                                     |
| -------- | ------------------------------------------------------------------------ |
| 资源随包 | 用原生相对路径写 `![图](assets/a.png)`，打包时资源一起进包，缺失直接报错 |
| 符号扩展 | `(tm)` → `™`、`-->` → `→`，只在普通文本中、渲染期生效，不改动原文        |
| 文件包含 | `<<< includes/ch1.md`，解析前展开，支持嵌套与循环检测                    |

**「单文件」的准确含义**：交付与传输只有一个文件。它不意味着用文本编辑器打开 `.mdpkg` 就能看到完整渲染——那是 `unpack` / `export` / `render` 的职责。

## 快速开始

```bash
cd packages/mdpkg && npm install

# 一个最小例子
mkdir -p demo/assets demo/includes
printf '# 标题 (tm)\n\n![图](assets/a.png)\n\n<<< includes/ch1.md\n' > demo/document.md
printf '第一章 (c) --> 结尾\n' > demo/includes/ch1.md
head -c 5000 /dev/urandom > demo/assets/a.png      # 任意图片

node src/cli.ts pack demo -o demo.mdpkg
node src/cli.ts validate demo.mdpkg
node src/cli.ts render demo.mdpkg -o demo.html        # 打开 demo.html 即可看
```

要求 Node 22.18+（用内置类型剥离直接跑 `.ts`，无构建步骤）。

## 命令

| 命令                             | 作用                                                           |
| -------------------------------- | -------------------------------------------------------------- |
| `pack <dir> -o out.mdpkg`        | 打包。默认打包目录内全部文件；`--referenced-only` 只打引用闭包 |
| `unpack <pkg> -o dir`            | 解包，强制路径校验与解压上限                                   |
| `list <pkg>`                     | 列条目（只读 header，不解压）                                  |
| `validate <pkg>`                 | Schema + size + sha256 + 引用闭包；统计外链数                  |
| `render <pkg> -o out.html`       | 默认内联为单文件 HTML；资源 > 50 MB 自动降级 `--dir`           |
| `export --raw <pkg> -o dir`      | 结构保持、文本一字不改                                         |
| `export --expanded <pkg> -o dir` | include 已展开、相对路径已按包根重写（可被任何 MD 工具打开）   |
| `diff a.mdpkg b.mdpkg`           | 解包双方后 `diff -ruN`                                         |

## 打开

`render`、`export` 与浏览器端 `openMdpkg` 除 `.mdpkg` 外同样接受**普通 ZIP**（目录树 + Markdown，无 `manifest.json`）。`.zip` 与 `.mdpkg` 扩展名同等对待。

无 `manifest.json` 时，入口按以下优先级推断：`document.md`（任意目录深度，取最浅）> `README.md` > `README.zh-CN.md` > 其余 `.md` 按字典序首个。隐藏路径（以 `.` 开头）排除。无任何 `.md` 时报 `MDPKG-E303` 拒绝打开。

宽容打开的包会标注**未校验来源（缺少 manifest.json）**：CLI 在 stderr 打印提示，浏览器 API 返回 `unverified: true` 与 `entry`（实际采用的推断入口）。注意与 `degraded`（资源 > 50 MB 的体积降级）区分——消费方接入宽容打开时应处理新增的 `unverified` 与 `entry` 字段。`demo.html` 查看器会对该类包显示「未校验」徽标。

`validate` 对无 manifest 的包仍报 `MDPKG-E102`；宽容打开不提供完整性校验（无声明可校验）。对宽容打开的包重新 `pack` 输出仍是规范 mdpkg。

## 浏览器库

`packages/mdpkg/web/` 提供 `mdpkg-web` 浏览器端 ESM/IIFE bundle：`openMdpkg` 读包、`packMdpkg` 重打包（与 CLI `pack` 逐字节一致）、`readEntrySource` 读单个条目。`demo.html` 为演示页。构建命令：`npm run build:web`。

## 格式

`.mdpkg` 是**标准 ZIP**，根目录含 `manifest.json`（版本、入口、资源索引含 sha256）。

- 可重复构建：mtime 固定 `1980-01-01`、条目按路径升序、同输入必产同字节 → Git 友好、可缓存
- 完整性：size + sha256 用于检测**损坏/误传/跨平台字节漂移**；**不防篡改**（manifest 与资源同在包内，防篡改需签名，v1 不提供）
- 降级：解包即标准 Markdown；`<<<` 在不支持的渲染器里是可见文本

完整规范见 [`spec/mdpkg-format-spec.md`](spec/mdpkg-format-spec.md)（中文，唯一真源）；英文翻译 [`spec/mdpkg-format-spec.en.md`](spec/mdpkg-format-spec.en.md)；渲染页 [spec.html](https://jianxi-dev.github.io/mdpkg/spec.html)。

## 测试

```bash
cd packages/mdpkg && node --test test/*.test.ts
# 136 个用例
```

fixture 是与实现无关的数据（`case.json` + `input/`），任何语言的实现跑通同一批用例即视为合规。

## 定位与已知缺口

**先自用，后标准化。** 这是一个正在被真实使用验证的格式，不是已确立的标准。若自用 3 个月后没有第二个使用者或实现者，它应降级为内部工具，不再投入规范治理成本。

已知缺口：

- `--fetch`（下载外链）未提供——会引入网络依赖与 SSRF 面，与「不下载、可预测」立场冲突
- 无 VS Code 插件（在采用可行性验证前不启动）

## 许可证

规范文本 CC BY 4.0；实现代码 MIT；测试向量（`spec/fixtures/`）CC0，可无摩擦复制。符号映射表参考 PyMdown Extensions（MIT）。
