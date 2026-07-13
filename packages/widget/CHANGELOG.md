# @quackback/widget

## 0.2.1 — 2026-05-02

- New event on `Quackback.on(...)`:
  - `ticket:reopened` — `{ ticketId, statusId, alreadyOpen }`. Fires when the user reopens one of their previously-solved tickets from the widget. `alreadyOpen: true` indicates the ticket was already in an open/pending/on_hold category, so no status transition occurred.

No breaking changes; existing subscribers are unaffected.

## 0.2.0 — 2026-05-02

Adds a first-class **support ticketing** surface so host apps can let end-users open and follow up on tickets directly from the widget.

- New deep-link target: `Quackback.open({ view: 'support', ticketId? })` — opens the support tab, or jumps straight to a ticket's detail view.
- New shortcut: `Quackback.openSupport(ticketId?)` — sugar for the same call. Use without an argument to land on the ticket list, with a ticket id to deep-link into a thread.
- New events on `Quackback.on(...)`:
  - `ticket:created` — `{ id, subject, statusId, statusCategory }`
  - `ticket:replied` — `{ ticketId, threadId }`
  - `ticket:resolved` — `{ ticketId, statusId, alreadyResolved }` (`alreadyResolved: true` indicates the ticket was already in a solved/closed state, so no transition occurred)
- The existing `open` event payload now includes `view: 'support'` and an optional `ticketId` field for support deep-links.

This release only adds to the public surface; existing integrations are unaffected.

## 0.1.5 - 2026-05-18

- Fix: `Quackback("init", { launcher: false, placement: "left" })` from a script-tag install now applies your options instead of silently keeping the default launcher and right-side placement. A repeat `init` call also reconfigures cleanly.

## 0.1.4 — 2026-04-17

- Launcher fade-in is slower (≈450 ms) and waits ~600 ms after the theme fetch resolves before appearing, for a gentler entrance that doesn't compete with the host page finishing its own render.

## 0.1.3 — 2026-04-17

- Honour the server's `themeMode` when resolving launcher colors. If the server is in dark mode, use `darkPrimary` + `darkPrimaryForeground`; otherwise use the light pair. Keeps the launcher in sync with the iframe's branding.

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
