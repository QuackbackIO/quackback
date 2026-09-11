/**
 * Short-lived pairing codes for agent-first widget install.
 *
 * The copied install prompt carries a code, not the HMAC signing secret.
 * The host-app coding agent redeems it over HTTP and writes the secret to
 * a server-only host env var. Codes are hashed in kv_store, TTL ~15 minutes,
 * two uses so a single retry works.
 */
import { createHash, randomBytes } from 'crypto'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { kvSet } from '@/lib/server/kv/pg-kv'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { currentWorkspaceNamespace } from '@/lib/server/workspaces/workspace-keyed'
import { getBaseUrl } from '@/lib/server/config'
import { CURRENT_WIDGET_SDK_VERSION, widgetSdkNeedsUpdate } from '@/lib/shared/widget/sdk-version'
import { trimTrailingSlash } from '@/lib/shared/widget/install-prompt'
import { toIsoStringOrNull } from '@/lib/shared/utils/date'
import { logger } from '@/lib/server/logger'
import { ensureWidgetSecret, updateWidgetConfig } from './settings.widget'
import { parseWidgetConfig, requireSettingsCached, wrapDbError } from './settings.helpers'

const log = logger.child({ component: 'widget-install-pairing' })

export const WIDGET_INSTALL_CODE_TTL_SECONDS = 15 * 60
export const WIDGET_INSTALL_CODE_MAX_USES = 2
export const WIDGET_INSTALL_CODE_PREFIX = 'qbi_'

export function generateWidgetInstallCode(): string {
  return `${WIDGET_INSTALL_CODE_PREFIX}${randomBytes(12).toString('base64url')}`
}

export function hashWidgetInstallCode(code: string): string {
  return createHash('sha256').update(code.trim(), 'utf8').digest('hex')
}

export function widgetInstallPairingKey(hash: string): string {
  return `widget:install-pairing:${hash}`
}

export async function mintWidgetInstallCode(): Promise<{ code: string }> {
  await ensureWidgetSecret()
  const code = generateWidgetInstallCode()
  await kvSet(
    widgetInstallPairingKey(hashWidgetInstallCode(code)),
    { remaining: WIDGET_INSTALL_CODE_MAX_USES },
    WIDGET_INSTALL_CODE_TTL_SECONDS
  )
  return { code }
}

/** Decrement remaining uses. True iff this caller consumed a live use. */
export async function consumeWidgetInstallCode(code: string): Promise<boolean> {
  const key = widgetInstallPairingKey(hashWidgetInstallCode(code))
  const result = await db.execute(sql`
    UPDATE kv_store
    SET value = jsonb_set(value, '{remaining}', to_jsonb((value->>'remaining')::int - 1))
    WHERE workspace_key = ${currentWorkspaceNamespace()}
      AND key = ${key}
      AND expires_at > now()
      AND COALESCE((value->>'remaining')::int, 0) > 0
    RETURNING (value->>'remaining')::int AS remaining
  `)
  return getExecuteRows(result).length > 0
}

export interface WidgetInstallContext {
  instanceUrl: string
  sdkUrl: string
  signingSecret: string
}

/**
 * Redeem a pairing code: consume it, return the signing secret once, and turn
 * on Show on your website so the agent path does not need a second admin click.
 */
export async function redeemWidgetInstallCode(code: string): Promise<WidgetInstallContext | null> {
  const consumed = await consumeWidgetInstallCode(code)
  if (!consumed) return null

  const signingSecret = await ensureWidgetSecret()
  await updateWidgetConfig({ enabled: true })

  const instanceUrl = trimTrailingSlash(getBaseUrl())
  return {
    instanceUrl,
    sdkUrl: `${instanceUrl}/api/widget/sdk.js`,
    signingSecret,
  }
}

export interface WidgetInstallStatus {
  connected: boolean
  enabled: boolean
  lastDetectedAt: string | null
  originHost: string | null
  sdkVersion: string | null
  currentSdkVersion: string
  sdkNeedsUpdate: boolean
}

/** Read-only install evidence for MCP / admin — never includes the HMAC. */
export async function getWidgetInstallStatus(): Promise<WidgetInstallStatus> {
  try {
    const org = await requireSettingsCached()
    const config = parseWidgetConfig(org.widgetConfig)
    const connected = Boolean(org.widgetInstalledFirstSeenAt)
    return {
      connected,
      enabled: config.enabled === true,
      lastDetectedAt: toIsoStringOrNull(org.widgetInstalledLastSeenAt),
      originHost: org.widgetInstalledOriginHost ?? null,
      sdkVersion: org.widgetInstalledSdkVersion ?? null,
      currentSdkVersion: CURRENT_WIDGET_SDK_VERSION,
      sdkNeedsUpdate:
        connected &&
        widgetSdkNeedsUpdate(org.widgetInstalledSdkVersion, CURRENT_WIDGET_SDK_VERSION),
    }
  } catch (error) {
    log.error({ err: error }, 'get widget install status failed')
    wrapDbError('fetch widget install status', error)
  }
}
