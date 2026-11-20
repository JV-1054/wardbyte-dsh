/**
 * dsh-wardbyte bundle entry.
 *
 * Registers 26 model-facing tools with `ctx.tools` that drive the local
 * Wardbyte binary-analysis toolkit through a persistent Python worker
 * (`worker/wardbyte_worker.py`) speaking JSON lines over stdio. The worker
 * imports the pip-installed `wardbyte` package and calls its server core
 * (`WardbyteServer._dispatch`) directly — no MCP wire protocol involved.
 *
 * Dependency-free: tool definitions are plain objects and the worker client
 * uses only Node built-ins (mirrors the dsh-rea bundle pattern).
 *
 * @module dsh-wardbyte
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { registerTools } from './lib/tools.js'

export const name = 'dsh-wardbyte'
export const inject = ['tools']

const DEFAULTS = {
  pythonPath: 'python',
  workerPath: join(dirname(fileURLToPath(import.meta.url)), 'worker', 'wardbyte_worker.py'),
  startupTimeoutMs: 120_000, // first request pays the heavy import (lief, capa, capstone, yara)
  toolTimeoutMs: 180_000,
}

function resolveOptions(config = {}) {
  const cfg = config && typeof config === 'object' ? config : {}
  return {
    pythonPath: typeof cfg.pythonPath === 'string' && cfg.pythonPath.trim() !== '' ? cfg.pythonPath.trim() : DEFAULTS.pythonPath,
    workerPath: typeof cfg.workerPath === 'string' && cfg.workerPath.trim() !== '' ? cfg.workerPath.trim() : DEFAULTS.workerPath,
    startupTimeoutMs: positiveInt(cfg.startupTimeoutMs, DEFAULTS.startupTimeoutMs),
    toolTimeoutMs: positiveInt(cfg.toolTimeoutMs, DEFAULTS.toolTimeoutMs),
  }
}

function positiveInt(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/**
 * Mount the tools.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {Record<string, unknown>} [config] - loader-entry `config:` overrides.
 */
export function apply(ctx, config = {}) {
  const options = resolveOptions(config)
  const worker = createWorkerClient(options)
  registerTools(ctx, worker)

  // Kill the persistent worker when the plugin unmounts (cordis dispose event).
  try {
    ctx.on('dispose', () => worker.dispose())
  } catch {
    // A context without event support keeps the worker until process exit.
  }

  reportMount(ctx, options, worker)
}

/** Best-effort mount note; logging must never break the mount itself. */
function reportMount(ctx, options, worker) {
  try {
    const logger = ctx.logger
    if (typeof logger?.info !== 'function') return
    logger.info(
      `dsh-wardbyte: tools=26 python=${options.pythonPath} ` +
        `worker=${options.workerPath} state=${worker.state}`,
    )
  } catch {
    // A logger that is absent or shaped differently is not a mount failure.
  }
}

/**
 * @param {{ pythonPath: string, workerPath: string, startupTimeoutMs: number, toolTimeoutMs: number }} options
 */
