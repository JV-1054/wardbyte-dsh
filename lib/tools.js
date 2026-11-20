/**
 * dsh-wardbyte tool table.
 *
 * Plain-object tool definitions registered through `ctx.tools.register`
 * (mirrors the dsh-rea bundle pattern; no framework imports). Schemas mirror
 * Wardbyte 1.3.0 `_handle_list_tools` exactly: names, descriptions, params.
 *
 * @module dsh-wardbyte/lib/tools
 */

const ARCH_BINARY = { type: 'string', enum: ['x86', 'x86-64', 'arm', 'arm64'] }
const ARCH_ASSEMBLER = { type: 'string', enum: ['x86', 'x86-64', 'arm64'] }

/**
 * Drop undefined values so the worker-side defaults apply.
 * @param {Record<string, unknown>|undefined} args
 */
function sanitize(args) {
  const out = {}
  for (const [k, v] of Object.entries(args ?? {})) {
    if (v !== undefined) out[k] = v
  }
  return out
}

const pathParam = (description = 'Target path.') => ({ type: 'string', required: true, description })
const bool = (description) => ({ type: 'boolean', description })
const integer = (description) => ({ type: 'integer', description })

const renderJson = (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }]

/**
 * Build a tool definition given the worker invoker.
 * @param {string} name
 * @param {string} description
 * @param {Record<string, object>} properties
 * @param {(name: string, args: Record<string, unknown>) => Promise<unknown>} invoke
 */
function tool(name, description, properties, invoke) {
  const required = Object.keys(properties).filter(k => properties[k]?.required === true)
  const fields = {}
  for (const [key, spec] of Object.entries(properties)) {
    const { required: _r, ...rest } = spec
    fields[key] = rest
  }
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties: fields,
      required,
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        description: 'Wardbyte result envelope: { success: boolean, data?: object, error?: { code, message, detail? } }.',
      },
      render: renderJson,
    },
    async execute(args) {
      return invoke(name, sanitize(args))
    },
  }
}

/* ------------------------------------------------------------------ */
/* Definitions — grouped as the server documents them                   */
/* ------------------------------------------------------------------ */

