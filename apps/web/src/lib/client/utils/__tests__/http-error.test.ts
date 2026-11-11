import { describe, expect, it } from 'vitest'
import { GENERIC_ERROR, extractHttpErrorMessage } from '../http-error'

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('extractHttpErrorMessage', () => {
  it('reads the message the server wrote for a refusal', async () => {
    expect(
      await extractHttpErrorMessage(json({ error: { message: 'A question is required' } }, 400))
    ).toBe('A question is required')
    expect(
      await extractHttpErrorMessage(
        json({ error: 'tier_limit_exceeded', message: "You have used this month's AI budget" }, 402)
      )
    ).toBe("You have used this month's AI budget")
  })

  it('never shows the body of a 5xx', async () => {
    // The server's own unhandled-error envelope, and a proxy's.
    expect(
      await extractHttpErrorMessage(
        json({ status: 500, unhandled: true, message: 'HTTPError' }, 500)
      )
    ).toBe(GENERIC_ERROR)
    expect(await extractHttpErrorMessage(json({ message: 'upstream connect error' }, 502))).toBe(
      GENERIC_ERROR
    )
  })

  it('falls back for a body that is not JSON', async () => {
    expect(await extractHttpErrorMessage(new Response('<html>nope</html>', { status: 403 }))).toBe(
      GENERIC_ERROR
    )
  })
})
