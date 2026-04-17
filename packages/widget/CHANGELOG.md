# @quackback/widget

## 0.1.2 — 2026-04-17

Security hardening:

- `init` now rejects any `instanceUrl` that isn't an `http:` or `https:` URL. Prevents `javascript:` URLs from loading into the panel iframe if an integrator accidentally lets user input reach `init()`.
- `window.open` for iframe-dispatched navigation now uses `noopener,noreferrer`, and only http(s) URLs are allowed. Prevents tabnabbing via the new tab's `window.opener` and blocks `javascript:` exploitation through the navigation channel.
- Dev dependency `happy-dom` bumped to `^20.8.9` to resolve three Dependabot alerts (CVE-2024-51757, CVE-2025-61927, CVE-2026-34226). These vulnerabilities were only reachable during test runs and never shipped to consumers of the package, but the bump removes the advisory.

The published package continues to have zero runtime dependencies (React is an optional peer).

## 0.1.1 — 2026-04-17

- Launcher now stays hidden until the server theme is applied, avoiding a brief flash of the default color before the brand color lands. A 1.5 s fallback reveal ensures the launcher still shows if the config fetch is slow or fails.
- Default launcher colors updated to Quackback branding (black background, amber-400 icon) for the pre-theme and fallback state.

## 0.1.0 — 2026-04-17

Initial release. Extracted from the Quackback monorepo.

- Vanilla JS: `Quackback.init`, `.identify`, `.logout`, `.open`, `.close`, `.showLauncher`, `.hideLauncher`, `.on`, `.off`, `.metadata`, `.destroy`, `.isOpen`, `.getUser`, `.isIdentified`
- React (`@quackback/widget/react`): `useQuackbackInit`, `useQuackback`, `useQuackbackEvent` — singleton + hooks, no provider
- TypeScript types for all methods and events; discriminated `Identity` union (`{ id, email } | { ssoToken }`); discriminated `OpenOptions` for deep-link targets
- IIFE bundle for script-tag users (served by Quackback at `/api/widget/sdk.js`)
- Theme and tab visibility are server-driven — admin configures them in Quackback; there is no client override
