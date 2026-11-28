/**
 * Help center translations through the REST API, MCP and webhooks (area
 * API-HC-L): an agent can do what a person does in the editor, with the same
 * rules. A translation written from Markdown reads back in its language; a
 * language with no version falls back, and says so; a change to the article
 * marks the translation behind and announces it; AI makes an update waiting
 * for review, which is published through the API; MCP translates, reads and
 * names a collection in a language.
 */
import { randomBytes } from 'node:crypto'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { ISOLATED } from '../../support/automation'
import { withSettings } from '../../support/isolated-settings'
import { fakeAi } from '../../support/fake-ai-client'
import { mcpCall } from '../../support/api-client'
import { bodyOf, deliveriesOf, hooksApi, subscribe, unsubscribe } from '../../support/webhooks'

test.describe.configure({ timeout: 90_000 })

async function seedArticle(marker: string) {
  const sql = supportDb()
  const categoryUuid = toUuid(generateId('kb_category'))
  const articleId = generateId('article')
  const [author] = await sql`SELECT id FROM principal WHERE role = 'admin' AND type = 'user'
    ORDER BY created_at LIMIT 1`
  const slug = `${marker}-${randomBytes(3).toString('hex')}`
  const body = 'Open Settings, then Account.'
  await sql`INSERT INTO kb_categories (id, slug, name, is_public, position, created_at, updated_at)
    VALUES (${categoryUuid}, ${slug}, ${`Getting started ${marker}`}, true, 0, NOW(), NOW())`
  await sql`INSERT INTO kb_articles (id, category_id, slug, title, content, content_json,
      principal_id, published_at, created_at, updated_at)
    VALUES (${toUuid(articleId)}, ${categoryUuid}, ${slug}, ${`Set up your account ${marker}`},
      ${body}, ${sql.json({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }] })},
      ${author.id}, NOW() - interval '1 minute', NOW(), NOW())`
  return { articleId, categoryId: fromUuid('kb_category', categoryUuid) }
}

const EVENTS = [
  'article.translation_published',
  'article.translation_updated',
  'article.translation_needs_update',
  'article.translation_update_ready',
]

