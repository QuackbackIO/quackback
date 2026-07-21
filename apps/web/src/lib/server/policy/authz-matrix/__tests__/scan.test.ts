import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import {
  scanSourceFile,
  scanAuthzSurfaces,
  scanEntryPoints,
  scanMcpTools,
  scanAllMcpTools,
  type ScannedAuthz,
} from '../scan'

const SRC_ROOT = join(__dirname, '../../../../..') // apps/web/src

/** Extract the single gate's authz from a one-surface snippet. */
function authzOf(relPath: string, body: string): ScannedAuthz {
  const { gates } = scanSourceFile(relPath, body)
  expect(gates).toHaveLength(1)
  return gates[0].authz
}

describe('scanSourceFile — gate authorization extraction', () => {
  it('reads a catalogue permission off requireAuth', () => {
    const authz = authzOf(
      'lib/server/functions/x.ts',
      `export const fn = h(async () => { await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE }) })`
    )
    expect(authz).toEqual({
      kind: 'permission',
      permissionConst: 'SETTINGS_MANAGE',
      permissionLiteral: null,
    })
  })

  it('treats argument-less requireAuth() as bare', () => {
    expect(
      authzOf(
        'lib/server/functions/x.ts',
        `export const fn = h(async () => { await requireAuth() })`
      )
    ).toEqual({
      kind: 'bare',
    })
  })

  it('reads a string-literal permission', () => {
    expect(
      authzOf(
        'lib/server/functions/x.ts',
        `export const fn = h(async () => { await requireAuth({ permission: 'settings.manage' }) })`
      )
    ).toEqual({ kind: 'permission', permissionConst: null, permissionLiteral: 'settings.manage' })
  })

  it('flags a non-static permission as unparseable', () => {
    const authz = authzOf(
      'lib/server/functions/x.ts',
      `export const fn = h(async () => { await requireAuth({ permission: dynamicPerm }) })`
    )
    expect(authz.kind).toBe('unparseable')
  })

  it('treats withApiKeyAuth(request) as bare and the 2-arg form as a permission gate', () => {
    expect(
      authzOf(
        'routes/api/v1/x.ts',
        `export const Route = r({ server: { handlers: { GET: async ({ request }) => { await withApiKeyAuth(request) } } } })`
      )
    ).toEqual({ kind: 'bare' })
    expect(
      authzOf(
        'routes/api/v1/x.ts',
        `export const Route = r({ server: { handlers: { POST: async ({ request }) => { await withApiKeyAuth(request, { permission: PERMISSIONS.POST_CREATE }) } } } })`
      )
    ).toEqual({ kind: 'permission', permissionConst: 'POST_CREATE', permissionLiteral: null })
  })

  it('records requireTeamAuth() as an alias gate', () => {
    expect(
      authzOf(
        'lib/server/functions/moderation.ts',
        `export const fn = h(async () => { const auth = await requireTeamAuth() })`
      )
    ).toEqual({
      kind: 'alias',
      callee: 'requireTeamAuth',
    })
  })
})

describe('scanSourceFile — surface labels', () => {
  it('labels a server function by its module-level const, not the local binding', () => {
    const { gates } = scanSourceFile(
      'lib/server/functions/x.ts',
      `export const approvePostFn = createServerFn().handler(async () => { const auth = await requireAuth({ permission: PERMISSIONS.POST_APPROVE }); return auth })`
    )
    expect(gates[0].surface).toBe('approvePostFn')
  })

  it('labels an API route by its HTTP method', () => {
    const { gates } = scanSourceFile(
      'routes/api/v1/posts/index.ts',
      `export const Route = createFileRoute('/api/v1/posts/')({ server: { handlers: { DELETE: async ({ request }) => { await withApiKeyAuth(request, { permission: PERMISSIONS.POST_MODERATE }) } } } })`
    )
    expect(gates[0].surface).toBe('DELETE')
  })
})

describe('scanSourceFile — inline role checks', () => {
  const snippet = `export const fn = h(async () => { if (isAdmin(p.role) || isTeamMember(p.role)) return })`

  it('captures isAdmin/isTeamMember inside function and route files', () => {
    expect(
      scanSourceFile('lib/server/functions/admin.ts', snippet).inline.map((i) => i.callee)
    ).toEqual(['isAdmin', 'isTeamMember'])
    expect(scanSourceFile('routes/api/chat/stream.ts', snippet).inline).toHaveLength(2)
  })

  it('ignores role checks outside route/function directories (policy internals)', () => {
    expect(scanSourceFile('lib/server/policy/posts.ts', snippet).inline).toHaveLength(0)
  })
})

