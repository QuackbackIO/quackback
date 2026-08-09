/**
 * Every registered handler module must load its whole graph statically.
 *
 * `primeJobHandlers()` imports each handler module once at tier start, before
 * any tenant scope is open, so no module executes its top level under one
 * tenant's connection. That guarantee reaches exactly as far as the *static*
 * import graph: a `await import(...)` inside a handler body runs at call time,
 * which is inside the per-pass tenant scope, and `resolveHandler`'s warning
 * cannot see it because it only guards the outer import.
 *
 * This was real rather than theoretical. Three of the seven handler modules
 * deferred their sweep modules to call time, and a top-level probe in
 * `sla.sweep.ts` read `(module not imported)` after priming and
 * `inst_gauntlet_alpha` after the tier ran the sweep — the module's top level
 * executed under a tenant scope, with no warning possible.
 *
 * A source scan is the right instrument because the property is about *when* a
 * module loads, which no runtime assertion in this process can observe after the
 * fact: once a module is in the registry there is no record of the scope it was
 * imported under.
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

describe('handler modules load their whole graph statically', () => {
  const modules = handlerModules()

  it('finds a real file for every registered queue', () => {
    // Without this the scan below could pass by scanning nothing — the shape
    // that has bitten this run repeatedly.
    expect(modules.length).toBe(JOB_DEFINITIONS.length)
    expect(modules.length).toBeGreaterThanOrEqual(7)
    for (const m of modules) {
      expect(fs.existsSync(m.file), `${m.queue} -> ${m.file}`).toBe(true)
    }
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
        `tenant scope around every pass, so that module's top level would run under ` +
        `whichever tenant reached it first. Import it statically.`
    ).toBe(0)
  })
})
