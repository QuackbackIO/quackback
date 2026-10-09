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
  matches: Array<{ routeId: string; loaderData?: unknown }>
}) => { meta?: Array<Record<string, string>> }
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
