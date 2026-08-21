/**
 * The §4.4 gate: no module-scope mutable state lands in server code without a
 * ledger entry saying what it holds.
 *
 * A third source-scanning invariant alongside `dep-graph` and `authz-matrix`,
 * with the same shape: derive from the tree, reconcile against a checked-in
 * golden, fail on any difference. The reason §4.4 rates this above the twenty
 * fixes it accompanies is that the fixes are a moment and this is a ratchet —
 * "without it, singleton twenty-one lands three weeks after twenty is fixed."
 */
import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkModuleState, renderLedgerDoc, serverRoots } from '../check'
import { MODULE_STATE_LEDGER } from '../ledger'
import { countModuleScopeContainers, scanRoots, siteId } from '../scan'
import { walkSourceFiles } from '../../source-files'

const SRC_ROOT = join(__dirname, '../../../../..') // apps/web/src
const REPO_ROOT = join(SRC_ROOT, '../../..')

const result = checkModuleState(REPO_ROOT)

describe('the gate', () => {
  it('finds no unledgered module-scope mutable state', () => {
    const unledgered = result.findings.filter((f) => f.kind === 'unledgered')
    expect(unledgered.map((f) => `${f.id} — ${f.detail}`)).toEqual([])
  })

  it('holds no ledger entry for a site that no longer exists', () => {
    const stale = result.findings.filter((f) => f.kind === 'stale')
    expect(stale.map((f) => f.id)).toEqual([])
  })

  it('finds no category the source contradicts', () => {
    const wrong = result.findings.filter((f) => f.kind === 'miscategorised')
    expect(wrong.map((f) => `${f.id} — ${f.detail}`)).toEqual([])
  })
})

describe('the scanner is looking at something', () => {
  // A source scanner that scans nothing passes every assertion above. This run
  // has caught sixteen tests that could not have failed, and "found no
  // violations because it read no files" is the cheapest instance of the shape.
  it('walks every declared server root and reads files in each', () => {
    // Deliberately asserted on the WALK, not on findings. Several roots have no
    // module-scope state at all today (`packages/db/src`, `integrations/`), so
    // "found sites here" would be a claim about the code rather than about the
    // scanner — and would go quiet the day a root stopped being scanned.
    for (const root of serverRoots(REPO_ROOT)) {
      expect(walkSourceFiles(root.dir).length, `${root.label} walked no files`).toBeGreaterThan(0)
    }
  })

  it('reports sites across several roots, not just one', () => {
    const roots = new Set(
      result.sites.map((s) => serverRoots(REPO_ROOT).find((r) => s.file.startsWith(r.label))?.label)
    )
    expect(roots.size).toBeGreaterThanOrEqual(4)
    expect(result.sites.length).toBeGreaterThan(50)
  })

  it('reports the sites §4 named by hand, so the scan reaches the known list', () => {
    // Anchors from SAAS-HOSTING-STACK.md §4.1 and §4.2. If a refactor moves one
    // of these out of the scan's reach, this fails rather than going quiet.
    const ids = new Set(result.sites.map(siteId))
    for (const id of [
      'apps/web/src/lib/server/auth/index.ts#magicLinkStash',
      'apps/web/src/lib/server/auth/index.ts#otpStash',
      'apps/web/src/lib/server/auth/index.ts#authInstances',
      'apps/web/src/lib/server/auth/index.ts#authConfigVersions',
      'apps/web/src/lib/server/encryption.ts#derivedKeys',
      'apps/web/src/lib/server/storage/s3.ts#s3Clients',
      'apps/web/src/lib/server/domains/analytics/visitor-hash.ts#cachedSalts',
      'apps/web/src/lib/server/domains/settings/tier-limits.service.ts#cachedLimits',
      'apps/web/src/lib/server/domains/ai/config.ts#openai',
      'apps/web/src/lib/server/jobs/worker.ts#loops',
      'apps/web/src/lib/server/domains/workflows/workflow.service.ts#hasLiveWorkflowCache',
      'apps/web/src/lib/server/domains/workflows/workflow.service.ts#liveAttributeKeysCache',
      'apps/web/src/lib/server/realtime/stream-connection-limit.ts#streamLimiter',
      'apps/web/src/routes/api/health.ready.ts#migrationsKnownUpToDate',
      'apps/web/src/routes/api/auth/$.ts#registrationAttempts',
      'packages/email/src/index.ts#smtpTransporter',
      'packages/email/src/index.ts#inboundFetchClient',
      'packages/email/src/ses.ts#cachedClient',
    ]) {
      expect(ids.has(id), id).toBe(true)
    }
  })

  it('does not report the frozen constants §4 counts as safe', () => {
    // §4: "About 45 other module-scope Set/Map instances are frozen constants
    // and are safe." A scanner that flags those buries the real entries.
    const ids = new Set(result.sites.map(siteId))
    for (const id of [
      'apps/web/src/lib/server/sanitize-tiptap.ts#ALLOWED_NODE_TYPES',
      'apps/web/src/lib/server/sanitize-tiptap.ts#ALLOWED_MARK_TYPES',
      'apps/web/src/lib/server/content/magic-bytes.ts#ALLOWED_REHOST_MIMES',
      'apps/web/src/lib/server/content/ssrf-guard.ts#ALLOWED_SCHEMES',
      'apps/web/src/lib/server/domains/assistant/assistant.actor.ts#ASSISTANT_PERMISSIONS',
      'apps/web/src/lib/server/domains/workflows/workflow-actor-permissions.ts#AUTOMATION_PERMISSIONS',
      'apps/web/src/lib/server/policy/authz-matrix/scan.ts#HTTP_METHODS',
      'apps/web/src/lib/server/markdown-tiptap.ts#IMAGE_NODE_TYPES',
      'apps/web/src/routes/api/widget/identify.ts#RESERVED_JWT_CLAIMS',
      'packages/db/src/types.ts#INTERACTIVE_BLOCK_KINDS',
    ]) {
      expect(ids.has(id), `${id} should be treated as a frozen constant`).toBe(false)
    }
  })

  it('suppresses at least the ~45 frozen Set/Map constants §4 counts', () => {
    // Measured, not assumed, and measured on the right population: module-scope
    // `new Set` / `new Map` only. Counting every *container* would sweep in
    // several hundred ordinary object and array literals, and a regex would
    // count function-local ones — either would make this pass for the wrong
    // reason while saying nothing about the claim.
    const totals = { constructed: 0, constructedMutated: 0 }
    for (const root of serverRoots(REPO_ROOT)) {
      for (const file of walkSourceFiles(root.dir)) {
        if (!file.endsWith('.ts')) continue
        const counts = countModuleScopeContainers(file, readFileSync(file, 'utf8'))
        totals.constructed += counts.constructed
        totals.constructedMutated += counts.constructedMutated
      }
    }
    const frozen = totals.constructed - totals.constructedMutated
    expect(totals.constructed, 'the scan found no Set/Map declarations at all').toBeGreaterThan(45)
    expect(frozen).toBeGreaterThanOrEqual(45)
    // …and it does still report the mutated ones, so "suppressed" is a
    // discrimination rather than a blanket exemption.
    expect(totals.constructedMutated).toBeGreaterThan(0)
  })
})

