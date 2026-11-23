/**
 * Team sign-in and the session audiences: a teammate returns to the admin page
 * they opened; portal users, portal-scope sessions and widget sessions hold no
 * team authority.
 *
 * Journeys: PPL-AUTH-47, 48, 49, 50.
 */
import { callServerFn } from '../../support/server-fns'
import { supportDb } from '../../support/db'
import { mintCustomer, mintSessionToken } from '../../support/widget-portal'
import {
  PASSWORD,
  WORKSPACE,
  baseUrl,
  expect,
  portalUser,
  setPasswordByReset,
  test,
  visitorContext,
} from '../../product/auth'
import { mintSession } from '../../support/teammates'
import { fromUuid } from '@quackback/ids'

const NOT_TEAM =
  "This account doesn't have team access. Team membership is by invitation only. Please contact your administrator."

test(
  'PPL-AUTH-47 team sign-in returns to the admin page that was opened',
  { tag: '@core' },
  async ({ newTeammate, playwright, visitor, marker }) => {
    const mate = await newTeammate({ roleKey: 'admin' })
    await setPasswordByReset(playwright, mate.email)

    const page = await visitor()
    const destination = `/admin/users?search=${marker}`
    await page.goto(destination)
    // The page the teammate opened (with its own query) is carried as the callback.
    await expect(page).toHaveURL((url) => {
      const callback = url.searchParams.get('callbackUrl') ?? ''
      return url.pathname === '/' && callback.startsWith(destination)
    })
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(`Sign in to ${WORKSPACE} admin`)).toBeVisible()
    await dialog.locator('#inline-email').fill(mate.email)
    await dialog.getByRole('button', { name: /^Continue/ }).click()
    await dialog.locator('#inline-password').fill(PASSWORD)
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(
      (url) => url.pathname === '/admin/users' && url.searchParams.get('search') === marker,
      { timeout: 20_000 }
    )
    expect(new URL(page.url()).origin).toBe(baseUrl())
  }
)

test(
  'PPL-AUTH-48 a portal user cannot open the admin',
  { tag: '@core' },
  async ({ playwright, browser, customerEmail }) => {
    const person = await portalUser(playwright, customerEmail)
    const state = await mintSession(fromUuid('user', person.userId))
    const context = await visitorContext(browser, { storageState: state })
    const page = await context.newPage()
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/\?auth=signin&callbackUrl=%2Fadmin&error=not_team_member/)
    await expect(page.locator('[data-sonner-toast]').first()).toContainText(NOT_TEAM)

    const res = await callServerFn(page.request, 'updatePortalAccessFn', { visibility: 'private' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain("Requires permission 'settings.manage'")
    const [row] = await supportDb()`SELECT portal_config FROM settings LIMIT 1`
    expect(String(row.portal_config ?? '')).not.toContain('"visibility":"private"')
    await context.close()
  }
)

test(
  'PPL-AUTH-49 a teammate on a portal-scope session holds no team authority',
  { tag: '@core' },
  async ({ newTeammate, browser }) => {
    const mate = await newTeammate({ roleKey: 'admin' })
    const state = await mintSession(mate.userId)
    const token = decodeURIComponent(state.cookies[0].value).split('.')[0]
    await supportDb()`UPDATE session SET scope = 'portal' WHERE token = ${token}`

    const context = await visitorContext(browser, { storageState: state })
    const page = await context.newPage()
    await page.goto('/admin/feedback')
    await expect(page).toHaveURL(/error=not_team_member/)

    const res = await callServerFn(page.request, 'updatePortalAccessFn', { visibility: 'private' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('on a dashboard session')
    await context.close()
  }
)

test(
  'PPL-AUTH-50 a widget session cannot reach account endpoints or site server functions',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    const customer = await mintCustomer({ email: `${marker}@customers.example` })
    const token = await mintSessionToken(customer.userUuid)
    await supportDb()`UPDATE session SET scope = 'widget' WHERE token = ${token}`
    const api = await playwright.request.newContext({
      baseURL: baseUrl(),
      extraHTTPHeaders: { authorization: `Bearer ${token}`, origin: baseUrl() },
    })
    try {
      const update = await api.post('/api/auth/update-user', { data: { name: 'Renamed' } })
      expect(update.status()).toBe(403)
      expect(await update.text()).toContain('Widget sessions cannot access this endpoint')
      const [user] = await supportDb()`SELECT name FROM "user" WHERE id = ${customer.userUuid}`
      expect(user.name).not.toBe('Renamed')

      const session = await api.get('/api/auth/get-session')
      expect(session.status()).toBe(200)
      expect((await session.json())?.user?.email).toBe(customer.email)

      const fn = await callServerFn(api, 'fetchMyApiKeysFn', undefined, { method: 'GET' })
      expect(fn.ok).toBe(false)
      expect(fn.error).toContain('Widget sessions cannot access this resource')
    } finally {
      await api.dispose()
    }
  }
)
