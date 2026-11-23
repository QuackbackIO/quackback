/**
 * Plan & billing on an install without plan billing (the suite's workspace):
 * who may open the page, its flash messages, and the hosted billing endpoints'
 * refusals, which come before any call to the control plane.
 *
 * Journeys: INT-PL-17, INT-PL-18, INT-PL-19.
 *
 * The success paths (a hosted billing session, a trial, checkout) need the
 * control plane and are not covered here.
 */
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { supportEnv } from '../../support/env'
import { personApi } from '../../support/server-fns'

/** POST a browser form to a billing endpoint without following the redirect. */
async function postForm(
  api: APIRequestContext,
  path: string,
  form: Record<string, string>,
  origin = supportEnv().baseUrl
): Promise<{ status: number; location: string; body: string }> {
  const res = await api.post(path, { form, headers: { origin }, maxRedirects: 0 })
  return { status: res.status(), location: res.headers().location ?? '', body: await res.text() }
}

test(
  'INT-PL-17 Plan & billing is the billing managers’ page; flash messages show and dismiss',
  { tag: '@core' },
  async ({ asPerson, newTeammate, browser }) => {
    const owner = await newTeammate({ roleKey: 'owner', principalRole: 'admin' })
    const page = await owner.newPage(browser)
    await page.goto('/admin/settings/billing')
    await expect(
      page.getByText('Plan and billing are not enabled for this workspace.')
    ).toBeVisible({ timeout: 15_000 })

    await page.goto('/admin/settings/billing?billing_error=seats_below_usage')
    const flash = page.getByRole('alert').filter({ hasText: 'Couldn’t update billing' })
    await expect(flash).toContainText('Pick at least as many seats as people you already have.')
    await flash.getByRole('button', { name: 'Dismiss' }).click()
    await expect(flash).toHaveCount(0)
    await expect(page).toHaveURL(/\/admin\/settings\/billing$/)

    // An unknown code falls back to the generic copy.
    await page.goto('/admin/settings/billing?billing_error=something_else')
    await expect(page.getByRole('alert')).toContainText(
      'Billing is temporarily unavailable. Try again in a moment.'
    )

    // The shared admin role does not hold billing.manage: the page is refused.
    const admin = await asPerson('admin')
    await admin.goto('/admin/settings/billing')
    await expect(admin).not.toHaveURL(/\/admin\/settings\/billing/)
    await expect(admin).toHaveURL(/error=not_team_member/)
  }
)

test(
  'INT-PL-18 the billing session endpoint refuses before calling the control plane',
  { tag: '@core' },
  async ({ playwright, newTeammate }) => {
    const owner = await newTeammate({ roleKey: 'owner', principalRole: 'admin' })
    const ownerApi = await owner.api(playwright)
    const adminApi = await personApi(playwright, 'admin')
    const anon = await playwright.request.newContext({ baseURL: supportEnv().baseUrl })
    try {
      // A cross-origin post is refused outright.
      const foreign = await postForm(
        ownerApi,
        '/api/billing/session',
        { action: 'portal' },
        'https://evil.test'
      )
      expect(foreign.status).toBe(403)
      expect(JSON.parse(foreign.body)).toEqual({ error: 'invalid_origin' })

      // Every other failure is a 303 back to Plan & billing with a stable code.
      const errorAt = (code: string) => `/admin/settings/billing?billing_error=${code}`
      expect(await postForm(anon, '/api/billing/session', { action: 'portal' })).toMatchObject({
        status: 303,
        location: errorAt('unauthorized'),
      })
      expect(await postForm(adminApi, '/api/billing/session', { action: 'portal' })).toMatchObject({
        status: 303,
        location: errorAt('forbidden'),
      })
      for (const form of [
        { action: 'nope' },
        { action: 'checkout', planId: 'enterprise-galaxy', billingPeriod: 'monthly' },
        { action: 'checkout', planId: 'pro', billingPeriod: 'weekly' },
        { action: 'downgrade', planId: 'pro' },
      ]) {
        expect(
          await postForm(ownerApi, '/api/billing/session', form),
          JSON.stringify(form)
        ).toMatchObject({ status: 303, location: errorAt('invalid') })
      }
      // Valid, but this install has no plan billing.
      for (const form of [
        { action: 'portal' },
        { action: 'checkout', planId: 'pro', billingPeriod: 'annual' },
        { action: 'branding-remove' },
      ]) {
        expect(
          await postForm(ownerApi, '/api/billing/session', form),
          JSON.stringify(form)
        ).toMatchObject({ status: 303, location: errorAt('unavailable') })
      }
    } finally {
      await Promise.all([ownerApi.dispose(), adminApi.dispose(), anon.dispose()])
    }
  }
)

test(
  'INT-PL-19 starting a trial validates the plan and refuses without plan billing',
  { tag: '@core' },
  async ({ playwright, newTeammate }) => {
    const owner = await newTeammate({ roleKey: 'owner', principalRole: 'admin' })
    const ownerApi = await owner.api(playwright)
    const adminApi = await personApi(playwright, 'admin')
    try {
      const errorAt = (code: string) => `/admin/settings/billing?billing_error=${code}`
      const foreign = await postForm(
        ownerApi,
        '/api/billing/trial',
        { planId: 'pro' },
        'https://evil.test'
      )
      expect(foreign.status).toBe(403)
      expect(await postForm(adminApi, '/api/billing/trial', { planId: 'pro' })).toMatchObject({
        status: 303,
        location: errorAt('forbidden'),
      })
      expect(await postForm(ownerApi, '/api/billing/trial', { planId: 'free' })).toMatchObject({
        status: 303,
        location: errorAt('invalid'),
      })
      // A return path pointing off the workspace never becomes the redirect.
      expect(
        await postForm(ownerApi, '/api/billing/trial', {
          planId: 'pro',
          returnTo: 'https://evil.test',
        })
      ).toMatchObject({ status: 303, location: errorAt('unavailable') })
    } finally {
      await Promise.all([ownerApi.dispose(), adminApi.dispose()])
    }
  }
)
