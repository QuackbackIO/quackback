/**
 * Every language in the full article editor (area ADM-HC-L): a language bar
 * above the title with a state per language; a translation behind its
 * article says so and can be marked up to date; an AI update waiting for
 * review is published from the editor; a missing language is translated by
 * AI into a draft; the list filters articles with a language behind.
 *
 * Set E2E_GALLERY_DIR to also save a screenshot of each screen there.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { generateId, toUuid } from '@quackback/ids'
import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { ISOLATED } from '../../support/automation'
import { withSettings } from '../../support/isolated-settings'
import { fakeAi } from '../../support/fake-ai-client'

async function snap(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_GALLERY_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  // The editor's sidebar fades in; let it finish before the picture.
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(dir, `${name}.png`) })
}

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

/**
 * A published English article at its second text version, with a French
 * translation made from the first, a German one with an AI update waiting,
 * and no Spanish one.
 */
async function seedArticle(marker: string) {
  const sql = supportDb()
  const categoryUuid = toUuid(generateId('kb_category'))
  const articleId = generateId('article')
  const articleUuid = toUuid(articleId)
  const [author] = await sql`SELECT id FROM principal WHERE role = 'admin' AND type = 'user'
    ORDER BY created_at LIMIT 1`
  const slug = `${marker}-${randomBytes(3).toString('hex')}`
  const title = `Set up your account ${marker}`
  const body = 'Open Settings, then Account.'
  await sql`INSERT INTO kb_categories (id, slug, name, is_public, position, created_at, updated_at)
    VALUES (${categoryUuid}, ${slug}, ${`Getting started ${marker}`}, true, 0, NOW(), NOW())`
  await sql`INSERT INTO kb_articles (id, category_id, slug, title, content, content_json,
      principal_id, published_at, text_revision, created_at, updated_at)
    VALUES (${articleUuid}, ${categoryUuid}, ${slug}, ${title}, ${body}, ${sql.json(doc(body))},
      ${author.id}, NOW() - interval '1 minute', 2, NOW(), NOW())`
  await sql`INSERT INTO kb_article_translations (id, article_id, locale, title, content,
      content_json, status, source_revision, source_text)
    VALUES (${toUuid(generateId('kb_article_translation'))}, ${articleUuid}, 'fr',
      ${`Configurer votre compte ${marker}`}, 'Ouvrez Paramètres.',
      ${sql.json(doc('Ouvrez Paramètres.'))}, 'published', 1,
      ${sql.json({ title, description: null, content: 'Open Settings.' })})`
  await sql`INSERT INTO kb_article_translations (id, article_id, locale, title, content,
      content_json, status, source_revision, pending_title, pending_content,
      pending_content_json, pending_source_revision, pending_source_text, pending_at,
      check_result)
    VALUES (${toUuid(generateId('kb_article_translation'))}, ${articleUuid}, 'de',
      ${`Konto einrichten ${marker}`}, 'Öffne Einstellungen.',
      ${sql.json(doc('Öffne Einstellungen.'))}, 'published', 1,
      ${`Konto einrichten (neu) ${marker}`}, 'Öffne Einstellungen, dann Konto.',
      ${sql.json(doc('Öffne Einstellungen, dann Konto.'))}, 2,
      ${sql.json({ title, description: null, content: body })}, NOW(),
      ${sql.json({ ok: true, problems: [] })})`
  return { articleId, articleUuid, title }
}

const HELP_CENTER = {
  feature_flags: { helpCenter: true },
  help_center_config: { 'locales.additional': ['fr', 'de', 'es'] },
}