describe('the ledger is a decision record, not a rubber stamp', () => {
  it('every entry states a reason of substance', () => {
    const thin = MODULE_STATE_LEDGER.filter((e) => e.reason.trim().length < 60)
    expect(thin.map((e) => siteId(e))).toEqual([])
  })

  it('no entry is duplicated', () => {
    const ids = MODULE_STATE_LEDGER.map(siteId)
    expect(ids.length).toBe(new Set(ids).size)
  })

  it('every workspace-scoped-key entry names the code composing its key', () => {
    const missing = MODULE_STATE_LEDGER.filter(
      (e) => e.category === 'workspace-scoped-key' && !e.keyedBy
    )
    expect(missing.map(siteId)).toEqual([])
  })

  it('records the two singletons another workstream owns, rather than claiming them', () => {
    const owned = MODULE_STATE_LEDGER.filter((e) => e.owner).map(siteId)
    expect(owned).toContain('apps/web/src/lib/server/encryption.ts#derivedKeys')
    expect(owned).toContain('apps/web/src/lib/server/storage/s3.ts#s3Clients')
    for (const e of MODULE_STATE_LEDGER) {
      if (e.owner) expect(e.owner, siteId(e)).toMatch(/Piece \d+/)
    }
  })
})

describe('MODULE-STATE.md', () => {
  it('matches the tree', () => {
    const golden = readFileSync(join(__dirname, '..', 'MODULE-STATE.md'), 'utf8')
    expect(renderLedgerDoc(result) + '\n').toBe(golden)
  })
})

