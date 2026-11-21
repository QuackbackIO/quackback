/**
 * One atomic publish of the portal's look (PORTAL-CUSTOMISE-SPEC §4.1).
 *
 * The name in the header, theme, Advanced CSS, tabs, welcome message, Help Center home and
 * the wide logo and its dark mode version are written in one transaction under the settings row lock, or not at
 * all: a refused part (permission, plan) refuses the whole publish before the
 * first write. The settings row has no version column, so a conflict is found
 * per part, by comparing what is stored with the value the editor loaded.
 */
import { db, settings } from '@/lib/server/db'
import { recordAuditEventInTransaction, type AuditActor } from '@/lib/server/audit/log'
import { logger } from '@/lib/server/logger'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { advancedCssRemainder } from '@/lib/shared/theme/readable-css'
import { portalHostsOf, portalOnSite } from '@/lib/server/domains/settings/portal-domain'
import {
  PORTAL_CUSTOMISE_PARTS,
  publishPortalCustomisationSchema,
  type PortalCustomisePart,
  type PortalCustomiseValues,
  type PublishPortalCustomisationInput,
  type PublishPortalCustomisationResult,
} from '@/lib/shared/schemas/portal-customise'
import {
  invalidateSettingsCache,
  parseJsonConfig,
  parseJsonOrNull,
  parsePortalConfig,
  writeMetadataKey,
  type SettingsRecord,
} from './settings.helpers'
import {
  deleteHeaderLogoKey,
  saveFaviconKey,
  saveHeaderLogoDarkKey,
  saveHeaderLogoKey,
  saveLogoKey,
  updateBrandingConfig,
  updateCustomCss,
  updateHeaderDisplayMode,
  updateHeaderDisplayName,
} from './settings.media'
import { updateHelpCenterConfig, updatePortalConfig } from './settings.service'
import { isStaged, stageReplacedUploads, unstageUploads } from './settings.staged-uploads'
import {
  DEFAULT_HELP_CENTER_CONFIG,
  type BrandingConfig,
  type HeaderDisplayMode,
  type UpdatePortalConfigInput,
} from './settings.types'

const log = logger.child({ component: 'portal-customise' })

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Deep equality that ignores key order (stored JSON and sent JSON may differ in it). */
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((value, i) => equal(value, b[i]))
  if (isObject(a) && isObject(b))
    return (
      Object.keys(a).length === Object.keys(b).length &&
      Object.keys(a).every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
    )
  return false
}

/** Who may publish each part. Tabs and welcome message are branding (decision Q2). */
const PART_PERMISSION: Record<PortalCustomisePart, PermissionKey> = {
  // As the header name's own setting asks.
  headerName: PERMISSIONS.SETTINGS_BRANDING,
  theme: PERMISSIONS.SETTINGS_BRANDING,
  customCss: PERMISSIONS.SETTINGS_BRANDING,
  'portal.nav': PERMISSIONS.SETTINGS_BRANDING,
  'portal.welcomeCard': PERMISSIONS.SETTINGS_BRANDING,
  'helpCenter.homepageTitle': PERMISSIONS.HELP_CENTER_MANAGE,
  'helpCenter.homepageDescription': PERMISSIONS.HELP_CENTER_MANAGE,
  'helpCenter.headerLinks': PERMISSIONS.HELP_CENTER_MANAGE,
  'logo.wideKey': PERMISSIONS.SETTINGS_BRANDING,
  'logo.darkKey': PERMISSIONS.SETTINGS_BRANDING,
  'logo.headerDisplayMode': PERMISSIONS.SETTINGS_BRANDING,
  // The icon is the workspace's own, in emails and the browser tab too.
  'logo.icon': PERMISSIONS.SETTINGS_MANAGE,
}

const PART_LABEL: Record<PortalCustomisePart, string> = {
  headerName: 'the name in the header',
  theme: 'the theme',
  customCss: 'Advanced CSS',
  'portal.nav': 'the portal tabs',
  'portal.welcomeCard': 'the welcome message',
  'helpCenter.homepageTitle': 'the Help Center home',
  'helpCenter.homepageDescription': 'the Help Center home',
  'helpCenter.headerLinks': 'the Help Center links',
  'logo.wideKey': 'the header logo',
  'logo.darkKey': 'the logo’s dark mode version',
  'logo.headerDisplayMode': 'the header logo',
  'logo.icon': 'the icon',
}

