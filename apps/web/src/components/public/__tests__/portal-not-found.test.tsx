// @vitest-environment happy-dom
/**
 * Inside the portal's shell, a missing page or an error is a page of the
 * portal: the brand's icon or no image, never Quackback's duck, and a post
 * that is gone leads to its board and to a search of the posts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

const where = vi.hoisted(() => ({
  pathname: '/nope',
  matches: [] as Array<{ status: string; error?: unknown }>,
}))
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: where.pathname }, matches: where.matches }),
}))
vi.mock('../use-portal-paths', () => ({ useFeedbackPath: () => '/feedback' }))

const { DefaultErrorPage, NotFoundPage, PortalErrorContext } =
  await import('@/components/shared/error-page')
const { PortalNotFound } = await import('../portal-not-found')

function inPortal(children: ReactNode, icon: string | null = '/api/storage/logos/icon.png') {
  return render(
    <PortalErrorContext.Provider value={{ icon, NotFound: PortalNotFound }}>
      {children}
    </PortalErrorContext.Provider>
  )
}

const images = () => [...document.querySelectorAll('img')].map((img) => img.getAttribute('src'))

afterEach(() => {
  cleanup()
  where.pathname = '/nope'
  where.matches = []
})

describe('a missing page in the portal', () => {
  it('shows the brand icon, not the duck, and the way home', () => {
    inPortal(<NotFoundPage />)
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy()
    expect(images()).toEqual(['/api/storage/logos/icon.png'])
    expect(screen.getByRole('link', { name: 'Go home' }).getAttribute('href')).toBe('/')
    expect(screen.queryByRole('search')).toBeNull()
  })

  it('shows no image where the brand has no icon', () => {
    inPortal(<NotFoundPage />, null)
    expect(images()).toEqual([])
  })

  it('leads a missing post to its board and to a search of the posts', () => {
    where.pathname = '/b/bug%20reports/posts/post_123'
    where.matches = [{ status: 'notFound', error: { data: { board: 'bug reports' } } }]
    inPortal(<NotFoundPage />)
    expect(screen.getByRole('link', { name: 'Go to the board' }).getAttribute('href')).toBe(
      '/feedback?board=bug%20reports'
    )
    const search = screen.getByRole('search')
    expect(search.getAttribute('action')).toBe('/feedback')
    expect(screen.getByRole('searchbox', { name: 'Search posts' }).getAttribute('name')).toBe(
      'search'
    )
  })
})

describe('a missing post on a board that is not there', () => {
  it('offers no way to the board, only the search and the way home', () => {
    where.pathname = '/b/no-such-board/posts/post_123'
    where.matches = [{ status: 'notFound', error: { data: { board: null } } }]
    inPortal(<NotFoundPage />)
    expect(screen.queryByRole('link', { name: 'Go to the board' })).toBeNull()
    expect(screen.getByRole('search')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go home' })).toBeTruthy()
  })
})

describe('an error in the portal', () => {
  it('keeps the brand, not the duck', () => {
    inPortal(<DefaultErrorPage error={new Error('boom')} />)
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy()
    expect(images()).toEqual(['/api/storage/logos/icon.png'])
  })
})

describe('outside the portal', () => {
  it('still shows the plain page', () => {
    render(<NotFoundPage />)
    expect(images()).toEqual(['/logo.png'])
  })
})
