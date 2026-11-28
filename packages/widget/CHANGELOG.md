# @quackback/widget

## Unreleased

- The `locale` option is documented as each user's own language: it wins over the person's language in Quackback and the visitor's browser, and an identified person's `locale` is recorded as their detected language, which emails use when the person has not chosen a language and the workspace does not show its main language to everyone. Leave it out when your app has one fixed language. The README's new Language section gives the order.
- Screen readers hear the launcher as "Open help" (or your launcher label) with the unread count, for example "Open help, 2 unread", and "Close help" while the panel is open, in the visitor's language when `init` passes a `locale`. The panel is announced as a dialog named in the same language.
- Opening the panel from the launcher or your own help button moves keyboard focus into it, and closing it returns focus to whatever opened it (or to the launcher if that is gone). An `open()` call while the visitor is typing in a field leaves their focus there, and in browsers that report user activation, so does an open on a timer or a route change.
- The desktop panel is taller (up to 704px) and narrower windows shrink it to fit, with rounder corners and a softer shadow. The launcher keeps the same shadow after a hover.
- Phones held sideways get the full-screen panel too, and on phones the panel stays above the on-screen keyboard while typing.
- With reduced motion turned on in the visitor's system settings, the panel and launcher no longer animate, including when the setting changes while the page is open.
- `hideLauncher()` hides the greeting bubble along with the button, and `showLauncher()` works after `init({ launcher: false })`.
- `logout()` on an open panel closes it and fires the `close` event.
- A "What's new" card above the closed launcher shows the newest unread changelog entry when the workspace turns it on. Clicking it opens the widget on that entry, and dismissing it hides the card until a newer entry is published. The new `whats-new` event (`{ count, entryId }`) fires the first time the card shows an entry to a visitor.
- An entry with "Announce above the launcher" turned off in its settings is left out of the "What's new" card and its count, and still counts towards the unread badge.
- Unread changelog entries are those published after a visitor's first visit on a device, even if they never open the changelog. Before, nothing counted as unread until the visitor had opened the changelog once, so the badge and the "What's new" card never showed for visitors who had not.
- The "What's new" card covers entries published after a visitor's first visit on a device: entries already unread on the first visit are recorded without showing the card or firing `whats-new`.
- `init({ whatsNew: false })` keeps the "What's new" card off on that page, and `Quackback.whatsNew(true | false)` switches it while the page is open. The unread badge is unchanged. A later `init` without the option keeps the last choice, and a call made before `init` holds.
- A reply preview above the closed launcher shows the newest unread replies from a teammate or the AI assistant, with the author's photo or initials and a "Reply to ..." button that opens the conversation with the message box focused. Dismissing it hides it until a newer reply; the badge stays. It goes ahead of the "What's new" card and the greeting. The workspace can show the whole reply instead, or only the badge, and can flash the reply in the page title while the visitor is on another tab.
- `Quackback.open({ view: 'messages', conversationId })` opens one conversation with its message box focused, and the `open` event carries `conversationId`.
- The `unread` event payload adds `messages`, `changelog` and `tickets` beside the unchanged `count`.
- The new `message` event (`{ conversationId, author: { name, avatarUrl }, preview }`) fires once for each new unread reply in any of the visitor's conversations (the 20 newest at each check) that arrives while the page is open or since the visitor's last visit on that device, whichever way the workspace shows replies, including the badge only, so you can build your own indicator.
- The unread count refreshes as soon as the visitor comes back to the page, instead of on the next poll.
- Script-tag installs can read state with `Quackback('isOpen')`, `Quackback('getUser')` and `Quackback('isIdentified')`.
- The SDK only accepts messages from the panel iframe on the page now. Before, a message from another window on the same origin, such as a removed panel's last reply, could change `getUser()`, the unread count or open a link in a new tab.
- `useQuackbackInit` calls `logout()` when `identity` goes back to `undefined`, so signing out of your app signs out of the widget. A visitor who was never identified keeps their anonymous session.
- New "Signing out and switching users" section in this README.

## 0.1.6 - 2026-11-23

- The package is now MIT licensed (was AGPL-3.0), so you can ship it in closed-source apps. The script-tag `sdk.js` is built from this package and is MIT too. The Quackback server stays AGPL-3.0.
- `tracking: false` on `init` keeps host-page visitor analytics off (no pageview beacons, no new device id), and `Quackback.tracking(true | false)` switches it at runtime, so a site can wait for analytics consent while the launcher stays available. `tracking(false)` also removes the stored device id. A withdrawal made before `init` holds, and `init` without the option keeps the last choice.
- `Quackback.open` types now include `{ view: 'messages' }` and `{ view: 'tickets' }`, the two views the iframe already accepts, and the `open` event's `view` type includes `chat`, `messages` and `tickets`.
- `Quackback.open` honours the documented deep links to a view.
- The React adapter accepts React 18 as well as 19.
- The launcher's unread badge reads at 4.8:1 (was 3.8:1).
- The config.json install ping now includes `?sdk=<version>` so the instance can tell an npm/file embed is behind and prompt an update on the widget settings page.
- `Quackback.version` / `SDK_VERSION` expose the package version to host apps.

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
