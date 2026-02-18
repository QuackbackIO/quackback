/**
 * Startup banner -- logs build and runtime info once on first request.
 * Build-time constants are injected via Vite `define`; runtime info is read at call time.
 */

let _logged = false

export function logStartupBanner(): void {
  if (_logged) return
  _logged = true

  const runtime =
    typeof globalThis.Bun !== 'undefined' ? `bun ${Bun.version}` : `node ${process.version}`
  const env = process.env.NODE_ENV ?? 'development'
  const port = process.env.PORT ?? '3000'
  const baseUrl = process.env.BASE_URL ?? `http://localhost:${port}`

  const lines = [
    '',
    '========================================',
    `  Quackback v${__APP_VERSION__} (${__GIT_COMMIT__})`,
    '========================================',
    `  Environment: ${env}`,
    `  Runtime:     ${runtime}`,
    `  Base URL:    ${baseUrl}`,
    `  Built:       ${__BUILD_TIME__}`,
    '========================================',
    '',
  ]

  console.log(lines.join('\n'))
}
