import { apply } from '../index.js';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));

function makeCtx() {
  const registered = [];
  return {
    registered,
    logger: { info: (...a) => console.log('[ctx-log]', ...a) },
    on(ev, fn) { if (ev === 'dispose') this._dispose = fn; },
    tools: {
      register(tool) {
        if (!tool?.name || typeof tool?.execute !== 'function') throw new Error('bad tool def: ' + tool?.name);
        registered.push(tool);
      },
    },
  };
}

const ctx = makeCtx();
apply(ctx, {
  pythonPath: process.env.WARDBYTE_PYTHON,
  workerPath: undefined, // default: packaged worker next to index.js
});

console.log('registered tools:', ctx.registered.length);
if (ctx.registered.length !== 26) {
  console.error('FAIL: expected 26 tools');
  process.exit(1);
}
const byName = new Map(ctx.registered.map(t => [t.name, t]));

async function run(name, args) {
  const tool = byName.get(name);
  if (!tool) return `BOUNCE: no tool ${name}`;
  try {
    const res = await tool.execute(args ?? {});
    const d = res?.data ?? res;
    return res?.success === false
      ? `ERR ${d?.error?.code ?? d?.code}`
      : `ok: ${JSON.stringify(d)?.slice(0, 140)}`;
  } catch (e) {
    return `THREW: ${e.message?.slice(0, 140)}`;
  }
}

let failures = 0;
function check(label, cond) {
  if (cond) console.log(`  [PASS] ${label}`);
  else { failures++; console.log(`  [FAIL] ${label}`); }
}

const t1 = await run('assemble_code', { code: 'mov eax, 1\nret', architecture: 'x86-64' });
check(`T3 assemble_code (${t1})`, t1.startsWith('ok:'));
const t2 = await run('notes_save', { name: 'plugin-smoke-test', content: { hello: 'wardbyte' }, approve: true });
check(`T4 notes_save (${t2})`, t2.startsWith('ok:'));
const t3 = await run('notes_read', { name: 'plugin-smoke-test' });
check(`T5 notes_read (${t3})`, t3.startsWith('ok:'));
const t4 = await run('notes_delete', { name: 'plugin-smoke-test', approve: true });
check(`T6 notes_delete (${t4})`, t4.startsWith('ok:'));
const t5 = await run('notes_read', { name: 'plugin-smoke-test' });
check(`T7 deleted note gone (${t5})`, t5.startsWith('ERR FILE_NOT_FOUND'));
const t6 = await run('json_query', { path: ROOT + 'package.json', key: 'name' });
check(`T9 json_query (${t6})`, t6.includes('dsh-wardbyte'));
const t7 = await run('fs_list', { path: ROOT + 'worker' });
check(`T8 fs_list (${t7})`, t7.startsWith('ok:'));
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
