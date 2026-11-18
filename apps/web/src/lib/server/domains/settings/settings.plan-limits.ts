/**
 * The `settings.plan_limits_state` column: the only reader and writer.
 *
 * The column holds the plan limits state as JSON (its shape is owned by
 * `domains/plan-limits/plan-limits.rules.ts`). These helpers move raw values;
 * the plan-limits domain parses and validates them.
 */
import { db, eq, settings, sql } from '@/lib/server/db'
import type {
  StoredCloudConfig,
  StoredCloudIdentityProjection,
  StoredPlanLimitsState,
} from '@/lib/shared/db-types'
import { configuredBaseUrl } from '@/lib/server/config'
import {
  effectiveSectionDomains,
  hostOfOrigin,
  normalizeHost,
  portalSectionsEnabled,
  PORTAL_SECTIONS,
  routableSectionHost,
  type SectionDomainMap,
} from '@/lib/shared/section-domains'
import { isPortalChatStartEnabled, isWidgetMessengerEnabled } from '@/lib/shared/support-surfaces'
import { parseIdentityProjection } from './cloud/identity-projection'
import { hostingOf, routableSectionDomains } from './section-domains.hosting'
import {
  findSettingsCached,
  invalidateSettingsCache,
  parseJsonConfig,
  parsePortalConfig,
  parseWidgetConfig,
} from './settings.helpers'
import { resolveStatusSettings } from './settings.status'
import {
  DEFAULT_HELP_CENTER_CONFIG,
  DEFAULT_MESSENGER_CONFIG,
  resolveFeatureFlags,
} from './settings.types'

/** What the plan limits state is computed from, off the cached settings row. */
export interface PlanLimitsSources {
  /** The stored state, raw. Null when there is none. */
  planLimitsState: unknown
  tierLimits: string | null
  cloud: StoredCloudConfig | null
  /** Bumped on every accepted billing projection. */
  cloudRevision: number
  /** Bumped on every tier limits write (and other auth config writes). */
  authConfigVersion: number
  cloudIdentity: StoredCloudIdentityProjection | null
  customCss: string | null
  /**
   * Every hostname a portal section names (help.acme.com), verified or not,
   * from the section map every reader uses: never the primary domain.
   */
  sectionHostnames: string[]
  /**
   * Every custom hostname that serves visitors now: a section's host while
   * routing sends visitors there (verified, and the section on), and a ready
   * custom domain that is primary or not parked on a section that is off.
   * Never the primary domain BASE_URL names.
   */
  liveCustomDomains: string[]
  /** Article translation is on and has languages to translate into. */
  autoTranslate: boolean
  /** Assistant replies are switched on (the default). */
  assistantResponds: boolean
  /** A visitor can start a chat the assistant answers: the widget Messages tab or portal chats. */
  visitorChatLive: boolean
}

/** The configured origin, never a paused custom domain's override; '' when there is none. */
function configuredOrigin(): string {
  try {
    return configuredBaseUrl()
  } catch {
    return ''
  }
}

