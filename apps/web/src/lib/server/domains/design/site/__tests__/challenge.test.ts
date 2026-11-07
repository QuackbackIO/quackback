import { describe, expect, it } from 'vitest'
import { isBotChallenge } from '../challenge'

const page = (title: string, body: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`

const longArticle = Array.from(
  { length: 80 },
  (_, i) => `<p>Paragraph ${i} of a long article about parcel delivery and how forms work.</p>`
).join('')

describe('isBotChallenge', () => {
  it.each([
    ['Just a moment...', '<p>Please wait.</p>'],
    ['Attention Required! | Guard', '<p>Sorry.</p>'],
    ['Access Denied', '<p>You do not have permission.</p>'],
    [
      'Pardon Our Interruption',
      '<p>Something about your browser made us think you were a bot.</p>',
    ],
    ['Are you a robot?', '<p>Tick the box.</p>'],
  ])('flags a wall by its title: %s', (title, body) => {
    expect(isBotChallenge(page(title, body))).toBe(true)
  })

  it('flags wall markup even in a page with a normal title', () => {
    expect(isBotChallenge(page('Acme Parcel', '<div id="cf-challenge-running"></div>'))).toBe(true)
    expect(isBotChallenge(page('Acme Parcel', '<script src="/cdn/cf_chl_opt.js"></script>'))).toBe(
      true
    )
    expect(
      isBotChallenge(page('', '<p>Request unsuccessful. Incapsula incident ID: 123</p>'))
    ).toBe(true)
    expect(
      isBotChallenge(page('Nimbus Tea', '<p>Please enable JS and disable any ad blocker</p>'))
    ).toBe(true)
    expect(isBotChallenge(page('Oops', '<h1>Sorry, you have been blocked</h1>'))).toBe(true)
  })

  it('flags a short page that asks for a captcha or verification', () => {
    expect(isBotChallenge(page('Nimbus Tea', '<p>Complete the CAPTCHA to continue.</p>'))).toBe(
      true
    )
    expect(
      isBotChallenge(page('', '<p>Verify you are human by completing the action below.</p>'))
    ).toBe(true)
    expect(isBotChallenge(page('Acme', '<h1>Access denied</h1>'), 403)).toBe(true)
  })

  it('does not flag a long article that mentions a captcha', () => {
    const html = page(
      'Acme Parcel | Blog',
      `<h1>Why our forms no longer use a captcha</h1>${longArticle}`
    )
    expect(isBotChallenge(html)).toBe(false)
  })

  it('does not flag a normal homepage', () => {
    expect(isBotChallenge(page('Acme Parcel | Parcels, delivered', longArticle), 200)).toBe(false)
    expect(isBotChallenge('')).toBe(false)
  })
})

describe('pages that hold the site back', () => {
  it('reads a client challenge title as a wall', () => {
    expect(
      isBotChallenge('<html><head><title>Client Challenge</title></head><body></body></html>')
    ).toBe(true)
  })

  it('reads an accepted but empty page that only runs a script as a wall', () => {
    const page =
      '<html><head><title></title><script>fetch("/x")</script></head><body></body></html>'
    expect(isBotChallenge(page, 202)).toBe(true)
    expect(isBotChallenge(page, 200)).toBe(false)
  })
})
