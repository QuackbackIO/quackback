/**
 * The portal account pages (/settings/*): who may open them, renaming,
 * avatars, the email change refusals and the profile read.
 *
 * Journeys: PPL-ACC-02, PPL-ACC-04, PPL-ACC-07, PPL-ACC-14, PPL-ACC-18,
 * PPL-ACC-32
 */
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { mailTo } from '../../support/mailpit'
import { callServerFn, mustCall, portalUser, refusedCall } from '../../product/people-team'

/** Upload a tiny PNG as the signed-in person's avatar the way the profile form does. */
async function uploadAvatar(
  api: Parameters<typeof mustCall>[0],
  filename: string
): Promise<string> {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
  const presigned = await mustCall<{ uploadUrl: string; key: string }>(
    api,
    'getAvatarUploadUrlFn',
    { filename, contentType: 'image/png', fileSize: png.length }
  )
  const put = await api.put(presigned.uploadUrl, {
    headers: { 'content-type': 'image/png' },
    data: png,
  })
  expect(put.status(), await put.text()).toBeLessThan(300)
  await mustCall(api, 'saveAvatarKeyFn', { key: presigned.key })
  return presigned.key
}

test.describe('who may open the account pages', () => {
  test(
    'PPL-ACC-02 a signed-out visitor is sent to the portal home from every settings page',
    { tag: '@core' },
    async ({ page }) => {
      for (const path of [
        '/settings',
        '/settings/profile',
        '/settings/preferences',
        '/settings/api-keys',
      ]) {
        await page.goto(path)
        await expect(page, path).toHaveURL(/\/$/)
        await expect(page.getByRole('heading', { name: 'Profile' })).toHaveCount(0)
      }
    }
  )

  test(
    'PPL-ACC-04 a portal user is kept out of the API keys page and its functions',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const person = await portalUser(browser, marker)
      const page = await person.context.newPage()
      await page.goto('/settings/api-keys')
      await expect(page).toHaveURL(/\/settings\/profile/, { timeout: 15_000 })

      const list = await refusedCall(person.api, 'fetchMyApiKeysFn', undefined, { method: 'GET' })
      expect(list.error).toContain('Access denied: Not a team member')
      const create = await refusedCall(person.api, 'createMyApiKeyFn', {
        name: `Key ${marker}`,
        scopes: ['read:feedback'],
        expiry: '30d',
      })
      expect(create.code).toBe('FORBIDDEN')
      const keys =
        await supportDb()`SELECT id FROM api_keys WHERE created_by_id = ${person.principalUuid}`
      expect(keys).toHaveLength(0)
    }
  )
})

test.describe('profile', () => {
  test(
    'PPL-ACC-07 a portal user renames themselves',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const person = await portalUser(browser, marker)
      const page = await person.context.newPage()
      await page.goto('/settings/profile')
      const field = page.locator('#name')
      await expect(field).toHaveValue(person.name, { timeout: 15_000 })
      const renamed = `Renamed ${marker}`.slice(0, 90)
      await field.fill(`  ${renamed}  `)
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect(page.getByText('Profile updated')).toBeVisible()

      const [u] = await supportDb()`SELECT name FROM "user" WHERE id = ${person.userUuid}`
      const [p] =
        await supportDb()`SELECT display_name FROM principal WHERE id = ${person.principalUuid}`
      expect(u.name).toBe(renamed)
      expect(p.display_name).toBe(renamed)
      await page.reload()
      await expect(page.locator('#name')).toHaveValue(renamed, { timeout: 15_000 })
    }
  )

  test(
    "PPL-ACC-14 saving someone else's uploaded avatar key is refused",
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'saveAvatarKeyFn accepts any avatars/ key (functions/user.ts saveAvatarKeySchema); a later remove deletes the other person object; see QUARANTINE.md',
      },
    },
    async ({ browser, marker }) => {
      const owner = await portalUser(browser, `${marker}-b`)
      const key = await uploadAvatar(owner.api, `${marker}.png`)
      const other = await portalUser(browser, marker)

      const res = await callServerFn(other.api, 'saveAvatarKeyFn', { key })
      expect(res.ok, 'a key the caller did not upload is refused').toBe(false)
      const [u] = await supportDb()`SELECT image_key FROM "user" WHERE id = ${other.userUuid}`
      expect(u.image_key).toBeNull()
    }
  )

  test(
    'PPL-ACC-18 an email change needs a good current-address code and mails nobody otherwise',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const person = await portalUser(browser, marker)
      const next = `${marker}-new@customers.example`
      const none = await refusedCall(person.api, 'requestEmailChangeFn', { email: next })
      expect(none.code).toBe('CURRENT_CODE_REQUIRED')
      const wrong = await refusedCall(person.api, 'requestEmailChangeFn', {
        email: next,
        currentCode: '000000',
      })
      expect(wrong.code).toBe('INVALID_CODE')
      await new Promise((r) => setTimeout(r, 1_500))
      expect(await mailTo(next)).toHaveLength(0)
      const [u] = await supportDb()`SELECT email FROM "user" WHERE id = ${person.userUuid}`
      expect(u.email).toBe(person.email)
    }
  )

  test(
    "PPL-ACC-32 reading another person's profile is refused",
    { tag: '@core' },
    async ({ browser, marker }) => {
      const a = await portalUser(browser, marker)
      const b = await portalUser(browser, `${marker}-b`)
      const own = await callServerFn(a.api, 'fetchUserProfile', a.userId, { method: 'GET' })
      expect(own.ok, own.raw.slice(0, 300)).toBe(true)
      expect(own.raw).toContain('hasPassword')
      const res = await refusedCall(a.api, 'fetchUserProfile', b.userId, { method: 'GET' })
      expect(res.error).toContain("Access denied: Cannot view other users' profiles")
      expect(res.raw).not.toContain('hasPassword')
    }
  )
})
