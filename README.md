# mdpkg — Markdown Enhanced

<p align="center">
  <a href="https://jianxi-dev.github.io/mdpkg/"><img src="https://img.shields.io/badge/format-v1.0-blue" alt="Format version v1.0"></a>
  <a href="https://github.com/jianxi-dev/mdpkg/actions"><img src="https://img.shields.io/github/actions/workflow/status/jianxi-dev/mdpkg/test.yml" alt="CI tests"></a>
  <a href="https://github.com/jianxi-dev/mdpkg/blob/main/LICENSE"><img src="https://img.shields.io/badge/code-MIT-blue" alt="Code license MIT"></a>
  <a href="https://github.com/jianxi-dev/mdpkg/blob/main/spec/mdpkg-format-spec.md"><img src="https://img.shields.io/badge/spec-CC%20BY%204.0-lightgrey" alt="Spec license CC BY 4.0"></a>
  <a href="https://github.com/jianxi-dev/mdpkg"><img src="https://img.shields.io/github/stars/jianxi-dev/mdpkg" alt="GitHub Stars"></a>
  <a href="https://jianxi-dev.github.io/mdpkg/"><img src="https://img.shields.io/badge/website-jianxi--dev.github.io%2Fmdpkg-orange" alt="Official site"></a>
</p>

**English** · [简体中文](README.zh-CN.md)

Package a Markdown document with images and chapters into **one `.mdpkg` file that is verifiable, opens offline, and builds reproducibly**.

```bash
mdpkg pack   ./my-doc  -o doc.mdpkg     # pack (resources go with the package)
mdpkg validate doc.mdpkg                # validate (structure + hashes + reference closure)
mdpkg render doc.mdpkg   -o doc.html    # render (self-contained single-file HTML, images inlined)
```

## What problem it solves

In plain Markdown, images are references — send one file and you lose the attachments. mdpkg provides three capabilities:

| Capability        | Description                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| Resource bundling | Write `![Image](assets/a.png)` with native relative paths; resources are packed together, a missing one fails loudly |
| Symbol expansion  | `(tm)` → ™, `-->` → →; applied only to plain text at render time, the source text is never modified                  |
| File inclusion    | `<<< includes/ch1.md`, expanded before parsing; supports nesting and cycle detection                                 |

**What "single file" really means:** delivery and transfer involve exactly one file. It does not mean opening `.mdpkg` in a text editor shows the fully rendered document — that is the job of `unpack` / `export` / `render`. Once opened, the same content can be exported to **md / html / docx / zip** from the CLI or browser library.

## Quick start

```bash
cd packages/mdpkg && npm install

# A minimal example
mkdir -p demo/assets demo/includes
printf '# Title (tm)\n\n![Image](assets/a.png)\n\n<<< includes/ch1.md\n' > demo/document.md
printf 'Chapter 1 (c) --> end\n' > demo/includes/ch1.md
head -c 5000 /dev/urandom > demo/assets/a.png      # any image

node src/cli.ts pack demo -o demo.mdpkg
node src/cli.ts validate demo.mdpkg
node src/cli.ts render demo.mdpkg -o demo.html        # open demo.html to view
```

Requires Node 22.18+ (runs `.ts` directly via built-in type stripping, no build step).

## Commands

| Command                          | Purpose                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `pack <dir> -o out.mdpkg`        | Pack. Defaults to all files in the directory; `--referenced-only` packs only the reference closure |
| `unpack <pkg> -o dir`            | Unpack with mandatory path validation and decompression limits                                     |
| `list <pkg>`                     | List entries (reads the header only, no decompression)                                             |
| `validate <pkg>`                 | Schema + size + sha256 + reference closure; counts external links                                  |
| `render <pkg> -o out.html`       | Defaults to inlined single-file HTML; auto-degrades to `--dir` when resources exceed 50 MB         |
| `export --raw <pkg> -o dir`      | Preserves structure, text untouched                                                                |
| `export --expanded <pkg> -o dir` | Includes expanded, relative paths rewritten against the package root (openable by any MD tool)     |
| `diff a.mdpkg b.mdpkg`           | Unpacks both and runs `diff -ruN`                                                                  |
| `render <pkg> --format docx -o out.docx` | Renders to OOXML document (resources embedded, SVG degraded to alt text)                           |
| `export --md <pkg> -o out.md`    | Exports expanded entry Markdown as a single file (include inlined, symbols kept as source text)    |
| `export --zip <pkg> -o out.zip`  | Exports a standard zip deliverable (expanded Markdown + resources + README, no manifest)          |

