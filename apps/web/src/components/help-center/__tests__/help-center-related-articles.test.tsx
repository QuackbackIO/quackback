// @vitest-environment happy-dom
/**
 * A related article links to its page in the page's language, which exists
 * whether or not it is translated there. One with no version in the page's
 * language names the language its title is in.
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
  it("links every article to the page's language, naming the language of an untranslated one", () => {
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
    const untranslated = screen.getByRole('link', { name: /Router advanced/ })
    expect(untranslated.getAttribute('href')).toBe('/hc/fr/articles/2-advanced')
    expect(untranslated.textContent).toContain('English')
    expect(screen.getByText('Router advanced').getAttribute('lang')).toBe('en')
    expect(screen.getByRole('link', { name: /Guide du routeur/ }).textContent).not.toContain(
      'English'
    )
  })
})
