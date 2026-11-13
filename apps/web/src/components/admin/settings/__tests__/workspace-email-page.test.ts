import { describe, expect, it } from 'vitest'
import { senderSurfacesFor } from '../workspace-email-page'

describe('senderSurfacesFor', () => {
  it('gives a row to each product that is on, and none to one that is off', () => {
    expect(
      senderSurfacesFor({
        feedback: true,
        supportInbox: false,
        supportTickets: false,
        changelog: true,
        statusPage: false,
      } as never)
    ).toEqual(['feedback', 'changelog'])
  })

  it('counts Support on through tickets alone', () => {
    expect(senderSurfacesFor({ supportInbox: false, supportTickets: true } as never)).toContain(
      'support'
    )
  })
})
