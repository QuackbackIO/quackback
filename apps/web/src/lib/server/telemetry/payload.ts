import { existsSync } from 'fs'
import type { EmailProvider } from '@quackback/email/provider'
import { getOrCreateInstanceId } from './instance-id'
import { activeSecretKey } from '@/lib/server/secret-key'
import {
  AI_FEATURES,
  aiFeatureOf,
  aiProviderOf,
  assertAnonymousTelemetry,
  authMethodsOf,
  knownValues,
  productsFromFlags,
  toAgeBracket,
  toScaleBracket,
  TELEMETRY_OUTCOMES,
  type AgeBracket,
  type AiFeature,
  type AiProvider,
  type ScaleBracket,
  type TelemetryOutcome,
  type TelemetryProducts,
  type TelemetryStarterResolution,
} from './anonymous'
import {
  DEFAULT_FEATURE_FLAGS,
  resolveFeatureFlags,
} from '@/lib/server/domains/settings/settings.types'
import { getSetupState, type SetupState } from '@/lib/shared/db-types'
import { analyticsWorkspaceKey } from '@/lib/shared/analytics-identity'
import { getCurrentWorkspace } from '@/lib/server/workspaces/workspace-context'

export interface TelemetryPayload {
  version: string
  runtime: 'bun' | 'node'
  runtimeVersion: string
  os: string
  arch: string
  deployMethod: string
  instanceId: string
  features: {
    oauth: boolean
    smtp: boolean
    s3: boolean
    ai: boolean
    widget: boolean
    mcp: boolean
  }
  /** Full flag map. Kept so existing raw_payload queries still work. */
  experimentalFeatures: Record<string, boolean>
  /** First-class product modules. */
  products: TelemetryProducts
  cloud: boolean
  firstWin: { reached: boolean; outcome: TelemetryOutcome | null }
  widgetInstalled: boolean
  activation: {
    outcome: TelemetryOutcome | null
    starterResolution: TelemetryStarterResolution | null
  }
  seats7d: ScaleBracket
  scale: {
    users: ScaleBracket
    posts: ScaleBracket
    boards: ScaleBracket
    conversations: ScaleBracket
    publishedArticles: ScaleBracket
    changelogEntries: ScaleBracket
    incidents: ScaleBracket
  }
  /** How long ago the workspace was created. */
  installAge: AgeBracket | null
  platform: {
    postgresMajor: number | null
    tenancy: 'single' | 'pooled'
    processRole: string
    /** Some settings are pinned by a declarative config file. */
    configFile: boolean
  }
  /** `ses`, `smtp`, `resend` or `console`. */
  emailProvider: EmailProvider
  aiProvider: AiProvider
  auth: {
    /** Enabled sign-in methods; custom identity providers report as `oidc`. */
    methods: string[]
    openSignup: boolean
  }
  /** Connected integration types, from the built-in catalogue only. */
  integrations: string[]
  /** Languages people chose for themselves, from the supported list only. */
  locales: string[]
  /** People who signed in during the last 30 days. */
  activeUsers30d: { team: ScaleBracket; portal: ScaleBracket }
  /** What was created or done in the last 30 days, per module. */
  activity30d: {
    posts: ScaleBracket
    votes: ScaleBracket
    comments: ScaleBracket
    conversations: ScaleBracket
    agentReplies: ScaleBracket
    tickets: ScaleBracket
    changelogPublished: ScaleBracket
    articlesPublished: ScaleBracket
    helpCenterSearches: ScaleBracket
    incidents: ScaleBracket
    workflowRuns: ScaleBracket
  }
  /** New conversations in the last 30 days by channel. */
  channels30d: Record<string, ScaleBracket>
  /** AI calls in the last 30 days by product feature. */
  ai30d: Record<AiFeature, ScaleBracket>
  health: { failedJobs24h: ScaleBracket }
}

function getRuntime(): 'bun' | 'node' {
  return typeof globalThis.Bun !== 'undefined' ? 'bun' : 'node'
}

function getRuntimeVersion(): string {
  const raw = getRuntime() === 'bun' ? Bun.version : process.version
  const [major, minor] = raw.replace(/^v/, '').split('.')
  return major && minor ? `${major}.${minor}` : raw
}

function detectDeployMethod(): string {
  if (process.env.RAILWAY_PROJECT_ID) return 'railway'
  if (process.env.RENDER_SERVICE_ID) return 'render'
  if (process.env.FLY_APP_NAME) return 'fly'
  if (process.env.DOCKER_CONTAINER || existsSync('/.dockerenv')) return 'docker'
  return 'unknown'
}

