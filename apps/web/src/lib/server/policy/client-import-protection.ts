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
  'openai',
  '@quackback/logger',
  'pino',
] as const

/** True for a protected package or any of its subpaths (`pino/file`, `@quackback/db/x`). */
export function isClientProtectedSpecifier(spec: string): boolean {
  return CLIENT_PROTECTED_SPECIFIERS.some((p) => spec === p || spec.startsWith(`${p}/`))
}
