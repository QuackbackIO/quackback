import { db, eq, settings, ssoVerifiedDomain } from '@/lib/server/db'
import { cacheGet, cacheSet, CACHE_KEYS } from '@/lib/server/redis'
import { ValidationError } from '@/lib/shared/errors'
import { httpsUrl } from '@/lib/shared/schemas/auth'
import { assertNotManaged } from '@/lib/server/config-file/managed-guard'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import type {
  AuthConfig,
  UpdateAuthConfigInput,
  PortalConfig,
  UpdatePortalConfigInput,
  BrandingConfig,
  PublicAuthConfig,
  PublicPortalConfig,
  DeveloperConfig,
  UpdateDeveloperConfigInput,
  FeatureFlags,
  TenantSettings,
  SettingsBrandingData,
  HelpCenterConfig,
  VerifiedDomain,
} from './settings.types'
import {
  DEFAULT_AUTH_CONFIG,
  DEFAULT_PORTAL_CONFIG,
  DEFAULT_DEVELOPER_CONFIG,
  DEFAULT_WIDGET_CONFIG,
  DEFAULT_LIVE_CHAT_CONFIG,
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_HELP_CENTER_CONFIG,
} from './settings.types'
import { publicLiveChatConfig } from './settings.widget'
import {
  parseJsonConfig,
  parseJsonOrNull,
  deepMerge,
  requireSettings,
  wrapDbError,
  invalidateSettingsCache,
  normalizeWelcomeCardInput,
  mergeWelcomeCard,
  publicWelcomeCard,
} from './settings.helpers'

async function getConfiguredAuthTypes(): Promise<Set<string>> {
  const { getConfiguredIntegrationTypes } =
    await import('@/lib/server/domains/platform-credentials/platform-credential.service')
  return getConfiguredIntegrationTypes()
}

function filterOAuthByCredentials(
  oauth: Record<string, boolean | undefined>,
  configuredTypes: Set<string>,
  passthroughKeys: string[]
): Record<string, boolean | undefined> {
  const passthrough = new Set(passthroughKeys)
  const filtered: Record<string, boolean | undefined> = {}
  for (const [key, enabled] of Object.entries(oauth)) {
    if (passthrough.has(key)) {
      filtered[key] = enabled
    } else {
      filtered[key] = enabled && configuredTypes.has(`auth_${key}`)
    }
  }
  return filtered
}

/**
 * Email-dependent passthrough keys for `filterOAuthByCredentials`.
 * Shared by both team and portal surfaces — neither has an
 * `auth_password` / `auth_magicLink` credential row (they use the
 * SMTP transport, not OAuth secrets), so they'd otherwise be dropped
 * by the OAuth-credential gate.
 *
 * `password` is always passthrough — the team and portal both use
 * stored credential hashes, not SMTP. `magicLink` only renders when
 * SMTP/Resend is wired so we don't surface a button that would
 * silently fail.
 */
async function getEmailDependentPassthroughKeys(): Promise<string[]> {
  const { isEmailConfigured } = await import('@quackback/email')
  return isEmailConfigured() ? ['magicLink', 'password'] : ['password']
}

/**
 * Display-name overrides for generic OAuth providers (currently only
 * `custom-oidc`, which is exposed on the portal surface only). Returns
 * a map of providerId → displayName when an admin has set one.
 */
async function getCustomProviderNames(
  oauth: Record<string, boolean | undefined>,
  configuredTypes: Set<string>
): Promise<Record<string, string> | undefined> {
  const { getAllAuthProviders } = await import('@/lib/server/auth/auth-providers')
  const { getPlatformCredentials } =
    await import('@/lib/server/domains/platform-credentials/platform-credential.service')

  const genericProviders = getAllAuthProviders().filter(
    (p) => p.type === 'generic-oauth' && oauth[p.id] && configuredTypes.has(p.credentialType)
  )

  if (genericProviders.length === 0) return undefined

  const names: Record<string, string> = {}
  const credResults = await Promise.all(
    genericProviders.map((p) => getPlatformCredentials(p.credentialType))
  )
  for (let i = 0; i < genericProviders.length; i++) {
    const displayName = credResults[i]?.displayName
    if (displayName) {
      names[genericProviders[i].id] = displayName
    }
  }

  return Object.keys(names).length > 0 ? names : undefined
}

export async function getAuthConfig(): Promise<AuthConfig> {
  try {
    const org = await requireSettings()
    return parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)
  } catch (error) {
    console.error(`[domain:settings] getAuthConfig failed:`, error)
    wrapDbError('fetch auth config', error)
  }
}

