/**
 * The help center landing page's tab title. Settings store the English default
 * title until an admin edits it, so the tab words a default in the page's
 * language, as the hero does, and keeps an admin's own title as written.
 */
import { describe, expect, it } from 'vitest'

const { Route } = await import('../_portal/hc/index')

type Head = (ctx: {
  loaderData: Record<string, unknown>
  matches: Array<{ routeId: string; loaderData?: unknown }>
}) => { meta?: Array<Record<string, string>> }
const head = (Route as unknown as { options: { head: Head } }).options.head

const polish = {
  routeId: '/_portal/hc',
  loaderData: { messages: { 'portal.hc.home.title': 'Jak możemy Ci pomóc?' } },
}

function tabTitle(homepageTitle: string | undefined) {
  const { meta } = head({
    loaderData: { helpCenterConfig: { homepageTitle }, workspaceName: 'Acme', logoUrl: null },
    matches: [polish],
  })
  return meta?.find((m) => 'title' in m)?.title
}

describe('help center landing tab title', () => {
  it('words the default title in the page language', () => {
    expect(tabTitle(undefined)).toBe('Jak możemy Ci pomóc? - Acme')
    expect(tabTitle('How can we help?')).toBe('Jak możemy Ci pomóc? - Acme')
  })

  it("keeps an admin's own title", () => {
    expect(tabTitle('Acme support')).toBe('Acme support - Acme')
  })
})
