// @vitest-environment happy-dom
/**
 * Where the server drew Home, Home's module starts loading as soon as the
 * page's scripts run, not when hydration reaches it: an update reaching Home
 * before it hydrated made React draw it again from nothing, and Home's blocks
 * vanished for seconds on a slow phone. The feed drawn at the root is the
 * same. Elsewhere nothing extra loads.
 */
import { createElement, Suspense, type ComponentType } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const hoisted = vi.hoisted(() => ({
  homeLoaded: 0,
  feedLoaded: 0,
  loaderData: { landing: 'home', messages: {}, gates: {} } as Record<string, unknown>,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useLoaderData: () => hoisted.loaderData,
  }),
  redirect: (options: object) => ({ redirect: options }),
  lazyRouteComponent: () =>
    Object.assign(() => null, {
      preload: async () => {
        hoisted.feedLoaded++
      },
    }),
}))
vi.mock('@/components/public/home/portal-home', () => {
  hoisted.homeLoaded++
  return {
    PortalHome: () => createElement('p', null, 'Home drawn'),
    loadHome: async () => ({}),
  }
})
vi.mock('@/components/public/feedback/feed-route', () => ({
  feedHead: () => ({}),
  feedSearchSchema: { extend: () => ({}) },
  hasFeedSearch: () => false,
  loadFeed: async () => ({}),
  portalPathsOf: () => ({}),
  preloadPageGraph: () => {},
}))

afterEach(() => {
  document.body.innerHTML = ''
  hoisted.homeLoaded = 0
  hoisted.feedLoaded = 0
  vi.resetModules()
})

/** Loads the route module, as the page's scripts do, and lets a started import land. */
async function loadRoute() {
  const route = await import('../index')
  await new Promise((resolve) => setTimeout(resolve, 0))
  return route.Route as unknown as { options: { component: ComponentType } }
}

describe('the portal root on the page the server drew', () => {
  it('starts loading Home’s module where the server drew Home', async () => {
    document.body.innerHTML = '<main><div data-qb-section="home" data-qb-grid=""></div></main>'
    await loadRoute()
    expect(hoisted.homeLoaded).toBe(1)
  })

  it('then draws Home at once, without waiting on its module, as hydration needs', async () => {
    document.body.innerHTML = '<main><div data-qb-section="home" data-qb-grid=""></div></main>'
    const { options } = await loadRoute()
    const host = document.createElement('div')
    const root = createRoot(host)
    // One synchronous render: a lazy component would show its fallback first.
    act(() =>
      root.render(
        createElement(Suspense, { fallback: 'waiting' }, createElement(options.component))
      )
    )
    expect(host.textContent).toBe('Home drawn')
    act(() => root.unmount())
  })

  it('starts loading the feed’s module where the server drew the feed', async () => {
    document.body.innerHTML = '<main><div data-qb-section="feed"></div></main>'
    await loadRoute()
    expect(hoisted.feedLoaded).toBe(1)
    expect(hoisted.homeLoaded).toBe(0)
  })

  it('loads nothing more on any other page', async () => {
    document.body.innerHTML = '<main><div data-qb-section="roadmap"></div></main>'
    await loadRoute()
    expect(hoisted.homeLoaded).toBe(0)
    expect(hoisted.feedLoaded).toBe(0)
  })

  it('looks for the marks Home’s grid carries', () => {
    const home = readFileSync(
      join(import.meta.dirname, '../../../components/public/home/portal-home.tsx'),
      'utf8'
    )
    expect(home).toContain('data-qb-section="home"')
    expect(home).toContain('data-qb-grid=""')
    const feed = readFileSync(
      join(import.meta.dirname, '../../../components/public/feedback/feedback-container.tsx'),
      'utf8'
    )
    expect(feed).toContain('data-qb-section="feed"')
  })
})