/** The primary goal, with feedback kept to the team reported as internal feedback. */
export function telemetryOutcome(state: SetupState | null): TelemetryOutcome | null {
  const goal = state?.goals?.[0] ?? state?.useCase
  if (goal === 'product_feedback' && state?.feedbackPrivate) return 'internal'
  return goal && (TELEMETRY_OUTCOMES as readonly string[]).includes(goal)
    ? (goal as TelemetryOutcome)
    : null
}

async function getCapabilityFeatures(): Promise<TelemetryPayload['features']> {
  try {
    const { config } = await import('@/lib/server/config')
    const { getDeveloperConfig } = await import('@/lib/server/domains/settings/settings.service')
    const { getWidgetConfig } = await import('@/lib/server/domains/settings/settings.widget')

    const [devConfig, widgetConfig] = await Promise.all([
      getDeveloperConfig().catch(() => null),
      getWidgetConfig().catch(() => null),
    ])

    return {
      oauth: !!activeSecretKey(),
      smtp: !!config.emailSmtpHost,
      s3: !!config.s3Bucket,
      ai: !!config.openaiApiKey,
      widget: widgetConfig?.enabled ?? false,
      mcp: devConfig?.mcpEnabled ?? true,
    }
  } catch {
    return { oauth: false, smtp: false, s3: false, ai: false, widget: false, mcp: false }
  }
}

async function getWorkspaceSnapshot(): Promise<{
  experimentalFeatures: Record<string, boolean>
  products: TelemetryProducts
  cloud: boolean
  firstWin: TelemetryPayload['firstWin']
  widgetInstalled: boolean
  activation: TelemetryPayload['activation']
  workspaceId: string | null
  installAge: AgeBracket | null
  configFile: boolean
  authConfig: { oauth?: Record<string, boolean | undefined>; openSignup?: boolean } | null
}> {
  const emptyProducts = productsFromFlags(DEFAULT_FEATURE_FLAGS)
  const empty = {
    experimentalFeatures: { ...DEFAULT_FEATURE_FLAGS },
    products: emptyProducts,
    cloud: false,
    firstWin: { reached: false, outcome: null as TelemetryOutcome | null },
    widgetInstalled: false,
    activation: {
      outcome: null as TelemetryOutcome | null,
      starterResolution: null as TelemetryStarterResolution | null,
    },
    workspaceId: null,
    installAge: null,
    configFile: false,
    authConfig: null,
  }
  try {
    const { db } = await import('@/lib/server/db')
    const { getCloudConfig } = await import('@/lib/server/domains/settings/cloud/cloud.service')
    const { detectFirstWin } = await import('@/lib/server/activation-wins')

    const org = await db.query.settings.findFirst({
      columns: {
        id: true,
        createdAt: true,
        authConfig: true,
        managedFieldPaths: true,
        featureFlags: true,
        setupState: true,
        widgetInstalledFirstSeenAt: true,
      },
    })
    const flags = resolveFeatureFlags(org?.featureFlags)
    const state = getSetupState(org?.setupState ?? null)
    const outcome = telemetryOutcome(state)
    const starter = state?.steps.startingPoint?.resolution ?? null
    const starterResolution =
      starter === 'created' ||
      starter === 'configured' ||
      starter === 'deferred' ||
      starter === 'unavailable'
        ? starter
        : null

    const [cloud, firstWin] = await Promise.all([
      getCloudConfig().catch(() => ({ enabled: false as const })),
      detectFirstWin(state).catch(() => ({ reached: false, reachedAt: null })),
    ])

    return {
      experimentalFeatures: { ...flags },
      products: productsFromFlags(flags),
      cloud: cloud.enabled === true,
      firstWin: { reached: firstWin.reached, outcome },
      widgetInstalled: Boolean(org?.widgetInstalledFirstSeenAt),
      activation: { outcome, starterResolution },
      workspaceId: await analyticsWorkspaceKey(getCurrentWorkspace()?.workspaceKey, org?.id),
      installAge: toAgeBracket(org?.createdAt ?? null),
      configFile: (org?.managedFieldPaths?.length ?? 0) > 0,
      authConfig: parseJsonObject(org?.authConfig),
    }
  } catch {
    return empty
  }
}

function parseJsonObject<T extends object>(value: unknown): T | null {
  if (value && typeof value === 'object') return value as T
  if (typeof value !== 'string' || value === '') return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? (parsed as T) : null
  } catch {
    return null
  }
}

