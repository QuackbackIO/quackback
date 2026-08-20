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
    expect(names(`const state = { v: 0 }\nexport function f() { state.v ||= 1 }`)).toEqual([
      'state',
    ])
  })

  it('flags a const object mutated by `delete`', () => {
    expect(
      names(
        `const state: Record<string, number> = {}\nexport function f(k: string) { delete state[k] }`
      )
    ).toEqual(['state'])
  })

  it('flags a const array that is pushed to', () => {
    expect(
      names(`const seen: string[] = []\nexport function add(x: string) { seen.push(x) }`)
    ).toEqual(['seen'])
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
    const ops = [
      '=',
      '+=',
      '-=',
      '*=',
      '/=',
      '%=',
      '**=',
      '<<=',
      '>>=',
      '>>>=',
      '&=',
      '|=',
      '^=',
      '&&=',
      '||=',
      '??=',
    ]
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
    import { isPooledTenancy } from '@/lib/server/workspaces/mode'
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

describe('bypasses found by attacking the first version of this scanner', () => {
  // Six shapes passed straight through the round-1 scanner, and three of them
  // were then planted as a real file in server code with the gate still green —
  // one containing, verbatim, §4.1's top-listed hazard (a magic-link stash keyed
  // only by lowercased email). Each is pinned here by the exact spelling that
  // worked.

  it('sees a Map inside an Object.freeze wrapper', () => {
    // The worst of the six: freezing is SHALLOW, so this is a frozen reference
    // around a fully live Map — and "nothing writes to it" is the rule that
    // suppresses 80 of 97 containers.
    const src = `
      const CACHES = Object.freeze({ tierLimits: new Map<string, number>() })
      export function put(k: string) { CACHES.tierLimits.set(k, 1) }
    `
    expect(names(src)).toEqual(['CACHES'])
  })

  it('sees a module-scope instance of a local class holding a Map', () => {
    const src = `
      class Lru {
        private entries = new Map<string, number>()
        put(k: string) { this.entries.set(k, 1) }
      }
      const cache = new Lru()
      export const put = (k: string) => cache.put(k)
    `
    expect(names(src)).toEqual(['cache'])
  })

  it('sees static state on a class EXPRESSION', () => {
    const src = `
      const R = class { static seen = new Map<string, number>() }
      export function mark(k: string) { R.seen.set(k, 1) }
    `
    expect(names(src)).toEqual(['R.seen'])
  })

  it('sees a container mutated only through an alias', () => {
    const src = `
      const backing = new Map<string, number>()
      const alias = backing
      export function put(k: string) { alias.set(k, 1) }
    `
    expect(names(src)).toEqual(['backing'])
  })

  it('sees Object.assign as a mutation', () => {
    const src = `
      const state: Record<string, number> = {}
      export function merge(p: Record<string, number>) { Object.assign(state, p) }
    `
    expect(names(src)).toEqual(['state'])
  })

  it('sees a module-scope `new` of any constructor it cannot vouch for', () => {
    // `new AsyncLocalStorage()` is the store that carries workspace identity and
    // `new Proxy()` is the db handle; a scanner that only knows `new Map` has
    // neither in its ledger at all.
    expect(
      names(`import { AsyncLocalStorage } from 'node:async_hooks'
      const storage = new AsyncLocalStorage<{ a: string }>()
      export const get = () => storage.getStore()`)
    ).toEqual(['storage'])
    expect(
      names(`const db = new Proxy({}, { get: () => 1 })
      export const x = db`)
    ).toEqual(['db'])
  })

  it('still does not flag value types built with `new`', () => {
    // The precision half. Widening `new` to a site is only affordable because
    // the exemptions are a short enumerated list of things that cannot carry
    // state, rather than a guess about what a constructor does.
    for (const src of [
      // Unflagged only — a `g`/`y` regex carries lastIndex and IS a site. See
      // the dedicated block below; round 2 had this case asserting the wrong
      // thing, which is what a blanket `RegExp` exemption bought.
      `const RE = new RegExp('a+')\nexport const m = (s: string) => RE.test(s)`,
      `const E = new Error('boom')\nexport const e = () => E`,
      `const U = new URL('https://example.com')\nexport const u = () => U.href`,
      `const F = new Intl.DateTimeFormat('en-US', { month: 'short' })\nexport const f = (d: Date) => F.format(d)`,
      `const N = new Intl.DisplayNames(['en'], { type: 'region' })\nexport const n = (c: string) => N.of(c)`,
    ]) {
      expect(names(src), src.split('\n')[0]).toEqual([])
    }
  })

  it('still does not flag a frozen object with no live container inside', () => {
    const src = `
      const CFG = Object.freeze({ retries: 3, timeoutMs: 1000 })
      export const r = () => CFG.retries
    `
    expect(names(src)).toEqual([])
  })
})

describe('a global-flagged RegExp is not a value type', () => {
  // `RegExp` was in PURE_CONSTRUCTORS. With `g` or `y` it carries `lastIndex`,
  // which is mutable and persists between calls — so a module-scope one is a
  // shared cursor. Both instances in this tree use `g`; both happen to go
  // through String.replace, which resets it, so nothing is exploitable today.
  // The exemption would have silently covered the next `.exec()` loop.
  it('flags a `g`-flagged RegExp', () => {
    expect(
      names(`const RE = new RegExp('a+', 'g')\nexport const m = (s: string) => RE.exec(s)`)
    ).toEqual(['RE'])
  })
  it('flags a `y`-flagged RegExp', () => {
    expect(
      names(`const RE = new RegExp('a+', 'gy')\nexport const m = (s: string) => RE.exec(s)`)
    ).toEqual(['RE'])
  })
  it('still ignores an unflagged one', () => {
    expect(
      names(`const RE = new RegExp('a+')\nexport const m = (s: string) => RE.test(s)`)
    ).toEqual([])
  })
  it('still ignores one with only case-insensitive flags', () => {
    expect(
      names(`const RE = new RegExp('a+', 'i')\nexport const m = (s: string) => RE.test(s)`)
    ).toEqual([])
  })
  it('flags one whose flags it cannot read, rather than assuming', () => {
    expect(
      names(
        `const F = 'g'\nconst RE = new RegExp('a+', F)\nexport const m = (s: string) => RE.exec(s)`
      )
    ).toEqual(['RE'])
  })
})

describe('initializer spellings that hid a factory', () => {
  // Three more shapes, zero live instances in the tree — recall for the future,
  // which is what §4.4 says the scanner is for. `unwrap()` handled parens,
  // `as`, `satisfies` and `Object.freeze/seal` but not these.
  const FACTORY = `
    function makeStash() {
      const m = new Map<string, string>()
      return { set(k: string, v: string) { m.set(k, v) } }
    }
    async function makeAsyncStash() {
      const m = new Map<string, string>()
      return { set(k: string, v: string) { m.set(k, v) } }
    }
    function pure(n: number) { let o = ''; for (let i = 0; i < n; i++) o += 'x'; return o }
  `

  it('sees through top-level await — ordinary modern ESM', () => {
    const src = `${FACTORY}
      const s = await makeAsyncStash()
      export const put = (k: string) => s.set(k, '1')`
    expect(names(src)).toEqual(['s'])
  })

  it('sees through .call and .apply', () => {
    for (const how of ['call', 'apply']) {
      const src = `${FACTORY}
        const s = makeStash.${how}(null)
        export const put = (k: string) => s.set(k, '1')`
      expect(names(src), how).toEqual(['s'])
    }
  })

  it('sees through .bind, conservatively', () => {
    // A bound factory is a function rather than a store, so this is one `()`
    // short of state. Flagged anyway: the direction is safe and there are zero
    // live instances, so the cost of being wrong here is a ledger line nobody
    // will ever have to write.
    const src = `${FACTORY}
      const s = makeStash.bind(null)
      export const use = () => s()`
    expect(names(src)).toEqual(['s'])
  })

  it('judges both branches of a ternary initializer', () => {
    const src = `${FACTORY}
      declare const flag: boolean
      const s = flag ? makeStash() : makeStash()
      export const put = (k: string) => s.set(k, '1')`
    expect(names(src)).toEqual(['s'])
  })

  it('flags a ternary where only ONE branch is a factory', () => {
    const src = `${FACTORY}
      declare const flag: boolean
      const s = flag ? makeStash() : null
      export const put = (k: string) => s?.set(k, '1')`
    expect(names(src)).toEqual(['s'])
  })

  it('still ignores the same three spellings around a pure callee', () => {
    // Precision: seeing through more wrappers must not turn every awaited or
    // conditional initializer into a site.
    const cases = [
      `const B = await Promise.resolve(pure(3))\nexport const b = () => B`,
      `declare const flag: boolean\nconst B = flag ? pure(1) : pure(2)\nexport const b = () => B`,
      `const B = pure.call(null, 3)\nexport const b = () => B`,
    ]
    for (const tail of cases) {
      expect(names(`${FACTORY}\n${tail}`), tail.split('\n')[0]).toEqual([])
    }
  })
})

describe('assignment to a global, both spellings', () => {
  // The ledger's only `global-assign` entry is `db.ts`'s `globalThis.__db`, so
  // the bracket form is that entry's obvious variant rather than a
  // hypothetical. Zero live instances of it today.
  it('sees the property form', () => {
    expect(names(`export function boot() { globalThis.__cache = new Map() }`)).toEqual([
      'globalThis.__cache',
    ])
  })

  it('sees the bracket form', () => {
    expect(names(`export function boot() { globalThis['__cache'] = new Map() }`)).toEqual([
      'globalThis.__cache',
    ])
  })

  it('sees the bracket form on `global` too', () => {
    expect(names('export function boot() { global[`__cache`] = new Map() }')).toEqual([
      'global.__cache',
    ])
  })

  it('names both spellings identically, so the ledger key is stable', () => {
    // A site that changed id when someone swapped `.x` for `['x']` would read
    // as one entry going stale and another appearing.
    const dot = names(`export function a() { globalThis.__db = {} as never }`)
    const bracket = names(`export function a() { globalThis['__db'] = {} as never }`)
    expect(dot).toEqual(bracket)
  })

  it('ignores a computed key it cannot read', () => {
    // Precision: an unreadable key would produce a site with no stable name,
    // which is worse than a miss because the ledger could never match it.
    expect(
      names(`declare const k: string
      export function boot() { globalThis[k] = new Map() }`)
    ).toEqual([])
  })

  it('ignores assignment to a non-global object', () => {
    expect(
      names(`declare const cfg: Record<string, unknown>
      export function boot() { cfg['__cache'] = new Map() }`)
    ).toEqual([])
  })
})
