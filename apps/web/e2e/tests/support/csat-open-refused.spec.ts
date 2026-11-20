/**
 * A customer rating (CSAT) rates a finished conversation: it is refused while
 * the conversation is open and accepted once it is closed. The emailed rating
 * link outlives the close, so a conversation reopened after the email went
 * out must turn the link's click into a plain "open again" page, not an error,
 * and the same link records once the conversation is closed again.
 */
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import { getMail, linksIn, mailTo } from '../../support/mailpit'
import { apiFor, createKey, emailConversation, expectJson, uuidOf } from '../../support/api-client'

async function csatOf(conversationId: string) {
  const [row] = await supportDb()`SELECT status, csat_rating FROM conversations
    WHERE id = ${uuidOf(conversationId)}`
  return row as { status: string; csat_rating: number | null }
}

test(
  'CSAT-R1 an emailed rating link is refused while the conversation is open again and records once it is closed',
  { tag: '@core' },
  async ({ page, playwright, baseURL, people, marker, customerEmail, request }) => {
    const { conversationId } = await emailConversation(request, customerEmail, marker)
    const { key } = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
    const api = await apiFor(playwright, baseURL, key)
    const setStatus = async (status: 'open' | 'closed') =>
      expectJson(
        await api.post(`/api/v1/conversations/${conversationId}/status`, { data: { status } }),
        200
      )
    try {
      await setStatus('closed')
      // The close email carries five face links to /csat?token=…&rating=N.
      const rateFour = await pollFor('the close email with rating links', async () => {
        for (const summary of await mailTo(customerEmail)) {
          const link = linksIn(await getMail(summary.ID)).find((l) =>
            /\/csat\?token=.*&rating=4$/.test(l)
          )
          if (link) return link
        }
        return null
      })

      // A teammate reopens the conversation before the customer gets to the email.
      await setStatus('open')
      await page.goto(rateFour)
      await expect(page.getByRole('heading', { name: 'How did we do?' })).toBeVisible()
      await page.getByRole('button', { name: 'Rate 4 of 5' }).click()
      await expect(
        page.getByRole('heading', { name: 'This conversation is open again' })
      ).toBeVisible()
      await expect(page.getByText('You can rate it once it has been resolved.')).toBeVisible()
      await expect(page.getByText('Something went wrong')).toHaveCount(0)
      expect(await csatOf(conversationId)).toEqual({ status: 'open', csat_rating: null })

      // Closed again: the same link now records the rating.
      await setStatus('closed')
      await page.goto(rateFour)
      await page.getByRole('button', { name: 'Rate 4 of 5' }).click()
      await expect(page.getByRole('heading', { name: 'Thanks for the feedback' })).toBeVisible()
      await expect
        .poll(async () => (await csatOf(conversationId)).csat_rating, { timeout: 10_000 })
        .toBe(4)
    } finally {
      await api.dispose()
    }
  }
)