/** What an absent value reads as, for each part (the read path's own default). */
const PART_DEFAULT: Record<PortalCustomisePart, unknown> = {
  headerName: '',
  theme: {},
  customCss: '',
  'portal.nav': null,
  'portal.welcomeCard': null,
  'helpCenter.homepageTitle': DEFAULT_HELP_CENTER_CONFIG.homepageTitle,
  'helpCenter.homepageDescription': DEFAULT_HELP_CENTER_CONFIG.homepageDescription,
  'helpCenter.headerLinks': DEFAULT_HELP_CENTER_CONFIG.headerLinks,
  'logo.wideKey': null,
  'logo.darkKey': null,
  'logo.headerDisplayMode': 'logo_and_name',
  'logo.icon': null,
}

export interface PublishPortalCustomisationContext {
  /** The caller's resolved permissions. */
  permissions: readonly PermissionKey[]
  /** Recorded on the audit row. */
  actor: AuditActor
  headers?: Headers
  /** The install's own address, for whether the portal is on an imported site's domain. */
  baseUrl?: string
}

function valueAt(values: unknown, part: PortalCustomisePart): unknown {
  let value: unknown = values
  for (const key of part.split('.')) {
    value =
      value !== null && typeof value === 'object'
        ? (value as Record<string, unknown>)[key]
        : undefined
  }
  return value
}

/** A part's value with absence read as the part's default. */
function normalised(part: PortalCustomisePart, value: unknown): unknown {
  return value ?? PART_DEFAULT[part]
}

/** Every part as stored, read the way the settings read path reads it. */
function storedParts(row: SettingsRecord): Record<PortalCustomisePart, unknown> {
  const portal = parsePortalConfig(row.portalConfig)
  const helpCenter = parseJsonConfig(row.helpCenterConfig, DEFAULT_HELP_CENTER_CONFIG)
  const stored: Record<PortalCustomisePart, unknown> = {
    headerName: row.headerDisplayName,
    theme: parseJsonOrNull<BrandingConfig>(row.brandingConfig),
    customCss: row.customCss,
    'portal.nav': portal.nav,
    'portal.welcomeCard': portal.welcomeCard,
    'helpCenter.homepageTitle': helpCenter.homepageTitle,
    'helpCenter.homepageDescription': helpCenter.homepageDescription,
    'helpCenter.headerLinks': helpCenter.headerLinks,
    'logo.wideKey': row.headerLogoKey,
    'logo.darkKey': portal.headerLogoDarkKey,
    'logo.headerDisplayMode': row.headerDisplayMode,
    'logo.icon': row.logoKey ? { key: row.logoKey, faviconKey: row.faviconKey ?? null } : null,
  }
  for (const part of PORTAL_CUSTOMISE_PARTS) stored[part] = normalised(part, stored[part])
  return stored
}

/** Part values in the publish shape, for the parts named. */
function partValues(
  parts: readonly PortalCustomisePart[],
  values: Record<PortalCustomisePart, unknown>
): PortalCustomiseValues {
  const out: Record<string, unknown> = {}
  for (const part of parts) {
    const [head, leaf] = part.split('.')
    if (leaf === undefined) out[head] = values[part]
    else out[head] = { ...(out[head] as Record<string, unknown> | undefined), [leaf]: values[part] }
  }
  return out as PortalCustomiseValues
}

/** Every font file a theme names: the text family's and the headings family's. */
const fontKeysOf = (theme: BrandingConfig | null | undefined): string[] => [
  ...new Set(
    [...(theme?.customFont?.files ?? []), ...(theme?.customHeadingFont?.files ?? [])].map(
      (file) => file.key
    )
  ),
]

/**
 * Publish the parts present in `input` together. Refuses the whole publish
 * when the caller may not publish one of them (ForbiddenError) or the plan
 * does not include what one of them needs (TierLimitError). When someone
 * else changed a part since the editor loaded it, nothing is written and the
 * refusal comes back as a value with the current values of those parts.
 */