export async function readPlanLimitsSources(): Promise<PlanLimitsSources | null> {
  const row = await findSettingsCached()
  if (!row) return null
  const helpCenter = parseJsonConfig(row.helpCenterConfig, DEFAULT_HELP_CENTER_CONFIG)
  const portal = parsePortalConfig(row.portalConfig)
  const widget = parseWidgetConfig(row.widgetConfig)
  const flags = resolveFeatureFlags(row.featureFlags)
  const messenger = { ...DEFAULT_MESSENGER_CONFIG, ...(widget.messenger ?? {}) }
  const sectionDomains = effectiveSectionDomains({
    sectionDomains: portal.sectionDomains,
    legacyHelpDomain: helpCenter.domain,
    primaryHost: hostOfOrigin(configuredOrigin()),
  })
  const sectionOn = portalSectionsEnabled({
    featureFlags: flags,
    statusConfig: resolveStatusSettings(row.metadata),
    portalConfig: portal,
  })
  return {
    planLimitsState: row.planLimitsState ?? null,
    tierLimits: row.tierLimits ?? null,
    cloud: row.cloud ?? null,
    cloudRevision: row.cloudRevision ?? 0,
    authConfigVersion: row.authConfigVersion ?? 0,
    cloudIdentity: row.cloudIdentity ?? null,
    customCss: row.customCss ?? null,
    sectionHostnames: PORTAL_SECTIONS.flatMap((section) => {
      const hostname = sectionDomains[section]?.hostname
      return hostname ? [hostname.toLowerCase()] : []
    }),
    liveCustomDomains: liveCustomDomains(
      row.cloudIdentity,
      routableSectionDomains(sectionDomains, hostingOf(row)),
      sectionOn
    ),
    autoTranslate:
      helpCenter.autoTranslate?.enabled === true &&
      (helpCenter.locales?.additional?.length ?? 0) > 0,
    assistantResponds: messenger.assistant?.respond === true,
    visitorChatLive:
      isWidgetMessengerEnabled(flags, widget) || isPortalChatStartEnabled(flags, portal),
  }
}

/** See {@link PlanLimitsSources.liveCustomDomains}. */
function liveCustomDomains(
  cloudIdentity: unknown,
  routable: SectionDomainMap,
  sectionOn: ReturnType<typeof portalSectionsEnabled>
): string[] {
  const live = new Set<string>()
  const parked = new Set<string>()
  for (const section of PORTAL_SECTIONS) {
    const entry = routable[section]
    if (!entry) continue
    const host = routableSectionHost(section, routable, sectionOn)
    if (host) live.add(host)
    else parked.add(normalizeHost(entry.hostname) ?? entry.hostname)
  }
  for (const domain of parseIdentityProjection(cloudIdentity)?.customDomains ?? []) {
    if (domain.readiness !== 'ready') continue
    const host = normalizeHost(domain.hostname) ?? domain.hostname
    if (domain.isPrimary || !parked.has(host)) live.add(host)
  }
  return [...live]
}

/** The stored state straight from the database, for a caller that lost a race. */
export async function readPlanLimitsStateFresh(): Promise<unknown> {
  const [row] = await db.select({ state: settings.planLimitsState }).from(settings).limit(1)
  return row?.state ?? null
}

/**
 * Write `next` only if the column still holds `expected`, so two processes
 * detecting the same drop at once cannot both start a grace and move its
 * dates. Returns whether this write won.
 */
export async function compareAndSetPlanLimitsState(
  expected: unknown,
  next: StoredPlanLimitsState | null
): Promise<boolean> {
  const expectedJson = expected === null || expected === undefined ? null : JSON.stringify(expected)
  const nextValue = next === null ? null : sql`${JSON.stringify(next)}::jsonb`
  const updated = await db
    .update(settings)
    .set({ planLimitsState: nextValue as unknown as StoredPlanLimitsState | null })
    .where(
      expectedJson === null
        ? sql`${settings.planLimitsState} IS NULL`
        : sql`${settings.planLimitsState} = ${expectedJson}::jsonb`
    )
    .returning({ id: settings.id })
  if (updated.length > 0) await invalidateSettingsCache()
  return updated.length > 0
}

/**
 * Change the stored state under the row lock. `change` gets the current raw
 * value and returns the next one, or undefined to leave it as it is.
 */
export async function updatePlanLimitsState(
  change: (current: unknown) => StoredPlanLimitsState | null | undefined
): Promise<boolean> {
  const wrote = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: settings.id, state: settings.planLimitsState })
      .from(settings)
      .limit(1)
      .for('update')
    if (!row) return false
    const next = change(row.state ?? null)
    if (next === undefined) return false
    await tx.update(settings).set({ planLimitsState: next }).where(eq(settings.id, row.id))
    return true
  })
  if (wrote) await invalidateSettingsCache()
  return wrote
}
