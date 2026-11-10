// @vitest-environment happy-dom
/**
 * Where the server drew Home, Home's module starts loading as soon as the
 * page's scripts run, not when hydration reaches it: an update reaching Home
 * before it hydrated made React draw it again from nothing, and Home's blocks
 * vanished for seconds on a slow phone. Elsewhere nothing extra loads.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const hoisted = vi.hoisted(() => ({ homeLoaded: 0 }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({ options }),
  redirect: (options: object) => ({ redirect: options }),
  lazyRouteComponent: () => Object.assign(() => null, { preload: async () => {} }),
}))
vi.mock('@/components/public/home/portal-home', () => {
  hoisted.homeLoaded++
  return { PortalHome: () => null, loadHome: async () => ({}) }
})
vi.mock('@/components/public/feedback/feed-route', () => ({
  feedHead: () => ({}),
  feedSearchSchema: { extend: () => ({}) },
  hasFeedSearch: () => false,
  loadFeed: async () => ({}),
  portalPathsOf: () => ({}),
}))

afterEach(() => {
  document.body.innerHTML = ''
  hoisted.homeLoaded = 0
  vi.resetModules()
})

/** Loads the route module, as the page's scripts do, and lets a started import land. */
async function loadRoute() {
  await import('../index')
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('the portal root on the page the server drew', () => {
  it('starts loading Home’s module where the server drew Home', async () => {
    document.body.innerHTML = '<main><div data-qb-section="home" data-qb-grid=""></div></main>'
    await loadRoute()
    expect(hoisted.homeLoaded).toBe(1)
  })

  it('loads nothing more on the feed or any other page', async () => {
    document.body.innerHTML = '<main><div data-qb-section="feed"></div></main>'
    await loadRoute()
    expect(hoisted.homeLoaded).toBe(0)
  })

  it('looks for the marks Home’s grid carries', () => {
    const home = readFileSync(
      join(import.meta.dirname, '../../../components/public/home/portal-home.tsx'),
      'utf8'
    )
    expect(home).toContain('data-qb-section="home"')
    expect(home).toContain('data-qb-grid=""')
  })
})