export async function publishPortalCustomisation(
  rawInput: PublishPortalCustomisationInput,
  context: PublishPortalCustomisationContext
): Promise<PublishPortalCustomisationResult> {
  const input = publishPortalCustomisationSchema.parse(rawInput)
  const parts = PORTAL_CUSTOMISE_PARTS.filter((part) => valueAt(input, part) !== undefined)
  if (parts.length === 0)
    throw new ValidationError('NOTHING_TO_PUBLISH', 'There are no changes to publish.')

  for (const part of parts) {
    if (!context.permissions.includes(PART_PERMISSION[part]))
      throw new ForbiddenError(
        'PERMISSION_DENIED',
        `You don't have permission to publish ${PART_LABEL[part]}. Ask a workspace owner.`
      )
    if (valueAt(input.before, part) === undefined)
      throw new ValidationError(
        'PUBLISH_BEFORE_REQUIRED',
        'Reload the page to see the published settings, then publish again.'
      )
  }

  log.info({ parts }, 'publish portal customisation')
  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(settings).limit(1).for('update')
    if (!row) throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    const stored = storedParts(row)

    const changedElsewhere = parts.filter(
      (part) => !equal(stored[part], normalised(part, valueAt(input.before, part)))
    )
    if (changedElsewhere.length > 0) {
      const refusal: PublishPortalCustomisationResult = {
        ok: false,
        code: 'SETTINGS_CHANGED',
        message: 'Someone else changed these settings. Reload the page to see their changes.',
        parts: changedElsewhere,
        current: partValues(changedElsewhere, stored),
      }
      return { result: refusal }
    }

    const changed = parts.filter(
      (part) => !equal(stored[part], normalised(part, valueAt(input, part)))
    )
    const has = (part: PortalCustomisePart) => changed.includes(part)

    // A new wide logo must be an upload still on the staged list: one the
    // sweep removed (a draft kept past a day) would save a broken image.
    const newWideKey = has('logo.wideKey') ? (input.logo!.wideKey as string | null) : null
    if (newWideKey !== null && !isStaged(row.metadata, newWideKey))
      throw new ValidationError(
        'WIDE_LOGO_NOT_UPLOADED',
        'Upload the wide logo again, then publish.'
      )

    // Its dark mode version likewise.
    const newDarkKey = has('logo.darkKey') ? (input.logo!.darkKey as string | null) : null
    if (newDarkKey !== null && !isStaged(row.metadata, newDarkKey))
      throw new ValidationError(
        'DARK_LOGO_NOT_UPLOADED',
        'Upload the dark mode version again, then publish.'
      )

    // The icon and its favicon likewise, each stored already or still staged.
    if (has('logo.icon')) {
      const icon = input.logo!.icon!
      const ready = (key: string) =>
        key === row.logoKey || key === row.faviconKey || isStaged(row.metadata, key)
      if (!ready(icon.key) || !ready(icon.faviconKey))
        throw new ValidationError('ICON_NOT_UPLOADED', 'Upload the icon again, then publish.')
    }

    // Font files likewise (the text family's and the headings'): each must be stored already or still staged.
    const storedFontKeys = fontKeysOf(parseJsonOrNull<BrandingConfig>(row.brandingConfig))
    const newFontKeys = has('theme') ? fontKeysOf(input.theme as BrandingConfig) : []
    if (has('theme')) {
      const missing = newFontKeys.some(
        (key) => !storedFontKeys.includes(key) && !isStaged(row.metadata, key)
      )
      if (missing)
        throw new ValidationError('FONT_NOT_UPLOADED', 'Upload the font again, then publish.')
    }

    // Plan checks for every changed part before the first write.
    const { assertTierFeature } = await import('./tier-enforce')
    if (has('theme') && (input.theme?.light !== undefined || input.theme?.dark !== undefined))
      await assertTierFeature('customColors', 'Custom colours', tx)
    if (has('customCss')) {
      const trimmed = input.customCss!.trim()
      if (trimmed.length > 0 && trimmed !== advancedCssRemainder(row.customCss ?? ''))
        await assertTierFeature('customCss', 'Custom CSS', tx)
    }

    const options = { executor: tx }
    // Through this transaction, on the row it holds.
    if (has('headerName')) await updateHeaderDisplayName(input.headerName!, options)
    if (has('theme')) {
      await updateBrandingConfig(input.theme as BrandingConfig, options)
      // Its font files are referred to now: off the staged list, so the sweep keeps them.
      if (newFontKeys.length > 0) await unstageUploads(newFontKeys, options)
      // Files of a font it replaced or removed wait for the sweep, as a replaced logo does.
      const dropped = storedFontKeys.filter((key) => !newFontKeys.includes(key))
      if (dropped.length > 0) await stageReplacedUploads(dropped, options)
    }
    if (has('customCss')) await updateCustomCss(input.customCss!, options)

    const portalPatch: UpdatePortalConfigInput = {}
    if (has('portal.nav')) portalPatch.nav = input.portal!.nav
    if (has('portal.welcomeCard'))
      portalPatch.welcomeCard = input.portal!.welcomeCard as UpdatePortalConfigInput['welcomeCard']
    if (Object.keys(portalPatch).length > 0) await updatePortalConfig(portalPatch, options)

    const helpCenterPatch = {
      ...(has('helpCenter.homepageTitle')
        ? { homepageTitle: input.helpCenter!.homepageTitle }
        : {}),
      ...(has('helpCenter.homepageDescription')
        ? { homepageDescription: input.helpCenter!.homepageDescription }
        : {}),
      ...(has('helpCenter.headerLinks') ? { headerLinks: input.helpCenter!.headerLinks } : {}),
    }
    if (Object.keys(helpCenterPatch).length > 0)
      await updateHelpCenterConfig(helpCenterPatch, options)

    if (has('logo.wideKey')) {
      const wideKey = input.logo!.wideKey as string | null
      const { previousKey } =
        wideKey === null
          ? await deleteHeaderLogoKey(options)
          : await saveHeaderLogoKey(wideKey, options)
      if (wideKey !== null) await unstageUploads([wideKey], options)
      // The replaced logo is not deleted at once: an undo in the editor can
      // publish it again until the sweep removes it a day later.
      if (previousKey && previousKey !== wideKey) await stageReplacedUploads([previousKey], options)
    }
    if (has('logo.darkKey')) {
      const darkKey = input.logo!.darkKey as string | null
      const { previousKey } = await saveHeaderLogoDarkKey(darkKey, options)
      if (darkKey !== null) await unstageUploads([darkKey], options)
      // The one it replaced waits for the sweep, as a replaced logo does.
      if (previousKey && previousKey !== darkKey) await stageReplacedUploads([previousKey], options)
    }
    if (has('logo.headerDisplayMode'))
      await updateHeaderDisplayMode(input.logo!.headerDisplayMode as HeaderDisplayMode, options)
    if (has('logo.icon')) {
      const icon = input.logo!.icon!
      await saveLogoKey(icon.key, options)
      await saveFaviconKey(icon.faviconKey, options)
      // Referred to now: off the staged list. The icon it replaced stays
      // stored, as an icon saved anywhere else does, for a settings undo.
      await unstageUploads([icon.key, icon.faviconKey], options)
    }

    // The brand assets confirmation, for the assets this publish really carries.
    const confirmation = input.brandAssets
    // The theme is sent whole: a font counts only when its files are new to what is stored.
    const fontIsNew = newFontKeys.some((key) => !storedFontKeys.includes(key))
    const carried = (confirmation?.assets ?? []).filter((asset) =>
      asset === 'logo'
        ? // The logo, or its dark mode version: one asset to the person who confirmed it.
          (has('logo.wideKey') && input.logo?.wideKey != null) ||
          (has('logo.darkKey') && input.logo?.darkKey != null)
        : asset === 'icon'
          ? has('logo.icon')
          : has('theme') && fontIsNew
    )
    const brandAssets =
      confirmation && carried.length > 0
        ? (() => {
            const onSite = portalOnSite(
              confirmation.host,
              portalHostsOf({ cloudIdentity: row.cloudIdentity, baseUrl: context.baseUrl ?? '' })
            )
            return {
              host: confirmation.host,
              assets: carried,
              // Worked out here, never taken on the editor's word.
              preTicked: confirmation.preTicked && onSite,
              portalOnSite: onSite,
            }
          })()
        : null
    if (brandAssets) log.info({ brandAssets }, 'brand assets confirmed on publish')

    // Where the look came from, for the launch plan's brand step: a publish
    // that carries an import names its website, and the next change to the
    // look made by hand clears it. Tabs and words leave it as it is.
    const lookChanged = changed.some((part) => part === 'theme' || part.startsWith('logo.'))
    if (changed.length > 0 && input.importedFrom)
      await writeMetadataKey('brandImport', { host: input.importedFrom }, options)
    else if (lookChanged && parseJsonOrNull<Record<string, unknown>>(row.metadata)?.brandImport)
      await writeMetadataKey('brandImport', null, options)

    if (changed.length > 0)
      await recordAuditEventInTransaction(tx, {
        event: 'portal.customise.published',
        actor: context.actor,
        headers: context.headers,
        target: { type: 'settings', id: row.id },
        metadata: { parts: changed, ...(brandAssets ? { brandAssets } : {}) },
      })

    const [after] = await tx.select().from(settings).limit(1)
    const published: PublishPortalCustomisationResult = {
      ok: true,
      parts: changed,
      published: partValues(parts, storedParts(after)),
    }
    return { result: published }
  })

  if (outcome.result.ok && outcome.result.parts.length > 0) await invalidateSettingsCache()
  return outcome.result
}
