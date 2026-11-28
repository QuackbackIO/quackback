/**
 * Translation versions against the real database (rolled back): the article's
 * text revision moves only when its translatable text changes, a translation
 * records the revision it was made from, and an AI update waits beside the
 * live text until a person publishes or discards it.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type KbArticleId, type KbCategoryId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  eq,
  helpCenterArticleTranslations,
  helpCenterArticles,
  helpCenterCategories,
  principal,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('../help-center-embedding.service', () => ({
  generateArticleEmbedding: async () => true,
}))
vi.mock('@/lib/server/content/rehost-images', () => ({
  rehostExternalImages: async (json: unknown) => json,
}))

const { updateArticle } = await import('../help-center.article.service')
const { upsertArticleTranslation } = await import('../help-center-translations.service')
const {
  getArticleTranslationOverview,
  markArticleTranslationCurrent,
  publishPendingTranslationUpdate,
  discardPendingTranslationUpdate,
  writePendingTranslationUpdate,
  getArticleTranslationChanges,
} = await import('../help-center-translation-versions.service')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ r: helpCenterArticleTranslations.pendingSourceRevision })
      .from(helpCenterArticleTranslations)
      .limit(0)
  },
})

let author: PrincipalId
let categoryId: KbCategoryId

async function seedCategory(): Promise<KbCategoryId> {
  const id = createId('kb_category') as KbCategoryId
  await testDb.insert(helpCenterCategories).values({ id, name: 'Start', slug: id })
  return id
}

async function seedArticle(): Promise<KbArticleId> {
  const id = createId('kb_article') as KbArticleId
  await testDb.insert(helpCenterArticles).values({
    id,
    categoryId,
    slug: id,
    title: 'Set up your account',
    description: 'Name and photo',
    content: 'Open **Settings**.',
    contentJson: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Open Settings.' }] }],
    },
    principalId: author,
    publishedAt: new Date(),
  })
  return id
}

async function revisionOf(id: KbArticleId) {
  const [row] = await testDb
    .select({ r: helpCenterArticles.textRevision })
    .from(helpCenterArticles)
    .where(eq(helpCenterArticles.id, id))
  return row!.r
}

async function translationOf(id: KbArticleId, locale: string) {
  const [row] = await testDb
    .select()
    .from(helpCenterArticleTranslations)
    .where(
      and(
        eq(helpCenterArticleTranslations.articleId, id),
        eq(helpCenterArticleTranslations.locale, locale)
      )
    )
  return row
}

const germanText = {
  articleId: undefined as unknown as KbArticleId,
  locale: 'de',
  title: 'Konto einrichten',
  description: 'Name und Foto',
  content: 'Öffne **Einstellungen**.',
}

const update = (revision: number, ok = true) => ({
  title: 'Konto einrichten (neu)',
  description: 'Name, Foto und Passwort',
  content: 'Öffne **Einstellungen** und dann **Konto**.',
  contentJson: {
    type: 'doc' as const,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'neu' }] }],
  },
  sourceRevision: revision,
  sourceText: { title: 'Set up your account', description: 'x', content: 'y' },
  check: ok
    ? { ok: true, problems: [] }
    : { ok: false, problems: [{ code: 'link_missing' as const, detail: '/settings' }] },
})

describe.skipIf(!fixture.available)('translation versions', () => {
  beforeEach(async () => {
    await fixture.begin()
    author = createId('principal') as PrincipalId
    await testDb.insert(principal).values({ id: author, createdAt: new Date() })
    categoryId = await seedCategory()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('the text revision', () => {
    it('goes up when the title, description or body changes', async () => {
      const id = await seedArticle()
      expect(await revisionOf(id)).toBe(1)
      await updateArticle(id, { title: 'Set up your profile' })
      expect(await revisionOf(id)).toBe(2)
      await updateArticle(id, { description: 'Name, photo and password' })
      expect(await revisionOf(id)).toBe(3)
      await updateArticle(id, { content: 'Open **Settings**, then **Account**.' })
      expect(await revisionOf(id)).toBe(4)
    })

    it('stays when a save sends the same text, or changes only the collection or audience', async () => {
      const id = await seedArticle()
      const other = await seedCategory()
      // What the editor sends on every save: all fields, text unchanged.
      await updateArticle(id, {
        title: 'Set up your account',
        description: 'Name and photo',
        content: 'Open **Settings**.',
        categoryId: other,
        segmentIds: [],
      })
      expect(await revisionOf(id)).toBe(1)
    })
  })

  describe('needs update', () => {
    it('records the revision and text a new translation is made from', async () => {
      const id = await seedArticle()
      await updateArticle(id, { title: 'Set up your profile' })
      await upsertArticleTranslation({ ...germanText, articleId: id })
      expect(await translationOf(id, 'de')).toMatchObject({
        sourceRevision: 2,
        sourceText: {
          title: 'Set up your profile',
          description: 'Name and photo',
          content: 'Open **Settings**.',
        },
      })
    })

    it('shows when the article text changed after the translation, and not after a move', async () => {
      const id = await seedArticle()
      await upsertArticleTranslation({ ...germanText, articleId: id })
      await updateArticle(id, { categoryId: await seedCategory() })
      let [de, fr] = await getArticleTranslationOverview(id, ['de', 'fr'])
      expect(de).toMatchObject({ status: 'draft', needsUpdate: false, pendingUpdate: null })
      expect(fr).toMatchObject({ status: 'untranslated', needsUpdate: false })

      await updateArticle(id, { content: 'Open **Settings**, then **Account**.' })
      ;[de] = await getArticleTranslationOverview(id, ['de'])
      expect(de.needsUpdate).toBe(true)
    })

    it('keeps the revision a translation was made from when a person edits it', async () => {
      const id = await seedArticle()
      await upsertArticleTranslation({ ...germanText, articleId: id })
      await updateArticle(id, { title: 'Set up your profile' })
      await upsertArticleTranslation({ ...germanText, articleId: id, title: 'Profil einrichten' })
      expect((await translationOf(id, 'de')).sourceRevision).toBe(1)
    })

    it('mark as up to date makes it current with the text as it is now, and drops a waiting update', async () => {
      const id = await seedArticle()
      await upsertArticleTranslation({ ...germanText, articleId: id })
      await updateArticle(id, { title: 'Set up your profile' })
      await writePendingTranslationUpdate(id, 'de', update(2))

      await markArticleTranslationCurrent(id, 'de')

      const row = await translationOf(id, 'de')
      expect(row).toMatchObject({
        title: 'Konto einrichten',
        sourceRevision: 2,
        pendingTitle: null,
        pendingSourceRevision: null,
        checkResult: null,
      })
      expect(row.sourceText?.title).toBe('Set up your profile')
      const [de] = await getArticleTranslationOverview(id, ['de'])
      expect(de.needsUpdate).toBe(false)
    })

    it('shows what changed in the article since the translation was made', async () => {
      const id = await seedArticle()
      await upsertArticleTranslation({ ...germanText, articleId: id })
      await updateArticle(id, { content: 'Open **Settings**, then **Account**.' })
      const changes = await getArticleTranslationChanges(id, 'de')
      expect(changes.source.before?.content).toBe('Open **Settings**.')
      expect(changes.source.after.content).toBe('Open **Settings**, then **Account**.')
      expect(changes.update).toBeNull()
    })
  })

  describe('a waiting AI update', () => {
    it('is stored beside the live text, which stays exactly as it was', async () => {
      const id = await seedArticle()
      await upsertArticleTranslation({ ...germanText, articleId: id })
      await testDb
        .update(helpCenterArticleTranslations)
        .set({ status: 'published' })
        .where(eq(helpCenterArticleTranslations.articleId, id))
      await updateArticle(id, { title: 'Set up your profile' })
      const before = await translationOf(id, 'de')

      expect(await writePendingTranslationUpdate(id, 'de', update(2))).toBe(true)

      const after = await translationOf(id, 'de')
      for (const key of [
        'title',
        'description',
        'content',
        'contentJson',
        'status',
        'sourceRevision',
        'updatedAt',
      ] as const) {
        expect(after[key]).toEqual(before[key])
      }
      expect(after).toMatchObject({
        pendingTitle: 'Konto einrichten (neu)',
        pendingSourceRevision: 2,
        checkResult: { ok: true },
      })
      const [de] = await getArticleTranslationOverview(id, ['de'])
      expect(de.pendingUpdate).toMatchObject({ sourceRevision: 2, current: true })
      const changes = await getArticleTranslationChanges(id, 'de')
      expect(changes.update?.live.title).toBe('Konto einrichten')
      expect(changes.update?.pending.title).toBe('Konto einrichten (neu)')
    })

    it('is not written for a translation already current with that revision', async () => {
      const id = await seedArticle()
      await upsertArticleTranslation({ ...germanText, articleId: id })
      expect(await writePendingTranslationUpdate(id, 'de', update(1))).toBe(false)
      expect(await writePendingTranslationUpdate(id, 'fr', update(2))).toBe(false)
      expect((await translationOf(id, 'de')).pendingTitle).toBeNull()
    })

    it('publishing makes it the live text and the translation current, keeping its publish state', async () => {
      const id = await seedArticle()
      await upsertArticleTranslation({ ...germanText, articleId: id })
      await testDb
        .update(helpCenterArticleTranslations)
        .set({ status: 'published' })
        .where(eq(helpCenterArticleTranslations.articleId, id))
      await updateArticle(id, { title: 'Set up your profile' })
      await writePendingTranslationUpdate(id, 'de', update(2))

      await publishPendingTranslationUpdate(id, 'de')

      const row = await translationOf(id, 'de')
      expect(row).toMatchObject({
        title: 'Konto einrichten (neu)',
        description: 'Name, Foto und Passwort',
        content: 'Öffne **Einstellungen** und dann **Konto**.',
        status: 'published',
        sourceRevision: 2,
        sourceText: { title: 'Set up your account' },
        pendingTitle: null,
        checkResult: null,
      })
      const [de] = await getArticleTranslationOverview(id, ['de'])
      expect(de).toMatchObject({ needsUpdate: false, pendingUpdate: null })
    })

    it('an update that failed its checks cannot be published, only discarded', async () => {
      const id = await seedArticle()
      await upsertArticleTranslation({ ...germanText, articleId: id })
      await updateArticle(id, { title: 'Set up your profile' })
      await writePendingTranslationUpdate(id, 'de', update(2, false))

      await expect(publishPendingTranslationUpdate(id, 'de')).rejects.toMatchObject({
        code: 'TRANSLATION_UPDATE_NEEDS_PERSON',
      })
      expect((await translationOf(id, 'de')).title).toBe('Konto einrichten')

      await discardPendingTranslationUpdate(id, 'de')
      const row = await translationOf(id, 'de')
      // The version it was made from stays as the discard marker.
      expect(row).toMatchObject({
        title: 'Konto einrichten',
        pendingTitle: null,
        pendingContent: null,
        pendingSourceRevision: 2,
        checkResult: null,
      })
      const [de] = await getArticleTranslationOverview(id, ['de'])
      expect(de).toMatchObject({ needsUpdate: true, pendingUpdate: null })
    })

    it('a person editing the live text keeps the waiting update and its checks', async () => {
      const id = await seedArticle()
      await upsertArticleTranslation({ ...germanText, articleId: id })
      await updateArticle(id, { title: 'Set up your profile' })
      await writePendingTranslationUpdate(id, 'de', update(2))
      await upsertArticleTranslation({ ...germanText, articleId: id, title: 'Profil' })
      expect(await translationOf(id, 'de')).toMatchObject({
        title: 'Profil',
        pendingTitle: 'Konto einrichten (neu)',
        checkResult: { ok: true },
      })
    })

    it('publishing or discarding with nothing waiting says so', async () => {
      const id = await seedArticle()
      await upsertArticleTranslation({ ...germanText, articleId: id })
      await expect(publishPendingTranslationUpdate(id, 'de')).rejects.toMatchObject({
        code: 'TRANSLATION_UPDATE_NOT_FOUND',
      })
      await expect(discardPendingTranslationUpdate(id, 'de')).rejects.toMatchObject({
        code: 'TRANSLATION_UPDATE_NOT_FOUND',
      })
    })
  })
})