describe('scanEntryPoints — gate presence per entry point', () => {
  it('marks a server function gated / ungated by whether its handler chain gates', () => {
    const gated = scanEntryPoints(
      'lib/server/functions/x.ts',
      `export const fetchFn = createServerFn().handler(async () => { await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE }) })`
    )
    expect(gated).toEqual([
      { file: 'lib/server/functions/x.ts', surface: 'fetchFn', kind: 'server-fn', gated: true },
    ])

    const ungated = scanEntryPoints(
      'lib/server/functions/x.ts',
      `export const publicFn = createServerFn().handler(async () => { return getSettings() })`
    )
    expect(ungated[0].gated).toBe(false)
  })

  it('marks route handlers gated / ungated and labels them by HTTP method', () => {
    const eps = scanEntryPoints(
      'routes/api/v1/x.ts',
      `export const Route = r({ server: { handlers: {
        GET: async ({ request }) => { await withApiKeyAuth(request) },
        POST: async () => { return ok() },
      } } })`
    )
    expect(eps).toEqual([
      { file: 'routes/api/v1/x.ts', surface: 'GET', kind: 'route', gated: true },
      { file: 'routes/api/v1/x.ts', surface: 'POST', kind: 'route', gated: false },
    ])
  })

  it('resolves an extracted same-file handler referenced by identifier', () => {
    const eps = scanEntryPoints(
      'routes/api/v1/x.ts',
      `export async function handleGet({ request }) { await withApiKeyAuth(request) }
       async function handlePost() { return ok() }
       export const Route = r({ server: { handlers: { GET: handleGet, POST: handlePost } } })`
    )
    expect(eps).toEqual([
      { file: 'routes/api/v1/x.ts', surface: 'GET', kind: 'route', gated: true },
      { file: 'routes/api/v1/x.ts', surface: 'POST', kind: 'route', gated: false },
    ])
  })

  it('resolves a const arrow handler referenced by identifier', () => {
    const eps = scanEntryPoints(
      'routes/api/v1/x.ts',
      `const handleGet = async ({ request }) => { await requireTeamAuth(request) }
       export const Route = r({ server: { handlers: { GET: handleGet } } })`
    )
    expect(eps).toEqual([
      { file: 'routes/api/v1/x.ts', surface: 'GET', kind: 'route', gated: true },
    ])
  })

  it('follows a delegating inline arrow one hop to the extracted handler', () => {
    const eps = scanEntryPoints(
      'routes/api/v1/x.ts',
      `export async function handlePost(request) { await withApiKeyAuth(request) }
       export const Route = r({ server: { handlers: {
         POST: ({ request }) => handlePost(request),
       } } })`
    )
    expect(eps).toEqual([
      { file: 'routes/api/v1/x.ts', surface: 'POST', kind: 'route', gated: true },
    ])
  })

  it('records an unresolvable identifier handler as an ungated entry point (fail visible)', () => {
    const eps = scanEntryPoints(
      'routes/api/v1/x.ts',
      `import { importedHandler } from './elsewhere'
       export const Route = r({ server: { handlers: { GET: importedHandler } } })`
    )
    expect(eps).toEqual([
      { file: 'routes/api/v1/x.ts', surface: 'GET', kind: 'route', gated: false },
    ])
  })
})

describe('scanMcpTools — tool authorization extraction', () => {
  it('reads declarative scope + teamOnly metadata off a registerTool definition', () => {
    const tools = scanMcpTools(
      'lib/server/mcp/tools/x.ts',
      `registerTool(server, auth, {
        name: 'triage_post',
        description: 'd',
        schema: {},
        annotations: WRITE,
        scope: 'write:feedback',
        teamOnly: true,
        handler: async (args) => jsonResult({}),
      })`
    )
    expect(tools).toEqual([{ name: 'triage_post', scopes: ['write:feedback'], teamOnly: true }])
  })

  it('a scope-only registerTool definition scans as non-team', () => {
    const tools = scanMcpTools(
      'lib/server/mcp/tools/x.ts',
      `registerTool(server, auth, { name: 'vote_post', schema: {}, annotations: WRITE, scope: 'write:feedback', handler: async () => r })`
    )
    expect(tools).toEqual([{ name: 'vote_post', scopes: ['write:feedback'], teamOnly: false }])
  })

  it('unions per-branch requireScope/requireTeamRole from a branchy handler', () => {
    const tools = scanMcpTools(
      'lib/server/mcp/tools/x.ts',
      `registerTool(server, auth, {
        name: 'search',
        schema: {},
        annotations: READ_ONLY,
        handler: async (args) => {
          if (args.entity === 'articles') {
            const d = requireScope(auth, 'read:article'); if (d) return d
            const t = requireTeamRole(auth); if (t) return t
            return r
          }
          const d = requireScope(auth, 'read:feedback'); if (d) return d
          const t = requireTeamRole(auth); if (t) return t
          return r
        },
      })`
    )
    expect(tools).toEqual([
      { name: 'search', scopes: ['read:article', 'read:feedback'], teamOnly: true },
    ])
  })

  it('still reads the legacy server.tool(name, …) shape with in-handler guards', () => {
    const tools = scanMcpTools(
      'lib/server/mcp/tools.ts',
      `server.tool('create_changelog', 'd', schema, WRITE, async (args) => {
        const s = requireScope(auth, 'write:changelog'); if (s) return s
        const t = requireTeamRole(auth); if (t) return t
        return r
      })`
    )
    expect(tools).toEqual([
      { name: 'create_changelog', scopes: ['write:changelog'], teamOnly: true },
    ])
  })
})

describe('scanAllMcpTools — live tool modules', () => {
  it('finds all 38 tools across the tool modules, each with at least one scope', () => {
    const tools = scanAllMcpTools(SRC_ROOT)
    expect(tools).toHaveLength(38)
    expect(tools.filter((t) => t.scopes.length === 0)).toEqual([])
  })
})

describe('scanAuthzSurfaces — live tree invariants', () => {
  const result = scanAuthzSurfaces(SRC_ROOT)

  it('parses every gate: zero unparseable authorization sites', () => {
    const bad = result.gates.filter((g) => g.authz.kind === 'unparseable')
    expect(bad, JSON.stringify(bad, null, 2)).toHaveLength(0)
  })

  it('finds permission, bare, and alias gates across the tree', () => {
    const kinds = new Set(result.gates.map((g) => g.authz.kind))
    expect(kinds).toContain('permission')
    expect(kinds).toContain('bare')
    expect(kinds).toContain('alias')
  })

  it('resolves the moderation queue through the requireTeamAuth alias', () => {
    const aliases = result.gates.filter((g) => g.authz.kind === 'alias')
    expect(aliases.length).toBeGreaterThan(0)
    expect(aliases.every((g) => g.file === 'lib/server/functions/moderation.ts')).toBe(true)
  })
})
