/**
 * The languages settings area: read from the settings row, and written inside
 * the settings registry's transaction through the services the Language card
 * and the help center's languages page use, so a new main language that is an
 * extra language swaps in as it does there.
 */
import type { z } from 'zod'
import type { Transaction } from '@/lib/server/db'
import { ValidationError } from '@/lib/shared/errors'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { languagesPatchSchema, languagePageLabelsSchema } from '@/lib/shared/languages-settings'
import { parseJsonConfig, requireSettings, type SettingsRecord } from './settings.helpers'
import { DEFAULT_HELP_CENTER_CONFIG, type HelpCenterLocaleChromeStrings } from './settings.types'
import {
  parseLanguageConfig,
  updateHelpCenterConfig,
  updateLanguageConfig,
} from './settings.service'
import { getTierLimits } from './tier-limits.service'
import { resolveCloudConfig } from './cloud/cloud.service'
import { buildRefusal, isEntitled } from './cloud/entitlements'
import { heldHelpCenterLocalesIn } from '@/lib/server/domains/plan-limits/plan-limits.locales'

type LanguagesPatch = z.infer<typeof languagesPatchSchema>
type PageLabels = z.infer<typeof languagePageLabelsSchema>

export function languagesAreaValues(row: SettingsRecord): Record<string, unknown> {
  const helpCenter = parseJsonConfig(row.helpCenterConfig, DEFAULT_HELP_CENTER_CONFIG)
  const language = parseLanguageConfig(row.languageConfig, helpCenter.locales?.default)
  const locales = helpCenter.locales
  return {
    mainLanguage: language.mainLanguage,
    visitorLanguage: language.visitorLanguage,
    extraLanguages: [...(locales?.additional ?? [])],
    pageLabels: (locales?.additional ?? []).map((locale) => {
      const chrome = locales?.chrome?.[locale]
      return {
        language: locale,
        homepageTitle: chrome?.homepageTitle ?? '',
        homepageDescription: chrome?.homepageDescription ?? '',
        searchPlaceholder: chrome?.searchPlaceholder ?? '',
      }
    }),
    autoTranslate: helpCenter.autoTranslate?.enabled ?? false,
    glossary: [...(helpCenter.autoTranslate?.protectedTerms ?? [])],
  }
}

function chromeOf(labels: PageLabels): HelpCenterLocaleChromeStrings {
  return {
    homepageTitle: labels.homepageTitle,
    homepageDescription: labels.homepageDescription,
    searchPlaceholder: labels.searchPlaceholder,
  }
}

/** Write a languages patch inside the registry's transaction. */
export async function writeLanguagesArea(tx: Transaction, input: LanguagesPatch): Promise<void> {
  const patch = languagesPatchSchema.parse(input)
  const options = { executor: tx }
  if (patch.mainLanguage !== undefined || patch.visitorLanguage !== undefined) {
    await updateLanguageConfig(
      {
        ...(patch.mainLanguage !== undefined ? { mainLanguage: patch.mainLanguage } : {}),
        ...(patch.visitorLanguage !== undefined ? { visitorLanguage: patch.visitorLanguage } : {}),
      },
      options
    )
  }
  const helpCenterChange =
    patch.extraLanguages !== undefined ||
    patch.pageLabels !== undefined ||
    patch.autoTranslate !== undefined ||
    patch.glossary !== undefined
  if (!helpCenterChange) return

  // Read again: a main-language swap above moved the help center's languages.
  const row = await requireSettings(tx)
  const current = languagesAreaValues(row) as {
    mainLanguage: string
    extraLanguages: string[]
  }
  const helpCenter = parseJsonConfig(row.helpCenterConfig, DEFAULT_HELP_CENTER_CONFIG)
  const extra = patch.extraLanguages ?? current.extraLanguages
  if (new Set(extra).size !== extra.length)
    throw new ValidationError('HC_LOCALE_DUPLICATE', 'Each extra language can be listed once')
  if (extra.includes(current.mainLanguage))
    throw new ValidationError(
      'HC_LOCALE_IS_DEFAULT',
      'The main language is always on; it cannot also be an extra language'
    )

  const chrome = { ...helpCenter.locales.chrome }
  for (const labels of patch.pageLabels ?? []) {
    if (!extra.includes(labels.language))
      throw new ValidationError(
        'HC_LOCALE_NOT_ENABLED',
        `Page labels name ${labels.language}, which is not an extra language`
      )
    chrome[labels.language] = chromeOf(labels)
  }
  const added = extra.filter((locale) => !helpCenter.locales.additional.includes(locale))
  for (const locale of added) {
    if (!chrome[locale]?.homepageTitle?.trim())
      throw new ValidationError(
        'HC_LOCALE_TITLE_REQUIRED',
        `Adding ${locale} needs its page labels, with a homepage title`
      )
  }

  const cap = (await getTierLimits(new Date(), tx)).maxHelpCenterLocales
  if (cap !== null) {
    // The main language counts toward the plan's language cap.
    if (added.length > 0 && 1 + extra.length > cap)
      throw new TierLimitError({
        limit: 'maxHelpCenterLocales',
        current: 1 + helpCenter.locales.additional.length,
        max: cap,
        message: `You've reached your plan's help center languages limit (${cap}). Upgrade to add more.`,
      })
  }
  // After the grace, the languages the plan holds keep their words. The order
  // they were added in decides which are held, so that order stays put while
  // any are.
  const held = heldHelpCenterLocalesIn({
    planLimitsState: row.planLimitsState,
    additional: helpCenter.locales.additional,
    cap,
    now: new Date(),
  })
  const edited = (patch.pageLabels ?? []).find(
    (labels) =>
      held.includes(labels.language) &&
      JSON.stringify(helpCenter.locales.chrome[labels.language] ?? null) !==
        JSON.stringify(chromeOf(labels))
  )
  if (edited)
    throw new ValidationError(
      'HC_LOCALE_HELD',
      `${edited.language} is past the plan's language limit; its page labels cannot change`
    )
  if (held.length > 0) {
    const kept = helpCenter.locales.additional.filter((locale) => extra.includes(locale))
    const reordered = extra
      .filter((locale) => helpCenter.locales.additional.includes(locale))
      .some((locale, index) => locale !== kept[index])
    if (reordered)
      throw new ValidationError(
        'HC_LOCALE_HELD',
        'While the plan holds languages, the extra languages keep the order they were added in'
      )
  }

  if (patch.autoTranslate === true && !helpCenter.autoTranslate.enabled) {
    const cloud = resolveCloudConfig(row.cloud ?? null)
    if (!isEntitled(cloud, 'aiArticleTranslation'))
      throw buildRefusal(cloud, 'aiArticleTranslation')
  }

  await updateHelpCenterConfig(
    {
      locales: { ...helpCenter.locales, additional: extra, chrome },
      autoTranslate: {
        ...(patch.autoTranslate !== undefined ? { enabled: patch.autoTranslate } : {}),
        ...(patch.glossary !== undefined ? { protectedTerms: patch.glossary } : {}),
      },
    },
    options
  )
}
