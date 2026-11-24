/**
 * The TanStack AI client runtime, loaded on demand. The admin AG-UI surfaces
 * (Copilot panel, reply transforms) mount with the inbox, but the client
 * library is only needed once someone asks Copilot something, so
 * `runAguiTurn` and `useAguiTurn` reach it through `import()` and nothing
 * imports it statically. Keep it that way: one static import from code the
 * inbox loads puts the whole library back on the inbox's initial load.
 */
export { ChatClient, fetchServerSentEvents } from '@tanstack/ai-client'
export { parsePartialJSON } from '@tanstack/ai'

export type AguiClientModule = typeof import('./agui-client')
