export { useQuackbackInit } from './use-init'
export type { UseQuackbackInitOptions } from './use-init'
export { useQuackback } from './use-quackback'
export { useQuackbackEvent } from './use-event'

// Re-export the singleton + types so users can import everything from one subpath.
export { default as Quackback } from '../index'
export type {
  InitOptions,
  Identity,
  OpenOptions,
  WidgetUser,
  EventName,
  EventMap,
  EventHandler,
  Unsubscribe,
} from '../types'
