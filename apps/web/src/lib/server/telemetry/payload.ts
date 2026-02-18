import { existsSync } from 'fs'
import { getOrCreateInstanceId } from './instance-id'

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
  scale: {
    users: string
    posts: string
    boards: string
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

function toBracket(count: number): string {
  if (count === 0) return '0'
  if (count <= 10) return '1-10'
  if (count <= 50) return '11-50'
  if (count <= 200) return '51-200'
  return '200+'
}

async function getFeatureFlags(): Promise<TelemetryPayload['features']> {
  try {
    const { config } = await import('@/lib/server/config')
    const { getDeveloperConfig, getWidgetConfig } =
      await import('@/lib/server/domains/settings/settings.service')

    const [devConfig, widgetConfig] = await Promise.all([
      getDeveloperConfig().catch(() => null),
      getWidgetConfig().catch(() => null),
    ])

    return {
      oauth: !!config.secretKey,
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

async function getScale(): Promise<TelemetryPayload['scale']> {
  try {
    const { db } = await import('@/lib/server/db')
    const { sql } = await import('drizzle-orm')
    const { getExecuteRows } = await import('@/lib/server/utils')

    const result = await db.execute<{ users: number; posts: number; boards: number }>(
      sql`SELECT
        (SELECT count(*)::int FROM "user") as users,
        (SELECT count(*)::int FROM "post") as posts,
        (SELECT count(*)::int FROM "board") as boards`
    )
    const row = getExecuteRows<{ users: number; posts: number; boards: number }>(result)[0]
    return {
      users: toBracket(row?.users ?? 0),
      posts: toBracket(row?.posts ?? 0),
      boards: toBracket(row?.boards ?? 0),
    }
  } catch {
    return { users: '0', posts: '0', boards: '0' }
  }
}

export async function buildPayload(): Promise<TelemetryPayload> {
  const [instanceId, features, scale] = await Promise.all([
    getOrCreateInstanceId(),
    getFeatureFlags(),
    getScale(),
  ])

  return {
    version: __APP_VERSION__,
    runtime: getRuntime(),
    runtimeVersion: getRuntimeVersion(),
    os: process.platform,
    arch: process.arch,
    deployMethod: detectDeployMethod(),
    instanceId,
    features,
    scale,
  }
}
