/**
 * The workspace's languages as one settings area (REST settings API and MCP
 * get_settings / update_settings): the main language and what visitors see,
 * the help center's extra languages and the words each one shows on its pages,
 * automatic translation and its glossary.
 */
import { z } from 'zod'
import { SUPPORTED_LOCALES } from '@/lib/shared/i18n'

const language = z.enum(SUPPORTED_LOCALES)

/** The words an extra language shows on its help center pages. */
export const languagePageLabelsSchema = z
  .object({
    language,
    homepageTitle: z.string().trim().min(1).max(200),
    homepageDescription: z.string().max(500).default(''),
    searchPlaceholder: z.string().max(200).default(''),
  })
  .strict()

export const languagesValueSchema = z.object({
  mainLanguage: language,
  visitorLanguage: z.enum(['own', 'main']),
  extraLanguages: z.array(language),
  pageLabels: z.array(languagePageLabelsSchema),
  autoTranslate: z.boolean(),
  glossary: z.array(z.string()),
})

/**
 * A change to the languages area. Arrays replace: `extraLanguages` is the full
 * list, `pageLabels` the words of every extra language, `glossary` every term
 * automatic translation keeps as written.
 */
export const languagesPatchSchema = z
  .object({
    mainLanguage: language.optional(),
    visitorLanguage: z.enum(['own', 'main']).optional(),
    extraLanguages: z.array(language).max(SUPPORTED_LOCALES.length).optional(),
    pageLabels: z.array(languagePageLabelsSchema).max(SUPPORTED_LOCALES.length).optional(),
    autoTranslate: z.boolean().optional(),
    glossary: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  })
  .strict()

/** The fields that change the help center, which also needs the help center permission. */
export const LANGUAGES_HELP_CENTER_FIELDS: ReadonlySet<string> = new Set([
  'extraLanguages',
  'pageLabels',
  'autoTranslate',
  'glossary',
])
