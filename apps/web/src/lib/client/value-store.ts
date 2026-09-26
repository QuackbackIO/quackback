import { useEffect, useState, useSyncExternalStore } from 'react'

/**
 * A value held outside React state. A component reads just the part of it it
 * draws, so a write re-renders only the readers whose part changed; code that
 * acts on the value reads the latest with `get` when it acts.
 */
export interface ReadableStore<T> {
  get(): T
  subscribe(onChange: () => void): () => void
}

export interface ValueStore<T> extends ReadableStore<T> {
  /** Replaces the value; writing the value already held notifies no one. */
  set(next: T): void
}

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return
      value = next
      for (const listener of listeners) listener()
    },
    subscribe(onChange) {
      listeners.add(onChange)
      return () => {
        listeners.delete(onChange)
      }
    },
  }
}

/**
 * One value drawn from a store. The component re-renders only when it changes
 * (compared with Object.is), so `select` should return a primitive.
 */
export function useStoreValue<T, S = T>(
  store: ReadableStore<T>,
  select: (value: T) => S = (value) => value as unknown as S
): S {
  const read = () => select(store.get())
  return useSyncExternalStore(store.subscribe, read, read)
}

/**
 * One value drawn from a store, updated once the store's changes have paused
 * for `delayMs`. A new `store` or `select` restarts the wait, so pass a
 * `select` that keeps its identity across renders.
 */
export function useDebouncedStoreValue<T, S>(
  store: ReadableStore<T>,
  select: (value: T) => S,
  delayMs: number
): S {
  const [value, setValue] = useState(() => select(store.get()))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => setValue(() => select(store.get())), delayMs)
    }
    schedule()
    const unsubscribe = store.subscribe(schedule)
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [store, select, delayMs])
  return value
}
