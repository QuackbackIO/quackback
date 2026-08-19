/**
 * The authorization matrix: evaluate every resolved surface (and every MCP
 * tool) against every principal class, and render the committed golden
 * document.
 *
 * Evaluation is pure derivation from two sources of truth — the scanned
 * authorization (what the code enforces) and the fixtures' resolved permission
 * sets (what each class holds). Nothing here restates an expectation by hand,
 * so a widened gate or a changed preset moves the output and shows up in the
 * MATRIX.md diff.
 */
import { ALL_PERMISSIONS, PERMISSION_CATALOGUE } from '@/lib/shared/permissions'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import type { ResolvedSurface } from './resolve'
import { PRINCIPAL_CLASSES, type PrincipalClass } from './principals'
import type { ScannedMcpTool, EntryPoint } from './scan'

export type Outcome = 'allow' | 'deny' | 'n/a'

/** Whether a principal class may reach and pass a resolved surface's gate. */
export function evaluate(cls: PrincipalClass, surface: ResolvedSurface): Outcome {
  if (!cls.channels.has(surface.channel)) return 'n/a'
  switch (surface.authz.type) {
    case 'permission':
      return cls.permissions.has(surface.authz.permission) ? 'allow' : 'deny'
    case 'end_user':
      return cls.isAuthenticatedPrincipal ? 'allow' : 'deny'
    case 'public_data':
      // Reaching the api-route channel means a valid key; the data is public.
      return 'allow'
    case 'mcp_entry':
      return 'allow'
    case 'dynamic_permission':
      // Passes if the class holds at least one candidate permission (can touch at
      // least one field); assertApiPermissions enforces the rest per changed field.
      return surface.authz.permissions.some((p) => cls.permissions.has(p)) ? 'allow' : 'deny'
    case 'role_gate':
      return (surface.authz.bar === 'admin' ? cls.role === 'admin' : cls.isTeamMember)
        ? 'allow'
        : 'deny'
  }
}

/** Whether an MCP class may invoke a tool (scope held AND team requirement met). */
export function evaluateMcpTool(cls: PrincipalClass, tool: ScannedMcpTool): Outcome {
  if (!cls.mcpScopes) return 'n/a'
  if (tool.teamOnly && !cls.isTeamMember) return 'deny'
  // A tool listing several scopes is usable if the class holds any one branch's scope.
  return tool.scopes.some((s) => cls.mcpScopes!.has(s)) ? 'allow' : 'deny'
}

// --------------------------------------------------------------------------
// Golden document rendering
// --------------------------------------------------------------------------

const OWNER = resolveActorPermissions('admin')
const MANAGER = resolveActorPermissions('member')

function authzLabel(s: ResolvedSurface): string {
  switch (s.authz.type) {
    case 'permission':
      return s.authz.permission
    case 'end_user':
      return 'END_USER (any authenticated)'
    case 'public_data':
      return 'PUBLIC (any valid key)'
    case 'mcp_entry':
      return 'MCP entry (tool scopes authorize)'
    case 'dynamic_permission':
      return `DYNAMIC (${s.authz.permissions.join(' | ')})`
    case 'role_gate': {
      const bar = s.authz.bar === 'admin' ? 'ADMIN-ONLY' : 'TEAM-ONLY'
      return `${bar}${s.authz.permission ? ` (~${s.authz.permission})` : ''}`
    }
  }
}

const mark = (b: boolean) => (b ? '✓' : '·')

/**
 * Render the committed matrix document. Pairs with `matrix.test.ts`, which
 * snapshots this string to MATRIX.md — the reviewable artifact contributors
 * read and reviewers diff.
 */
