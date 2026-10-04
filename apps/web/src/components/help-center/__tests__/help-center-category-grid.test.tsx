// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import de from '@/locales/de.json'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}))

import { HelpCenterCategoryGrid } from '../help-center-category-grid'

afterEach(cleanup)

const category = (articleCount: number) => ({
  id: 'kb_category_1',
  urlId: 1,
  slug: 'general',
  name: 'General',
  icon: null,
  description: null,
  articleCount,
})

it('speaks the visitor language when the help center has nothing to show', () => {
  render(
    <IntlProvider locale="de" messages={de}>
      <HelpCenterCategoryGrid categories={[]} />
    </IntlProvider>
  )
  expect(screen.getByText('Noch keine Artikel. Schau bald wieder vorbei.')).toBeInTheDocument()
})

it('counts articles with the plural rules of the language', () => {
  render(
    <IntlProvider locale="en">
      <HelpCenterCategoryGrid categories={[category(1), { ...category(3), id: 'kb_category_2' }]} />
    </IntlProvider>
  )
  expect(screen.getByText('1 article')).toBeInTheDocument()
  expect(screen.getByText('3 articles')).toBeInTheDocument()
})