/** @type {Array<[string, string, Record<string, object>]>} */
const TABLE = [
  // [binary]
  ['bin_stats', '[binary] Binary triage: size, hashes, entropy, strings.', {
    path: pathParam('Path to the binary file.'),
    include_imphash: bool('Also compute the import-table imphash. Defaults to false.'),
    include_ssdeep: bool('Also compute the ssdeep fuzzy hash. Defaults to false.'),
    include_tlsh: bool('Also compute the TLSH fuzzy hash. Defaults to false.'),
  }],
  ['parse_binary', '[binary] Parse ELF/PE/Mach-O structure via LIEF.', {
    path: pathParam('Path to the binary file.'),
  }],
  ['disassemble_bytes', '[binary] Disassemble machine code via Capstone. Offset optional: omit it to start at the main code section (.text/__text) automatically.', {
    path: pathParam('Path to the binary file.'),
    offset: integer('File offset to start disassembly. Omit to auto-start at the main code section.'),
    length: integer('Number of bytes to disassemble. Defaults to 256.'),
    architecture: { ...ARCH_BINARY, description: 'Instruction set. Defaults to x86-64.' },
    base_address: { type: 'string', description: "Hex base address (e.g. '0x1000'). Defaults to the code section's virtual address when offset is omitted." },
    instruction_count: integer('Maximum instructions to decode. Defaults to 100.'),
  }],
  ['bin_diff', '[binary] Compare two binary files.', {
    path_a: pathParam('First file.'),
    path_b: pathParam('Second file.'),
  }],
  ['yara_scan', '[binary] YARA signature scan (local rules).', {
    path: pathParam('Path to the binary file.'),
    rules_file: { type: 'string', description: 'Optional local YARA rules file.' },
  }],
  ['func_xref', '[binary] Function cross-reference analysis (LIEF + Capstone).', {
    path: pathParam('Path to the binary file.'),
    function_name: { type: 'string', description: 'Function name or mangled symbol.' },
  }],
  ['capa_scan', '[binary] FLARE capa capability analysis. Results are cached per file version (kept until file changes).', {
    path: pathParam('Path to the binary file.'),
  }],
  ['binary_assessment', '[binary] Composite static analysis (stats, parse, xref, yara, capa).', {
    path: pathParam('Path to the binary file.'),
  }],
  ['assemble_code', '[binary] Assemble assembly code via Keystone.', {
    code: { type: 'string', required: true, description: 'Assembly code text.' },
    architecture: { ...ARCH_ASSEMBLER, description: 'Architecture. Defaults to x86-64.' },
  }],
  ['emulate_code', '[binary] Emulate machine code via Unicorn (sandboxed, no host access).', {
    code_hex: { type: 'string', required: true, description: 'Machine code to emulate, hex encoded.' },
    architecture: { ...ARCH_ASSEMBLER, description: 'Architecture. Defaults to x86-64.' },
    base_address: { type: 'string', description: 'Hex base address (e.g. 0x1000). Defaults to 0x1000.' },
    max_instructions: integer('Maximum instructions to run. Defaults to 1000.'),
    timeout_seconds: integer('Emulation time limit in seconds. Defaults to 10.'),
  }],
  ['strings_extract', '[binary] Extract printable ASCII strings from a binary with byte offsets.', {
    path: pathParam('Path to the binary file.'),
    min_length: integer('Minimum string length. Defaults to 4.'),
    max_strings: integer('Maximum strings to return. Defaults to 500.'),
  }],
  ['section_info', '[binary] Per-section details for a binary (PE/ELF/Mach-O).', {
    path: pathParam('Path to the binary file.'),
  }],

  // [filesystem]
  ['fs_list', '[filesystem] List directory contents.', {
    path: pathParam('Directory path.'),
    recursive: bool('Recurse into subdirectories. Defaults to false.'),
  }],
  ['fs_read', '[filesystem] Read file bytes (bounded).', {
    path: pathParam('Path to the file.'),
    offset: integer('Starting byte offset. Defaults to 0.'),
    length: integer('Maximum bytes to read. Omit to use the server-configured bound.'),
  }],
  ['fs_stat', '[filesystem] File/directory metadata.', {
    path: pathParam('Target path.'),
  }],
  ['fs_search', '[filesystem] Search text within files.', {
    path: pathParam('Directory path.'),
    pattern: { type: 'string', required: true, description: 'Text pattern to search.' },
    case_sensitive: bool('Match case. Defaults to false.'),
    extension: { type: 'string', description: 'Optional file extension filter.' },
  }],
  ['fs_hash', '[filesystem] Hash a file.', {
    path: pathParam('Path to the file.'),
    algorithm: { type: 'string', description: 'Hash algorithm. Defaults to sha256.' },
  }],

  // [code-data]
  ['tree_parse', '[code-data] Syntax-aware code parsing via Tree-sitter.', {
    path: pathParam('Path to the source file.'),
    language: { type: 'string', description: "Tree-sitter language id (e.g. 'python', 'go'). Omit to auto-detect." },
  }],
  ['search_text', '[code-data] Search text within files (alias for fs_search).', {
    path: pathParam('Directory path.'),
    pattern: { type: 'string', required: true, description: 'Text pattern to search.' },
    case_sensitive: bool('Match case. Defaults to false.'),
    extension: { type: 'string', description: 'Optional file extension filter.' },
  }],
  ['json_query', '[code-data] Safe dotted-key/array-index JSON query.', {
    path: pathParam('JSON file path.'),
    key: { type: 'string', required: true, description: 'Dotted key path, e.g. a.b[0].c' },
  }],
  ['sqlite_readonly', '[code-data] Read-only SQLite query.', {
    path: pathParam('SQLite database path.'),
    query: { type: 'string', required: true, description: 'SQL SELECT query.' },
    max_rows: integer('Maximum rows to return. Defaults to 100.'),
  }],

  // [notes]
  ['notes_list', '[notes] List analyst notes.', {}],
  ['notes_read', '[notes] Read an analyst note.', {
    name: { type: 'string', required: true, description: 'Note name.' },
  }],
  ['notes_save', '[notes] Save an analyst note (requires approve=True).', {
    name: { type: 'string', required: true, description: 'Note name.' },
    content: { type: 'object', required: true, description: 'Note content (JSON object).' },
    approve: bool('Must be true to allow saving. Defaults to false.'),
  }],
  ['notes_search', '[notes] Search analyst note contents.', {
    query: { type: 'string', required: true, description: 'Search query.' },
    case_sensitive: bool('Match case. Defaults to false.'),
  }],
  ['notes_delete', '[notes] Delete an analyst note by name (requires approve=True).', {
    name: { type: 'string', required: true, description: 'Note name.' },
    approve: bool('Must be true to allow deleting. Defaults to false.'),
  }],
]

/**
 * Register all 26 tools.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {{ call: (name: string, args: Record<string, unknown>) => Promise<object> }} worker
 */
export function registerTools(ctx, worker) {
  let count = 0
  for (const [name, description, properties] of TABLE) {
    ctx.tools.register(tool(name, description, properties, (t, args) => worker.call(t, args)))
    count++
  }
  return count
}
