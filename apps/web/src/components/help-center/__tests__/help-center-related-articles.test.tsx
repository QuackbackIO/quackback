// @vitest-environment happy-dom
/**
 * A related article links to the language it was loaded in: the page's
 * language when it is translated there, else the main language page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => undefined,
}))

import { HelpCenterRelatedArticles } from '../help-center-related-articles'

afterEach(cleanup)

const base = { description: null, categorySlug: 'setup' }

describe('HelpCenterRelatedArticles', () => {
  it("links each article to the language it was loaded in, not the page's", () => {
    render(
      <IntlProvider locale="fr">
        <HelpCenterRelatedArticles
          locale="fr"
          articles={[
            { ...base, id: 'a', urlId: 1, slug: 'guide', title: 'Guide du routeur', locale: 'fr' },
            {
              ...base,
              id: 'b',
              urlId: 2,
              slug: 'advanced',
              title: 'Router advanced',
              locale: 'en',
            },
          ]}
        />
      </IntlProvider>
    )
    expect(screen.getByRole('link', { name: /Guide du routeur/ }).getAttribute('href')).toBe(
      '/hc/fr/articles/1-guide'
    )
    expect(screen.getByRole('link', { name: /Router advanced/ }).getAttribute('href')).toBe(
      '/hc/en/articles/2-advanced'
    )
  })
})
