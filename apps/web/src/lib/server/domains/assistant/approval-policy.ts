/**
 * What an approval is, read off the operation itself: its risk tier, the
 * permissions a person needs to decide it, and the summary people read.
 *
 * Everything here is computed by the server from the diff. Nothing reads text
 * the requesting agent wrote, so a request cannot describe itself as safe or
 * name itself something it is not.
 */
import type { ApprovalRisk } from '@/lib/server/db'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import type {
  SettingsArea,
  SettingsChange,
  SettingsProposal,
} from '@/lib/shared/assistant/settings-proposals'
import { SETTINGS_AREA_META } from '@/lib/shared/settings-registry'
import { AREAS } from './settings-proposals.areas'

/** The tool name a settings request is filed under. */
export const SETTINGS_PROPOSAL_TOOL = 'propose_settings_change'

const RISK_ORDER: Record<ApprovalRisk, number> = { low: 0, medium: 1, high: 2, critical: 3 }

/** The riskier of two tiers. */
export function higherRisk(a: ApprovalRisk, b: ApprovalRisk): ApprovalRisk {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b
}

/** More changes than this in one request is medium risk, however small each one is. */
export const BULK_CHANGE_THRESHOLD = 25

/** Operations that send data out, change access, or change the AI's knowledge. */
const HIGH_RISK_TOOLS = new Set([
  'create_article',
  'update_article',
  'delete_article',
  'manage_category',
  'create_webhook',
  'update_webhook',
  'create_api_key',
  'update_api_key',
  'delete_api_key',
  'invite_member',
  'update_member_role',
  'update_guidance',
  'export_data',
])

/** Pending connector calls are writes; even an old stored tier cannot lower their risk. */
export function toolApprovalRisk(toolName: string, args: Record<string, unknown>): ApprovalRisk {
  if (toolName.startsWith('connector_') || HIGH_RISK_TOOLS.has(toolName) || args.permanent === true)
    return 'high'
  return 'medium'
}

/** The tier of each settings area, as the settings registry declares it. */
const SETTINGS_AREA_RISK: Record<SettingsArea, ApprovalRisk> = Object.fromEntries(
  Object.entries(SETTINGS_AREA_META).map(([id, meta]) => [id, meta.risk])
) as Record<SettingsArea, ApprovalRisk>

/** The risk of a settings request: its riskiest change, and medium for a bulk one. */
export function settingsProposalRisk(proposal: SettingsProposal): ApprovalRisk {
  const base = proposal.changes.reduce<ApprovalRisk>(
    (risk, change) => higherRisk(risk, SETTINGS_AREA_RISK[change.area]),
    'low'
  )
  return proposal.changes.length > BULK_CHANGE_THRESHOLD ? higherRisk(base, 'medium') : base
}

/** The permission one settings change needs. A logo needs settings management. */
export function settingsChangePermission(
  change: Pick<SettingsChange, 'area' | 'path'>
): PermissionKey {
  return change.area === 'branding' && change.path[0] === 'logoKey'
    ? PERMISSIONS.SETTINGS_MANAGE
    : AREAS[change.area].permission
}

/** Every permission a person needs to decide these settings changes. */
export function settingsProposalPermissions(
  changes: readonly Pick<SettingsChange, 'area' | 'path'>[]
): ReadonlySet<PermissionKey> {
  return new Set(changes.map(settingsChangePermission))
}

/** Switches named on their own in a summary, by change id. */
const SWITCH_PHRASES: Record<string, string> = {
  'messenger.enabled': 'Messenger',
  'modules.supportInbox': 'the support inbox',
  'modules.supportTickets': 'tickets',
  'modules.helpCenter': 'the help center',
  'modules.statusPage': 'the status page',
}

const AREA_PHRASES: Record<SettingsArea, string> = {
  branding: 'branding',
  portal: 'the workspace name',
  messenger: 'Messenger settings',
  modules: 'modules',
  office_hours: 'office hours',
  changelog: 'changelog settings',
}

function joinPhrases(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * A one-line summary of a settings request, written from the diff: switches
 * by name, every other change by area. It never quotes a proposed value, so
 * text the request carries can never become its title.
 */
export function summarizeSettingsProposal(proposal: SettingsProposal): string {
  const switches: string[] = []
  const areas: SettingsArea[] = []
  for (const change of proposal.changes) {
    const name = SWITCH_PHRASES[change.id]
    if (name && typeof change.after === 'boolean') {
      switches.push(`turn ${change.after ? 'on' : 'off'} ${name}`)
    } else if (!areas.includes(change.area)) {
      areas.push(change.area)
    }
  }
  const phrases = [...switches]
  if (areas.length > 0)
    phrases.push(`change ${joinPhrases(areas.map((area) => AREA_PHRASES[area]))}`)
  const sentence = joinPhrases(phrases)
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}
