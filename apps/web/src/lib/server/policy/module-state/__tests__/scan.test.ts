/**
 * Attacking the scanner.
 *
 * Piece 5's `Vary: Host` guard was attacked with 17 adversarial inputs and two
 * of the critic's own predictions turned out wrong, which is the strongest
 * argument in this run for writing the attack before someone else does. This
 * file is that attack, run against `extractSites` directly so each case is one
 * synthetic file with one intended answer.
 *
 * The cases are grouped by what they attack:
 *
 * 1. **Tokenizer bypasses** — the class that broke the two previous scanners.
 *    A parser makes these structurally impossible rather than defended, so the
 *    tests exist to prove the structural claim, not to pin a workaround.
 * 2. **Declaration shapes** — the ways state hides from a rule that only knows
 *    `let`: a mutated `const` object, a factory, a class static, a global
 *    assignment, a namespace, destructuring.
 * 3. **False positives** — the ~45 frozen constants, and the shapes near them.
 *    Recall bought with precision is not a win here: a scanner that flags
 *    lookup tables gets its ledger padded until nobody reads it.
 */
import { describe, it, expect } from 'vitest'
import { extractSites, mutatesBinding, type StateSite } from '../scan'
import { readsRealTenancyMode } from '../check'
import * as ts from 'typescript'

function sites(source: string): StateSite[] {
  return extractSites('probe.ts', source)
}
function names(source: string): string[] {
  return sites(source)
    .map((s) => s.name)
    .sort()
}

describe('tokenizer bypasses (the class that broke the last two scanners)', () => {
  it('does not see a declaration inside a string literal', () => {
    expect(names(`const s = 'let leaked = new Map()'`)).toEqual([])
  })

  it('does not see a declaration inside a template literal', () => {
    expect(names('const s = `let leaked = 1; const c = new Map()`')).toEqual([])
  })

  it('does not see a declaration inside a nested template substitution', () => {
    expect(names('const s = `a ${`let leaked = 1`} b`')).toEqual([])
  })

  it('does not see a commented-out declaration, line or block', () => {
    expect(names(`// let leakedA = 1\n/* let leakedB = new Map() */\nexport const x = 1`)).toEqual(
      []
    )
  })

  it('is not desynced by a brace inside a string', () => {
    const src = `function f() { const s = '}' ; return s }\nlet real = 1`
    expect(names(src)).toEqual(['real'])
  })

  it('is not desynced by an apostrophe inside a dollar-quoted-looking string', () => {
    // The exact shape that still desyncs the migration linter's stripper.
    const src = `const sql = "VALUES ($$5 o'clock$$)"\nlet real = 1`
    expect(names(src)).toEqual(['real'])
  })

  it('is not desynced by a regex literal containing braces and quotes', () => {
    const src = `const re = /[{}'"]+/g\nlet real = 1`
    expect(names(src)).toEqual(['real'])
  })

  it('sees a declaration whose line also carries a URL', () => {
    // Piece 5's guard lost the rest of any line containing `https://` because
    // its comment stripper ate from the `//` onwards.
    expect(names(`let cache = 'https://example.com/a'`)).toEqual(['cache'])
  })
})

describe('type space is not runtime state', () => {
  it('ignores an ambient `declare let`', () => {
    expect(names(`declare let ambient: number`)).toEqual([])
  })

  it('ignores an ambient global block', () => {
    expect(names(`declare global {\n  var __thing: string | undefined\n}`)).toEqual([])
  })

  it('ignores type and interface declarations named like state', () => {
    expect(names(`type cache = Map<string, string>\ninterface registry { x: number }`)).toEqual([])
  })

  it('ignores a `.d.ts` file entirely', () => {
    expect(extractSites('probe.d.ts', `let leaked = 1`)).toEqual([])
  })
})

