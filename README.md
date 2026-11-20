<p align="center">
  <a href="https://github.com/JV-1054/wardbyte-dsh/stargazers"><img src="https://img.shields.io/github/stars/JV-1054/wardbyte-dsh?style=social" alt="Stars"></a>
  <a href="https://github.com/JV-1054/wardbyte-dsh/forks"><img src="https://img.shields.io/github/forks/JV-1054/wardbyte-dsh?style=social" alt="Forks"></a>
  <a href="https://github.com/JV-1054/wardbyte-dsh/issues"><img src="https://img.shields.io/github/issues/JV-1054/wardbyte-dsh?style=flat" alt="Issues"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-5eead4?style=flat-square" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/DSH-0.2.2--rc.5-7c3aed?style=flat-square" alt="DSH 0.2.2-rc.5">
  <img src="https://img.shields.io/badge/tools-26-5eead4?style=flat-square" alt="26 tools">
  <img src="https://img.shields.io/badge/dependencies-0%20runtime-f97316?style=flat-square" alt="Zero runtime dependencies">
</p>

# dsh-wardbyte

**Wardbyte binary analysis, as 26 first-class tools inside DeepSeek Harness.**

An agent can now *triage a binary, parse its headers, disassemble it, hunt it with YARA rules, fingerprint its
capabilities with FLARE capa, assemble shellcode, and emulate it* — as ordinary tool calls, with no MCP bridge,
no wire protocol, and no external service to keep alive.

```
$ bin_stats    path=target/sample.exe        →  size, md5/sha1/sha256, entropy, imphash, ssdeep, tlsh, strings
$ parse_binary path=target/sample.exe        →  ELF / PE / Mach-O structure via LIEF
$ capa_scan    path=target/sample.exe        →  FLARE capa capability findings
$ emulate_code code_hex=b801000000c3         →  Unicorn-sandboxed execution
```

---

## Why native instead of MCP?

The Wardbyte core is an MCP server. Pointing DSH at it over stdio works — but it puts a JSON-RPC session,
a transport, and a second process lifecycle between the agent and the analysis engine. This bundle removes that
layer entirely:

| | MCP bridge | **dsh-wardbyte (native)** |
|---|---|---|
| Tool names in the agent's tool table | `mcp__wardbyte__bin_stats` | `bin_stats` |
| Transport | JSON-RPC over stdio | in-process call → one JSON line |
| Extra process per session | server + client | **none** (the Python worker *is* the analysis engine) |
| Failure surface | transport errors, session resync, handshake timeouts | structured payload, same as any other tool |
| Tool schema source | re-declared in the MCP client | mirrored once, in `lib/tools.js` |

The Python worker is still a separate process — the analysis libraries (`lief`, `capstone`, `yara`, `capa`,
`unicorn`, `keystone`) are native and heavy — but it is a **direct** line to `WardbyteServer._dispatch`, not a
protocol negotiation. One request in, one JSON line out.

---

## Install

### 1. Install the Wardbyte core (Python)

The analysis engine is the `wardbyte` Python package. A prebuilt wheel ships with this repository's
releases, so no compiler is needed:

```sh
pip install https://github.com/JV-1054/wardbyte-dsh/releases/download/wardbyte-core-v1.2.1/wardbyte-1.2.1-py3-none-any.whl
```

<details>
<summary>Or install from the source distribution</summary>

```sh
pip install https://github.com/JV-1054/wardbyte-dsh/releases/download/wardbyte-core-v1.2.1/wardbyte-1.2.1.tar.gz
```
</details>

<details>
<summary>Or build from a source checkout</summary>

```sh
cd path/to/wardbyte
pip install .
```
</details>

Verify the core is importable before continuing:

```sh
python -c "import wardbyte; print(wardbyte.__version__)"
```

### 2. Install the DSH bundle

From any DeepSeek Harness session with the `plugin_manager` tool:

```
plugin_manager { "action": "install_bundle", "target": "github:JV-1054/wardbyte-dsh" }
```

Or add it to your profile's `package.json`:

```json
{
  "dependencies": { "dsh-wardbyte": "github:JV-1054/wardbyte-dsh" },
  "dsh": { "profile": { "bundles": ["dsh-wardbyte"] } }
}
```

### 3. Restart DSH