async function getPlatform(
  configFile: boolean
): Promise<Pick<TelemetryPayload, 'platform' | 'emailProvider' | 'aiProvider'>> {
  const { config } = await import('@/lib/server/config')
  const { getProcessRole } = await import('@/lib/server/process-role')
  let postgresMajor: number | null = null
  let emailProvider: EmailProvider = 'console'
  try {
    const { db } = await import('@/lib/server/db')
    const { sql } = await import('drizzle-orm')
    const { getExecuteRows } = await import('@/lib/server/utils')
    const row = getExecuteRows<{ v: string }>(
      await db.execute(sql`SELECT current_setting('server_version_num') as v`)
    )[0]
    const num = Number(row?.v)
    postgresMajor = Number.isFinite(num) && num > 0 ? Math.floor(num / 10_000) : null
  } catch {
    // Leave unknown
  }
  try {
    const { getEmailProvider } = await import('@quackback/email')
    emailProvider = getEmailProvider()
  } catch {
    // Leave as console: a conflicting configuration never boots, so this is
    // a process with no provider to report.
  }
  return {
    platform: {
      postgresMajor,
      tenancy: config.isPooledTenancy ? 'pooled' : 'single',
      processRole: getProcessRole(),
      configFile,
    },
    emailProvider,
    aiProvider: aiProviderOf(config.openaiApiKey, config.openaiBaseUrl),
  }
}

async function getAuth(
  authConfig: { oauth?: Record<string, boolean | undefined>; openSignup?: boolean } | null
): Promise<TelemetryPayload['auth']> {
  try {
    const { getRegisteredAuthProviders } = await import('@/lib/server/auth/registered-providers')
    const { getAllAuthProviders } = await import('@/lib/server/auth/auth-providers')
    const { isSignInMethodEnabled } = await import('@/lib/shared/signin-methods')
    const registered = await getRegisteredAuthProviders().catch(() => [] as string[])
    const builtIn = getAllAuthProviders()
      .filter((p) => p.type !== 'generic-oauth')
      .map((p) => p.id)
    const methods = authMethodsOf(registered, builtIn)
    for (const key of ['password', 'magicLink']) {
      if (isSignInMethodEnabled(authConfig?.oauth, key)) methods.push(key)
    }
    return { methods: [...new Set(methods)].sort(), openSignup: authConfig?.openSignup === true }
  } catch {
    return { methods: [], openSignup: false }
  }
}

async function getIntegrationsAndLocales(): Promise<
  Pick<TelemetryPayload, 'integrations' | 'locales'>
> {
  try {
    const { db } = await import('@/lib/server/db')
    const { sql } = await import('drizzle-orm')
    const { getExecuteRows } = await import('@/lib/server/utils')
    const { listIntegrationTypes } = await import('@/lib/server/integrations')
    const { SUPPORTED_LOCALES } = await import('@/lib/shared/i18n')
    const [integrationRows, localeRows] = await Promise.all([
      db.execute(sql`SELECT integration_type as v FROM integrations WHERE status = 'active'`),
      db.execute(
        sql`SELECT DISTINCT preferred_language as v FROM "user" WHERE preferred_language IS NOT NULL`
      ),
    ])
    const values = (result: unknown) => getExecuteRows<{ v: string }>(result).map((r) => r.v)
    return {
      integrations: knownValues(values(integrationRows), listIntegrationTypes()),
      locales: knownValues(values(localeRows), SUPPORTED_LOCALES),
    }
  } catch {
    return { integrations: [], locales: [] }
  }
}

const ACTIVITY_ZERO: TelemetryPayload['activity30d'] = {
  posts: '0',
  votes: '0',
  comments: '0',
  conversations: '0',
  agentReplies: '0',
  tickets: '0',
  changelogPublished: '0',
  articlesPublished: '0',
  helpCenterSearches: '0',
  incidents: '0',
  workflowRuns: '0',
}

async function getActivity(): Promise<
  Pick<TelemetryPayload, 'activeUsers30d' | 'activity30d' | 'channels30d' | 'ai30d' | 'health'>
