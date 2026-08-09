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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkModuleState, renderLedgerDoc, serverRoots } from '../check'
import { MODULE_STATE_LEDGER } from '../ledger'
import { countModuleScopeContainers, siteId } from '../scan'
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
      'apps/web/src/lib/server/events/relay.ts#strictAttempts',
      'apps/web/src/lib/server/domains/workflows/workflow.service.ts#hasLiveWorkflowCache',
      'apps/web/src/lib/server/domains/workflows/workflow.service.ts#liveAttributeKeysCache',
      'apps/web/src/lib/server/realtime/stream-connection-limit.ts#streamLimiter',
      'apps/web/src/routes/api/health.ready.ts#migrationsKnownUpToDate',
      'apps/web/src/routes/api/auth/$.ts#registrationAttempts',
      'packages/email/src/index.ts#smtpTransporter',
      'packages/email/src/index.ts#resendClient',
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

  it('every tenant-scoped-key entry names the code composing its key', () => {
    const missing = MODULE_STATE_LEDGER.filter(
      (e) => e.category === 'tenant-scoped-key' && !e.keyedBy
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