/**
 * OAuth providers that are always available regardless of tier.
 * Anything outside this set requires the customOidcProvider feature flag.
 */
const STANDARD_OAUTH_PROVIDERS = new Set(['google', 'github', 'microsoft', 'discord'])

export async function updateAuthConfig(input: UpdateAuthConfigInput): Promise<AuthConfig> {
  console.log(`[domain:settings] updateAuthConfig`)
  try {
    // Managed-fields gate: refuse touching paths the config file at
    // `/etc/quackback/config.yaml` has declared. Per-key so the file
    // can lock one knob while leaving siblings UI-editable. Runs
    // BEFORE the tier gate so a 403 FIELD_MANAGED error shows up
    // cleanly even when the user is on a tier that would otherwise
    // also block the change.
    if (input.oauth) {
      for (const key of Object.keys(input.oauth)) {
        await assertNotManaged(`auth.oauth.${key}`)
      }
    }
    if (input.openSignup !== undefined) {
      await assertNotManaged('auth.openSignup')
    }
    if (input.ssoOidc) {
      for (const key of Object.keys(input.ssoOidc)) {
        await assertNotManaged(`auth.ssoOidc.${key}`)
      }
    }
    if (input.twoFactor) {
      for (const key of Object.keys(input.twoFactor)) {
        await assertNotManaged(`auth.twoFactor.${key}`)
      }
    }

    // Tier gate: refuse non-standard OAuth providers when
    // customOidcProvider is off. No-op when the feature is unlimited.
    if (input.oauth) {
      const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
      const { enforceFeatureGate } = await import('@/lib/server/domains/settings/tier-enforce')
      const limits = await getTierLimits()
      const enablingNonStandard = Object.entries(input.oauth).some(
        ([id, enabled]) => enabled && !STANDARD_OAUTH_PROVIDERS.has(id)
      )
      if (enablingNonStandard) {
        enforceFeatureGate({
          enabled: limits.features.customOidcProvider,
          feature: 'customOidcProvider',
          friendly: 'Custom OIDC providers',
        })
      }
    }

    // Tier gate: ssoOidc itself requires customOidcProvider. Reject
    // attempts to enable or configure SSO when the tier is off.
    if (input.ssoOidc?.enabled === true) {
      const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
      const { enforceFeatureGate } = await import('@/lib/server/domains/settings/tier-enforce')
      const limits = await getTierLimits()
      enforceFeatureGate({
        enabled: limits.features.customOidcProvider,
        feature: 'customOidcProvider',
        friendly: 'Single sign-on (OIDC)',
      })

      // Secret-presence gate: enabling SSO without a saved client
      // secret would register a Better-Auth provider that 4xxs on
      // every callback. Force the admin to paste the secret first via
      // the UI's ClientSecretField component (which writes to
      // platform_credentials and triggers a rebuild on save).
      const { ValidationError } = await import('@/lib/shared/errors')
      const { hasSsoClientSecret } = await import('@/lib/server/auth/sso-secret')
      if (!(await hasSsoClientSecret())) {
        throw new ValidationError(
          'SSO_NO_CLIENT_SECRET',
          'Save the SSO client secret before enabling SSO sign-in.'
        )
      }
    }

    // Enum guard for autoProvisionRole. Runs before the DB read so a
    // malformed API call (e.g. `{ ssoOidc: { autoProvisionRole: 'root' } }`)
    // can't poison the stored JSON blob. The JIT hook downstream trusts
    // this field to map to a known role.
    if (input.ssoOidc?.autoProvisionRole !== undefined) {
      const allowed = ['admin', 'member', 'user'] as const
      if (!allowed.includes(input.ssoOidc.autoProvisionRole as (typeof allowed)[number])) {
        throw new ValidationError(
          'INVALID_SSO_CONFIG',
          `autoProvisionRole must be one of ${allowed.join(', ')}.`
        )
      }
    }

    const org = await requireSettings()
    const existing = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)
    const updated = deepMerge(existing, input as Partial<AuthConfig>)

    // Coupling invariant: `twoFactor.required=true` is only meaningful
    // when `oauth.password=true`. The 2FA gate
    // (`handleCredentialPostSignInGate`) runs exclusively on password
    // sign-in paths — magic-link, SSO, and non-SSO OAuth all bypass
    // it. Persisting `required=true` while password is off stores a
    // toggle that does nothing at runtime, which misleads admins
    // reading the settings page ("my team is 2FA-protected") and
    // pollutes audit dumps. Reject the combination at write time;
    // migration 0061 normalized any pre-existing inert state.
    //
    // `password` defaults to `true` when the key is absent (matches
    // `DEFAULT_AUTH_CONFIG` + `isAuthMethodAllowed`'s `?? true`), so
    // we only refuse when it's *explicitly* false.
    if (updated.twoFactor?.required === true && updated.oauth?.password === false) {
      const { ValidationError } = await import('@/lib/shared/errors')
      throw new ValidationError(
        'TWO_FACTOR_REQUIRES_PASSWORD',
        'Two-factor enforcement only applies to password sign-in. Enable Password sign-in first, or disable Require 2FA before turning off Password.'
      )
    }

    // Partial-write validation: a naked `{ ssoOidc: { enabled: true } }`
    // shouldn't land in DB if the stored ssoOidc is missing discoveryUrl
    // / clientId — the runtime would skip registration and the workspace
    // would have an orphaned half-config.
    if (updated.ssoOidc) {
      const isHttps = httpsUrl.safeParse(updated.ssoOidc.discoveryUrl ?? '').success
      if (updated.ssoOidc.enabled) {
        if (!updated.ssoOidc.discoveryUrl || !updated.ssoOidc.clientId || !isHttps) {
          throw new ValidationError(
            'INVALID_SSO_CONFIG',
            'SSO requires an https:// discoveryUrl and clientId when enabled.'
          )
        }
      }

      // Stamp `detailsChangedAt` when a connection-affecting field
      // changed (discoveryUrl / clientId). A brand-new ssoOidc block
      // (no prior) also counts as "changed" — it has never been tested.
      // autoCreateUsers / autoProvisionRole / attributeMapping don't
      // affect the IdP handshake, so they don't reset the timestamp.
      // The client secret is handled separately by setSsoClientSecretFn.
      const prevSso = existing.ssoOidc
      const detailsChanged =
        !prevSso ||
        updated.ssoOidc.discoveryUrl !== prevSso.discoveryUrl ||
        updated.ssoOidc.clientId !== prevSso.clientId
      if (detailsChanged) {
        updated.ssoOidc.detailsChangedAt = new Date().toISOString()
      }

      // Gate the off→on transition: enabling SSO requires a successful
      // test sign-in performed AFTER the most recent details change.
      // Transition-only — a config save that round-trips an already-on
      // `enabled` (e.g. editing autoProvisionRole) is never blocked, and
      // changing the discovery URL while enabled stamps detailsChangedAt
      // but doesn't kick the workspace out of SSO.
      const wasEnabled = prevSso?.enabled === true
      if (updated.ssoOidc.enabled === true && !wasEnabled) {
        const { isSsoTestValid } = await import('@/lib/server/auth/sso-gates')
        if (!isSsoTestValid(updated.ssoOidc)) {
          throw new ValidationError(
            'SSO_TEST_REQUIRED',
            'Run a successful test sign-in before enabling SSO.'
          )
        }
      }
      // Block private/loopback/link-local discovery URLs at write time
      // so the auth runtime never gets handed an SSRF target. Only when
      // the URL actually changed — `checkUrlSafety` is a DNS round-trip,
      // and an unchanged URL was already validated when it was written.
      const discoveryUrlChanged = !prevSso || updated.ssoOidc.discoveryUrl !== prevSso.discoveryUrl
      if (discoveryUrlChanged && isHttps && updated.ssoOidc.discoveryUrl) {
        const { checkUrlSafety } = await import('@/lib/server/content/ssrf-guard')
        const safety = await checkUrlSafety(updated.ssoOidc.discoveryUrl)
        if (!safety.safe) {
          throw new ValidationError(
            'INVALID_SSO_CONFIG',
            safety.reason === 'ssrf-rejected'
              ? 'Discovery URL must point to a public IdP, not a private or loopback address.'
              : 'Discovery URL is not a valid https:// URL.'
          )
        }
      }
    }

    // Atomic bump of auth_config_version + the JSON write in the same
    // transaction. Without the version bump other pods would keep
    // stale Better-Auth instances until their next cache TTL expiry.
    const { bumpAuthConfigVersionInTx } = await import('@/lib/server/auth/config-version')
    const { resetAuth } = await import('@/lib/server/auth')
    await db.transaction(async (tx) => {
      await tx
        .update(settings)
        .set({ authConfig: JSON.stringify(updated) })
        .where(eq(settings.id, org.id))
      await bumpAuthConfigVersionInTx(tx)
    })
    // invalidateSettingsCache drops the Redis cache entry so other pods
    // re-read the bumped version on next request. The local resetAuth
    // skips the next-request wait on the calling pod.
    resetAuth()
    await invalidateSettingsCache()
    return updated
  } catch (error) {
    console.error(`[domain:settings] updateAuthConfig failed:`, error)
    wrapDbError('update auth config', error)
  }
}

