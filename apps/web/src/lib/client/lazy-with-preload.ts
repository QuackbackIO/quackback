import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

// The loaded component keeps its own props type through M[K]; `any` here only
// admits every props type, as React.lazy's own constraint does.
// eslint-disable-next-line typescript/no-explicit-any
type AnyComponent = ComponentType<any>

/**
 * A lazily loaded component plus a way to start fetching its chunk ahead of
 * the first render that needs it (on hover or focus of whatever opens it).
 * `preload` swallows a failed fetch: the render that needs the component
 * retries the import and surfaces the error there.
 */
export function lazyWithPreload<K extends string, M extends Record<K, AnyComponent>>(
  loader: () => Promise<M>,
  exportName: K
): { Component: LazyExoticComponent<M[K]>; preload: () => void } {
  return {
    Component: lazy(() => loader().then((m) => ({ default: m[exportName] }))),
    preload: () => void loader().catch(() => {}),
  }
}

function renderNothing(): null {
  return null
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * A lazily loaded component the page can do without, such as the toast
 * container. A chunk that fails to load (a network blip, an edge still warming
 * up after a deploy) is tried once more, and if that fails too the component
 * renders nothing. The failure never reaches an error boundary, so a missing
 * extra cannot replace the whole page with an error screen.
 */
export function lazyOptional<K extends string, M extends Record<K, AnyComponent>>(
  loader: () => Promise<M>,
  exportName: K,
  { retryDelayMs = 1000 }: { retryDelayMs?: number } = {}
): LazyExoticComponent<M[K]> {
  return lazy(async () => {
    try {
      return { default: (await loader())[exportName] }
    } catch {
      await wait(retryDelayMs)
      try {
        return { default: (await loader())[exportName] }
      } catch {
        return { default: renderNothing as unknown as M[K] }
      }
    }
  })
}
