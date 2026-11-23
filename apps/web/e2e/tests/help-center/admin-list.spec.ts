/**
 * Help center admin: the article list (status and category filters, search,
 * sort and paging).
 *
 * Journeys: HC-A-39, HC-A-40, HC-A-41.
 */
import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { waitForHydration } from '../../utils/helpers'
import { hcApi, hcArticle, hcCategory, searchWord } from '../../product/help-center'

/** The titles the list shows, in order. */
function listTitles(page: Page) {
  return page.locator('h3').allInnerTexts()
}

test(
  'HC-A-39 the status and category filters change the list and Clear all resets them',
  { tag: '@core' },
  async ({ asPerson, marker, playwright }) => {
    const hc = await hcApi(playwright)
    const category = await hcCategory(hc, `Filters ${marker}`)
    const draft = await hcArticle(hc, { categoryId: category.id, title: `Draft row ${marker}` })
    const live = await hcArticle(hc, {
      categoryId: category.id,
      title: `Live row ${marker}`,
      publish: true,
    })
    const admin = await asPerson('admin')
    await admin.goto(`/admin/help-center?category=${category.id}`)
    await expect(admin.getByText('2 articles', { exact: true })).toBeVisible()
    await expect(admin.getByRole('heading', { name: draft.title })).toBeVisible()
    await expect(admin.getByRole('heading', { name: live.title })).toBeVisible()
    // The category shows as a chip.
    await expect(
      admin.getByRole('button', { name: `Remove Category ${category.name} filter` })
    ).toBeVisible()

    const draftOption = admin.getByRole('option', { name: 'Draft', exact: true })
    await waitForHydration(draftOption)
    await draftOption.click()
    await expect(admin).toHaveURL(/status=draft/)
    await expect(admin.getByRole('heading', { name: live.title })).toBeHidden()
    await expect(admin.getByRole('heading', { name: draft.title })).toBeVisible()
    await expect(admin.getByText('1 article', { exact: true })).toBeVisible()

    await admin.getByRole('option', { name: 'Published', exact: true }).click()
    await expect(admin).toHaveURL(/status=published/)
    await expect(admin.getByRole('heading', { name: draft.title })).toBeHidden()
    await expect(admin.getByRole('heading', { name: live.title })).toBeVisible()

    // Removing the status chip keeps the category.
    await admin.getByRole('button', { name: 'Remove Status Published filter' }).click()
    await expect(admin).not.toHaveURL(/status=/)
    await expect(admin.getByRole('heading', { name: draft.title })).toBeVisible()

    await admin.getByRole('option', { name: 'Draft', exact: true }).click()
    await admin.getByRole('button', { name: 'Clear all' }).click()
    await expect(admin).not.toHaveURL(/status=|category=/)
  }
)

test(
  'HC-A-40 the admin search finds drafts and private articles by a title word',
  { tag: '@core' },
  async ({ asPerson, marker, playwright }) => {
    const hc = await hcApi(playwright)
    const word = searchWord()
    const hidden = await hcCategory(hc, `Private ${marker}`, { isPublic: false })
    const draft = await hcArticle(hc, { categoryId: hidden.id, title: `Find ${word} draft` })
    const other = await hcArticle(hc, { categoryId: hidden.id, title: `Other ${marker}` })
    const admin = await asPerson('admin')
    await admin.goto('/admin/help-center')

    const search = admin.getByPlaceholder('Search articles…')
    await waitForHydration(search)
    await search.fill(word)
    await expect(admin).toHaveURL(new RegExp(`search=${word}`))
    await expect(admin.getByRole('heading', { name: draft.title })).toBeVisible()
    await expect(admin.getByRole('heading', { name: other.title })).toBeHidden()
    expect(await listTitles(admin)).toEqual([draft.title])

    await search.fill(searchWord())
    await expect(admin.getByText('No articles match your search')).toBeVisible()
  }
)

test(
  'HC-A-41 a category with more than a page loads the rest, and Oldest sorts by creation',
  { tag: '@core' },
  async ({ asPerson, marker, playwright }) => {
    test.setTimeout(60_000)
    const hc = await hcApi(playwright)
    const category = await hcCategory(hc, `Paging ${marker}`)
    const titles: string[] = []
    for (let i = 1; i <= 23; i++) {
      const title = `Page item ${String(i).padStart(2, '0')} ${marker}`
      await hcArticle(hc, { categoryId: category.id, title })
      titles.push(title)
    }
    const admin = await asPerson('admin')
    await admin.goto(`/admin/help-center?category=${category.id}`)
    // Newest first, 20 to a page, with a plus while more exist.
    await expect(admin.getByText('20+ articles', { exact: true })).toBeVisible()
    expect((await listTitles(admin))[0]).toBe(titles[22])

    const more = admin.getByRole('button', { name: 'Load more articles' })
    await more.scrollIntoViewIfNeeded()
    await expect(admin.getByText('23 articles', { exact: true })).toBeVisible({ timeout: 15_000 })
    expect(new Set(await listTitles(admin))).toEqual(new Set(titles))

    await admin.goto(`/admin/help-center?category=${category.id}&sort=oldest`)
    await expect(admin.getByText('20+ articles', { exact: true })).toBeVisible()
    expect((await listTitles(admin)).slice(0, 3)).toEqual(titles.slice(0, 3))
  }
)