/**
 * Shallow-merge a patch into the stored `ssoOidc` block + invalidate the
 * settings cache. Shared by the two timestamp-stamping helpers below.
 * No-op when no ssoOidc block exists.
 *
 * Deliberately skips the `auth_config_version` bump + `resetAuth()` that
 * `updateAuthConfig` does: `detailsChangedAt` / `lastSuccessfulTestAt`
 * are gate metadata read by server fns, not by the Better-Auth runtime,
 * so there's nothing for it to rebuild. Dropping the version bump avoids
 * a cross-pod Better-Auth rebuild on every test sign-in.
 */
async function patchSsoOidc(patch: Partial<NonNullable<AuthConfig['ssoOidc']>>): Promise<void> {
  const org = await requireSettings()
  const existing = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)
  if (!existing.ssoOidc) return
  const updated: AuthConfig = {
    ...existing,
    ssoOidc: { ...existing.ssoOidc, ...patch },
  }
  await db
    .update(settings)
    .set({ authConfig: JSON.stringify(updated) })
    .where(eq(settings.id, org.id))
  await invalidateSettingsCache()
}

/**
 * Stamp `ssoOidc.detailsChangedAt = now`. Called when a connection-
 * affecting field changes *outside* `updateAuthConfig` — specifically
 * the client secret, which `setSsoClientSecretFn` writes to
 * `platform_credentials` rather than the settings JSON. Keeps the
 * "a prior test only counts if it postdates the last details change"
 * invariant honest.
 */
