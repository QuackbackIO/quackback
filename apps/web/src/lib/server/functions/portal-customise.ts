/**
 * Server functions for portal Customise: the one-step publish
 * (PORTAL-CUSTOMISE-SPEC §4.1), Import your brand (§6.1) and Ask (§6.8).
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { publishPortalCustomisationSchema } from '@/lib/shared/schemas/portal-customise'
import {
  askPortalCustomiseSchema,
  type PortalAskResponse,
} from '@/lib/shared/portal-customise/ask-request'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { DomainException, RateLimitError } from '@/lib/shared/errors'
import type { ImportBrandRefusalCode, ImportBrandResult } from '@/lib/shared/theme/brand-import'
import { actorFromAuth } from '@/lib/server/audit/log'
import { logger } from '@/lib/server/logger'
import { requireAuth } from './auth-helpers'

const log = logger.child({ component: 'portal-customise' })

/**
 * Publish theme, Advanced CSS, tabs, welcome message, Help Center home and
 * wide logo together. Opening it takes settings.branding (everyone who can
 * open Customise); each part then needs its own permission, checked by the
 * domain service. A plan or permission refusal is thrown; a conflict with
 * someone else's change is returned as `{ ok: false, code: 'SETTINGS_CHANGED' }`
 * so the editor can read which parts and their current values.
 */
export const publishPortalCustomisationFn = createServerFn({ method: 'POST' })
  .validator(publishPortalCustomisationSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    log.info('publish portal customisation')
    const [{ getRequestHeaders }, { publishPortalCustomisation }, { config }] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('@/lib/server/domains/settings/portal-customise.service'),
      import('@/lib/server/config'),
    ])
    return publishPortalCustomisation(data, {
      permissions: auth.permissions,
      actor: actorFromAuth(auth),
      headers: getRequestHeaders(),
      baseUrl: config.baseUrl,
    })
  })

const REFUSALS = new Set<string>([
  'INVALID_WEBSITE',
  'RATE_LIMITED',
  'ROBOTS_DISALLOWED',
  'SITE_UNREACHABLE',
  'SITE_BLOCKED',
  'SITE_ERROR_PAGE',
  'SITE_PICKER',
] satisfies ImportBrandRefusalCode[])

/** An import refusal as a value, worded for the person; null for any other failure. */
function importRefusal(err: unknown): ImportBrandResult | null {
  if (!(err instanceof DomainException) || !REFUSALS.has(err.code)) return null
  const code = err.code as ImportBrandRefusalCode
  if (err instanceof RateLimitError) {
    const message = err.retryAfter <= 60 ? 'Try again in a minute.' : 'Try again tomorrow.'
    return { ok: false, code, message }
  }
  // What the site showed in its own page's place, for the editor to say in its own words.
  const shown = err as { reason?: unknown; host?: unknown; candidates?: unknown }
  if (
    (shown.reason === 'error' || shown.reason === 'bot' || shown.reason === 'picker') &&
    typeof shown.host === 'string'
  )
    return {
      ok: false,
      code,
      message: err.message,
      notRead: {
        reason: shown.reason,
        host: shown.host,
        candidates: Array.isArray(shown.candidates)
          ? shown.candidates.filter((c): c is string => typeof c === 'string').slice(0, 3)
          : [],
      },
    }
  return { ok: false, code, message: err.message }
}

/**
 * Import your brand: read a website (a domain or URL) and return the editor's
 * draft values, with the site's logo uploaded but saved to no setting (a wide
 * one is published as `logo.wideKey`). Every plan; limited per workspace.
 * A refusal the editor shows (INVALID_WEBSITE, RATE_LIMITED,
 * ROBOTS_DISALLOWED, SITE_UNREACHABLE, SITE_BLOCKED, SITE_ERROR_PAGE, SITE_PICKER) is returned as a value, since a thrown
 * error reaches the browser without its code.
 */
export const importBrandFn = createServerFn({ method: 'POST' })
  .validator(z.object({ url: z.string().max(2048) }))
  .handler(async ({ data }): Promise<ImportBrandResult> => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const [
      { importBrand },
      { browserReaderFrom },
      { config },
      { acceptLanguages },
      { getRequestHeaders },
      { portalHosts },
    ] = await Promise.all([
      import('@/lib/server/domains/brand-import/brand-import.service'),
      import('@/lib/server/domains/brand-import/browser-reader'),
      import('@/lib/server/config'),
      import('@/lib/server/domains/brand-import/site/local-version'),
      import('@tanstack/react-start/server'),
      import('@/lib/server/domains/settings/portal-domain'),
    ])
    try {
      const brand = await importBrand(data.url, {
        // A settings read that fails only leaves the brand assets unconfirmed.
        portalHosts: await portalHosts().catch(() => []),
        browser: browserReaderFrom({ url: config.browserUrl, token: config.browserToken }),
        canStageSquareLogo: auth.permissions.includes(PERMISSIONS.SETTINGS_MANAGE),
        languages: acceptLanguages(getRequestHeaders().get('accept-language')),
      })
      return { ok: true, brand }
    } catch (err) {
      const refusal = importRefusal(err)
      if (refusal) return refusal
      throw err
    }
  })

/**
 * Ask for a change in Customise (§6.8): a sentence in, a patch of the editor's
 * draft out. Nothing is saved; the editor applies the patch to its draft and
 * the person publishes as usual. AI off, the allowance used up or an answer
 * that does not fit come back as a plain reply, never an error.
 */
export const askPortalCustomiseFn = createServerFn({ method: 'POST' })
  .validator(askPortalCustomiseSchema)
  .handler(async ({ data }): Promise<PortalAskResponse> => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const { askPortalCustomise } = await import('@/lib/server/domains/assistant/portal-ask.service')
    return askPortalCustomise(data)
  })