describe('declaration shapes that hide from a `let`-only rule', () => {
  it('flags a mutated const object', () => {
    expect(names(`const state = { count: 0 }\nexport function inc() { state.count++ }`)).toEqual([
      'state',
    ])
  })

  it('flags a const object mutated by assignment rather than increment', () => {
    expect(names(`const state = { v: 0 }\nexport function set(n: number) { state.v = n }`)).toEqual(
      ['state']
    )
  })

  it('flags a const object mutated by a logical assignment operator', () => {
    expect(names(`const state = { v: 0 }\nexport function f() { state.v ||= 1 }`)).toEqual(['state'])
  })

  it('flags a const object mutated by `delete`', () => {
    expect(
      names(`const state: Record<string, number> = {}\nexport function f(k: string) { delete state[k] }`)
    ).toEqual(['state'])
  })

  it('flags a const array that is pushed to', () => {
    expect(names(`const seen: string[] = []\nexport function add(x: string) { seen.push(x) }`)).toEqual(
      ['seen']
    )
  })

  it('flags state inside a factory called once at module scope', () => {
    const src = `
      function makeCounter() {
        let n = 0
        return { inc: () => ++n }
      }
      export const counter = makeCounter()
    `
    expect(names(src)).toEqual(['counter'])
  })

  it('flags state inside an IIFE at module scope', () => {
    const src = `export const memo = (() => { let cached: number | undefined; return () => cached ?? 0 })()`
    expect(names(src)).toEqual(['memo'])
  })

  it('flags state inside an arrow factory declared as a const', () => {
    const src = `
      const make = () => { const m = new Map<string, number>(); return { put: (k: string) => m.set(k, 1) } }
      export const store = make()
    `
    expect(names(src).includes('store')).toBe(true)
  })

  it('flags a mutable static field on a module-scope class', () => {
    const src = `
      export class Registry {
        static entries = new Map<string, number>()
        static add(k: string) { Registry.entries.set(k, 1) }
      }
    `
    expect(names(src)).toEqual(['Registry.entries'])
  })

  it('flags an assignment to a global', () => {
    expect(names(`export function boot() { globalThis.__cache = new Map() }`)).toEqual([
      'globalThis.__cache',
    ])
  })

  it('flags a `let` inside a namespace block', () => {
    expect(names(`namespace State {\n  export let current = 0\n}`)).toEqual(['current'])
  })

  it('flags every name bound by a destructuring `let`', () => {
    expect(names(`let { a, b } = { a: 1, b: 2 }`)).toEqual(['a', 'b'])
  })

  it('flags `var` as well as `let`', () => {
    expect(names(`var legacy = 1`)).toEqual(['legacy'])
  })

  it('sees through `as const` and parentheses on the initializer', () => {
    const src = `
      const rows = ([] as string[])
      export function add(x: string) { rows.push(x) }
    `
    expect(names(src)).toEqual(['rows'])
  })
})

describe('re-exported and exported state', () => {
  it('records the declaration site, not the re-export', () => {
    // `export { x }` and `export * from` create no new state. The definition
    // is what the ledger has to name, and SERVER_ROOTS covers lib/shared
    // precisely so a definition cannot hide outside the scan.
    expect(names(`export * from './other'\nexport { something } from './other'`)).toEqual([])
  })

  it('flags an exported `let` once, under its own name', () => {
    expect(names(`export let current = 0`)).toEqual(['current'])
  })
})