export async function markSsoDetailsChanged(): Promise<void> {
  console.log(`[domain:settings] markSsoDetailsChanged`)
  try {
    await patchSsoOidc({ detailsChangedAt: new Date().toISOString() })
  } catch (error) {
    console.error(`[domain:settings] markSsoDetailsChanged failed:`, error)
    wrapDbError('mark sso details changed', error)
  }
}

/**
 * Stamp `ssoOidc.lastSuccessfulTestAt = now`. Called by the SSO test
 * callback when a test sign-in succeeds AND the IdP-returned email
 * matches the admin who ran it. Compared against `detailsChangedAt`
 * to gate enabling SSO and per-domain enforcement.
 */
export async function markSsoTestSucceeded(): Promise<void> {
  console.log(`[domain:settings] markSsoTestSucceeded`)
  try {
    await patchSsoOidc({ lastSuccessfulTestAt: new Date().toISOString() })
  } catch (error) {
    console.error(`[domain:settings] markSsoTestSucceeded failed:`, error)
    wrapDbError('mark sso test succeeded', error)
  }
}

/**
 * Verified-domain CRUD lives in its own table (`sso_verified_domain`)
 * since multi-domain. Each write bumps `auth_config_version` so cached
 * Better-Auth instances on other pods rebuild on their next request —
 * mirrors the invalidation pattern of `updateAuthConfig`.
 */
export const MAX_VERIFIED_DOMAINS = 10

function rowToVerifiedDomain(row: typeof ssoVerifiedDomain.$inferSelect): VerifiedDomain {
  return {
    id: row.id,
    name: row.name,
    verificationToken: row.verificationToken,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    enforced: row.enforced,
    createdAt: row.createdAt.toISOString(),
  }
}

/** Random base32-style token used as the DNS TXT value. 15 random bytes
 *  → 24 chars of Crockford base32 (no look-alike characters). */
function generateVerificationToken(): string {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  const buf = new Uint8Array(15)
  crypto.getRandomValues(buf)
  let bits = 0
  let value = 0
  let out = ''
  for (const b of buf) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

/**
 * Insert a verified-domain row for `name`. Idempotent: if a row with
 * that name already exists, returns the existing row (preserves its
 * pending/verified state and token). Caps at MAX_VERIFIED_DOMAINS.
 */
export async function insertVerifiedDomain(name: string): Promise<VerifiedDomain> {
  console.log(`[domain:settings] insertVerifiedDomain name=${name}`)
  try {
    const { bumpAuthConfigVersionInTx } = await import('@/lib/server/auth/config-version')
    const { resetAuth } = await import('@/lib/server/auth')

    const inserted = await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(ssoVerifiedDomain)
        .where(eq(ssoVerifiedDomain.name, name))
      if (existing.length > 0) {
        return { row: existing[0], created: false }
      }
      const count = await tx.$count(ssoVerifiedDomain)
      if (count >= MAX_VERIFIED_DOMAINS) {
        throw new ValidationError(
          'MAX_DOMAINS_REACHED',
          `Maximum of ${MAX_VERIFIED_DOMAINS} verified domains reached.`
        )
      }
      const [row] = await tx
        .insert(ssoVerifiedDomain)
        .values({
          name,
          verificationToken: generateVerificationToken(),
        })
        .returning()
      await bumpAuthConfigVersionInTx(tx)
      return { row, created: true }
    })
    if (inserted.created) {
      resetAuth()
      await invalidateSettingsCache()
    }
    return rowToVerifiedDomain(inserted.row)
  } catch (error) {
    console.error(`[domain:settings] insertVerifiedDomain failed:`, error)
    wrapDbError('insert verified domain', error)
  }
}

