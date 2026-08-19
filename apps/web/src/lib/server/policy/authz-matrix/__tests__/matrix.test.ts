import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { resolveSurfaces } from '../resolve'
import { scanAllMcpTools, scanAllEntryPoints } from '../scan'
import { PRINCIPAL_CLASS_BY_ID, ALL_MCP_SCOPES } from '../principals'
import { evaluate, evaluateMcpTool, renderMatrixDoc } from '../matrix'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import type { PermissionKey } from '@/lib/shared/permissions'

const SRC_ROOT = join(__dirname, '../../../../..') // apps/web/src
const { surfaces } = resolveSurfaces(SRC_ROOT)
const tools = scanAllMcpTools(SRC_ROOT)
const entryPoints = scanAllEntryPoints(SRC_ROOT)

const byId = (id: string) => PRINCIPAL_CLASS_BY_ID[id as keyof typeof PRINCIPAL_CLASS_BY_ID]
const MANAGER = resolveActorPermissions('member')

const permServerFns = surfaces.filter(
  (s) => s.channel === 'server-fn' && s.authz.type === 'permission'
)
const endUserFns = surfaces.filter((s) => s.authz.type === 'end_user')

describe('server-function permission gates', () => {
  it('admin (Owner preset) passes every permission gate', () => {
    expect(permServerFns.every((s) => evaluate(byId('admin'), s) === 'allow')).toBe(true)
  })

  it('member outcome tracks the Manager preset exactly (allow AND deny)', () => {
    for (const s of permServerFns) {
      const expected = MANAGER.has((s.authz as { permission: PermissionKey }).permission)
        ? 'allow'
        : 'deny'
      expect(evaluate(byId('member'), s), `${s.file}::${s.surface}`).toBe(expected)
    }
    // The preset genuinely splits: some gates deny member, some allow.
    const memberDenied = permServerFns.filter((s) => evaluate(byId('member'), s) === 'deny')
    expect(memberDenied.length).toBeGreaterThan(0)
    expect(memberDenied.length).toBeLessThan(permServerFns.length)
  })

  it('portal + every widget class are denied all teammate permission gates', () => {
    for (const id of ['portal_user', 'anon_widget', 'unverified_widget', 'verified_widget']) {
      expect(
        permServerFns.every((s) => evaluate(byId(id), s) === 'deny'),
        id
      ).toBe(true)
    }
  })

  it('end-user gates admit portal + widget classes', () => {
    expect(endUserFns.length).toBeGreaterThan(0)
    for (const id of ['portal_user', 'anon_widget', 'verified_widget']) {
      expect(
        endUserFns.every((s) => evaluate(byId(id), s) === 'allow'),
        id
      ).toBe(true)
    }
  })
})

describe('widget class collapse', () => {
  it('anon / unverified / verified widgets are authorization-identical everywhere', () => {
    for (const s of surfaces) {
      const a = evaluate(byId('anon_widget'), s)
      expect(evaluate(byId('unverified_widget'), s)).toBe(a)
      expect(evaluate(byId('verified_widget'), s)).toBe(a)
    }
  })
})

describe('API-route channel reachability', () => {
  const apiSurfaces = surfaces.filter((s) => s.channel === 'api-route')

  it('cookie-session classes cannot reach REST (no API key) — the anonymous-to-REST baseline', () => {
    expect(apiSurfaces.length).toBeGreaterThan(0)
    for (const id of ['admin', 'member', 'portal_user', 'verified_widget']) {
      expect(
        apiSurfaces.every((s) => evaluate(byId(id), s) === 'n/a'),
        id
      ).toBe(true)
    }
  })

  it('an API key resolves REST gates against its owner permissions', () => {
    for (const s of apiSurfaces) {
      const expected =
        s.authz.type === 'public_data'
          ? 'allow'
          : s.authz.type === 'permission'
            ? byId('full_api_key').permissions.has(s.authz.permission)
              ? 'allow'
              : 'deny'
            : evaluate(byId('full_api_key'), s)
      expect(evaluate(byId('full_api_key'), s), `${s.file}::${s.surface}`).toBe(expected)
    }
  })
})