## Opening

`render`, `export`, and the browser `openMdpkg` accept not only `.mdpkg` but also **plain ZIP archives** (a directory tree with Markdown, no `manifest.json`). The `.zip` extension is treated the same as `.mdpkg`.

When no `manifest.json` is present, the entrypoint is inferred by this priority: `document.md` (at any depth, shallowest wins) > `README.md` > `README.zh-CN.md` > first remaining `.md` in lexicographic order. Hidden paths (starting with `.`) are excluded. If no `.md` file exists, opening fails with `MDPKG-E303`.

Lenient-opened packages are flagged as **unverified source (missing manifest.json)**: the CLI prints a notice on stderr, and the browser API returns `unverified: true` along with `entry` (the actual entrypoint inferred). This is separate from `degraded` (the >50 MB resource fallback) — consumers adding lenient-open support should handle the new `unverified` and `entry` fields. The `demo.html` viewer shows an "unverified" badge for such packages.

`validate` still rejects packages without a manifest (`MDPKG-E102`); lenient opening provides no integrity check (there is no declaration to verify). Re-packaging a lenient-opened archive with `pack` produces a conformant `.mdpkg`.

The browser library also opens **`.md` files directly** (single-file render; `<<<` include directives degrade to visible text) and supports **dropping in a folder** (sibling attachments are collected and images inlined). Relative references resolve against the document's directory: `../assets/a.png` and `./` refs match package resources, and non-ASCII (e.g. Chinese) paths are supported.

## Browser library

`packages/mdpkg/web/` ships `mdpkg-web` — an ESM/IIFE bundle for browsers. Build with `npm run build:web`.

Opening:
- `openMdpkg` — reads `.mdpkg` / `.zip` packages
- `openMarkdown` — renders a single `.md` file
- `openFiles` — unified entry for arbitrary `Map<string, Uint8Array>` / directory collections

Editing:
- `packMdpkg` — repacks edits (byte-identical to CLI `pack`)
- `readEntrySource` — reads a single entry's source text

Export:
- `toMarkdown` — expanded Markdown (include inlined, symbols kept as source text)
- `toHtml` — self-contained HTML (same pipeline as `openMdpkg().html`)
- `toDocx` — OOXML document (resources embedded, SVG degraded to alt text)
- `toZip` — standard zip deliverable (expanded Markdown + resources + README)

Utilities:
- `expand` — include expansion + path rewriting
- `buildManifest` — construct a manifest from files
- `toBase64` — bytes to base64
- `MdeError` — error class

Export format matrix: **md** / **mdpkg** / **html** / **zip** / **docx** (pdf falls back to browser print). `demo.html` exercises the full flow including the export bar.

## Format

`.mdpkg` is a **standard ZIP** whose root contains `manifest.json` (version, entrypoint, and a resource index including sha256).

- Reproducible builds: mtime fixed to `1980-01-01`, entries sorted by path ascending, identical input always produces identical bytes → Git-friendly, cacheable
- Integrity: size + sha256 detect corruption / misdelivery / cross-platform byte drift; **not** tamper-proof (manifest and resources live in the same package; tamper-resistance requires signing, not provided in v1)
- Graceful degradation: unpacking yields standard Markdown; `<<<` is visible text in renderers without support

Full specification: [`spec/mdpkg-format-spec.md`](spec/mdpkg-format-spec.md) (Chinese, source of truth) · English translation [`spec/mdpkg-format-spec.en.md`](spec/mdpkg-format-spec.en.md) · rendered spec page [spec.html](https://jianxi-dev.github.io/mdpkg/spec.html)

## Tests

```bash
cd packages/mdpkg && node --test test/*.test.ts
# 225 tests
```

Fixtures are implementation-agnostic data (`case.json` + `input/`); any implementation passing the same set is considered conformant.

## Positioning and known gaps

**Self-use first, standardization later.** This is a format being validated through real use, not an established standard. If after 3 months of self-use there is no second user or implementer, it should be demoted to an internal tool and spec-governance effort stops.

Known gaps:

- `--fetch` (downloading external links) is not provided — it would introduce network dependencies and an SSRF surface, conflicting with the "no download, predictable" stance
- No VS Code extension (not started until adoption feasibility is validated)

## License

Spec text CC BY 4.0; implementation code MIT; test vectors (`spec/fixtures/`) CC0 for frictionless copying. The symbol mapping table references PyMdown Extensions (MIT).
