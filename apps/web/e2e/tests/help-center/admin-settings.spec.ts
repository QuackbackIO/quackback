/**
 * Help center settings: redirect rules, homepage texts and header links.
 *
 * Journeys: HC-A-62, HC-A-63, HC-A-64, HC-A-66, HC-A-67.
 */
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { supportDb } from '../../support/db'
import { withSettings } from '../../support/isolated-settings'
import { callServerFn, personApi } from '../../support/server-fns'
import { waitForHydration } from '../../utils/helpers'
import { articlePath, hcApi, hcArticle, hcCategory } from '../../product/help-center'

const SETTINGS = '/admin/settings/help-center'

test(
  'HC-A-62 a redirect rule sends an old /hc path to a published article',
  { tag: '@core' },
  async ({ asPerson, marker, playwright, request }) => {
    const hc = await hcApi(playwright)
    const category = await hcCategory(hc, `Redirected ${marker}`)
    const article = await hcArticle(hc, {
      categoryId: category.id,
      title: `Redirect target ${marker}`,
      publish: true,
    })
    const admin = await asPerson('admin')
    await admin.goto(`${SETTINGS}?tab=domains-languages`)
    const pathInput = admin.getByRole('textbox', { name: 'Redirect path' })
    await waitForHydration(pathInput)
    const add = admin.getByRole('button', { name: 'Add rule' })
    // The path must start with / before Add rule is offered.
    await pathInput.fill(`hc/old/${marker}`)
    await expect(add).toBeDisabled()
    // Messy but valid: normalised to /hc/old/<marker>.
    await pathInput.fill(`/hc//old/${marker}/`)
    const card = admin.locator('div').filter({ has: pathInput }).last()
    await card.getByRole('combobox').last().click()
    await admin.getByRole('option', { name: article.title }).click()
    await add.click()
    const path = `/hc/old/${marker}`
    await expect(admin.getByText(path, { exact: true })).toBeVisible()
    await expect(admin.getByText(`→ article "${article.title}"`)).toBeVisible()

    // First hop: the rule (legacy article form); second hop: the canonical URL.
    const first = await request.get(path, { maxRedirects: 0 })
    expect(first.status()).toBe(301)
    const legacy = new URL(first.headers()['location'], 'http://x').pathname
    expect(legacy).toBe(`/hc/articles/${category.slug}/${article.slug}`)
    const second = await request.get(legacy, { maxRedirects: 0 })
    expect(second.status()).toBe(301)
    expect(new URL(second.headers()['location'], 'http://x').pathname).toBe(articlePath(article))
  }
)

test(
  'HC-A-63 redirect rules refuse a taken path and dead targets, and stop redirecting to a dead page',
  { tag: '@core' },
  async ({ marker, playwright, request }) => {
    const hc = await hcApi(playwright)
    const category = await hcCategory(hc, `Rules ${marker}`)
    const privateCat = await hcCategory(hc, `Private rules ${marker}`, { isPublic: false })
    const live = await hcArticle(hc, {
      categoryId: category.id,
      title: `Rule live ${marker}`,
      publish: true,
    })
    const draft = await hcArticle(hc, { categoryId: category.id, title: `Rule draft ${marker}` })
    const api = await personApi(playwright, 'admin')
    const create = (path: string, targetType: 'article' | 'category', targetId: string) =>
      callServerFn(api, 'createRedirectRuleFn', { path, targetType, targetId })

    const path = `/hc/rules/${marker}`
    const ok = await create(path, 'category', category.id)
    expect(ok.ok, ok.error).toBe(true)
    const taken = await create(`${path}/`, 'article', live.id)
    expect(taken.code).toBe('HC_REDIRECT_PATH_TAKEN')
    expect(taken.error).toContain('A redirect rule for')
    expect(taken.error).toContain(path)
    expect(taken.error).toContain('already exists')

    const unpublished = await create(`${path}-a`, 'article', draft.id)
    expect(unpublished.code).toBe('HC_REDIRECT_TARGET_NOT_PUBLISHED')
    expect(unpublished.error).toContain('Redirect target must be a published article')
    const hidden = await create(`${path}-b`, 'category', privateCat.id)
    expect(hidden.code).toBe('HC_REDIRECT_TARGET_NOT_PUBLISHED')
    expect(hidden.error).toContain('Redirect target must be a public category')
    const missing = await create(`${path}-c`, 'article', generateId('article'))
    expect(missing.code).toBe('HC_REDIRECT_TARGET_NOT_FOUND')
    const rows = await supportDb()`SELECT path FROM hc_redirect_rules WHERE path LIKE ${`${path}%`}`
    expect(rows.map((r) => r.path)).toEqual([path])

    // The category rule redirects; once the category is private it is a 404,
    // and public again it redirects again with no re-entry.
    const articleRule = await create(`${path}-live`, 'article', live.id)
    expect(articleRule.ok, articleRule.error).toBe(true)
    expect((await request.get(path, { maxRedirects: 0 })).status()).toBe(301)
    expect(
      (
        await hc.patch(`/api/v1/help-center/categories/${category.id}`, {
          data: { isPublic: false },
        })
      ).status()
    ).toBe(200)
    expect((await request.get(path, { maxRedirects: 0 })).status()).toBe(404)
    expect(
      (
        await hc.patch(`/api/v1/help-center/categories/${category.id}`, {
          data: { isPublic: true },
        })
      ).status()
    ).toBe(200)
    expect((await request.get(path, { maxRedirects: 0 })).status()).toBe(301)

    // Same for an article rule when its target is unpublished.
    expect((await request.get(`${path}-live`, { maxRedirects: 0 })).status()).toBe(301)
    await hc.patch(`/api/v1/help-center/articles/${live.id}`, { data: { publishedAt: null } })
    expect((await request.get(`${path}-live`, { maxRedirects: 0 })).status()).toBe(404)
  }
)

