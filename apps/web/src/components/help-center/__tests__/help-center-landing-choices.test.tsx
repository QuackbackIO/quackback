// @vitest-environment happy-dom
/**
 * The help center's home as the design chooses it: topics as cards or a
 * list, popular articles on or off, and a standard or large search. On the
 * design engine its sections span the page under the title; outside it, it
 * is exactly what it was.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
} from '@tanstack/react-router'
import { HelpCenterLandingView } from '../help-center-landing-view'

const CATEGORIES = [
  {
    id: 'kb_category_1',
    urlId: 1,
    slug: 'billing',
    name: 'Billing',
    icon: null,
    description: 'Plans, invoices and payment.',
    articleCount: 4,
  },
  {
    id: 'kb_category_2',
    urlId: 2,
    slug: 'getting-started',
    name: 'Getting started',
    icon: null,
    description: null,
    articleCount: 1,
  },
]

const POPULAR = [
  {
    id: 'kb_article_1',
    urlId: 7,
    slug: 'change-plan',
    title: 'Change your plan',
    categorySlug: 'billing',
    categoryName: 'Billing',
  },
]

const v2 = (attributes: Record<string, string>) => ({
  engine: 'v2',
  attributes: { 'data-qb-page-titles': 'plain', ...attributes },
  titles: {},
  bandImage: null,
  feedback: { headline: null },
  home: { headline: null, blocks: [] },
})

async function mount(portalDesign: unknown) {
  const root = createRootRouteWithContext<object>()({
    beforeLoad: () => ({ settings: { portalDesign } as never }),
    component: () => (
      <main>
        <HelpCenterLandingView
          categories={CATEGORIES}
          popularArticles={POPULAR}
          helpCenterConfig={null}
          askAiEnabled={false}
        />
      </main>
    ),
  })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/hc'] }),
    context: {},
  })
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" onError={() => {}}>
        <RouterProvider router={router} />
      </IntlProvider>
    </QueryClientProvider>
  )
  await waitFor(() => expect(view.container.querySelector('main')).not.toBeNull())
  return view.container.querySelector('main')!
}

/** The markup with the designer's section markers left out, which only make a part pickable. */
const today = (node: Element) => node.innerHTML.replace(/ data-qb-section="[^"]*"/g, '')

afterEach(cleanup)

describe('the help center’s home without a choice', () => {
  it('spans the page and spaces its sections on the design engine', async () => {
    expect(today(await mount(v2({})))).toMatchSnapshot()
  })

  it('is exactly today’s outside it', async () => {
    expect(today(await mount({ engine: 'legacy' }))).toMatchSnapshot()
  })

  it('is the same as choosing today’s cards, popular articles and standard search', async () => {
    const before = today(await mount(v2({})))
    cleanup()
    const chosen = await mount(
      v2({
        'data-qb-help-topics': 'cards',
        'data-qb-help-popular': 'on',
        'data-qb-help-search': 'standard',
      })
    )
    expect(today(chosen)).toBe(before)
  })

  it('marks its topics and popular articles as sections the designer can pick', async () => {
    const page = await mount(v2({}))
    expect(page.querySelectorAll('[data-qb-section="topics"]')).toHaveLength(1)
    expect(page.querySelectorAll('[data-qb-section="popular"]')).toHaveLength(1)
  })
})

describe('the help center’s home on the design engine', () => {
  it('spans popular articles across the page, as wide as its topics', async () => {
    const page = await mount(v2({}))
    const popular = page.querySelector('[data-qb-section="popular"]')!
    const topics = page.querySelector('[data-qb-section="topics"]')!
    expect(popular.className).toContain('w-full')
    expect(popular.className).toContain('max-w-[var(--qb-page-max,72rem)]')
    expect(topics.className).toContain('w-full')
    expect(topics.className).toContain('max-w-[var(--qb-page-max,72rem)]')
  })

  it('leaves room between the search and the topics, as under every page title', async () => {
    const topics = (await mount(v2({}))).querySelector('[data-qb-section="topics"]')!
    expect(topics.className.split(' ')).toContain('pt-8')
    expect(topics.className.split(' ')).not.toContain('pt-2')
  })

  it('keeps today’s markup outside it', async () => {
    const page = await mount({ engine: 'legacy' })
    expect(page.querySelector('[data-qb-section="popular"]')!.className).toContain('max-w-6xl')
    expect(page.querySelector('[data-qb-section="topics"]')!.className.split(' ')).toContain('pt-2')
  })
})

describe('the help center’s choices', () => {
  it('lists the topics as rows on one card', async () => {
    const page = await mount(v2({ 'data-qb-help-topics': 'list' }))
    const topics = page.querySelector('[data-qb-section="topics"]')!
    expect(topics.querySelector('.grid')).toBeNull()
    expect(topics.className).toContain('w-full')
    const rows = topics.querySelectorAll('ul > li a')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.textContent).toContain('Billing')
    expect(rows[0]!.textContent).toContain('4 articles')
  })

  it('leaves popular articles off', async () => {
    const page = await mount(v2({ 'data-qb-help-popular': 'off' }))
    expect(page.textContent).not.toContain('Popular articles')
    expect(page.textContent).not.toContain('Change your plan')
  })

  it('draws a large search: taller, with larger words, given more room', async () => {
    const standard = await mount(v2({}))
    const standardInput = standard.querySelector('input[type=search]')!.className
    expect(standardInput).toContain('text-base')
    cleanup()
    const large = await mount(v2({ 'data-qb-help-search': 'large' }))
    expect(large.querySelector('input[type=search]')!.className).toContain('text-lg')
    expect(large.querySelector('[role=search]')!.parentElement!.className).toContain('max-w-3xl')
  })
})
