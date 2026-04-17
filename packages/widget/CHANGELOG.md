# @quackback/widget

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
