import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseWebsiteInput } from '../website-branding'

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Some browsers keep a space or a quote in a host instead of refusing it
 * (`https://not a website` parses, with the host `not%20a%20website`). The
 * check must give the same answer there as on the server.
 */
function lenientBrowserUrl() {
  const Strict = URL
  class Lenient extends Strict {
    constructor(input: string) {
      const host = /^(https?:\/\/)([^/?#]*)(.*)$/i.exec(input)
      super(host ? `${host[1]}${host[2]!.replace(/[ "]/g, 'x')}${host[3]}` : input)
      if (host && /[ "]/.test(host[2]!)) this.#host = host[2]!.replace(/ /g, '%20')
    }
    #host: string | null = null
    override get hostname() {
      return this.#host ?? super.hostname
    }
  }
  vi.stubGlobal('URL', Lenient)
}

describe('parseWebsiteInput', () => {
  it('reads a domain or an address', () => {
    expect(parseWebsiteInput(' acme.com ')?.hostname).toBe('acme.com')
    expect(parseWebsiteInput('https://www.acme.com/about')?.hostname).toBe('www.acme.com')
    expect(parseWebsiteInput('bücher.example')?.hostname).toBe('xn--bcher-kva.example')
    expect(parseWebsiteInput('my_shop.example.com')?.hostname).toBe('my_shop.example.com')
  })

  it('refuses what is not a website', () => {
    for (const value of ['', '   ', 'not a website', 'acme .com', 'ftp://acme.com', 'http://'])
      expect(parseWebsiteInput(value), value).toBeNull()
  })

  it('refuses a host with a space or a quote in a browser that would let it through', () => {
    lenientBrowserUrl()
    expect(parseWebsiteInput('acme.com')?.hostname).toBe('acme.com')
    for (const value of ['not a website', 'acme .com', 'https://ac"me.com'])
      expect(parseWebsiteInput(value), value).toBeNull()
  })
})
