// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  rewriteFromSectionHome,
  rewriteToSectionHome,
  sectionHomeFromDocument,
} from '../section-home-rewrite'

describe('rewriteToSectionHome', () => {
  it("shows the section's home in place of /, keeping the query", () => {
    const url = rewriteToSectionHome(new URL('https://help.acme.com/?q=refunds'), '/hc')
    expect(url?.href).toBe('https://help.acme.com/hc?q=refunds')
  })

  it('leaves every other path alone', () => {
    expect(rewriteToSectionHome(new URL('https://help.acme.com/hc/articles/x'), '/hc')).toBe(
      undefined
    )
    expect(rewriteToSectionHome(new URL('https://help.acme.com/b/bugs'), '/hc')).toBe(undefined)
  })

  it('leaves / alone off a section host', () => {
    expect(rewriteToSectionHome(new URL('https://acme.example.com/'), null)).toBe(undefined)
  })

  it('does not change the URL it was given', () => {
    const url = new URL('https://help.acme.com/')
    rewriteToSectionHome(url, '/hc')
    expect(url.pathname).toBe('/')
  })
})

describe('rewriteFromSectionHome', () => {
  it("writes the section's home as /, so links and the server's canonical check agree", () => {
    expect(rewriteFromSectionHome(new URL('https://help.acme.com/hc?q=1'), '/hc')?.href).toBe(
      'https://help.acme.com/?q=1'
    )
  })

  it('keeps deeper paths and every path off a section host', () => {
    expect(rewriteFromSectionHome(new URL('https://help.acme.com/hc/articles/x'), '/hc')).toBe(
      undefined
    )
    expect(rewriteFromSectionHome(new URL('https://acme.example.com/hc'), null)).toBe(undefined)
  })
})

describe('sectionHomeFromDocument', () => {
  it('reads the home the server marked the document with', () => {
    document.documentElement.setAttribute('data-section-home', '/status')
    expect(sectionHomeFromDocument(document)).toBe('/status')
  })

  it('is null on a document that has no mark', () => {
    document.documentElement.removeAttribute('data-section-home')
    expect(sectionHomeFromDocument(document)).toBeNull()
  })

  it('ignores a mark that is not a site path', () => {
    document.documentElement.setAttribute('data-section-home', 'https://evil.example.com/')
    expect(sectionHomeFromDocument(document)).toBeNull()
    document.documentElement.setAttribute('data-section-home', '//evil.example.com')
    expect(sectionHomeFromDocument(document)).toBeNull()
    document.documentElement.removeAttribute('data-section-home')
  })
})
