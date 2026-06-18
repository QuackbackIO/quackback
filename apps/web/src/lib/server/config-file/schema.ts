import { z } from 'zod'
import { httpsUrl } from '@/lib/shared/schemas/auth'

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

const useCaseSchema = z.enum(['saas', 'consumer', 'marketplace', 'internal'])

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
    // control-plane on CP-provisioned tenants where the operator did
    // the equivalent of the wizard out-of-band (named the workspace,
    // picked a plan) before the user ever sees the OSS portal. The
    // reconciler stamps every setupState.step + completedAt so the
    // /onboarding/* routes redirect straight to /admin.
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
    aiFeedbackExtraction: z.boolean().optional(),
  })
  .strict()
  .optional()
const tierLimitsSchema = z
  .object({
    maxBoards: tierLimitNumberSchema.optional(),
    maxPosts: tierLimitNumberSchema.optional(),
    maxTeamSeats: tierLimitNumberSchema.optional(),
    aiTokensPerMonth: tierLimitNumberSchema.optional(),
    apiRequestsPerMonth: tierLimitNumberSchema.optional(),
    apiRequestsPerMinute: tierLimitNumberSchema.optional(),
    features: tierFeatureFlagsSchema,
    notice: planNoticeSchema.optional(),
  })
  .strict()

// `features` is per-key managed: each entry locks one feature flag
// while leaving others UI-toggleable. Accepts any boolean key — the
// FeatureFlags shape has its own zod schema that the reconciler
// validates against; here the shape just needs to be string→boolean.
const featuresSchema = z.record(z.string(), z.boolean())

// Workspace runtime state. The reconciler writes whatever the file
// declares; absent → `settings.state` keeps its DB default of 'active'.
const stateSchema = z.enum(['active', 'suspended', 'deleting', 'deleted'])

// Auth surface: OAuth provider toggles + openSignup + optional OIDC SSO.
// Provider secrets are never declared here — both OAuth client secrets
// (Google/GitHub/etc.) and the SSO OIDC client secret live encrypted
// in the platform_credentials table.
const oauthProvidersSchema = z
  .object({
    google: z.boolean().optional(),
    github: z.boolean().optional(),
    password: z.boolean().optional(),
    // `magicLink` is the email-link sign-in option the team-login form
    // surfaces alongside (or instead of) password. Defaults to false in
    // PortalAuthForm's `?? false` fallback, so a managed-cloud control
    // plane has to declare it explicitly to push magic-link as the
    // primary admin auth surface. Self-host tenants keep the legacy
    // default unless their declarative config opts in.
    magicLink: z.boolean().optional(),
  })
  .strict()

// OIDC SSO provider config. The file declares the non-secret config —
// discoveryUrl + clientId + UX flags — while the client *secret* lives
// in platform_credentials (auth_sso, encrypted). The admin login page
// is email-first: typing an email at a verified domain auto-redirects
// to the IdP, so there's no "default CTA" knob.
const ssoOidcSchema = z
  .object({
    enabled: z.boolean(),
    discoveryUrl: httpsUrl,
    clientId: z.string().min(1),
    /** Auto-create user records on first SSO sign-in. */
    autoCreateUsers: z.boolean().default(true),
  })
  .strict()

// SSO enforcement is per-domain (sso_verified_domain.enforced), not
// declared here. A config-file shape for that can be added later.

const authSchema = z
  .object({
    oauth: oauthProvidersSchema.optional(),
    openSignup: z.boolean().optional(),
    ssoOidc: ssoOidcSchema.optional(),
  })
  .strict()

export const quackbackConfigSchema = z
  .object({
    apiVersion: z.literal('quackback.io/v1'),
    kind: z.literal('QuackbackConfig'),
    metadata: z.object({ source: z.string().optional() }).strict().optional(),
    spec: z
      .object({
        workspace: workspaceSchema.optional(),
        tierLimits: tierLimitsSchema.optional(),
        features: featuresSchema.optional(),
        state: stateSchema.optional(),
        auth: authSchema.optional(),
      })
      .strict(),
  })
  .strict()

export type QuackbackConfig = z.infer<typeof quackbackConfigSchema>
export type QuackbackConfigSpec = QuackbackConfig['spec']

export function parseQuackbackConfig(input: unknown): z.ZodSafeParseResult<QuackbackConfig> {
  return quackbackConfigSchema.safeParse(input)
}
