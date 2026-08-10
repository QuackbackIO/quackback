import { z } from 'zod'
import { httpsUrl } from '@/lib/shared/schemas/auth'
import {
  BILLING_STATUSES,
  ENTITLEMENT_KEYS,
  PLAN_IDS,
} from '@/lib/server/domains/settings/cloud/cloud.types'

/**
 * Declarative Quackback config file schema.
 *
 * Loaded from `/etc/quackback/config.yaml`. Anything declared here is
 * reconciled into the `settings` row AND blocked from in-app UI
 * mutation; anything absent stays freely user-editable.
 *
 * Only fields with a legitimate platform-control story are in scope.
 * Workflow data (boards, posts, integrations, API keys, sessions) is
 * intentionally NOT representable here — keeps the lock surface small
 * and prevents the file from growing into a kitchen-sink schema.
 */

const useCaseSchema = z.enum([
  'product_feedback',
  'customer_support',
  'help_center',
  'internal',
  // Legacy values still accepted in config files
  'saas',
  'consumer',
  'marketplace',
])

const workspaceSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    slug: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    useCase: useCaseSchema.optional(),
    // Force the in-app onboarding wizard to be skipped. Set by the
    // control-plane on CP-provisioned workspaces where the operator did
    // the equivalent of the wizard out-of-band (named the workspace,
    // picked a plan) before the user ever sees the OSS portal. The
    // reconciler records a managed starting point and completion time so the
    // user sees the one-time activation handoff before entering the admin app.
    onboardingComplete: z.boolean().optional(),
  })
  .strict()

// Mirrors the TierLimits shape from
// apps/web/src/lib/server/domains/settings/tier-limits.types.ts.
// `null` in any numeric field = unlimited; partial objects allowed
// (the reconciler merges into the existing tierLimits row, so the
// file only needs to declare the fields it wants to lock).
const tierLimitNumberSchema = z.number().int().nonnegative().nullable()

// Optional operator-set admin banner. Delivered alongside tier limits;
// see PlanNotice in domains/settings/tier-limits.types.ts.
const planNoticeSchema = z
  .object({
    label: z.string().min(1),
    message: z.string().optional(),
    expiresAt: z.string().optional(),
    actionUrl: httpsUrl.optional(),
    actionLabel: z.string().optional(),
  })
  .strict()

const tierFeatureFlagsSchema = z
  .object({
    customDomain: z.boolean().optional(),
    customOidcProvider: z.boolean().optional(),
    ipAllowlist: z.boolean().optional(),
    webhooks: z.boolean().optional(),
    mcpServer: z.boolean().optional(),
    analyticsExports: z.boolean().optional(),
    customColors: z.boolean().optional(),
    customCss: z.boolean().optional(),
    integrations: z.boolean().optional(),
  })
  .strict()
  .optional()
const tierLimitsSchema = z
  .object({
    maxBoards: tierLimitNumberSchema.optional(),
    maxPosts: tierLimitNumberSchema.optional(),
    maxTeamSeats: tierLimitNumberSchema.optional(),
    maxStatusComponents: tierLimitNumberSchema.optional(),
    aiTokensPerMonth: tierLimitNumberSchema.optional(),
    apiRequestsPerMonth: tierLimitNumberSchema.optional(),
    apiRequestsPerMinute: tierLimitNumberSchema.optional(),
    features: tierFeatureFlagsSchema,
    notice: planNoticeSchema.optional(),
  })
  .strict()

// Cloud configuration block. Mirrors CloudConfig from
// apps/web/src/lib/server/domains/settings/cloud/cloud.types.ts and is the
// operator/self-hoster channel for plan and entitlements — the same role the
// config file already plays for tier limits. A future billing module is the
// second writer; the two are kept apart by managed paths (see the leaf paths
// in managed-paths.ts).
//
// Absent from the file = the column is left alone. Present with
// `enabled: false` = explicitly inert. Neither writes a plan.
const planIdSchema = z.enum(PLAN_IDS)

const cloudEntitlementsSchema = z
  .object(Object.fromEntries(ENTITLEMENT_KEYS.map((key) => [key, z.boolean().optional()])))
  .strict()

const cloudBillingSchema = z
  .object({
    provider: z.string().min(1).nullable().optional(),
    customerRef: z.string().min(1).nullable().optional(),
    subscriptionRef: z.string().min(1).nullable().optional(),
    status: z.enum(BILLING_STATUSES).nullable().optional(),
    currentPeriodEnd: z.string().min(1).nullable().optional(),
  })
  .strict()

const cloudSchema = z
  .object({
    enabled: z.boolean(),
    plan: planIdSchema.nullable().optional(),
    entitlements: cloudEntitlementsSchema.optional(),
    billing: cloudBillingSchema.optional(),
    upgradeUrl: httpsUrl.nullable().optional(),
  })
  .strict()
  // Enabling the cloud block without naming a plan would leave every
  // entitlement denied-by-default with nothing to upsell to. Reject it at the
  // file boundary so that state is unreachable through the supported writer.
  .refine((value) => !value.enabled || (value.plan !== undefined && value.plan !== null), {
    message: 'spec.cloud.plan is required when spec.cloud.enabled is true',
    path: ['plan'],
  })

// Deprecated compatibility keys. `auth` and top-level `features` were managed
// by older config files, but are now in-app only. Keep accepting them for one
// release so old files do not make the whole watcher fail before supported
// workspace/tier fields can reconcile. The reconciler deliberately ignores
// both keys.
const deprecatedFeaturesSchema = z.record(z.string(), z.boolean())
const deprecatedAuthSchema = z.unknown()

export const quackbackConfigSchema = z
  .object({
    apiVersion: z.literal('quackback.io/v1'),
    kind: z.literal('QuackbackConfig'),
    metadata: z.object({ source: z.string().optional() }).strict().optional(),
    spec: z
      .object({
        workspace: workspaceSchema.optional(),
        tierLimits: tierLimitsSchema.optional(),
        cloud: cloudSchema.optional(),
        features: deprecatedFeaturesSchema.optional(),
        auth: deprecatedAuthSchema.optional(),
      })
      .strict(),
  })
  .strict()

export type QuackbackConfig = z.infer<typeof quackbackConfigSchema>
export type QuackbackConfigSpec = QuackbackConfig['spec']

export function getDeprecatedConfigKeys(spec: QuackbackConfigSpec): Array<'auth' | 'features'> {
  const keys: Array<'auth' | 'features'> = []
  if (Object.prototype.hasOwnProperty.call(spec, 'auth')) keys.push('auth')
  if (Object.prototype.hasOwnProperty.call(spec, 'features')) keys.push('features')
  return keys
}

export function parseQuackbackConfig(input: unknown): z.ZodSafeParseResult<QuackbackConfig> {
  return quackbackConfigSchema.safeParse(input)
}