The 26 tools appear on the agent's tool table after a restart. If `python` is not on your `PATH`, set
`pythonPath` in `cordis.patch.yml` (see [Configuration](#configuration)).

---

## The 26 tools

Every tool returns the Wardbyte envelope — `{ success, data?, error?: { code, message, detail? } }`.
A denied path, a missing file, or bad input arrives as a **readable structured payload**, never as a broken
tool call.

### Binary analysis — 12 tools

| Tool | What it does | Key parameters |
|---|---|---|
| `bin_stats` | Size, hashes (md5/sha1/sha256), entropy, string count, optional imphash / ssdeep / tlsh | `path`, `include_imphash`, `include_ssdeep`, `include_tlsh` |
| `parse_binary` | Full ELF / PE / Mach-O structure via LIEF | `path` |
| `section_info` | Per-section details for a binary | `path` |
| `disassemble_bytes` | Capstone disassembly; offset omitted → auto-start at `.text`/`__text` | `path`, `offset`, `length` (256), `architecture` (x86-64), `base_address`, `instruction_count` (100) |
| `func_xref` | Function cross-references (LIEF + Capstone) | `path`, `function_name` |
| `bin_diff` | Structural diff of two binaries | `path_a`, `path_b` |
| `yara_scan` | YARA signature scan with local rules | `path`, `rules_file` |
| `capa_scan` | FLARE capa capability analysis (cached per file version) | `path` |
| `binary_assessment` | Composite: stats + parse + xref + YARA + capa in one call | `path` |
| `strings_extract` | Printable ASCII strings with byte offsets | `path`, `min_length` (4), `max_strings` (500) |
| `assemble_code` | Assemble source with Keystone | `code`, `architecture` (x86-64) |
| `emulate_code` | Emulate machine code in Unicorn (sandboxed, no host access) | `code_hex`, `architecture`, `base_address` (0x1000), `max_instructions` (1000), `timeout_seconds` (10) |

### Filesystem — 5 tools

| Tool | What it does | Key parameters |
|---|---|---|
| `fs_list` | List a directory | `path`, `recursive` |
| `fs_read` | Read file bytes (bounded) | `path`, `offset`, `length` |
| `fs_stat` | File / directory metadata | `path` |
| `fs_search` | Search text within files | `path`, `pattern`, `case_sensitive`, `extension` |
| `fs_hash` | Hash a file | `path`, `algorithm` (sha256) |

### Code & data — 4 tools

| Tool | What it does | Key parameters |
|---|---|---|
| `tree_parse` | Syntax-aware parsing via Tree-sitter | `path`, `language` (auto-detect) |
| `search_text` | Text search (alias of `fs_search`) | `path`, `pattern`, `case_sensitive`, `extension` |
| `json_query` | Safe dotted-key / array-index JSON read (`a.b[0].c`) | `path`, `key` |
| `sqlite_readonly` | Read-only SQLite `SELECT` | `path`, `query`, `max_rows` (100) |

### Analyst notes — 5 tools

| Tool | What it does | Key parameters |
|---|---|---|
| `notes_list` | List saved notes | — |
| `notes_read` | Read one note | `name` |
| `notes_save` | Save a note (requires `approve: true`) | `name`, `content` (object), `approve` |
| `notes_search` | Search note contents | `query`, `case_sensitive` |
| `notes_delete` | Delete a note (requires `approve: true`) | `name`, `approve` |

---

## See it work

Real captures from this repository's own worker — no mocks.

**Triage a binary**

```jsonc
// → bin_stats { path: "worker/wardbyte_worker.py", include_imphash: true }
{
  "success": true,
  "data": {
    "path": "worker/wardbyte_worker.py",
    "size": 2436,
    "md5": "4a7042d8df5a30bc4ac988c1dabb523e",
    "sha1": "40fe39c389126c60098ee6b5d52d58069e745e67",
    "sha256": "ea546706a5065f0e8b13cece6f034fd5b1d7d60efbacc75c68d6df85042c7a0f",
    "entropy": 4.5965,
    "strings_count": 56,
    "strings_preview": ["…"],
    "output_truncated": false
  }
}
```

**Assemble and emulate**

```jsonc
// → assemble_code { code: "mov eax, 1; ret" }
{
  "success": true,
  "data": {
    "architecture": "x86-64",
    "bytes": "b801000000c3",
    "length": 6,
    "instruction_count": 2,
    "note": "Saving assembled output requires a separate save operation with operator approval."
  }
}

// → emulate_code { code_hex: "b801000000c3" }
{
  "success": true,
  "data": {
    "architecture": "x86-64",
    "base_address": "0x1000",
    "code_size": 6,
    "instructions_executed": 2,
    "max_instructions": 1000,
    "registers": {},
    "stopped": false
  }
}
```

**A refusal, handled gracefully**

```jsonc
// → bin_stats { path: "C:\\Windows\\System32\\notepad.exe" }
{
  "success": false,
  "error": {
    "code": "PATH_DENIED",
    "message": "Path is in a restricted system directory: C:\\Windows\\System32\\notepad.exe",
    "detail": "Path: C:\\Windows\\System32\\notepad.exe"
  }
}
```

The agent reads that, adapts, and moves on — the call did not fail, and the session did not stall.

---

## Architecture

```
      DSH agent
          │  tool call: { name, arguments }
          ▼
   lib/tools.js ────────────── 26 plain-object tool definitions
          │                     (name, description, JSON-Schema parameters)
          │  worker.call(name, args)
          ▼
   index.js ────────────────── worker client: spawn, line-buffer stdout,
          │                     match by id, timeouts, respawn, dispose
          │  spawn(python, worker/wardbyte_worker.py)
          ▼
   worker/wardbyte_worker.py ─ one JSON object per line, both directions
          │
          ▼
   WardbyteServer._dispatch() ─ the real engine: lief · capstone · yara ·
                                  capa · unicorn · keystone · tree-sitter
```

- **Lazy start.** The worker spawns on the *first* tool call, not at mount — DSH starts fast even with the
  bundle installed.
- **Warm and persistent.** One process serves every call for the profile's lifetime; `dispose` (plugin
  unmount) kills it.
- **Crash-safe.** A worker crash, a fatal startup, or a timeout rejects the *in-flight* call with a readable
  message and respawns the worker on the next call.
- **Policy-aware.** Wardbyte's own policy gate (restricted directories, size limits, output clamping) still
  applies inside the worker. The plugin does not widen it.
- **Zero runtime dependencies.** The bundle is plain Node built-ins — no `node_modules`, nothing to audit
  beyond this repository.

---

## Configuration

All options live in `cordis.patch.yml` under the bundle's `config:` key.

```yaml
- insert:
    id: dsh-wardbyte
    name: dsh-wardbyte
    config:
      # pythonPath: C:/Python312/python.exe   # defaults to `python` on PATH
      # workerPath: /custom/wardbyte_worker.py
      # startupTimeoutMs: 120000
      # toolTimeoutMs: 180000
```

| Option | Default | Meaning |
|---|---|---|
| `pythonPath` | `python` | Interpreter used to run the worker. Point it at the same interpreter that has `wardbyte` installed. |
| `workerPath` | bundled `worker/wardbyte_worker.py` | Override to run a patched worker. |
| `startupTimeoutMs` | `120000` | Budget for the worker's first import (`lief`, `capa`, `capstone`, `yara` are heavy). |
| `toolTimeoutMs` | `180000` | Per-call budget. On timeout the worker is killed and respawns on the next call. |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `The wardbyte Python package is not installed for this interpreter (…)` | The worker ran under an interpreter without the core | Install the wheel (see [Install](#install)) for that interpreter, or set `pythonPath` to the one that has it |
| First call takes a while, then everything is fast | First import pulls in `lief`, `capstone`, `unicorn`, `yara-python`, `flare-capa` | Expected — only the first call pays. Raise `startupTimeoutMs` if it trips |
| `PATH_DENIED` | Wardbyte's own policy gate protects system directories | Point the tool at a permitted path |
| `FILE_NOT_FOUND` / size-limit error | The file is missing, or larger than the configured cap | Check the path; Wardbyte caps binaries at 64 MB by default |
| `capa failed (exit 16)` | The input is not a format capa recognises | capa only analyses executables; use `bin_stats` or `parse_binary` for other files |
| Tools missing from the agent's tool table | DSH has not reloaded the bundle | Restart DSH, or confirm `dsh-wardbyte` is listed in `dsh.profile.bundles` |

---

## Development

```sh
node test/smoke-test.mjs      # registers all 26 tools through a stub ctx and exercises 9 scenarios
python test/test_worker.py    # drives the worker protocol directly over stdio
node --check index.js && node --check lib/tools.js   # syntax
python -m py_compile worker/wardbyte_worker.py       # syntax
```

```
dsh-wardbyte/
├── index.js                  bundle entry: worker client, tool registration, dispose
├── lib/tools.js              the 26 tool definitions and their JSON-Schema parameters
├── worker/wardbyte_worker.py JSON-lines bridge to WardbyteServer._dispatch
├── cordis.patch.yml          bundle registration + config
├── locale/en.json            plugin metadata (title, description)
├── icon.svg                  plugin icon
└── test/                     smoke tests (Node + Python)
```

---

## Contributing

Issues and pull requests are welcome.

- Keep tool definitions in `lib/tools.js` in sync with Wardbyte's `_handle_list_tools` — names, descriptions
  and parameters are mirrored exactly so behaviour matches the core.
- New tools need: a schema entry, a dispatch name, and a scenario in `test/smoke-test.mjs`.
- Run both test suites before opening a PR.

---

## Credits

- **Wardbyte** — the binary-analysis toolkit this bundle serves (installed from the wheel above).
- **[FLARE capa](https://github.com/mandiant/capa)** — capability identification (Apache-2.0).
- **[LIEF](https://github.com/lief-project/LIEF)**, **[Capstone](https://github.com/capstone-engine/capstone)**,
  **[Unicorn](https://github.com/unicorn-engine/unicorn)**, **[Keystone](https://github.com/keystone-engine/keystone)**,
  **[yara-python](https://github.com/VirusTotal/yara-python)** — the engines behind the tools.
- **[DeepSeek Harness](https://github.com/DeepSeek-AI)** — the plugin platform.

## License

[MIT](LICENSE) © 2026 Juniper
