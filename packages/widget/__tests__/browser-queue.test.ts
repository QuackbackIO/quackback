import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The browser-queue module runs side-effects at import time, so each test
// needs a fresh import with isolated module state.

declare global {
  interface Window {
    Quackback?: ((...args: unknown[]) => unknown) & { q?: IArguments[] }
    __QUACKBACK_URL__?: string
  }
}

describe('browser-queue', () => {
  beforeEach(() => {
    vi.resetModules()
    delete (window as Window).Quackback
    delete (window as Window).__QUACKBACK_URL__
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('replays queued commands through the SDK after the script loads', async () => {
    const dispatched: unknown[][] = []
    vi.doMock('../src/core/sdk', () => ({
      createSDK: () => ({
        dispatch: (...args: unknown[]) => {
          dispatched.push(args)
        },
        isOpen: () => false,
        getUser: () => null,
        isIdentified: () => false,
      }),
    }))

    // Simulate the inline snippet's queue
    const q: IArguments[] = []
    const queueFn = function (this: void) {
      // eslint-disable-next-line prefer-rest-params
      q.push(arguments)
    } as ((...args: unknown[]) => unknown) & { q: IArguments[] }
    queueFn.q = q
    window.Quackback = queueFn
    window.Quackback('init', { instanceUrl: 'https://feedback.acme.com' })
    window.Quackback('identify', { id: 'u1', email: 'a@b.c' })

    await import('../src/browser-queue')

    expect(dispatched[0]).toEqual(['init', { instanceUrl: 'https://feedback.acme.com' }, undefined])
    expect(dispatched[1]).toEqual(['identify', { id: 'u1', email: 'a@b.c' }, undefined])
  })

  it('replaces window.Quackback with a live dispatcher after loading', async () => {
    vi.doMock('../src/core/sdk', () => ({
      createSDK: () => ({
        dispatch: () => 'DISPATCHED',
        isOpen: () => false,
        getUser: () => null,
        isIdentified: () => false,
      }),
    }))

    await import('../src/browser-queue')

    expect(typeof window.Quackback).toBe('function')
    expect((window.Quackback as (...args: unknown[]) => unknown)('open')).toBe('DISPATCHED')
  })

  it('auto-dispatches init with the baked instance URL if no init was queued', async () => {
    const dispatched: unknown[][] = []
    vi.doMock('../src/core/sdk', () => ({
      createSDK: () => ({
        dispatch: (...args: unknown[]) => {
          dispatched.push(args)
        },
        isOpen: () => false,
        getUser: () => null,
        isIdentified: () => false,
      }),
    }))

    window.__QUACKBACK_URL__ = 'https://feedback.acme.com'

    await import('../src/browser-queue')

    expect(dispatched[0]).toEqual(['init', { instanceUrl: 'https://feedback.acme.com' }, undefined])
  })

  it('does not auto-init if the queue already contains an init call', async () => {
    const dispatched: unknown[][] = []
    vi.doMock('../src/core/sdk', () => ({
      createSDK: () => ({
        dispatch: (...args: unknown[]) => {
          dispatched.push(args)
        },
        isOpen: () => false,
        getUser: () => null,
        isIdentified: () => false,
      }),
    }))

    window.__QUACKBACK_URL__ = 'https://feedback.acme.com'
    const q: IArguments[] = []
    const queueFn = function (this: void) {
      // eslint-disable-next-line prefer-rest-params
      q.push(arguments)
    } as ((...args: unknown[]) => unknown) & { q: IArguments[] }
    queueFn.q = q
    window.Quackback = queueFn
    window.Quackback('init', { instanceUrl: 'https://override.example' })

    await import('../src/browser-queue')

    // Only the queued init should run, not a separate baked-URL init
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]).toEqual(['init', { instanceUrl: 'https://override.example' }, undefined])
  })
})