/** Remove a verified-domain row by id. No-op if the row doesn't exist. */
export async function removeVerifiedDomain(id: `domain_${string}`): Promise<void> {
  console.log(`[domain:settings] removeVerifiedDomain id=${id}`)
  try {
    const { bumpAuthConfigVersionInTx } = await import('@/lib/server/auth/config-version')
    const { resetAuth } = await import('@/lib/server/auth')

    const removed = await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(ssoVerifiedDomain)
        .where(eq(ssoVerifiedDomain.id, id))
        .returning({ id: ssoVerifiedDomain.id })
      if (deleted.length === 0) return false
      await bumpAuthConfigVersionInTx(tx)
      return true
    })
    if (removed) {
      resetAuth()
      await invalidateSettingsCache()
    }
  } catch (error) {
    console.error(`[domain:settings] removeVerifiedDomain failed:`, error)
    wrapDbError('remove verified domain', error)
  }
}

/**
 * Stamp `verifiedAt` on a verified-domain row — race-protected by an
 * expected-token check inside the same transaction. Surfaces
 * STALE_VERIFICATION_TOKEN when the row has been rotated or removed
 * between the caller's read-of-token and the DNS lookup.
 */
export async function stampVerifiedDomain(input: {
  id: `domain_${string}`
  expectedToken: string
  verifiedAt: string
}): Promise<VerifiedDomain> {
  console.log(`[domain:settings] stampVerifiedDomain id=${input.id}`)
  try {
    const { bumpAuthConfigVersionInTx } = await import('@/lib/server/auth/config-version')
    const { resetAuth } = await import('@/lib/server/auth')

    const updated = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(ssoVerifiedDomain)
        .where(eq(ssoVerifiedDomain.id, input.id))
      if (!current || current.verificationToken !== input.expectedToken) {
        throw new ValidationError(
          'STALE_VERIFICATION_TOKEN',
          'Domain changed during verification. Refresh and try again.'
        )
      }
      const [row] = await tx
        .update(ssoVerifiedDomain)
        .set({ verifiedAt: new Date(input.verifiedAt) })
        .where(eq(ssoVerifiedDomain.id, input.id))
        .returning()
      await bumpAuthConfigVersionInTx(tx)
      return row
    })
    resetAuth()
    await invalidateSettingsCache()
    return rowToVerifiedDomain(updated)
  } catch (error) {
    console.error(`[domain:settings] stampVerifiedDomain failed:`, error)
    wrapDbError('stamp verified domain', error)
  }
}

/** Flip the per-domain enforcement flag. Workspace-scoped bootstrap
 *  precondition (recent SSO sign-in + email configured) is enforced
 *  upstream in the server function. */
export async function setVerifiedDomainEnforced(
  id: `domain_${string}`,
  enforced: boolean
): Promise<VerifiedDomain> {
  console.log(`[domain:settings] setVerifiedDomainEnforced id=${id} enforced=${enforced}`)
  try {
    const { bumpAuthConfigVersionInTx } = await import('@/lib/server/auth/config-version')
    const { resetAuth } = await import('@/lib/server/auth')

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(ssoVerifiedDomain)
        .set({ enforced })
        .where(eq(ssoVerifiedDomain.id, id))
        .returning()
      if (!row) {
        throw new ValidationError('VERIFIED_DOMAIN_NOT_FOUND', 'Domain not found.')
      }
      await bumpAuthConfigVersionInTx(tx)
      return row
    })
    resetAuth()
    await invalidateSettingsCache()
    return rowToVerifiedDomain(updated)
  } catch (error) {
    console.error(`[domain:settings] setVerifiedDomainEnforced failed:`, error)
    wrapDbError('set verified domain enforced', error)
  }
}

