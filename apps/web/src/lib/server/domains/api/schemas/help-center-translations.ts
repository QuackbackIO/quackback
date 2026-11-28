/**
 * Help center translation API registrations: one language of an article or a
 * collection. The same service functions as the editor.
 */
import 'zod-openapi'
import { z } from 'zod'
import {
  registerPath,
  createItemResponseSchema,
  createRequestBodySchema,
  asSchema,
} from '../openapi'
import { TimestampSchema } from './common'
import { errorResponses } from './errors'
import { ArticleTranslationSummarySchema } from './help-center'

const MANAGE = 'Requires the help_center.manage permission.'
const featureOff = { 404: { description: 'Not found, or the help center feature is disabled' } }
const LANGUAGES = 'en, de, fr, es, ar, ru, pt-br, zh-cn, zh-tw, nl, pl, th, uk'

const articleIdParam = {
  name: 'articleId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description: 'Help center article ID',
} as const
const categoryIdParam = {
  name: 'categoryId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description: 'Help center category ID',
} as const
const localeParam = {
  name: 'locale',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description: `The language (${LANGUAGES}). Not the item's own language.`,
} as const

const PutArticleTranslationBody = createRequestBodySchema({
  title: z.string().min(1).max(200),
  description: z.string().max(300).nullable().optional(),
  content: z.string().min(1).meta({
    description: 'The body as Markdown; the formatted body readers see is built from it',
  }),
  status: z.enum(['draft', 'published']).optional().meta({
    description:
      'A new translation is a draft unless published is given; saving an existing one keeps its publish state unless a status is given',
  }),
})

const PutCategoryTranslationBody = createRequestBodySchema({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
})

const translationResponse = {
  200: {
    description: 'The translation',
    content: {
      'application/json': {
        schema: createItemResponseSchema(ArticleTranslationSummarySchema, 'ArticleTranslation'),
      },
    },
  },
}

registerPath('/help-center/articles/{articleId}/translations/{locale}', {
  put: {
    tags: ['Help Center'],
    summary: 'Write one language of an article',
    description: `Creates or replaces the article's version in a language from Markdown. A translation records the article version it was made from; a new one is current. ${MANAGE}`,
    parameters: [articleIdParam, localeParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(PutArticleTranslationBody) } },
    },
    responses: { ...translationResponse, ...errorResponses(400, 403), ...featureOff },
  },
  delete: {
    tags: ['Help Center'],
    summary: 'Delete one language of an article',
    description: `Readers of that language get the article's own text again, with a notice. ${MANAGE}`,
    parameters: [articleIdParam, localeParam],
    responses: {
      204: { description: 'Translation deleted' },
      ...errorResponses(400, 403),
      ...featureOff,
    },
  },
})

const AiOutcomeSchema = z.object({
  kind: z.enum(['draft', 'update', 'paused', 'skipped']).meta({
    description:
      'draft: a missing language got a new draft. update: an existing translation got an update waiting for review. paused: the AI allowance is used up until pausedUntil. skipped: see reason',
  }),
  check: z
    .object({
      ok: z.boolean(),
      problems: z.array(z.object({ code: z.string(), detail: z.string().optional() })),
    })
    .optional()
    .meta({
      description:
        'The checks on the AI text: code, link and image targets, headings, nothing empty, never-translate words. An update that failed them cannot be published',
    }),
  pausedUntil: TimestampSchema.optional(),
  reason: z
    .enum(['unavailable', 'held', 'not_found', 'current', 'update_waiting', 'changed', 'failed'])
    .optional(),
})

const actions: Array<[string, string, string, 'translation' | 'outcome']> = [
  [
    'ai-draft',
    'Translate one language with AI',
    'AI translates the article into the language now. A missing language gets a draft; an existing translation gets an update waiting for review beside its live text, which does not change. AI never publishes.',
    'outcome',
  ],
  [
    'publish-update',
    'Publish the waiting AI update',
    'Makes the update waiting for review the translation text, current with the article; the translation keeps its publish state. Refused for an update that failed its checks.',
    'translation',
  ],
  [
    'discard-update',
    'Discard the waiting AI update',
    'Drops the update waiting for review; the live text stays.',
    'translation',
  ],
  [
    'mark-current',
    'Mark a translation as up to date',
    'Says the translation already matches the article as it is now; also drops a waiting update.',
    'translation',
  ],
]

for (const [action, summary, description, returns] of actions) {
  registerPath(`/help-center/articles/{articleId}/translations/{locale}/${action}`, {
    post: {
      tags: ['Help Center'],
      summary,
      description: `${description} ${MANAGE}`,
      parameters: [articleIdParam, localeParam],
      responses: {
        ...(returns === 'translation'
          ? translationResponse
          : {
              200: {
                description: 'What the AI run did',
                content: {
                  'application/json': {
                    schema: createItemResponseSchema(
                      AiOutcomeSchema,
                      'ArticleTranslationAiOutcome'
                    ),
                  },
                },
              },
            }),
        ...errorResponses(400, 403),
        ...featureOff,
      },
    },
  })
}

registerPath('/help-center/categories/{categoryId}/translations/{locale}', {
  put: {
    tags: ['Help Center'],
    summary: "Write a category's name in one language",
    description: `Sets the category's name and description in a language. ${MANAGE}`,
    parameters: [categoryIdParam, localeParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(PutCategoryTranslationBody) } },
    },
    responses: {
      200: {
        description: 'The category translation',
        content: {
          'application/json': {
            schema: createItemResponseSchema(
              z.object({
                locale: z.string(),
                name: z.string(),
                description: z.string().nullable(),
                updatedAt: TimestampSchema,
              }),
              'CategoryTranslation'
            ),
          },
        },
      },
      ...errorResponses(400, 403),
      ...featureOff,
    },
  },
  delete: {
    tags: ['Help Center'],
    summary: "Delete a category's name in one language",
    description: `Readers of that language get the category's own name again. ${MANAGE}`,
    parameters: [categoryIdParam, localeParam],
    responses: {
      204: { description: 'Category translation deleted' },
      ...errorResponses(400, 403),
      ...featureOff,
    },
  },
})
