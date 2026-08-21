/**
 * Default SLA policy setting — client-safe types + defaults.
 *
 * The value rides in the `settings.metadata` JSON bag under the
 * `defaultSlaPolicy` key (see `domains/settings/settings.sla-default.ts`).
 * `null` means no default: conversations start without a policy unless a
 * workflow later applies one.
 */
import { z } from 'zod'

export interface DefaultSlaPolicySettings {
  policyId: string | null
}

export const DEFAULT_SLA_POLICY_SETTINGS: DefaultSlaPolicySettings = {
  policyId: null,
}

export const defaultSlaPolicySchema = z.object({
  policyId: z.string().min(1).nullable(),
})

export type UpdateDefaultSlaPolicyInput = z.infer<typeof defaultSlaPolicySchema>