test(
  'HC-A-64 deleting a redirect rule asks first and the path stops redirecting',
  { tag: '@nightly' },
  async ({ asPerson, marker, playwright, request }) => {
    const hc = await hcApi(playwright)
    const category = await hcCategory(hc, `Rule delete ${marker}`)
    await hcArticle(hc, { categoryId: category.id, title: `In ${marker}`, publish: true })
    const api = await personApi(playwright, 'admin')
    const path = `/hc/gone/${marker}`
    const made = await callServerFn(api, 'createRedirectRuleFn', {
      path,
      targetType: 'category',
      targetId: category.id,
    })
    expect(made.ok, made.error).toBe(true)
    expect((await request.get(path, { maxRedirects: 0 })).status()).toBe(301)

    const admin = await asPerson('admin')
    await admin.goto(`${SETTINGS}?tab=domains-languages`)
    const row = admin.getByRole('listitem').filter({ hasText: path })
    const del = row.getByRole('button', { name: 'Delete redirect rule' })
    await waitForHydration(del)
    await del.click()
    const confirm = admin.getByRole('alertdialog')
    await expect(confirm).toContainText('Visitors to the old path will get a not found page')
    await confirm.getByRole('button', { name: 'Delete redirect rule' }).click()
    await expect(row).toBeHidden()
    expect((await request.get(path, { maxRedirects: 0 })).status()).toBe(404)
  }
)

test.describe('workspace-wide help center texts', { tag: '@isolated' }, () => {
  test.beforeEach(() => {
    test.skip(!ISOLATED, ISOLATED_SKIP)
  })

  test(
    'HC-A-66 the homepage title and description show on the landing page',
    { tag: '@core' },
    async ({ asPerson, marker, request }) => {
      await withSettings({ help_center_config: {} }, async () => {
        const admin = await asPerson('admin')
        await admin.goto(SETTINGS)
        const title = admin.locator('#homepage-title')
        await waitForHydration(title)
        const description = admin.locator('#homepage-description')
        await title.fill(`Help for ${marker}`)
        await description.fill(`Answers about ${marker}`)
        await expect
          .poll(async () => {
            const [row] = await supportDb()`SELECT help_center_config FROM settings LIMIT 1`
            const cfg = JSON.parse(String(row.help_center_config)) as Record<string, unknown>
            return [cfg.homepageTitle, cfg.homepageDescription]
          })
          .toEqual([`Help for ${marker}`, `Answers about ${marker}`])

        const landing = await (await request.get('/hc', { headers: { cookie: 'e2e=1' } })).text()
        expect(landing).toContain(`Help for ${marker}`)
        expect(landing).toContain(`Answers about ${marker}`)
        expect(landing).toMatch(new RegExp(`<title>[^<]*Help for ${marker}`))

        // A cleared title is not saved; the old one stays after a reload.
        await title.fill('')
        await admin.waitForTimeout(1_500)
        await admin.reload()
        await expect(admin.locator('#homepage-title')).toHaveValue(`Help for ${marker}`)
      })
    }
  )

  test(
    'HC-A-67 a protocol-relative header link is refused',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'HC-B20: helpCenterHeaderLinkUrl accepts anything starting with "/", so //example.com is stored and portal-header.tsx renders it as an internal link',
      },
    },
    async ({ playwright, marker }) => {
      await withSettings({ help_center_config: {} }, async () => {
        const api = await personApi(playwright, 'admin')
        const good = await callServerFn(api, 'updateHelpCenterConfigFn', {
          headerLinks: [{ label: `Docs ${marker}`, url: '/docs' }],
        })
        expect(good.ok, good.error).toBe(true)
        const bad = await callServerFn(api, 'updateHelpCenterConfigFn', {
          headerLinks: [{ label: `Evil ${marker}`, url: '//example.com' }],
        })
        expect(bad.ok).toBe(false)
      })
    }
  )
})
