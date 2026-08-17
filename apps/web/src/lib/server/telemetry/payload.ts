import { existsSync } from 'fs'
import { getOrCreateInstanceId } from './instance-id'
import { activeSecretKey } from '@/lib/server/secret-key'
import {
  assertAnonymousTelemetry,
  productsFromFlags,
  toScaleBracket,
  type ScaleBracket,
  type TelemetryOutcome,
  type TelemetryProducts,
  type TelemetryStarterResolution,
} from './anonymous'
import {
  DEFAULT_FEATURE_FLAGS,
  resolveFeatureFlags,
} from '@/lib/server/domains/settings/settings.types'
import { getSetupState, type OnboardingOutcome } from '@/lib/shared/db-types'

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
  /** First-class product modules. Stable names, not mixed with Labs. */
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

function asOutcome(value: OnboardingOutcome | string | null | undefined): TelemetryOutcome | null {
  if (
    value === 'product_feedback' ||
    value === 'customer_support' ||
    value === 'help_center' ||
    value === 'internal'
  ) {
    return value
  }
  return null
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
  }
  try {
    const { db } = await import('@/lib/server/db')
    const { getCloudConfig } = await import('@/lib/server/domains/settings/cloud/cloud.service')
    const { detectFirstWin } = await import('@/lib/server/activation-wins')

    const org = await db.query.settings.findFirst({
      columns: {
        featureFlags: true,
        setupState: true,
        widgetInstalledFirstSeenAt: true,
      },
    })
    const flags = resolveFeatureFlags(org?.featureFlags)
    const state = getSetupState(org?.setupState ?? null)
    const outcome = asOutcome(state?.useCase)
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
        (SELECT count(*)::int FROM "user") as users,
        (SELECT count(*)::int FROM "posts" WHERE "deleted_at" IS NULL) as posts,
        (SELECT count(*)::int FROM "boards" WHERE "deleted_at" IS NULL) as boards,
        (SELECT count(*)::int FROM "conversations") as conversations,
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
            AND p.user_id IS NOT NULL`
    )
    const row = getExecuteRows<{ seats: number }>(result)[0]
    return toScaleBracket(row?.seats ?? 0)
  } catch {
    return '0'
  }
}

export async function buildPayload(): Promise<TelemetryPayload> {
  const [instanceId, features, workspace, scale, seats7d] = await Promise.all([
    getOrCreateInstanceId(),
    getCapabilityFeatures(),
    getWorkspaceSnapshot(),
    getScale(),
    getSeats7d(),
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
  }
  assertAnonymousTelemetry(payload)
  return payload
}