describe('API key scope enforcement (owner permissions ∩ key scopes)', () => {
  it('a read-only scoped key is denied every write tool a full key passes', () => {
    const writeTools = tools.filter((t) => t.scopes.every((s) => s.startsWith('write:')))
    expect(writeTools.length).toBeGreaterThan(0)
    for (const t of writeTools) {
      expect(evaluateMcpTool(byId('full_api_key'), t), t.name).toBe('allow')
      expect(evaluateMcpTool(byId('scoped_api_key'), t), t.name).toBe('deny')
    }
  })

  it('the scoped key still invokes read tools within its scopes', () => {
    const readTool = tools.find(
      (t) => t.scopes.includes('read:feedback') && !t.scopes.some((s) => s.startsWith('write:'))
    )!
    expect(readTool).toBeTruthy()
    expect(evaluateMcpTool(byId('scoped_api_key'), readTool)).toBe('allow')
  })

  it('the scoped key holds strictly fewer REST permissions than the full key', () => {
    const scoped = byId('scoped_api_key').permissions
    const full = byId('full_api_key').permissions
    expect(scoped.size).toBeGreaterThan(0)
    expect(scoped.size).toBeLessThan(full.size)
    for (const p of scoped) expect(full.has(p), p).toBe(true)
  })

  it('a read-only key is denied write-mapped REST permission gates the full key passes', () => {
    const tightened = surfaces.filter(
      (s) =>
        s.channel === 'api-route' &&
        evaluate(byId('full_api_key'), s) === 'allow' &&
        evaluate(byId('scoped_api_key'), s) === 'deny'
    )
    expect(tightened.length).toBeGreaterThan(0)
  })

  it('public-tier reads still admit any valid key regardless of scopes', () => {
    const publicReads = surfaces.filter((s) => s.authz.type === 'public_data')
    expect(publicReads.length).toBeGreaterThan(0)
    for (const s of publicReads) {
      expect(evaluate(byId('scoped_api_key'), s), `${s.file}::${s.surface}`).toBe('allow')
    }
  })
})

describe('OAuth scope enforcement (same model as scoped keys)', () => {
  it('a read-only OAuth grant is denied write tools a full (legacy) key passes', () => {
    const contrast = tools.filter(
      (t) =>
        evaluateMcpTool(byId('full_api_key'), t) === 'allow' &&
        evaluateMcpTool(byId('oauth_client'), t) === 'deny'
    )
    expect(contrast.length).toBeGreaterThan(0)
  })

  it('the OAuth grant can invoke read tools within its scopes', () => {
    const readTool = tools.find(
      (t) => t.scopes.includes('read:feedback') && !t.scopes.some((s) => s.startsWith('write:'))
    )!
    expect(evaluateMcpTool(byId('oauth_client'), readTool)).toBe('allow')
  })
})

describe('inline secondary gates', () => {
  const stream = surfaces.find((s) => s.channel === 'sse' && s.authz.type === 'role_gate')
  const onboarding = surfaces.find((s) => s.authz.type === 'role_gate' && s.authz.bar === 'admin')

  it('SSE inbox/presence scopes are team-only; visitors denied; keys never reach it', () => {
    expect(stream, 'expected an SSE role_gate surface from the inline scan').toBeTruthy()
    expect(evaluate(byId('admin'), stream!)).toBe('allow')
    expect(evaluate(byId('member'), stream!)).toBe('allow')
    expect(evaluate(byId('portal_user'), stream!)).toBe('deny')
    expect(evaluate(byId('verified_widget'), stream!)).toBe('deny')
    expect(evaluate(byId('full_api_key'), stream!)).toBe('n/a')
  })

  it('the onboarding admin-only gate denies members, not just visitors', () => {
    expect(onboarding, 'expected an admin-bar role_gate from the inline scan').toBeTruthy()
    expect(evaluate(byId('admin'), onboarding!)).toBe('allow')
    expect(evaluate(byId('member'), onboarding!)).toBe('deny')
    expect(evaluate(byId('portal_user'), onboarding!)).toBe('deny')
  })
})

describe('MCP scope universe', () => {
  it('every scope the tools reference is a known catalogue scope', () => {
    const scanned = new Set(tools.flatMap((t) => t.scopes))
    for (const s of scanned) expect(ALL_MCP_SCOPES as readonly string[]).toContain(s)
  })

  it('every MCP tool declares at least one scope', () => {
    // Guards the registerTool metadata extraction: if a tool's declarative
    // `scope` (or a branchy handler's requireScope) stops resolving, it scans
    // as scopeless and this fails rather than silently over-granting.
    const scopeless = tools.filter((t) => t.scopes.length === 0).map((t) => t.name)
    expect(scopeless, scopeless.join(', ')).toEqual([])
  })
})

describe('entry-point inventory', () => {
  it('enumerates both server functions and route handlers', () => {
    expect(entryPoints.length).toBeGreaterThan(400)
    expect(entryPoints.some((e) => e.kind === 'server-fn')).toBe(true)
    expect(entryPoints.some((e) => e.kind === 'route')).toBe(true)
  })

  it('the large majority of entry points carry a scanned gate', () => {
    const gated = entryPoints.filter((e) => e.gated).length
    expect(gated).toBeGreaterThan(entryPoints.length / 2)
    // Some are legitimately ungated (public reads, webhooks, pre-auth); the
    // MATRIX.md snapshot pins exactly which, so a new one is a reviewed diff.
    expect(entryPoints.some((e) => !e.gated)).toBe(true)
  })
})

describe('golden matrix document', () => {
  it('matches the committed MATRIX.md snapshot', async () => {
    const doc = renderMatrixDoc(surfaces, tools, entryPoints)
    await expect(doc).toMatchFileSnapshot(join(__dirname, '../MATRIX.md'))
  })
})