describe('frozen constants are not state (the ~45)', () => {
  const frozen = [
    `const IMAGE_NODE_TYPES = new Set(['image', 'resizableImage', 'chatImage'])`,
    `export const ALLOWED_REHOST_MIMES = new Set(['image/png', 'image/jpeg'])`,
    `const VALID_HEADING_LEVELS = new Set([1, 2, 3, 4, 5, 6])`,
    `const RESUMABLE_STATUSES: ReadonlySet<string> = new Set(['open', 'snoozed'])`,
    `const HTTP_METHODS = new Set(['GET', 'POST'])`,
    `const LOOKUP = new Map([['a', 1], ['b', 2]])`,
    `const DEFAULTS = { retries: 3, timeoutMs: 1000 }`,
    `const ORDER = ['low', 'high']`,
  ]
  for (const src of frozen) {
    it(`ignores: ${src.slice(0, 52)}…`, () => {
      // Reading it is not mutating it.
      expect(names(`${src}\nexport function has(x: never) { return String(x) }`)).toEqual([])
    })
  }

  it('ignores a constant that is only READ, including by a method call', () => {
    const src = `
      const KINDS = new Set(['a', 'b'])
      export function ok(k: string) { return KINDS.has(k) && [...KINDS].length > 0 }
    `
    expect(names(src)).toEqual([])
  })

  it('starts flagging the same constant the moment something writes to it', () => {
    const src = `
      const KINDS = new Set(['a', 'b'])
      export function register(k: string) { KINDS.add(k) }
    `
    expect(names(src)).toEqual(['KINDS'])
  })

  it('ignores a frozen static lookup table on a class', () => {
    const src = `
      export class Codes {
        static readonly KNOWN = new Set(['a'])
        static has(k: string) { return Codes.KNOWN.has(k) }
      }
    `
    expect(names(src)).toEqual([])
  })

  it('ignores a factory whose return value cannot carry the closure', () => {
    // `findAppDir()` and `generateCSV()` are the live instances: a `let` walks
    // up a tree or builds a string, and the result is a value, not a handle.
    const src = `
      function build(n: number) { let out = ''; for (let i = 0; i < n; i++) out += 'x'; return out }
      export const BANNER = build(3)
    `
    expect(names(src)).toEqual([])
  })

  it('ignores a factory returning a plain data object with no callable member', () => {
    const src = `
      function invert(m: Record<string, string>) {
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(m)) out[v] = k
        return out
      }
      export const INVERTED = invert({ a: 'b' })
    `
    expect(names(src)).toEqual([])
  })

  it('ignores a local variable shadowing a flagged name in another function', () => {
    const src = `
      const KINDS = new Set(['a'])
      export function unrelated() { const other = new Map<string, number>(); other.set('x', 1); return other.size + KINDS.size }
    `
    // `other` is function-local: it dies with the call.
    expect(names(src)).toEqual([])
  })
})

describe('mutatesBinding', () => {
  const parse = (src: string) =>
    ts.createSourceFile('t.ts', src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)

  it('detects every assignment operator form', () => {
    const ops = ['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '&&=', '||=', '??=']
    for (const op of ops) {
      expect(mutatesBinding(parse(`x.v ${op} 1`), 'x'), op).toBe(true)
    }
  })

  it('does not treat a read as a mutation', () => {
    expect(mutatesBinding(parse(`const y = x.v + x.get('k')`), 'x')).toBe(false)
  })

  it('does not treat a mutation of a DIFFERENT binding as a mutation', () => {
    expect(mutatesBinding(parse(`other.set('k', 1)`), 'x')).toBe(false)
  })
})

describe('the refuses-pooled claim cannot be certified by mention', () => {
  // The first version of this check was `text.includes('isPooledTenancy')`, and
  // the first attack on it worked: swap the import for a local
  // `const isPooledTenancy = (): boolean => false` and the string is still
  // there while the guard is gone. Certification by mention, the same shape as
  // Piece 5's "unconditional witness" helper.
  const guarded = `
    import { isPooledTenancy } from '@/lib/server/tenancy/mode'
    export function start() { if (isPooledTenancy()) return }
  `
  const viaConfig = `
    import { config } from '@/lib/server/config'
    export function start() { if (config.isPooledTenancy) return }
  `
  const shadowed = `
    const isPooledTenancy = (): boolean => false
    export function start() { if (isPooledTenancy()) return }
  `
  const mentionOnly = `
    // isPooledTenancy is handled elsewhere
    export function start() { return 'isPooledTenancy' }
  `

  it('accepts a real import from tenancy/mode', () => {
    expect(readsRealTenancyMode(guarded, 'probe.ts')).toBe(true)
  })
  it('accepts the config read', () => {
    expect(readsRealTenancyMode(viaConfig, 'probe.ts')).toBe(true)
  })
  it('rejects a local declaration shadowing the name', () => {
    expect(readsRealTenancyMode(shadowed, 'probe.ts')).toBe(false)
  })
  it('rejects a mention in a comment or a string', () => {
    expect(readsRealTenancyMode(mentionOnly, 'probe.ts')).toBe(false)
  })
  it('rejects an import of the same name from somewhere else', () => {
    const elsewhere = `
      import { isPooledTenancy } from './my-own-helpers'
      export function start() { if (isPooledTenancy()) return }
    `
    expect(readsRealTenancyMode(elsewhere, 'probe.ts')).toBe(false)
  })
})