export async function listVerifiedDomains(): Promise<VerifiedDomain[]> {
  try {
    const rows = await db.select().from(ssoVerifiedDomain).orderBy(ssoVerifiedDomain.createdAt)
    return rows.map(rowToVerifiedDomain)
  } catch (error) {
    console.error(`[domain:settings] listVerifiedDomains failed:`, error)
    wrapDbError('list verified domains', error)
  }
}

export async function getPortalConfig(): Promise<PortalConfig> {
  try {
    const org = await requireSettings()
    return parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)
  } catch (error) {
    console.error(`[domain:settings] getPortalConfig failed:`, error)
    wrapDbError('fetch portal config', error)
  }
}

export async function updatePortalConfig(input: UpdatePortalConfigInput): Promise<PortalConfig> {
  console.log(`[domain:settings] updatePortalConfig`)
  try {
    const normalizedWelcome = normalizeWelcomeCardInput(input.welcomeCard)
    const inputWithoutWelcome: UpdatePortalConfigInput = { ...input }
    delete inputWithoutWelcome.welcomeCard
    const org = await requireSettings()
    const existing = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)
    const updated = deepMerge(existing, inputWithoutWelcome as Partial<PortalConfig>)
    // welcomeCard.body must replace, not deep-merge — see mergeWelcomeCard.
    if (normalizedWelcome) {
      updated.welcomeCard = mergeWelcomeCard(existing.welcomeCard, normalizedWelcome)
    }

    const hasAuthMethod = Object.values(updated.oauth).some(Boolean)
    if (!hasAuthMethod) {
      throw new ValidationError(
        'AUTH_METHOD_REQUIRED',
        'At least one authentication method must be enabled'
      )
    }

    // Provider registration in `auth/index.ts` reads portalConfig.oauth at
    // build time — toggling a portal OAuth provider must invalidate other
    // pods' Better-Auth instances or they'll keep serving the stale provider
    // list until cache TTL. Skip the bump for non-oauth edits (e.g. the
    // welcome card debounce-saves) to avoid an auth rebuild per keystroke.
    if (input.oauth !== undefined) {
      const { bumpAuthConfigVersionInTx } = await import('@/lib/server/auth/config-version')
      const { resetAuth } = await import('@/lib/server/auth')
      await db.transaction(async (tx) => {
        await tx
          .update(settings)
          .set({ portalConfig: JSON.stringify(updated) })
          .where(eq(settings.id, org.id))
        await bumpAuthConfigVersionInTx(tx)
      })
      resetAuth()
    } else {
      await db
        .update(settings)
        .set({ portalConfig: JSON.stringify(updated) })
        .where(eq(settings.id, org.id))
    }
    await invalidateSettingsCache()
    return updated
  } catch (error) {
    console.error(`[domain:settings] updatePortalConfig failed:`, error)
    wrapDbError('update portal config', error)
  }
}

export async function getDeveloperConfig(): Promise<DeveloperConfig> {
  try {
    const org = await requireSettings()
    return parseJsonConfig(org.developerConfig, DEFAULT_DEVELOPER_CONFIG)
  } catch (error) {
    console.error(`[domain:settings] getDeveloperConfig failed:`, error)
    wrapDbError('fetch developer config', error)
  }
}

export async function updateDeveloperConfig(
  input: UpdateDeveloperConfigInput
): Promise<DeveloperConfig> {
  console.log(`[domain:settings] updateDeveloperConfig`)
  try {
    // Tier gate: refuse mcpEnabled=true when mcpServer feature is off.
    // No-op in OSS. Disabling MCP is always allowed (no upgrade required).
    if (input.mcpEnabled === true) {
      const { assertTierFeature } = await import('@/lib/server/domains/settings/tier-enforce')
      await assertTierFeature('mcpServer', 'MCP server')
    }

    const org = await requireSettings()
    const existing = parseJsonConfig(org.developerConfig, DEFAULT_DEVELOPER_CONFIG)
    const updated = deepMerge(existing, input as Partial<DeveloperConfig>)
    await db
      .update(settings)
      .set({ developerConfig: JSON.stringify(updated) })
      .where(eq(settings.id, org.id))
    await invalidateSettingsCache()
    return updated
  } catch (error) {
    console.error(`[domain:settings] updateDeveloperConfig failed:`, error)
    wrapDbError('update developer config', error)
  }
}

export async function getHelpCenterConfig(): Promise<HelpCenterConfig> {
  try {
    const org = await requireSettings()
    return parseJsonConfig(org.helpCenterConfig, DEFAULT_HELP_CENTER_CONFIG)
  } catch (error) {
    console.error(`[domain:settings] getHelpCenterConfig failed:`, error)
    wrapDbError('fetch help center config', error)
  }
}