describe('cross-file factory resolution', () => {
  it('sees a factory imported from another scanned module', () => {
    // `magicLinkStash` and `otpStash` — §4.1's top-listed hazard — are visible
    // today only because `makeStash` happens to sit in the same file as its
    // call. Moving it to a helper module would have removed both from the scan
    // with nothing failing, which is one refactor away, not a hypothetical.
    const dir = mkdtempSync(join(tmpdir(), 'module-state-xfile-'))
    try {
      mkdirSync(join(dir, 'mod'))
      writeFileSync(
        join(dir, 'mod', 'stash-helper.ts'),
        `export function makeStash<T>() {
           const m = new Map<string, T>()
           return {
             set(k: string, v: T) { m.set(k.toLowerCase(), v) },
             take(k: string) { const v = m.get(k.toLowerCase()); m.delete(k.toLowerCase()); return v },
           }
         }\n`
      )
      writeFileSync(
        join(dir, 'mod', 'consumer.ts'),
        `import { makeStash } from './stash-helper'
         const magicLinkStash = makeStash<string>()
         export const store = (email: string, t: string) => magicLinkStash.set(email, t)\n`
      )

      const sites = scanRoots(dir, [{ dir: join(dir, 'mod'), label: 'mod' }])
      expect(sites.map((s) => `${s.kind}:${s.name}`)).toContain('factory:magicLinkStash')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not flag a factory whose imported callee holds nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'module-state-xfile-'))
    try {
      mkdirSync(join(dir, 'mod'))
      writeFileSync(
        join(dir, 'mod', 'pure-helper.ts'),
        `export function banner(n: number) { let out = ''; for (let i = 0; i < n; i++) out += 'x'; return out }\n`
      )
      writeFileSync(
        join(dir, 'mod', 'consumer.ts'),
        `import { banner } from './pure-helper'\nexport const BANNER = banner(3)\n`
      )

      expect(scanRoots(dir, [{ dir: join(dir, 'mod'), label: 'mod' }])).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('factory resolution across every import spelling', () => {
  // Round 2 resolved `@/` and relative specifiers only. Six more spellings
  // passed straight through, and each was planted as a real file before being
  // pinned here. #7 was not the documented third-party limit —
  // `@quackback/logger` is first-party and `packages/logger/src` IS a scanned
  // root — and #8 is the widest: 88 files in the scanned roots already use
  // `export … from`, so any factory moved behind a barrel vanished silently.
  const FACTORY = `export function makeStash<T>() {
      const m = new Map<string, T>()
      return { set(k: string, v: T) { m.set(k, v) }, take(k: string) { return m.get(k) } }
    }
    export function makeInner<T>() {
      const m = new Map<string, T>()
      return { put(k: string, v: T) { m.set(k, v) } }
    }
    export function makeOuter<T>() { return makeInner<T>() }
    export const registry = new Map<string, number>()
    export default function defaultStash<T>() {
      const m = new Map<string, T>()
      return { set(k: string, v: T) { m.set(k, v) } }
    }\n`

  function withTree(consumer: string, run: (sites: string[]) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'module-state-imports-'))
    try {
      mkdirSync(join(dir, 'mod'), { recursive: true })
      mkdirSync(join(dir, 'packages', 'logger', 'src'), { recursive: true })
      writeFileSync(join(dir, 'mod', 'factory.ts'), FACTORY)
      writeFileSync(join(dir, 'mod', 'barrel.ts'), `export { makeStash } from './factory'\n`)
      writeFileSync(join(dir, 'packages', 'logger', 'src', 'index.ts'), FACTORY)
      writeFileSync(join(dir, 'mod', 'consumer.ts'), consumer)
      const sites = scanRoots(dir, [
        { dir: join(dir, 'mod'), label: 'mod' },
        { dir: join(dir, 'packages', 'logger', 'src'), label: 'packages/logger/src' },
      ])
      run(sites.map((s) => `${s.kind}:${s.name}`))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  const cases: Array<[string, string, string]> = [
    [
      'a workspace package specifier',
      `import { makeStash } from '@quackback/logger'
       const pkgStash = makeStash<string>()
       export const put = (k: string, v: string) => pkgStash.set(k, v)\n`,
      'factory:pkgStash',
    ],
    [
      'a re-export barrel',
      `import { makeStash } from './barrel'
       const barrelStash = makeStash<string>()
       export const put = (k: string, v: string) => barrelStash.set(k, v)\n`,
      'factory:barrelStash',
    ],
    [
      'a namespace import',
      `import * as F from './factory'
       const nsStash = F.makeStash<string>()
       export const put = (k: string, v: string) => nsStash.set(k, v)\n`,
      'factory:nsStash',
    ],
    [
      'a default import',
      `import defaultStash from './factory'
       const defStash = defaultStash<string>()
       export const put = (k: string, v: string) => defStash.set(k, v)\n`,
      'factory:defStash',
    ],
    [
      'a two-hop factory, resolved in the DEFINING module',
      `import { makeOuter } from './factory'
       const twoHop = makeOuter<string>()
       export const put = (k: string, v: string) => twoHop.put(k, v)\n`,
      'factory:twoHop',
    ],
    [
      'an aliased-import mutation of an exported container',
      `import { registry as reg } from './factory'
       export function remember(k: string) { reg.set(k, 1) }\n`,
      'container:registry',
    ],
  ]

  for (const [label, consumer, expected] of cases) {
    it(`sees a factory reached through ${label}`, () => {
      withTree(consumer, (sites) => expect(sites).toContain(expected))
    })
  }

  it('still ignores an imported callee that holds nothing', () => {
    // Precision control: resolving MORE import spellings must not turn every
    // imported call into a site.
    const dir = mkdtempSync(join(tmpdir(), 'module-state-imports-'))
    try {
      mkdirSync(join(dir, 'mod'))
      writeFileSync(
        join(dir, 'mod', 'pure.ts'),
        `export function banner(n: number) { let o = ''; for (let i = 0; i < n; i++) o += 'x'; return o }\n`
      )
      writeFileSync(join(dir, 'mod', 'barrel.ts'), `export { banner } from './pure'\n`)
      writeFileSync(
        join(dir, 'mod', 'consumer.ts'),
        `import { banner } from './barrel'\nexport const BANNER = banner(3)\n`
      )
      expect(scanRoots(dir, [{ dir: join(dir, 'mod'), label: 'mod' }])).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
