/**
 * No registered handler module defers a module to call time.
 *
 * **Read the title literally — it is one level deep, and it used to overclaim.**
 * This scan reads exactly the seven wrapper files named by `JOB_DEFINITIONS`. A
 * call-time `import()` one level below, inside `sla.sweep.ts`, kept this file
 * green while that module's top level ran under a workspace scope on the pooled
 * fleet.
 *
 * `primeJobHandlers()` imports each handler module once at tier start, before
 * any workspace scope is open, so no module executes its top level under one
 * workspace's connection. That guarantee reaches exactly as far as the *static*
 * import graph: a `await import(...)` inside a handler body runs at call time,
 * which is inside the per-pass workspace scope, and `resolveHandler`'s warning
 * cannot see it because it only guards the outer import.
 *
 * This was real rather than theoretical. Three of the seven handler modules
 * deferred their sweep modules to call time, and a top-level probe in
 * `sla.sweep.ts` read `(module not imported)` after priming and
 * `inst_cloud_alpha` after the tier ran the sweep — the module's top level
 * executed under a workspace scope, with no warning possible.
 *
 * Deepening it was measured and rejected rather than skipped. The modules these
 * seven statically import include `conversation.service` (6 call-time imports),
 * `pending-actions.service` (2) and `settings.service` (24) — ordinary lazy
 * loading throughout the app, none of it queue-specific. A scan that flagged
 * those would either fail on day one or need an allowlist that grows forever,
 * and neither is a guard.
 *
 * So the boundary is stated rather than blurred. **The queue guarantees the
 * handler wrappers and their static graph are loaded before any scope opens.**
 * It does not, and cannot, guarantee that about the whole application's lazy
 * graph: a module imported at call time runs under whatever scope its caller
 * has, which for a request is the *correct* workspace. That only becomes a hazard
 * when such a module captures scope-dependent state at its top level, and is
 * then shared process-wide.
 *
 * **The boundary, stated plainly:** this file covers exactly one property — the
 * registered handler wrappers contain no call-time `import()`, so their static
 * graph loads at prime time. It does NOT scan for module-scope mutable state:
 * a module that captures scope-dependent state at its top level and is then
 * shared process-wide is outside this file's reach wherever it loads from, and
 * no automated scan owns that hazard today — it is held by review, not by a
 * test.
 *
 * A source scan is the right instrument because the property is about *when* a
 * module loads, which no runtime assertion in this process can observe after the
 * fact: once a module is in the registry there is no record of the scope it was
 * imported under. `priming.test.ts` pins the other half — that priming actually
 * runs.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { JOB_DEFINITIONS } from '../definitions'

const SERVER_ROOT = path.resolve(__dirname, '../..')

/**
 * The module each definition's handler lives in, taken from the definition
 * source rather than a hand-kept list — a second list would drift from
 * JOB_DEFINITIONS and this test would then guard the wrong files.
 */
function handlerModules(): Array<{ queue: string; file: string }> {
  const source = fs.readFileSync(path.join(SERVER_ROOT, 'jobs/definitions.ts'), 'utf8')
  const out: Array<{ queue: string; file: string }> = []
  for (const def of JOB_DEFINITIONS) {
    // The `name: '<queue>'` entry and the `import('<specifier>')` that follows it.
    const at = source.indexOf(`name: '${def.name}'`)
    expect(at, `no definition block found for ${def.name}`).toBeGreaterThan(-1)
    const next = source.indexOf("import('", at)
    const end = source.indexOf("')", next)
    const specifier = source.slice(next + "import('".length, end)
    const rel = specifier.replace(/^@\/lib\/server\//, '')
    out.push({ queue: def.name, file: path.join(SERVER_ROOT, `${rel}.ts`) })
  }
  return out
}

describe('registered handler modules defer nothing to call time', () => {
  const modules = handlerModules()

  it('finds a real file for every registered queue', () => {
    // Without this the scan below could pass by scanning nothing — the shape
    // that has bitten this run repeatedly.
    expect(modules.length).toBe(JOB_DEFINITIONS.length)
    expect(modules.length).toBeGreaterThanOrEqual(7)
    for (const m of modules) {
      expect(fs.existsSync(m.file), `${m.queue} -> ${m.file}`).toBe(true)
    }
    // And every queue resolved to a DIFFERENT file. The derivation reads the
    // first `import('...')` after each `name:` marker, so a handler written
    // without one silently reuses the next definition's specifier: `existsSync`
    // still passes, one module gets scanned twice and one not at all.
    expect(
      new Set(modules.map((m) => m.file)).size,
      `two queues derived the same handler file — the derivation has drifted:\n` +
        modules.map((m) => `  ${m.queue} -> ${path.relative(SERVER_ROOT, m.file)}`).join('\n')
    ).toBe(modules.length)
  })

  it.each(handlerModules())('$queue has no call-time import', ({ file }) => {
    const src = fs.readFileSync(file, 'utf8')
    // Strip block and line comments so the prose above (which names the
    // anti-pattern) does not trip the scan on itself.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const dynamic = [...code.matchAll(/\bimport\s*\(/g)]
    expect(
      dynamic.length,
      `${path.relative(SERVER_ROOT, file)} defers a module to call time. The tier opens a ` +
        `workspace scope around every pass, so that module's top level would run under ` +
        `whichever workspace reached it first. Import it statically.`
    ).toBe(0)
  })
})
