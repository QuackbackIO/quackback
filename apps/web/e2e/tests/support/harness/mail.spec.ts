/**
 * Self-test: mail the app sends reaches Mailpit, the helpers find it by its
 * recipient only, and email_log agrees (the second oracle).
 */
import { test, expect } from '../../../support/fixtures'
import {
  emailLogFor,
  linksIn,
  mailTo,
  waitForMail,
  waitForEmailLog,
} from '../../../support/mailpit'
import { clearSigninRateLimit, enableMagicLinkMethod } from '../../../utils/db-helpers'

test.describe('outbound mail', { tag: '@smoke' }, () => {
  test('a sign-in link lands in Mailpit and in email_log, for that address only', async ({
    request,
    baseURL,
    customerEmail,
    marker,
  }) => {
    enableMagicLinkMethod()
    clearSigninRateLimit()
    const otherAddress = `${marker}-other@customers.example`
    expect(await mailTo(otherAddress)).toEqual([])

    const res = await request.post('/api/auth/portal-signin', {
      data: { email: customerEmail, callbackURL: '/' },
      headers: { origin: baseURL! },
    })
    expect(res.status(), await res.text()).toBe(200)

    const mail = await waitForMail({ to: customerEmail })
    expect(mail.To.map((t) => t.Address)).toEqual([customerEmail])
    expect(mail.Subject).toMatch(/^\d{6} is your code for Acme Corp$/)
    const verify = linksIn(mail).find((href) => href.includes('/verify-magic-link?token='))
    expect(verify, 'the mail carries the sign-in link').toBeTruthy()
    expect(new URL(verify!).origin).toBe(new URL(baseURL!).origin)

    const row = await waitForEmailLog(customerEmail, { direction: 'outbound' })
    expect(row.status).toBe('sent')
    expect(row.provider).toBe('smtp')

    // Nothing went to an address the test did not use.
    expect(await mailTo(otherAddress)).toEqual([])
    expect(await emailLogFor(otherAddress)).toEqual([])
  })
})