> {
  const zeroAi = Object.fromEntries(AI_FEATURES.map((f) => [f, '0'])) as Record<
    AiFeature,
    ScaleBracket
  >
  const empty = {
    activeUsers30d: { team: '0' as ScaleBracket, portal: '0' as ScaleBracket },
    activity30d: { ...ACTIVITY_ZERO },
    channels30d: {},
    ai30d: zeroAi,
    health: { failedJobs24h: '0' as ScaleBracket },
  }
  try {
    const { db } = await import('@/lib/server/db')
    const { sql } = await import('drizzle-orm')
    const { getExecuteRows } = await import('@/lib/server/utils')
    const { CHANNELS } = await import('@/lib/shared/db-types')

    type Counts = Record<string, number | null>
    const since = sql`now() - interval '30 days'`
    const [countsResult, channelResult, aiResult] = await Promise.all([
      db.execute(sql`SELECT
        (SELECT count(distinct p.user_id)::int FROM "session" s
           JOIN "principal" p ON p.user_id = s.user_id
           WHERE s.updated_at > ${since} AND p.type = 'user' AND p.role IN ('admin', 'member')) as team,
        (SELECT count(distinct p.user_id)::int FROM "session" s
           JOIN "principal" p ON p.user_id = s.user_id
           WHERE s.updated_at > ${since} AND p.type = 'user' AND p.role = 'user') as portal,
        (SELECT count(*)::int FROM "posts" WHERE created_at > ${since} AND deleted_at IS NULL) as posts,
        (SELECT count(*)::int FROM "post_votes" WHERE created_at > ${since}) as votes,
        (SELECT count(*)::int FROM "post_comments" WHERE created_at > ${since} AND deleted_at IS NULL) as comments,
        (SELECT count(*)::int FROM "conversations" WHERE created_at > ${since}) as conversations,
        (SELECT count(*)::int FROM "conversation_messages"
           WHERE created_at > ${since} AND sender_type = 'agent' AND is_internal = false) as agent_replies,
        (SELECT count(*)::int FROM "tickets" WHERE created_at > ${since} AND deleted_at IS NULL) as tickets,
        (SELECT count(*)::int FROM "changelog_entries" WHERE published_at > ${since} AND deleted_at IS NULL) as changelog_published,
        (SELECT count(*)::int FROM "kb_articles" WHERE published_at > ${since} AND deleted_at IS NULL) as articles_published,
        (SELECT count(*)::int FROM "kb_search_queries" WHERE created_at > ${since}) as help_center_searches,
        (SELECT count(*)::int FROM "status_incidents" WHERE created_at > ${since} AND deleted_at IS NULL) as incidents,
        (SELECT count(*)::int FROM "workflow_runs" WHERE started_at > ${since}) as workflow_runs,
        (SELECT count(*)::int FROM "job_queue"
           WHERE status = 'failed' AND updated_at > now() - interval '1 day') as failed_jobs_24h`),
      db.execute(sql`SELECT channel as k, count(*)::int as n FROM "conversations"
        WHERE created_at > ${since} GROUP BY channel`),
      db.execute(sql`SELECT pipeline_step as k, count(*)::int as n FROM "ai_usage_log"
        WHERE created_at > ${since} GROUP BY pipeline_step`),
    ])
    const c = getExecuteRows<Counts>(countsResult)[0] ?? {}
    const b = (key: string) => toScaleBracket(c[key] ?? 0)

    const channels30d: Record<string, ScaleBracket> = {}
    for (const { k, n } of getExecuteRows<{ k: string; n: number }>(channelResult)) {
      if ((CHANNELS as readonly string[]).includes(k)) channels30d[k] = toScaleBracket(n)
    }

    const aiCounts = Object.fromEntries(AI_FEATURES.map((f) => [f, 0])) as Record<AiFeature, number>
    for (const { k, n } of getExecuteRows<{ k: string; n: number }>(aiResult)) {
      aiCounts[aiFeatureOf(k)] += n
    }

    return {
      activeUsers30d: { team: b('team'), portal: b('portal') },
      activity30d: {
        posts: b('posts'),
        votes: b('votes'),
        comments: b('comments'),
        conversations: b('conversations'),
        agentReplies: b('agent_replies'),
        tickets: b('tickets'),
        changelogPublished: b('changelog_published'),
        articlesPublished: b('articles_published'),
        helpCenterSearches: b('help_center_searches'),
        incidents: b('incidents'),
        workflowRuns: b('workflow_runs'),
      },
      channels30d,
      ai30d: Object.fromEntries(AI_FEATURES.map((f) => [f, toScaleBracket(aiCounts[f])])) as Record<
        AiFeature,
        ScaleBracket
      >,
      health: { failedJobs24h: b('failed_jobs_24h') },
    }
  } catch {
    return empty
  }
}