export async function updateHelpCenterConfig(
  input: Partial<HelpCenterConfig>
): Promise<HelpCenterConfig> {
  console.log(`[domain:settings] updateHelpCenterConfig`)
  try {
    const org = await requireSettings()
    const existing = parseJsonConfig(org.helpCenterConfig, DEFAULT_HELP_CENTER_CONFIG)
    const updated = deepMerge(existing, input)
    await db
      .update(settings)
      .set({ helpCenterConfig: JSON.stringify(updated) })
      .where(eq(settings.id, org.id))
    await invalidateSettingsCache()
    return updated
  } catch (error) {
    console.error(`[domain:settings] updateHelpCenterConfig failed:`, error)
    wrapDbError('update help center config', error)
  }
}

export async function getPublicAuthConfig(): Promise<PublicAuthConfig> {
  try {
    const org = await requireSettings()
    const authConfig = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)

    const [configuredTypes, passthroughKeys] = await Promise.all([
      getConfiguredAuthTypes(),
      getEmailDependentPassthroughKeys(),
    ])
    const filteredOAuth = filterOAuthByCredentials(
      authConfig.oauth,
      configuredTypes,
      passthroughKeys
    )
    return {
      oauth: filteredOAuth,
      openSignup: authConfig.openSignup,
    }
  } catch (error) {
    console.error(`[domain:settings] getPublicAuthConfig failed:`, error)
    wrapDbError('fetch public auth config', error)
  }
}

export async function getPublicPortalConfig(): Promise<PublicPortalConfig> {
  try {
    const org = await requireSettings()
    const portalConfig = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)

    const [configuredTypes, passthroughKeys] = await Promise.all([
      getConfiguredAuthTypes(),
      getEmailDependentPassthroughKeys(),
    ])
    const filteredOAuth = filterOAuthByCredentials(
      portalConfig.oauth,
      configuredTypes,
      passthroughKeys
    )
    const customProviderNames = await getCustomProviderNames(filteredOAuth, configuredTypes)
    const welcome = publicWelcomeCard(portalConfig.welcomeCard)
    return {
      oauth: filteredOAuth,
      features: portalConfig.features,
      ...(customProviderNames && { customProviderNames }),
      ...(welcome && { welcomeCard: welcome }),
      portalAccess: {
        isPrivate: portalConfig.access?.visibility === 'private',
        widgetSignIn: portalConfig.access?.widgetSignIn ?? false,
      },
    }
  } catch (error) {
    console.error(`[domain:settings] getPublicPortalConfig failed:`, error)
    wrapDbError('fetch public portal config', error)
  }
}

// TenantSettings and SettingsBrandingData are defined in settings.types.ts
// to prevent client-side barrel imports from pulling in this server-only module.

