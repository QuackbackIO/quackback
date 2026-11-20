/**
 * The client-safe half of signing in across section hosts: which return paths
 * a handoff accepts, and the addresses that start one.
 */
import { describe, expect, it } from 'vitest'
import {
  SECTION_HANDOFF_PATH,
  SECTION_SIGN_IN_PATH,
  crossHostHref,
  safeHandoffReturnTo,
  sectionHandoffUrl,
  sectionSignInUrl,
} from '../section-handoff'

describe('safeHandoffReturnTo', () => {
  it.each([
    '/',
    '/hc',
    '/hc/articles/getting-started',
    '/b/ideas/posts/post_1?sort=new#comments',
    '/hc/search?q=a%20b',
    '/x?next=https%3A%2F%2Fexample.com',
    '/auth/auth-complete',
  ])('keeps the same-origin path %s', (path) => {
    expect(safeHandoffReturnTo(path)).toBe(path)
  })

  it.each([
    ['protocol-relative', '//evil.example'],
    ['backslash', '/\\evil.example'],
    ['leading backslash', '\\\\evil.example'],
    ['absolute https', 'https://evil.example/'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,hi'],
    ['relative without slash', 'hc/articles'],
    ['encoded slashes', '/%2F%2Fevil.example'],
    ['lower-case encoded slashes', '/%2f%2fevil.example'],
    ['encoded backslash', '/%5Cevil.example'],
    ['double-encoded slashes', '/%252F%252Fevil.example'],
    ['tab smuggling', '/\t/evil.example'],
    ['encoded tab', '/%09/evil.example'],
    ['newline', '/\n/evil.example'],
    ['malformed escape', '/%E0%A4%A'],
    ['empty', ''],
    ['not a string', 42],
    ['the handoff itself', `${SECTION_HANDOFF_PATH}?from=acme.com&returnTo=/`],
    ['an over-long path', `/${'a'.repeat(2100)}`],
  ])('refuses %s', (_label, value) => {
    expect(safeHandoffReturnTo(value)).toBeNull()
  })
})

describe('sectionHandoffUrl', () => {
  it('starts the handoff on the target host, naming the host the viewer is signed in on', () => {
    const url = new URL(
      sectionHandoffUrl({
        targetOrigin: 'https://help.acme.com',
        fromHost: 'acme.com',
        returnTo: '/hc/articles/x?ref=nav',
      })
    )
    expect(url.origin).toBe('https://help.acme.com')
    expect(url.pathname).toBe(SECTION_HANDOFF_PATH)
    expect(url.searchParams.get('from')).toBe('acme.com')
    expect(url.searchParams.get('returnTo')).toBe('/hc/articles/x?ref=nav')
  })

  it('sends an unsafe return path to the home page', () => {
    const url = new URL(
      sectionHandoffUrl({
        targetOrigin: 'https://help.acme.com',
        fromHost: 'acme.com',
        returnTo: '//evil.example',
      })
    )
    expect(url.searchParams.get('returnTo')).toBe('/')
  })
})

describe('crossHostHref', () => {
  const links = {
    origins: {
      primary: 'https://acme.com',
      feedback: 'https://acme.com',
      roadmap: 'https://acme.com',
      changelog: 'https://acme.com',
      help: 'https://help.acme.com',
      support: 'https://acme.com',
      status: 'https://acme.com',
    },
    hostOrigin: 'https://acme.com',
  }

  it('is a plain link for a signed-out viewer', () => {
    expect(crossHostHref('https://help.acme.com/', { links, signedIn: false })).toBe(
      'https://help.acme.com/'
    )
  })

  it('goes through the handoff for a signed-in viewer, keeping the path and query', () => {
    const href = new URL(
      crossHostHref('https://help.acme.com/hc/articles/x?y=1', { links, signedIn: true })
    )
    expect(href.origin).toBe('https://help.acme.com')
    expect(href.pathname).toBe(SECTION_HANDOFF_PATH)
    expect(href.searchParams.get('from')).toBe('acme.com')
    expect(href.searchParams.get('returnTo')).toBe('/hc/articles/x?y=1')
  })

  it('leaves a link on this page own host alone', () => {
    expect(crossHostHref('https://acme.com/roadmap', { links, signedIn: true })).toBe(
      'https://acme.com/roadmap'
    )
  })
})

describe('sectionSignInUrl', () => {
  it('starts provider sign-in on the primary domain and names the host to come back to', () => {
    const url = new URL(
      sectionSignInUrl({
        primaryOrigin: 'https://acme.com',
        hereHost: 'help.acme.com',
        provider: 'github',
        returnTo: '/hc',
        errorReturnTo: '/?auth=signin&callbackUrl=%2Fhc',
        loginHint: 'jo@example.com',
      })
    )
    expect(url.origin).toBe('https://acme.com')
    expect(url.pathname).toBe(SECTION_SIGN_IN_PATH)
    expect(url.searchParams.get('provider')).toBe('github')
    expect(url.searchParams.get('to')).toBe('help.acme.com')
    expect(url.searchParams.get('returnTo')).toBe('/hc')
    expect(url.searchParams.get('errorReturnTo')).toBe('/?auth=signin&callbackUrl=%2Fhc')
    expect(url.searchParams.get('loginHint')).toBe('jo@example.com')
  })

  it('drops unsafe return paths', () => {
    const url = new URL(
      sectionSignInUrl({
        primaryOrigin: 'https://acme.com',
        hereHost: 'help.acme.com',
        provider: 'github',
        returnTo: 'https://evil.example',
        errorReturnTo: '//evil.example',
      })
    )
    expect(url.searchParams.get('returnTo')).toBe('/')
    expect(url.searchParams.get('errorReturnTo')).toBe('/')
  })
})