async function getScale(): Promise<TelemetryPayload['scale']> {
  const zero = {
    users: '0',
    posts: '0',
    boards: '0',
    conversations: '0',
    publishedArticles: '0',
    changelogEntries: '0',
    incidents: '0',
  } as const
  try {
    const { db } = await import('@/lib/server/db')
    const { sql } = await import('drizzle-orm')
    const { getExecuteRows } = await import('@/lib/server/utils')

    const result = await db.execute<{
      users: number
      posts: number
      boards: number
      conversations: number
      published_articles: number
      changelog_entries: number
      incidents: number
    }>(
      sql`SELECT
        (SELECT count(*)::int FROM "user" u WHERE NOT EXISTS (SELECT 1 FROM "principal" p WHERE p.user_id = u.id AND p.test_owner_principal_id IS NOT NULL)) as users,
        (SELECT count(*)::int FROM "posts" po WHERE po."deleted_at" IS NULL AND NOT EXISTS (SELECT 1 FROM "principal" p WHERE p.id = po.principal_id AND p.test_owner_principal_id IS NOT NULL)) as posts,
        (SELECT count(*)::int FROM "boards" WHERE "deleted_at" IS NULL) as boards,
        (SELECT count(*)::int FROM "conversations" c WHERE NOT EXISTS (SELECT 1 FROM "principal" p WHERE p.id = c.visitor_principal_id AND p.test_owner_principal_id IS NOT NULL)) as conversations,
        (SELECT count(*)::int FROM "kb_articles" WHERE "deleted_at" IS NULL AND "published_at" IS NOT NULL) as published_articles,
        (SELECT count(*)::int FROM "changelog_entries" WHERE "deleted_at" IS NULL AND "published_at" IS NOT NULL) as changelog_entries,
        (SELECT count(*)::int FROM "status_incidents" WHERE "deleted_at" IS NULL) as incidents`
    )
    const row = getExecuteRows<{
      users: number
      posts: number
      boards: number
      conversations: number
      published_articles: number
      changelog_entries: number
      incidents: number
    }>(result)[0]
    return {
      users: toScaleBracket(row?.users ?? 0),
      posts: toScaleBracket(row?.posts ?? 0),
      boards: toScaleBracket(row?.boards ?? 0),
      conversations: toScaleBracket(row?.conversations ?? 0),
      publishedArticles: toScaleBracket(row?.published_articles ?? 0),
      changelogEntries: toScaleBracket(row?.changelog_entries ?? 0),
      incidents: toScaleBracket(row?.incidents ?? 0),
    }
  } catch {
    return { ...zero }
  }
}

async function getSeats7d(): Promise<ScaleBracket> {
  try {
    const { db } = await import('@/lib/server/db')
    const { sql } = await import('drizzle-orm')
    const { getExecuteRows } = await import('@/lib/server/utils')
    const result = await db.execute<{ seats: number }>(
      sql`SELECT count(distinct p.user_id)::int as seats
          FROM "session" s
          INNER JOIN "principal" p ON p.user_id = s.user_id
          WHERE s.updated_at > now() - interval '7 days'
            AND p.role IN ('admin', 'member')
            AND p.type = 'user'
            AND p.user_id IS NOT NULL`
    )
    const row = getExecuteRows<{ seats: number }>(result)[0]
    return toScaleBracket(row?.seats ?? 0)
  } catch {
    return '0'
  }
}

/**
 * The daily snapshot, and the workspace id a hosted ping is grouped under.
 * The id is returned beside the payload, never inside it: a self-hosted
 * ping carries no workspace identifier.
 */
export async function buildPayload(): Promise<{
  payload: TelemetryPayload
  workspaceId: string | null
}> {
  const [instanceId, features, workspace, scale, seats7d, extras, activity] = await Promise.all([
    getOrCreateInstanceId(),
    getCapabilityFeatures(),
    getWorkspaceSnapshot(),
    getScale(),
    getSeats7d(),
    getIntegrationsAndLocales(),
    getActivity(),
  ])
  const [platform, auth] = await Promise.all([
    getPlatform(workspace.configFile),
    getAuth(workspace.authConfig),
  ])

  const payload: TelemetryPayload = {
    version: __APP_VERSION__,
    runtime: getRuntime(),
    runtimeVersion: getRuntimeVersion(),
    os: process.platform,
    arch: process.arch,
    deployMethod: detectDeployMethod(),
    instanceId,
    features,
    experimentalFeatures: workspace.experimentalFeatures,
    products: workspace.products,
    cloud: workspace.cloud,
    firstWin: workspace.firstWin,
    widgetInstalled: workspace.widgetInstalled,
    activation: workspace.activation,
    seats7d,
    scale,
    installAge: workspace.installAge,
    ...platform,
    auth,
    ...extras,
    ...activity,
  }
  assertAnonymousTelemetry(payload)
  return { payload, workspaceId: workspace.workspaceId }
}
