# dsh-wardbyte

Wardbyte — the binary-analysis toolkit — as a **native [DeepSeek Harness](https://github.com/DeepSeek-AI) plugin**: 26 model-facing tools registered straight on the DSH tool table, driven by a persistent Python worker over JSON-lines stdio. No MCP bridge, no wire protocol between DSH and the server core.

## Tools (26)

Core is the pip-installed [`wardbyte`](https://pypi.org/project/wardbyte/) package (`WardbyteServer._dispatch`).

| Group | Tools |
|---|---|
| `[binary]` | `bin_stats`, `parse_binary`, `disassemble_bytes`, `bin_diff`, `yara_scan`, `func_xref`, `capa_scan`, `binary_assessment`, `assemble_code`, `emulate_code`, `strings_extract`, `section_info` |
| `[filesystem]` | `fs_list`, `fs_read`, `fs_stat`, `fs_search`, `fs_hash` |
| `[code-data]` | `tree_parse`, `search_text`, `json_query`, `sqlite_readonly` |
| `[notes]` | `notes_list`, `notes_read`, `notes_save`, `notes_search`, `notes_delete` |

Every result is the Wardbyte envelope `{ success, data?, error?: { code, message, detail? } }` — tool failures (bad path, denied policy, bad input) arrive as structured payloads, never as broken tool calls.

## Prerequisites

- **DeepSeek Harness** 0.2.2-rc.5 or compatible (bundle format `dsh.bundle.patch`).
- **Python 3.12+** with the Wardbyte server core installed:
  ```sh
  pip install wardbyte        # if it is published for your channel
  # or from the wardbyte source tree:
  pip install .
  ```
- **Node ≥ 20** (ships inside DSH).

## Installation

From a git checkout, in any session with the `plugin_manager` tool:

```
plugin_manager { "action": "install_bundle", "target": "C:/path/to/dsh-wardbyte" }
```

Or add the dependency manually in the profile's `package.json`:

```json
"dsh-wardbyte": "github:<you>/dsh-wardbyte"
```

…then add `"dsh-wardbyte"` to `dsh.profile.bundles` and restart DSH (or let HMR activate it).

If `python` is not on PATH, set `pythonPath` in `cordis.patch.yml` (see the commented example there). Other overridable options: `workerPath` (default: the packaged `worker/wardbyte_worker.py`), `startupTimeoutMs` (default `120000` — the first request pays the heavy `lief`/`capa`/`capstone`/`yara` imports), `toolTimeoutMs` (default `180000`; on timeout the worker is killed and will respawn on the next call).

## Troubleshooting

- **`The wardbyte Python package is not installed for this interpreter (...); install it with: pip install wardbyte`** — the plugin's Python worker could not import the server core. Install it for the same interpreter configured via `pythonPath`: `pip install wardbyte`.
- **First call slow** — wardbyte's first import (lief, capstone, unicorn, yara-python, flare-capa) is heavy; the startup budget is `startupTimeoutMs` (default 120 s) and only the first call pays for it.
- **`PATH_DENIED` / size-limit errors** — these come from Wardbyte's own policy gate, not the plugin; point the tool at a permitted path.

## Architecture

```
DSH agent ──tool call──▶ lib/tools.js (26 defs) ──invoke──▶ index.js worker client
   spawn(python, worker/wardbyte_worker.py)  ◀── JSON lines over stdio ──▶
   wardbyte_worker.py: WardbyteServer._dispatch(name, args)  →  structured result
```

- The worker starts **lazily** on the first tool call and stays warm for the profile's lifetime; `dispose` (plugin unmount) kills it.
- Wardbyte's own policy gate (restricted-dir + size limits), output clamping, and per-tool 20 s limits all still apply inside the worker.
- capa results are cached per file version for the worker process lifetime.

## Tests

```sh
node test/smoke-test.mjs      # registers via apply(ctx-stub) and exercises 9 scenarios
python test/test_worker.py    # drives the worker protocol directly over stdio
```

## License

[MIT](LICENSE)