test.describe('every language in the article editor', () => {
  test.skip(!ISOLATED, 'turns on workspace-wide help center languages; runs in support-isolated')

  test(
    'ADM-HC-L1 the language bar, needs update, an AI update ready, and AI for a missing language',
    { tag: ['@core', '@isolated'] },
    async ({ asPerson, marker }) => {
      const { articleId, articleUuid, title } = await seedArticle(marker)
      const sql = supportDb()
      await fakeAi.script({
        marker,
        json: {
          title: `Configura tu cuenta ${marker}`,
          description: '',
          content: 'Abre Ajustes y luego Cuenta.',
        },
      })
      try {
        await withSettings(HELP_CENTER, async () => {
          const page = await asPerson('admin')
          await page.goto(`/admin/help-center?article=${articleId}`)
          const bar = page.getByRole('tablist', { name: 'Article languages' })
          await expect(bar).toBeVisible({ timeout: 20_000 })
          await expect(bar.getByRole('tab')).toHaveText([
            'EnglishMain',
            'FrançaisNeeds update',
            'DeutschNeeds update',
            'EspañolNot translated',
          ])
          await snap(page, 'hc-editor-language-bar')

          // French was made from the first version.
          await bar.getByRole('tab', { name: /Français/ }).click()
          await expect(
            page.getByText('The English article changed after this translation was made.')
          ).toBeVisible()
          await page.getByRole('button', { name: 'Show changes' }).click()
          const changes = page.getByRole('dialog')
          await expect(changes.getByText('+ Open Settings, then Account.')).toBeVisible()
          await expect(changes.getByText('- Open Settings.')).toBeVisible()
          await snap(page, 'hc-editor-show-changes')
          await page.keyboard.press('Escape')
          await page.getByRole('button', { name: 'Mark as up to date' }).click()
          await expect(
            page.getByText('The English article changed after this translation was made.')
          ).toHaveCount(0)
          await expect(bar.getByRole('tab', { name: /Français/ })).toHaveText('FrançaisPublished')
          const [fr] = await sql`SELECT source_revision FROM kb_article_translations
            WHERE article_id = ${articleUuid} AND locale = 'fr'`
          expect(fr.source_revision).toBe(2)

          // German has an AI update waiting; readers still see the live text.
          await bar.getByRole('tab', { name: /Deutsch/ }).click()
          await expect(page.getByText(/An AI update is ready/)).toBeVisible()
          await snap(page, 'hc-editor-update-ready')
          await page.getByRole('button', { name: 'Publish update' }).click()
          await expect(page.getByText(/An AI update is ready/)).toHaveCount(0)
          await expect(page.getByLabel('Article title').last()).toHaveValue(
            `Konto einrichten (neu) ${marker}`
          )
          const [de] = await sql`SELECT title, status, source_revision, pending_title
            FROM kb_article_translations WHERE article_id = ${articleUuid} AND locale = 'de'`
          expect(de).toMatchObject({
            title: `Konto einrichten (neu) ${marker}`,
            status: 'published',
            source_revision: 2,
            pending_title: null,
          })

          // Spanish has no version yet: AI makes a draft.
          await bar.getByRole('tab', { name: /Español/ }).click()
          await expect(page.getByText('This article is not in Español yet')).toBeVisible()
          await expect(
            page.getByText('Readers who use Español see the English article.')
          ).toBeVisible()
          // The sidebar says what readers get now.
          await expect(page.getByText('The English article', { exact: true })).toBeVisible()
          await snap(page, 'hc-editor-missing-language')
          await page.getByRole('button', { name: 'Translate with AI' }).click()
          await expect(page.getByLabel('Article title').last()).toHaveValue(
            `Configura tu cuenta ${marker}`,
            { timeout: 20_000 }
          )
          const [es] = await sql`SELECT status, source_revision FROM kb_article_translations
            WHERE article_id = ${articleUuid} AND locale = 'es'`
          expect(es).toMatchObject({ status: 'draft', source_revision: 2 })
          const [request] = await fakeAi.requests({ contains: marker, endpoint: 'chat' })
          expect(request.text).toContain(title)
          await expect(bar.getByRole('tab', { name: /Español/ })).toHaveText('EspañolDraft')
        })
      } finally {
        await fakeAi.clear(marker)
      }
    }
  )

  test(
    'ADM-HC-L2 the list shows each language and filters articles with a language behind',
    { tag: ['@core', '@isolated'] },
    async ({ asPerson, marker }) => {
      const { title } = await seedArticle(marker)
      await withSettings(HELP_CENTER, async () => {
        const page = await asPerson('admin')
        await page.goto('/admin/help-center?languages=needs_update')
        const row = page.getByText(title)
        await expect(row).toBeVisible({ timeout: 20_000 })
        const item = page.locator('div.group', { has: row })
        await expect(item.getByLabel('Languages')).toHaveText('FRDEES')
        await expect(item.locator('[data-state="needs_update"]')).toHaveCount(2)
        await expect(item.locator('[data-state="missing"]')).toHaveCount(1)
        await snap(page, 'hc-list-languages')
      })
    }
  )
})
