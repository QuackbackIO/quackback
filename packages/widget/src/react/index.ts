// React adapter — populated in Tasks 14–15 (useQuackbackInit, useQuackback, useQuackbackEvent).
// Placeholder re-export so tsup can build a valid subpath today.
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
