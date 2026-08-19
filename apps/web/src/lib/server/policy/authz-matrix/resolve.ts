/**
 * Reconcile the raw gate scan against the hand-declared classifications into a
 * single list of resolved surfaces — each with a definite authorization — plus
 * the list of reconciliation errors.
 *
 * This is the join the whole matrix stands on: the scanner supplies what the
 * code enforces, the classifications supply intent for the non-permission
 * sites, and this module fails (via `errors`) the moment the two drift — an
 * unparseable gate, an unclassified bare/inline site, or a stale classification
 * with no live site. Both the completeness CI gate and the derived matrix
 * consume it, so they can never disagree about the surface set.
 */
import { ALL_PERMISSIONS, PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { scanAuthzSurfaces } from './scan'
import {
  ALIAS_RESOLUTIONS,
  BARE_GATE_CLASSIFICATIONS,
  INLINE_CLASSIFICATIONS,
  gateKey,
  inlineKey,
} from './classifications'

export type Channel = 'server-fn' | 'api-route' | 'mcp' | 'sse'

export type ResolvedAuthz =
  /** A specific catalogue permission is required. */
  | { type: 'permission'; permission: PermissionKey }
  /** Any authenticated principal (team, portal, or widget). */
  | { type: 'end_user' }
  /** Any valid API key, no permission checked; the data is portal-public. */
  | { type: 'public_data' }
  /** MCP transport entry: a valid key authenticates; per-tool scopes authorize. */
  | { type: 'mcp_entry' }
  /** A key authenticates; a runtime check authorizes against a closed set of candidate permissions (field-scoped write). */
  | { type: 'dynamic_permission'; permissions: readonly PermissionKey[] }
  /** An inline decision gated on role (`admin`, or `team` = admin|member), optionally mirroring a permission. */
  | { type: 'role_gate'; bar: 'admin' | 'team'; permission?: PermissionKey }

export interface ResolvedSurface {
  file: string
  surface: string
  line: number
  callee: string
  channel: Channel
  authz: ResolvedAuthz
}

export interface ResolveResult {
  surfaces: ResolvedSurface[]
  errors: string[]
}

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS)
const PERMISSION_BY_CONST = new Map<string, PermissionKey>(
  Object.entries(PERMISSIONS) as [string, PermissionKey][]
)

function channelOf(file: string): Channel {
  if (file.startsWith('routes/api/chat/stream')) return 'sse'
  if (file === 'lib/server/mcp/handler.ts') return 'mcp'
  if (file.startsWith('routes/api/')) return 'api-route'
  return 'server-fn'
}

export function resolveSurfaces(srcRoot: string): ResolveResult {
  const { gates, inline } = scanAuthzSurfaces(srcRoot)
  const surfaces: ResolvedSurface[] = []
  const errors: string[] = []

  const usedBare = new Set<string>()
  const usedInline = new Set<string>()
  const usedAlias = new Set<string>()

  for (const g of gates) {
    const base = {
      file: g.file,
      surface: g.surface,
      line: g.line,
      callee: g.callee,
      channel: channelOf(g.file),
    }

    if (g.authz.kind === 'permission') {
      let key: PermissionKey | undefined
      if (g.authz.permissionConst) {
        key = PERMISSION_BY_CONST.get(g.authz.permissionConst)
        if (!key) {
          errors.push(`${g.file}:${g.line} unknown PERMISSIONS.${g.authz.permissionConst}`)
          continue
        }
      } else if (g.authz.permissionLiteral && PERMISSION_SET.has(g.authz.permissionLiteral)) {
        key = g.authz.permissionLiteral as PermissionKey
      } else {
        errors.push(
          `${g.file}:${g.line} unrecognized permission literal '${g.authz.permissionLiteral}'`
        )
        continue
      }
      surfaces.push({ ...base, authz: { type: 'permission', permission: key } })
    } else if (g.authz.kind === 'alias') {
      const perm = ALIAS_RESOLUTIONS[g.authz.callee]
      if (!perm) {
        errors.push(`${g.file}:${g.line} gate alias '${g.authz.callee}' has no resolution`)
        continue
      }
      usedAlias.add(g.authz.callee)
      surfaces.push({ ...base, authz: { type: 'permission', permission: perm } })
    } else if (g.authz.kind === 'bare') {
      const key = gateKey(g.file, g.surface)
      const cls = BARE_GATE_CLASSIFICATIONS[key]
      if (!cls) {
        errors.push(
          `${g.file}:${g.line} unclassified bare gate '${key}' — add it to BARE_GATE_CLASSIFICATIONS`
        )
        continue
      }
      usedBare.add(key)
      if (cls.intent === 'DYNAMIC_PERMISSION') {
        const perms = cls.resolvesToAny ?? []
        const unknown = perms.filter((p) => !PERMISSION_SET.has(p))
        if (perms.length === 0 || unknown.length > 0) {
          errors.push(
            `${g.file}:${g.line} DYNAMIC_PERMISSION gate '${key}' has ${
              perms.length === 0
                ? 'no candidate permissions'
                : `unknown candidates (${unknown.join(', ')})`
            }`
          )
          continue
        }
        surfaces.push({ ...base, authz: { type: 'dynamic_permission', permissions: perms } })
        continue
      }
      const authz: ResolvedAuthz =
        cls.intent === 'PUBLIC_DATA'
          ? { type: 'public_data' }
          : cls.intent === 'MCP_ENTRY'
            ? { type: 'mcp_entry' }
            : { type: 'end_user' }
      surfaces.push({ ...base, authz })
    } else {
      errors.push(
        `${g.file}:${g.line} unparseable gate — authority not statically legible: ${g.authz.raw}`
      )
    }
  }

  for (const i of inline) {
    const key = inlineKey(i.file, i.surface, i.callee)
    const cls = INLINE_CLASSIFICATIONS[key]
    if (!cls) {
      errors.push(
        `${i.file}:${i.line} unclassified inline role check '${key}' — add it to INLINE_CLASSIFICATIONS`
      )
      continue
    }
    const firstOccurrence = !usedInline.has(key)
    usedInline.add(key)
    // One surface per distinct inline gate, even when a handler repeats the
    // check across branches (e.g. the SSE endpoint tests isTeamMember 3×).
    if (cls.intent === 'SECONDARY_GATE' && firstOccurrence) {
      surfaces.push({
        file: i.file,
        surface: i.surface,
        line: i.line,
        callee: i.callee,
        channel: channelOf(i.file),
        authz: { type: 'role_gate', bar: cls.roleBar ?? 'team', permission: cls.resolvesTo },
      })
    }
    // NOT_A_GATE contributes no surface — it is a refinement behind an existing gate.
  }

  // Reverse lockstep: no classification may outlive the site it describes.
  for (const key of Object.keys(BARE_GATE_CLASSIFICATIONS)) {
    if (!usedBare.has(key))
      errors.push(`stale bare classification '${key}' — no live gate matches it`)
  }
  for (const key of Object.keys(INLINE_CLASSIFICATIONS)) {
    if (!usedInline.has(key))
      errors.push(`stale inline classification '${key}' — no live site matches it`)
  }
  for (const callee of Object.keys(ALIAS_RESOLUTIONS)) {
    if (!usedAlias.has(callee))
      errors.push(`stale alias resolution '${callee}' — no live call matches it`)
  }

  surfaces.sort(
    (a, b) => a.channel.localeCompare(b.channel) || a.file.localeCompare(b.file) || a.line - b.line
  )
  return { surfaces, errors }
}
