import { useEffect } from 'react'
import Quackback from '../index'
import type { EventName, EventHandler } from '../types'

/**
 * Subscribe to a widget event for the component's lifetime. The handler
 * fires synchronously when the event is emitted.
 */
export function useQuackbackEvent<T extends EventName>(name: T, handler: EventHandler<T>): void {
  useEffect(() => {
    const unsub = Quackback.on(name, handler)
    return unsub
  }, [name, handler])
}