function createWorkerClient(options) {
  let child = null
  let ready = false
  let readyPromise = null
  let nextRequestId = 1
  const pending = new Map() // id -> { resolve, reject, push, timer, settled, startedAt }

  const state = () =>
    child === null ? 'idle' : ready ? 'ready' : 'starting'

  function describe() {
    return { state: state(), pythonPath: options.pythonPath, workerPath: options.workerPath }
  }

  function killWorker(reason) {
    const old = child
    child = null
    ready = false
    readyPromise = null
    if (old) {
      try { old.kill() } catch { /* ignore */ }
    }
    for (const entry of pending.values()) {
      entry.settled = true
      clearTimeout(entry.timer)
      entry.reject(new Error(`wardbyte worker ${reason ?? 'exited unexpectedly'}`))
    }
    pending.clear()
  }

  function ensureWorker() {
    if (child) return child
    const spawned = spawn(
      options.pythonPath,
      ['-u', options.workerPath],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    )
    let stdoutBuf = ''
    spawned.stdout.setEncoding('utf8')
    spawned.stdout.on('data', chunk => {
      stdoutBuf += chunk
      let nl
      while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim()
        stdoutBuf = stdoutBuf.slice(nl + 1)
        if (!line) continue
        handleMessage(line)
      }
    })
    spawned.stderr.on('data', chunk => {
      const text = chunk.toString('utf8')
      try { ctxLogs.push(text.slice(0, 4000)) } catch { /* ring capped */ }
      if (ctxLogs.length > 20) ctxLogs.shift()
    })
    spawned.on('exit', (code, signal) => {
      const wasCurrent = child === spawned
      if (wasCurrent) {
        const reason = signal ? `terminated by ${signal}` : `exited with code ${code ?? 'null'}`
        killWorker(reason)
      }
    })
    spawned.on('error', err => {
      const wasCurrent = child === spawned
      if (wasCurrent) killWorker(`spawn error: ${err?.message ?? err}`)
    })
    child = spawned
    return spawned
  }

  const ctxLogs = []

  function handleMessage(line) {
    let msg
    try { msg = JSON.parse(line) } catch {
      // Startup banners or non-JSON lines are ignored (wardbyte logs to stderr, but be safe)
      return
    }
    if (msg && msg.ready) {
      ready = true
      return
    }
    if (msg && msg.fatal) {
      killWorker(`fatal: ${msg.fatal}`)
      return
    }
    const id = typeof msg?.id === 'number' ? msg.id : null
    if (id === null) return
    const entry = pending.get(id)
    if (!entry || entry.settled) return
    entry.settled = true
    clearTimeout(entry.timer)
    pending.delete(id)
    if (msg.ok) entry.resolve(msg.result)
    else entry.reject(new Error(`wardbyte worker: ${msg.error ?? 'unknown error'}`))
  }

  function request(name, args, timeoutMs, isStartup) {
    const childProc = ensureWorker()
    const id = nextRequestId++
    const payload = JSON.stringify({ id, name, arguments: args ?? {} }) + '\n'
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, settled: false, timer: null, startedAt: Date.now() }
      pending.set(id, entry)
      entry.timer = setTimeout(() => {
        if (entry.settled) return
        entry.settled = true
        pending.delete(id)
        killWorker(`timed out after ${timeoutMs}ms on request ${name} (request killed, worker respawned)`)
        reject(new Error(`wardbyte worker timed out after ${timeoutMs}ms on ${name}; the worker was killed and will respawn on the next call`))
      }, timeoutMs)
      try {
        childProc.stdin.write(payload)
      } catch (err) {
        if (!entry.settled) {
          entry.settled = true
          clearTimeout(entry.timer)
          pending.delete(id)
          reject(new Error(`wardbyte worker stdin write failed: ${err?.message ?? err}`))
        }
      }
    })
  }

  async function remountReady() {
    if (readyPromise && ready) return readyPromise
    readyPromise = (async () => {
      const started = Date.now()
      const deadline = started + options.startupTimeoutMs
      while (!ready && child && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 100))
      }
      if (!ready || !child) throw new Error('wardbyte worker did not become ready')
    })()
    return readyPromise
  }

  return {
    get state() { return state() },
    describe,
    recentLogs: () => ctxLogs.slice(),
    async call(name, args) {
      if (!ready) {
        // Guarantees the worker is spawned and past its ready handshake before
        // the real request is written, so the first call is not racing setup.
        if (child === null) ensureWorker()
        await remountReady()
      }
      return request(name, args, options.toolTimeoutMs, false)
    },
    dispose() {
      killWorker('disposed')
    },
  }
}

// Regression guard used by `test/` in the source repo — cheap here too.
if (process.env.DSH_WARDBYTE_SELFTEST === '1') {
  const schema = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'lib', 'tools.js'), 'utf8')
  if (!schema.includes('binary_assessment')) throw new Error('dsh-wardbyte selftest: tool table missing')
}