test.describe('help center translations through the API', () => {
  test.skip(!ISOLATED, 'turns on workspace-wide help center languages; runs in support-isolated')

  test(
    'API-HC-L1 write, read in a language, needs update, an AI update published, and the events',
    { tag: ['@core', '@isolated'] },
    async ({ playwright, baseURL, people, marker }) => {
      const { articleId } = await seedArticle(marker)
      await fakeAi.script({
        marker,
        json: {
          title: `Konto einrichten (KI) ${marker}`,
          description: '',
          content: 'Öffne Einstellungen, dann Konto.',
        },
      })
      const api = await hooksApi(playwright, baseURL, people, marker)
      const hook = await subscribe(api, marker, EVENTS)
      try {
        await withSettings(
          {
            feature_flags: { helpCenter: true },
            help_center_config: { 'locales.additional': ['de', 'fr'] },
          },
          async () => {
            const base = `/api/v1/help-center/articles/${articleId}`

            // Write the German version from Markdown, published.
            const put = await api.put(`${base}/translations/de`, {
              data: {
                title: `Konto einrichten ${marker}`,
                content: 'Öffne **Einstellungen**.',
                status: 'published',
              },
            })
            expect(put.status(), await put.text()).toBe(200)
            expect((await put.json()).data).toMatchObject({
              locale: 'de',
              status: 'published',
              needsUpdate: false,
              updateReady: false,
            })
            const [published] = await deliveriesOf(
              marker,
              'article.translation_published',
              articleId
            )
            expect(bodyOf(published).data).toMatchObject({ articleId, locale: 'de' })

            // Read in German, and in French, which has no version.
            const de = (await (await api.get(`${base}?locale=de`)).json()).data
            expect(de).toMatchObject({
              locale: 'de',
              requestedLocale: 'de',
              fallback: false,
              title: `Konto einrichten ${marker}`,
              content: 'Öffne **Einstellungen**.',
            })
            expect(de.translations).toEqual([
              expect.objectContaining({ locale: 'de', status: 'published', needsUpdate: false }),
            ])
            const fr = (await (await api.get(`${base}?locale=fr`)).json()).data
            expect(fr).toMatchObject({ locale: 'en', requestedLocale: 'fr', fallback: true })
            expect(fr.title).toBe(`Set up your account ${marker}`)

            // The article changes: German is behind, announced once.
            const patch = await api.patch(base, {
              data: { content: 'Open Settings, then Account, then Save.' },
            })
            expect(patch.status(), await patch.text()).toBe(200)
            const [behind] = await deliveriesOf(
              marker,
              'article.translation_needs_update',
              articleId
            )
            expect(bodyOf(behind).data).toMatchObject({
              articleId,
              locale: 'de',
              articleRevision: 2,
              translationRevision: 1,
            })
            const after = (await (await api.get(base)).json()).data
            expect(after.translations[0]).toMatchObject({ locale: 'de', needsUpdate: true })

            // AI makes an update waiting for review; the live text stays.
            const ai = await api.post(`${base}/translations/de/ai-draft`)
            expect(ai.status(), await ai.text()).toBe(200)
            expect((await ai.json()).data).toMatchObject({ kind: 'update', check: { ok: true } })
            const [ready] = await deliveriesOf(
              marker,
              'article.translation_update_ready',
              articleId
            )
            expect(bodyOf(ready).data).toMatchObject({ locale: 'de', checksPassed: true })
            const live = (await (await api.get(`${base}?locale=de`)).json()).data
            expect(live.title).toBe(`Konto einrichten ${marker}`)
            expect(live.translations[0]).toMatchObject({ needsUpdate: true, updateReady: true })

            // Publish the update: live, and current.
            const pub = await api.post(`${base}/translations/de/publish-update`)
            expect(pub.status(), await pub.text()).toBe(200)
            expect((await pub.json()).data).toMatchObject({
              locale: 'de',
              status: 'published',
              title: `Konto einrichten (KI) ${marker}`,
              needsUpdate: false,
              updateReady: false,
            })

            // A language the article is written in is refused; an unknown one too.
            expect(
              (
                await api.put(`${base}/translations/en`, { data: { title: 'x', content: 'y' } })
              ).status()
            ).toBe(400)
            expect(
              (
                await api.put(`${base}/translations/xx`, { data: { title: 'x', content: 'y' } })
              ).status()
            ).toBe(400)
          }
        )
      } finally {
        await unsubscribe(api, hook)
        await fakeAi.clear(marker)
      }
    }
  )

  test(
    'API-HC-L3 with Translate automatically on, an article change brings an update waiting for review and a draft for a missing language',
    { tag: ['@core', '@isolated'] },
    async ({ playwright, baseURL, people, marker }) => {
      const { articleId } = await seedArticle(marker)
      const articleUuid = toUuid(articleId)
      const sql = supportDb()
      await fakeAi.script({
        marker,
        json: {
          title: `Automatisch ${marker}`,
          description: '',
          content: 'Öffne Einstellungen, dann Konto, dann Speichern.',
        },
      })
      const api = await hooksApi(playwright, baseURL, people, marker)
      try {
        await withSettings(
          {
            feature_flags: { helpCenter: true },
            help_center_config: {
              'locales.additional': ['de', 'fr'],
              'autoTranslate.enabled': true,
            },
          },
          async () => {
            const base = `/api/v1/help-center/articles/${articleId}`
            const put = await api.put(`${base}/translations/de`, {
              data: {
                title: `Konto einrichten ${marker}`,
                content: 'Öffne Einstellungen.',
                status: 'published',
              },
            })
            expect(put.status(), await put.text()).toBe(200)

            // The article's text changes; nobody asks for a translation.
            const patch = await api.patch(base, {
              data: { content: 'Open Settings, then Account, then Save.' },
            })
            expect(patch.status(), await patch.text()).toBe(200)

            // German: an update waits beside the live text, which does not change.
            await expect
              .poll(
                async () => {
                  const [de] = await sql`SELECT pending_title FROM kb_article_translations
                    WHERE article_id = ${articleUuid} AND locale = 'de'`
                  return de?.pending_title ?? null
                },
                { timeout: 45_000 }
              )
              .toBe(`Automatisch ${marker}`)
            const [de] = await sql`SELECT title, status, source_revision, pending_source_revision,
                check_result FROM kb_article_translations
              WHERE article_id = ${articleUuid} AND locale = 'de'`
            expect(de).toMatchObject({
              title: `Konto einrichten ${marker}`,
              status: 'published',
              source_revision: 1,
              pending_source_revision: 2,
            })
            expect(de.check_result).toMatchObject({ ok: true })

            // French had no version: it gets a draft, not a published page.
            await expect
              .poll(
                async () => {
                  const [fr] = await sql`SELECT status FROM kb_article_translations
                    WHERE article_id = ${articleUuid} AND locale = 'fr'`
                  return fr?.status ?? null
                },
                { timeout: 45_000 }
              )
              .toBe('draft')
          }
        )
      } finally {
        await fakeAi.clear(marker)
      }
    }
  )

  test(
    'API-HC-L2 MCP translates an article, reads it in a language, and names a collection',
    { tag: ['@core', '@isolated'] },
    async ({ playwright, baseURL, people, marker }) => {
      const { articleId, categoryId } = await seedArticle(marker)
      await fakeAi.script({
        marker,
        json: {
          title: `Configurer votre compte ${marker}`,
          description: '',
          content: 'Ouvrez Paramètres.',
        },
      })
      const api = await hooksApi(playwright, baseURL, people, marker)
      try {
        await withSettings(
          {
            feature_flags: { helpCenter: true },
            help_center_config: { 'locales.additional': ['de', 'fr'] },
          },
          async () => {
            const drafted = await mcpCall(api, 'translate_article', { articleId, locale: 'fr' })
            expect(drafted.isError, drafted.text).toBe(false)
            expect(drafted.json).toMatchObject({ locale: 'fr', kind: 'draft' })

            const read = await mcpCall(api, 'get_details', { id: articleId, locale: 'fr' })
            expect(read.json).toMatchObject({
              locale: 'fr',
              fallback: false,
              title: `Configurer votre compte ${marker}`,
            })
            expect(read.json.translations).toEqual([
              expect.objectContaining({ locale: 'fr', status: 'draft' }),
            ])

            const german = await mcpCall(api, 'get_details', { id: articleId, locale: 'de' })
            expect(german.json).toMatchObject({ locale: 'en', fallback: true })

            // A rich body Markdown cannot hold: publishing alone must keep it whole.
            const sql = supportDb()
            const richBody = {
              type: 'doc',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Ouvrez Paramètres.' }] },
                { type: 'youtube', attrs: { src: 'https://www.youtube.com/watch?v=abc123def45' } },
                { type: 'resizableImage', attrs: { src: 'https://example.com/a.png', width: 320 } },
              ],
            }
            await sql`UPDATE kb_article_translations SET content_json = ${sql.json(richBody)}
              WHERE article_id = ${toUuid(articleId)} AND locale = 'fr'`
            const published = await mcpCall(api, 'update_article', {
              articleId,
              locale: 'fr',
              publishedAt: '2026-11-28T00:00:00Z',
            })
            expect(published.json.translation).toMatchObject({ locale: 'fr', status: 'published' })
            const [fr] = await sql`SELECT content_json FROM kb_article_translations
              WHERE article_id = ${toUuid(articleId)} AND locale = 'fr'`
            expect(fr.content_json).toEqual(richBody)

            const named = await mcpCall(api, 'manage_category', {
              action: 'update',
              categoryId,
              locale: 'de',
              name: `Erste Schritte ${marker}`,
            })
            expect(named.json.translation).toMatchObject({
              locale: 'de',
              name: `Erste Schritte ${marker}`,
            })

            const found = await mcpCall(api, 'search', {
              entity: 'articles',
              categoryId,
              locale: 'fr',
            })
            expect(found.json.articles).toEqual([
              expect.objectContaining({
                id: articleId,
                locale: 'fr',
                fallback: false,
                title: `Configurer votre compte ${marker}`,
              }),
            ])

            const removed = await mcpCall(api, 'update_article', { articleId, removeLocale: 'fr' })
            expect(removed.json).toMatchObject({ removedLocale: 'fr' })
          }
        )
      } finally {
        await fakeAi.clear(marker)
      }
    }
  )
})
