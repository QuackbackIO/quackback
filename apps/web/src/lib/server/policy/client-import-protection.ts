import { builtinModules } from 'node:module'

/**
 * Bare package specifiers the client environment must never import.
 *
 * Fed to TanStack Start's `importProtection` in `vite.config.ts` (which fails
 * the dev server / build on a real client import) and to the
 * `server-fn-client-half` policy test (which catches the same packages while
 * they are still reachable only from an exported helper in a server-function
 * module — before Vite's optimizer gets a chance to trip over them).
 */
export const CLIENT_PROTECTED_SPECIFIERS = [
  'postgres',
  '@quackback/db',
  '@quackback/db/client',
  '@quackback/db/schema',
  // The personal email domain list is about 270 KB of data.
  '@quackback/db/email/personal-email-domains',
  'openai',
  '@quackback/logger',
  'pino',
  // Server-side file preview engines: a WebAssembly PDF renderer and a HEIC decoder.
  'mupdf',
  'heic-convert',
] as const

/**
 * Node's built-in modules, `node:`-prefixed or bare (`node:url`, `crypto`,
 * `fs/promises`).
 *
 * A browser cannot load them. Vite swaps each one for an empty stub, so the
 * build passes and the chunk breaks later: the browser refuses any chunk that
 * still imports one, and every page that lazily loads it fails with "Failed to
 * fetch dynamically imported module". A server module reachable from the
 * client (config.ts, through the comment renderer) is enough to carry one in.
 * Code that runs in both environments uses the web platform's equivalent.
 */
export const NODE_BUILTIN_SPECIFIER = new RegExp(
  `^(?:node:|(?:${builtinModules.filter((m) => !m.startsWith('_')).join('|')})(?:/|$))`
)

/** True for a protected package or any of its subpaths (`pino/file`, `@quackback/db/x`). */
export function isClientProtectedSpecifier(spec: string): boolean {
  return (
    NODE_BUILTIN_SPECIFIER.test(spec) ||
    CLIENT_PROTECTED_SPECIFIERS.some((p) => spec === p || spec.startsWith(`${p}/`))
  )
}
