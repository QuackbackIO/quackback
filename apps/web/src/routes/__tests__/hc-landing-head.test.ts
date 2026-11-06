/**
 * The help center landing pages' tab titles. Settings store the English
 * default title until an admin edits it, so the tab words a default in the
 * page's language, as the hero does, and keeps an admin's own title as written.
 */
import { describe, expect, it } from 'vitest'
import { getRouteApi } from '@tanstack/react-router'

const { Route: Landing } = await import('../_portal/hc/index')
const { Route: LocaleLanding } = await import('../_portal/hc/$locale/index')

type Head = (ctx: {
  loaderData: Record<string, unknown>
  params?: Record<string, string>
  matches: Array<{ routeId: string; loaderData?: unknown; context?: unknown }>
}) => { meta?: Array<Record<string, string>>; links?: Array<Record<string, string>> }
const headOf = (route: unknown) => (route as { options: { head: Head } }).options.head

// The help center layout, whose loader reads its strings in the page's language.
const polishLayout = {
  routeId: getRouteApi('/_portal/hc').id,
  loaderData: { messages: { 'portal.hc.home.title': 'Jak możemy Ci pomóc?' } },
}

function tabTitle(meta: Array<Record<string, string>> | undefined) {
  return meta?.find((m) => 'title' in m)?.title
}

describe('help center landing tab title', () => {
  const landing = (homepageTitle: string | undefined) =>
    tabTitle(
      headOf(Landing)({
        loaderData: { helpCenterConfig: { homepageTitle }, workspaceName: 'Acme', logoUrl: null },
        matches: [polishLayout],
      }).meta
    )

  it('words the default title in the page language', () => {
    expect(landing(undefined)).toBe('Jak możemy Ci pomóc? - Acme')
    expect(landing('How can we help?')).toBe('Jak możemy Ci pomóc? - Acme')
  })

  it("keeps an admin's own title", () => {
    expect(landing('Acme support')).toBe('Acme support - Acme')
  })
})

describe('a language’s help center landing tab title', () => {
  const localeLanding = (title: string | null) =>
    tabTitle(
      headOf(LocaleLanding)({
        loaderData: { title, description: null, workspaceName: 'Acme', logoUrl: null },
        params: { locale: 'en' },
        matches: [polishLayout],
      }).meta
    )

  it('words the default title in the page language', () => {
    expect(localeLanding(null)).toBe('Jak możemy Ci pomóc? - Acme')
    expect(localeLanding('How can we help?')).toBe('Jak możemy Ci pomóc? - Acme')
  })

  it("keeps the language's own title", () => {
    expect(localeLanding('Centre d’aide Acme')).toBe('Centre d’aide Acme - Acme')
  })
})

describe('help center landing canonicals', () => {
  const portal = {
    routeId: '/_portal',
    loaderData: { workspaceName: 'Acme' },
    context: { baseUrl: 'https://feedback.example.com' },
  }

  it('canonicalises /hc to itself on the request base', () => {
    const { links } = headOf(Landing)({
      loaderData: { helpCenterConfig: null, workspaceName: 'Acme', logoUrl: null },
      matches: [polishLayout, portal],
    })
    expect(links).toContainEqual({ rel: 'canonical', href: 'https://feedback.example.com/hc' })
  })

  it('canonicalises the default locale landing to /hc', () => {
    const { links } = headOf(LocaleLanding)({
      loaderData: { title: null, description: null, workspaceName: 'Acme', logoUrl: null },
      params: { locale: 'en' },
      matches: [polishLayout, portal],
    })
    expect(links).toContainEqual({ rel: 'canonical', href: 'https://feedback.example.com/hc' })
  })

  it("canonicalises another locale's landing to its own prefixed path", () => {
    const { links } = headOf(LocaleLanding)({
      loaderData: { title: null, description: null, workspaceName: 'Acme', logoUrl: null },
      params: { locale: 'de' },
      matches: [polishLayout, portal],
    })
    expect(links).toContainEqual({
      rel: 'canonical',
      href: 'https://feedback.example.com/hc/de',
    })
  })

  it('emits no canonical on either landing when the request has no base URL', () => {
    const noBase = { routeId: '/_portal', loaderData: { workspaceName: 'Acme' }, context: {} }
    const home = headOf(Landing)({
      loaderData: { helpCenterConfig: null, workspaceName: 'Acme', logoUrl: null },
      matches: [polishLayout, noBase],
    })
    const locale = headOf(LocaleLanding)({
      loaderData: { title: null, description: null, workspaceName: 'Acme', logoUrl: null },
      params: { locale: 'en' },
      matches: [polishLayout, noBase],
    })
    expect(home.links).toEqual([])
    expect(locale.links).toEqual([])
  })
})