export function renderMatrixDoc(
  surfaces: ResolvedSurface[],
  tools: ScannedMcpTool[],
  entryPoints: EntryPoint[]
): string {
  const out: string[] = []
  out.push('# Authorization matrix (generated — do not edit by hand)')
  out.push('')
  out.push(
    'Regenerate with `bunx vitest run apps/web/src/lib/server/policy/authz-matrix -u`.',
    'A diff here means a gate, a role preset, or the set of surfaces changed — review it as an access-control change.',
    ''
  )

  // Section 1 — permission reach by role profile.
  out.push('## 1. Permission reach by role profile')
  out.push('')
  out.push(
    'Profiles: **Owner** = admin class + an admin-owned full API key (scoped keys hold the subset their scopes map to); **Manager** = member class + member OAuth grant; **None** = portal user + every widget class (holds no teammate permission).'
  )
  out.push('')
  out.push('| Permission | Category | Owner | Manager |')
  out.push('| --- | --- | :---: | :---: |')
  const categoryOf = new Map(PERMISSION_CATALOGUE.map((e) => [e.key, e.category]))
  for (const p of ALL_PERMISSIONS) {
    out.push(
      `| ${p} | ${categoryOf.get(p) ?? '?'} | ${mark(OWNER.has(p))} | ${mark(MANAGER.has(p))} |`
    )
  }
  out.push('')

  // Section 2 — every surface's enforced authorization, grouped by channel.
  out.push('## 2. Surfaces and their enforced authorization')
  out.push('')
  const sections = [
    ['server-fn', 'Server functions (`requireAuth`)'],
    ['api-route', 'Public REST API (`withApiKeyAuth`)'],
    ['sse', 'SSE stream (inline gate)'],
    ['mcp', 'MCP transport entry'],
  ] as const
  for (const [ch, title] of sections) {
    const rows = surfaces.filter((s) => s.channel === ch)
    if (rows.length === 0) continue
    out.push(`### ${title} — ${rows.length} surface${rows.length === 1 ? '' : 's'}`)
    out.push('')
    out.push('| Surface | Enforces |')
    out.push('| --- | --- |')
    for (const s of rows) {
      out.push(`| \`${s.file}\`::${s.surface} | ${authzLabel(s)} |`)
    }
    out.push('')
  }

  // Section 3 — MCP tool contracts + the scope over-grant.
  out.push('## 3. MCP tools')
  out.push('')
  out.push(
    `${tools.length} tools. "Team" = requires an admin/member role in addition to the scope.`
  )
  out.push('')
  out.push('| Tool | Scope(s) | Team |')
  out.push('| --- | --- | :---: |')
  for (const t of tools) {
    out.push(`| ${t.name} | ${t.scopes.join(', ')} | ${mark(t.teamOnly)} |`)
  }
  out.push('')
  out.push('### MCP scope holdings by class')
  out.push('')
  out.push(
    'Key scopes are enforced: an API key holds exactly its stored scopes (owner permissions ∩ key scopes on REST, per-tool scope guards on MCP). A key with NULL stored scopes (legacy, pre-scope-selection) holds every scope. OAuth grants carry their own enforced scopes.'
  )
  out.push('')
  const scopeUniverse = [...new Set(tools.flatMap((t) => t.scopes))].sort()
  out.push(`| Class | ${scopeUniverse.join(' | ')} |`)
  out.push(`| --- | ${scopeUniverse.map(() => ':---:').join(' | ')} |`)
  for (const cls of PRINCIPAL_CLASSES) {
    if (!cls.mcpScopes) continue
    out.push(
      `| ${cls.label} | ${scopeUniverse.map((s) => mark(cls.mcpScopes!.has(s))).join(' | ')} |`
    )
  }
  out.push('')

  // Section 4 — entry points with no requireAuth/withApiKeyAuth gate. Pinned so a
  // newly added route or function that forgets to gate shows up as a diff here.
  const ungated = entryPoints.filter((e) => !e.gated)
  out.push('## 4. Entry points without a requireAuth/key gate')
  out.push('')
  out.push(
    `${ungated.length} of ${entryPoints.length} entry points hold no \`requireAuth\` / \`withApiKeyAuth\` / \`requireTeamAuth\` gate.`,
    'Each is expected to be intentionally public, a pre-auth flow, a signature-verified webhook, or a handler that delegates auth (e.g. the MCP route).',
    '**Adding a row here is an access-control change** — confirm the new entry point is meant to be reachable without a gate.',
    ''
  )
  out.push('| Entry point | Kind |')
  out.push('| --- | --- |')
  for (const e of ungated) {
    out.push(`| \`${e.file}\`::${e.surface} | ${e.kind} |`)
  }
  return out.join('\n') + '\n'
}
