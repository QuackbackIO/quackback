// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { VisitorBeacon } from '../visitor-beacon'

const sendBeacon = vi.fn((_url: string | URL, _data?: BodyInit | null) => true)

function clearAllCookies() {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`
  }
}

beforeEach(() => {
  clearAllCookies()
  vi.stubGlobal('navigator', { ...navigator, sendBeacon, doNotTrack: null })
  vi.spyOn(window, 'location', 'get').mockReturnValue({
    ...window.location,
    href: 'http://localhost/',
  } as Location)
})

afterEach(() => {
  cleanup()
  clearAllCookies()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  sendBeacon.mockClear()
})

async function mountBeacon(props: { analytics?: boolean; deviceTracking?: boolean }) {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <VisitorBeacon {...props} />
        <Outlet />
      </>
    ),
  })
  const portal = createRoute({
    getParentRoute: () => rootRoute,
    id: '/_portal',
    component: () => <Outlet />,
  })
  const home = createRoute({
    getParentRoute: () => portal,
    path: '/',
    component: () => <p>portal home</p>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([portal.addChildren([home])]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(<RouterProvider router={router} />)
  await screen.findByText('portal home')
}

describe('VisitorBeacon tracking controls (#965)', () => {
  it('writes no qb_device cookie and sends no beacon when analytics is disabled', async () => {
    await mountBeacon({ analytics: false, deviceTracking: true })
    expect(document.cookie).toBe('')
    expect(sendBeacon).not.toHaveBeenCalled()
  })

  it('sends a cookieless beacon without qb_device when deviceTracking is disabled', async () => {
    await mountBeacon({ analytics: true, deviceTracking: false })
    expect(document.cookie).toBe('')
    expect(sendBeacon).toHaveBeenCalledTimes(1)
    const body = JSON.parse(sendBeacon.mock.calls[0]![1] as string)
    expect(body).not.toHaveProperty('deviceId')
  })

  it('clears a stale qb_device cookie when deviceTracking is disabled', async () => {
    document.cookie = 'qb_device=stale-device-id; Path=/'
    await mountBeacon({ analytics: true, deviceTracking: false })
    expect(document.cookie).not.toContain('qb_device=')
    expect(sendBeacon).toHaveBeenCalledTimes(1)
  })
})