export async function getTenantSettings(): Promise<TenantSettings | null> {
  try {
    const cached = await cacheGet<TenantSettings>(CACHE_KEYS.TENANT_SETTINGS)
    if (cached) {
      console.log(`[domain:settings] getTenantSettings: cache hit`)
      return cached
    }

    const org = await db.query.settings.findFirst()
    if (!org) return null

    const authConfig = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)
    const portalConfig = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)
    const brandingConfig = parseJsonOrNull<BrandingConfig>(org.brandingConfig) ?? {}
    const developerConfig = parseJsonConfig(org.developerConfig, DEFAULT_DEVELOPER_CONFIG)

    const widgetConfig = parseJsonConfig(org.widgetConfig, DEFAULT_WIDGET_CONFIG)
    const helpCenterConfig = parseJsonConfig(org.helpCenterConfig, DEFAULT_HELP_CENTER_CONFIG)

    const featureFlags: FeatureFlags = {
      ...DEFAULT_FEATURE_FLAGS,
      ...(org.featureFlags ? JSON.parse(org.featureFlags) : {}),
    }

    const [configuredTypes, passthroughKeys, verifiedDomains] = await Promise.all([
      getConfiguredAuthTypes(),
      getEmailDependentPassthroughKeys(),
      listVerifiedDomains(),
    ])
    const filteredAuthOAuth = filterOAuthByCredentials(
      authConfig.oauth,
      configuredTypes,
      passthroughKeys
    )
    const filteredPortalOAuth = filterOAuthByCredentials(
      portalConfig.oauth,
      configuredTypes,
      passthroughKeys
    )
    // Only portal exposes generic-oauth providers, so display-name overrides
    // are computed for the portal surface only.
    const portalCustomNames = await getCustomProviderNames(filteredPortalOAuth, configuredTypes)

    const brandingData: SettingsBrandingData = {
      name: org.name,
      logoUrl: getPublicUrlOrNull(org.logoKey),
      faviconUrl: getPublicUrlOrNull(org.faviconKey),
      headerLogoUrl: getPublicUrlOrNull(org.headerLogoKey),
      headerDisplayMode: org.headerDisplayMode,
      headerDisplayName: org.headerDisplayName,
    }

    const result: TenantSettings = {
      settings: org,
      name: org.name,
      slug: org.slug,
      authConfig,
      portalConfig,
      brandingConfig,
      developerConfig,
      helpCenterConfig,
      customCss: org.customCss ?? '',
      publicAuthConfig: {
        oauth: filteredAuthOAuth,
        openSignup: authConfig.openSignup,
      },
      publicPortalConfig: (() => {
        const welcome = publicWelcomeCard(portalConfig.welcomeCard)
        return {
          oauth: filteredPortalOAuth,
          features: portalConfig.features,
          ...(portalCustomNames && { customProviderNames: portalCustomNames }),
          ...(welcome && { welcomeCard: welcome }),
          portalAccess: {
            isPrivate: portalConfig.access?.visibility === 'private',
            widgetSignIn: portalConfig.access?.widgetSignIn ?? false,
          },
        }
      })(),
      publicWidgetConfig: {
        enabled: widgetConfig.enabled,
        defaultBoard: widgetConfig.defaultBoard,
        position: widgetConfig.position,
        tabs: widgetConfig.tabs,
        hmacRequired: widgetConfig.identifyVerification ?? false,
        // Client-safe chat config — the widget gates its chat tab on chat.enabled,
        // so this must be projected here (cannedReplies stay agent-only).
        chat: publicLiveChatConfig(widgetConfig.chat ?? DEFAULT_LIVE_CHAT_CONFIG),
      },
      featureFlags,
      brandingData,
      faviconData: brandingData.faviconUrl ? { url: brandingData.faviconUrl } : null,
      managedFieldPaths: org.managedFieldPaths ?? [],
      state: (org.state as 'active' | 'suspended' | 'deleting' | null) ?? 'active',
      verifiedDomains,
    }

    // 1h TTL: settings change rarely and every mutation in this file
    // calls invalidateSettingsCache(), so a long TTL is safe and keeps
    // the per-request cost of getTenantSettings to a single Redis GET.
    await cacheSet(CACHE_KEYS.TENANT_SETTINGS, result, 3600)
    return result
  } catch (error) {
    console.error(`[domain:settings] getTenantSettings failed:`, error)
    wrapDbError('fetch settings with all configs', error)
  }
}

// ============================================================================
// Feature Flags
// ============================================================================

/**
 * Get current feature flags, merged with defaults
 */
export async function getFeatureFlags(): Promise<FeatureFlags> {
  const settings = await getTenantSettings()
  return settings?.featureFlags ?? DEFAULT_FEATURE_FLAGS
}

/**
 * Check if a specific feature flag is enabled
 */
export async function isFeatureEnabled(flag: keyof FeatureFlags): Promise<boolean> {
  const flags = await getFeatureFlags()
  return flags[flag] ?? false
}

/**
 * Update feature flags (partial update, merges with existing)
 */
export async function updateFeatureFlags(input: Partial<FeatureFlags>): Promise<FeatureFlags> {
  // Per-key managed gate: only the keys declared in the config file
  // are locked; every other flag stays UI-editable. Assert before any
  // DB write so a partial update with one locked key fails atomically.
  for (const key of Object.keys(input)) {
    await assertNotManaged(`features.${key}`)
  }
  // Tier gate: enabling AI feedback extraction is plan-entitled (Scale on
  // cloud). Checked only on enable so a downgrade can still switch it off.
  if (input.aiFeedbackExtraction === true) {
    const { assertTierFeature } = await import('@/lib/server/domains/settings/tier-enforce')
    await assertTierFeature('aiFeedbackExtraction', 'AI feedback extraction')
  }
  const org = await requireSettings()
  const current: FeatureFlags = {
    ...DEFAULT_FEATURE_FLAGS,
    ...(org.featureFlags ? JSON.parse(org.featureFlags) : {}),
  }
  const updated = { ...current, ...input }
  await db
    .update(settings)
    .set({ featureFlags: JSON.stringify(updated) })
    .where(eq(settings.id, org.id))
  await invalidateSettingsCache()
  return updated
}
