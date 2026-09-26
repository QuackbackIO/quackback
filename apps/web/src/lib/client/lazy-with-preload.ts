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
