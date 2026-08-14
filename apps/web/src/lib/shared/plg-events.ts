import type { OnboardingOutcome } from './db-types'
import type { ActivationSurface } from './activation-action'

export const PLG_EVENT_NAMES = [
  'saas_handoff_consumed',
  'onboarding_goal_saved',
  'starter_created',
  'starter_configured',
  'starter_deferred',
  'starter_unavailable',
  'activation_cta_viewed',
  'activation_cta_clicked',
  'board_link_copied',
  'widget_configured',
  'widget_install_observed',
  'trial_started',
  'first_win_reached',
] as const

export type PlgEventName = (typeof PLG_EVENT_NAMES)[number]
export type PlgArtifactType = 'board' | 'messenger' | 'article' | 'widget' | 'none'

export interface PlgEventInput {
  name: PlgEventName
  outcome?: OnboardingOutcome
  surface?: ActivationSurface
  actionId?: string
  artifactType?: PlgArtifactType
}

const EVENT_NAMES = new Set<string>(PLG_EVENT_NAMES)
const OUTCOMES = new Set(['product_feedback', 'customer_support', 'help_center', 'internal'])
const SURFACES = new Set([
  'onboarding_handoff',
  'feedback_empty',
  'conversation_empty',
  'launch_plan',
])
const ARTIFACT_TYPES = new Set(['board', 'messenger', 'article', 'widget', 'none'])
const INPUT_KEYS = new Set(['name', 'outcome', 'surface', 'actionId', 'artifactType'])

/** Reject unknown fields so content, URLs, emails, and tokens can never enter PLG logs. */
export function parsePlgEventInput(value: unknown): PlgEventInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (Object.keys(input).some((key) => !INPUT_KEYS.has(key))) return null
  if (typeof input.name !== 'string' || !EVENT_NAMES.has(input.name)) return null
  if (input.outcome !== undefined && !OUTCOMES.has(String(input.outcome))) return null
  if (input.surface !== undefined && !SURFACES.has(String(input.surface))) return null
  if (input.artifactType !== undefined && !ARTIFACT_TYPES.has(String(input.artifactType))) {
    return null
  }
  if (
    input.actionId !== undefined &&
    (typeof input.actionId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(input.actionId))
  ) {
    return null
  }
  return input as unknown as PlgEventInput
}
