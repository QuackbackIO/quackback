---
title: 'feat: Embeddable Feedback Widget'
type: feat
date: 2026-02-09
---

# Embeddable Feedback Widget

## Overview

Quackback's product audit identified the embeddable widget as a **Tier 1 ship blocker** — without it, teams won't consider switching from Canny/Featurebase. The widget lets customers collect feedback directly inside their product via a `<script>` tag, rather than sending users to a separate feedback portal URL.

The widget loads in an **iframe** pointing to a dedicated `/_widget/` route on the Quackback instance. A vanilla JS SDK handles the trigger button and iframe lifecycle on the host page. User identity is passed from the host app via `QuackbackWidget.identify({ ... })`, with optional HMAC-SHA256 verification.

## Problem Statement / Motivation

- Customers expect in-product feedback collection (every competitor offers this)
- Sending users to a separate URL creates friction and lowers engagement
- Existing customers already have authenticated users — they shouldn't re-auth just to give feedback
- The widget must inherit portal branding so it looks native to the host product

## Proposed Solution

**iframe-based widget** with a vanilla JS SDK (~10KB bundled). The iframe loads `/_widget/` routes on the Quackback instance, reusing the existing portal branding pipeline, data fetching, and components. Authentication uses **token-based auth** (not cookies) since third-party iframe cookies are blocked by Safari/Firefox and unreliable in Chrome.

Host apps pass user identity via `QuackbackWidget.identify({ ... })` → postMessage → server-side verification → session token returned → widget uses `Authorization: Bearer <token>` for all API calls.

---

## Technical Approach

### Architecture

```
Host Website                           Quackback Instance
┌──────────────────────┐               ┌──────────────────────────────┐
│                      │               │                              │
│  <script async       │               │  GET /api/widget/v1/sdk.js   │
│   src="sdk.js">      │               │  (bundled SDK, served static)│
│                      │   iframe      │                              │
│  window.QuackbackConfig              │  /_widget/ route group       │
│    = { theme, ... }  │──────────────▶│    ├─ _widget.tsx (layout)   │
│                      │               │    └─ _widget/index.tsx      │
│  Trigger button      │  postMessage  │                              │
│  (vanilla DOM)       │◀────────────▶│  POST /api/widget/identify   │
│                      │               │  (returns session token)     │
│  QuackbackWidget     │               │                              │
│    .identify({...})  │               │  Reuses:                     │
│    .open()           │               │  - Portal branding pipeline  │
│    .close()          │               │  - PostCard, usePublicPosts  │
│                      │               │  - Widget auth context       │
└──────────────────────┘               └──────────────────────────────┘
```

**Why iframe (not Web Component)?**

- Complete CSS isolation — host styles can't leak in, branding can't leak out
- No separate build — it's just another TanStack route reusing existing components
- Security sandbox via `sandbox="allow-scripts allow-forms allow-same-origin allow-popups"`

**Note on `allow-same-origin`**: This flag is required for the iframe to make same-origin API calls. Combined with `allow-scripts`, the iframe has full access to the Quackback origin's storage. This is acceptable because the widget routes are trusted first-party code. If user-generated content is ever rendered inside the widget, this must be revisited.

### Authentication Model: Token-Based (Not Cookies)

**Critical constraint**: Session cookies with `sameSite: 'lax'` (current Better Auth config at `apps/web/src/lib/server/auth/index.ts:149`) are NOT sent in cross-origin iframe requests. Safari blocks all third-party cookies. Firefox partitions them. Cookies are unreliable for iframe auth.

**Solution**: The widget uses **token-based auth** via `Authorization: Bearer <sessionToken>` headers:

```
1. Host calls QuackbackWidget.identify({ id, email, name, hash })
2. SDK sends postMessage to widget iframe
3. Widget POSTs to /api/widget/identify with the identity data
4. Server verifies HMAC, finds/creates user, finds/creates session
5. Server returns { sessionToken, user } in response body (NOT as a cookie)
6. Widget stores token in WidgetAuthContext (React context)
7. Widget hooks/mutations use widgetFetch() wrapper that adds Authorization header
8. Widget sends identify-result postMessage back to host
```

### v1 Scope: Identify-Only Auth

In v1, the widget does **not** include inline OAuth or email OTP flows. All authentication is via `QuackbackWidget.identify({ ... })` — the host app is responsible for passing user identity. This eliminates:

- OAuth popup handling in the widget
- Email OTP UI inside the widget
- BroadcastChannel integration for auth events
- Session cookie → token exchange endpoint

Users who are not identified by the host app can browse posts, but cannot vote or submit new posts. The widget shows a muted info bar: "Voting requires authentication".

`QuackbackWidget.identify()` should be called on **every page load** (this is the Canny/Intercom pattern). The identify endpoint is idempotent — it reuses existing valid sessions rather than creating new ones each time.

**Future v2**: Add inline OAuth/OTP auth flows with a token exchange endpoint.

### Bearer Token Injection into Server Functions

**Problem**: TanStack Start server functions use `createServerFn()` which internally calls `fetch()`. The widget iframe is embedded as a **third party** on the host site — browsers block or partition third-party cookies. The widget must inject Bearer tokens into API requests.

**Solution — Scoped `widgetFetch` wrapper (NOT globalThis.fetch monkey-patching)**:

Monkey-patching `globalThis.fetch` is fragile: it interacts poorly with React Strict Mode (double mount/unmount), concurrent features, other interceptors, and server-side rendering. Instead, the widget uses explicit fetch injection.

```
1. WidgetAuthContext stores { token, user } in React state
2. Context provides widgetFetch(url, opts): a wrapper that clones the request and
   adds Authorization: Bearer <token> to same-origin requests
3. Widget-specific hooks (useWidgetPosts, useWidgetVote, etc.) use widgetFetch
   instead of reusing portal hooks directly
4. Server-side getWidgetSession() reads the Bearer token from the Authorization header
```

**Implementation:**

- File: `apps/web/src/components/widget/widget-auth-provider.tsx`
- Wraps the `_widget.tsx` layout
- Stores `{ token, user } | null` in state (token stored via `useRef` so it's always current)
- Provides `widgetFetch`, `setWidgetAuth(token, user)`, `clearWidgetAuth()` via context
- `widgetFetch` is a thin wrapper: reads token from ref, adds `Authorization` header, calls native `fetch`

**Widget-specific data hooks:**

- File: `apps/web/src/lib/client/hooks/use-widget-data.ts`
- Thin wrappers around existing portal server functions that use `widgetFetch` from context
- `useWidgetPosts()`, `useWidgetVote()`, `useWidgetCreatePost()`, etc.
- These wrappers are small (~5-10 lines each) — they call the same server functions but with the Authorization header injected

**Server-side auth:**

- File: `apps/web/src/lib/server/functions/widget-auth.ts` (NEW — separate from `auth-helpers.ts`)
- `getWidgetSession()`: reads `Authorization: Bearer <token>` header, looks up session by token in DB, validates expiry, returns `AuthContext | null`
- Does NOT modify `getSessionDirect()` or `requireAuth()` — the existing auth pathway is untouched
- Widget-only scope: limits Bearer token surface to widget routes

### Session Lifecycle

**Session reuse on re-identify**: When `identify` is called (on every page load), the endpoint checks for an existing valid session for the userId. If found and not expired, it returns the existing token rather than creating a new row. This prevents session table accumulation.

**Token expiry**: Sessions have a 7-day expiry. When a widget API call returns 401:

1. Widget sends `quackback:identify-expired` postMessage to host
2. Host SDK re-calls `QuackbackWidget.identify()` automatically with the buffered identity
3. If re-identify succeeds, the failed request is retried
4. If re-identify fails (user no longer valid), widget falls back to anonymous mode

**Page refresh**: The token is in-memory only — it's lost on iframe reload. The host SDK re-sends the buffered identify on `quackback:ready`, which triggers re-identify (cheap since it reuses the existing session).

### Error Handling

The identify flow defines specific error codes in the `quackback:identify-result` postMessage:

| Error Code         | HTTP Status | Meaning                             |
| ------------------ | ----------- | ----------------------------------- |
| `HMAC_INVALID`     | 403         | Hash verification failed            |
| `WIDGET_DISABLED`  | 403         | Widget is not enabled               |
| `VALIDATION_ERROR` | 400         | Missing required fields (id, email) |
| `NETWORK_ERROR`    | —           | Fetch failed (network issue)        |
| `SERVER_ERROR`     | 500         | Unexpected server error             |

On error, the SDK:

- Resolves the `identify()` Promise with `{ success: false, error: '<code>' }`
- Widget falls back to anonymous mode (browse only)
- Does NOT retry automatically (host app should handle errors)

---

## User Identification (Widget Identify)

### How It Works

```
Host Website                                Quackback Widget (iframe)
┌──────────────────────────┐                ┌────────────────────────────┐
│                          │                │                            │
│  QuackbackWidget         │  postMessage   │  Receives identify msg     │
│    .identify({           │───────────────▶│                            │
│      id: 'user_123',     │                │  POST /api/widget/identify │
│      email: 'j@acme.com',│                │  { id, email, name,        │
│      name: 'Jane',       │                │    avatarURL, hash }       │
│      hash: 'abc123...'   │                │                            │
│    })                    │                │  Server verifies HMAC      │
│                          │                │  ↓                         │
│                          │                │  Find/create user          │
│                          │                │  Find/create session       │
│                          │  postMessage   │  ↓                         │
│  → Promise resolves with │◀───────────────│  quackback:identify-result │
│    { success, user }     │                │  Widget shows as identified│
└──────────────────────────┘                └────────────────────────────┘
```

### JS API

The SDK exposes `window.QuackbackWidget` after loading. All methods return Promises.

```javascript
// Identify user (call on every page load)
await QuackbackWidget.identify({
  id: 'user_123', // Required: unique user ID in your system
  email: 'jane@acme.com', // Required: user's email
  name: 'Jane Doe', // Optional: display name
  avatarURL: 'https://...', // Optional: avatar image URL
  created: '2024-01-15T...', // Optional: ISO 8601 account creation date
  hash: 'a1b2c3d4...', // Required when HMAC verification enabled
})
// → { success: true, user: { id, name, email } }
// → { success: false, error: "HMAC_INVALID" }

// Clear identity (user logged out of host app)
QuackbackWidget.identify(null)

// Programmatic control
QuackbackWidget.open()
QuackbackWidget.close()
QuackbackWidget.destroy()
```

### HMAC Verification

When `identifyVerification` is enabled (recommended for production), the `hash` field is **required**. Industry standard (Intercom, Canny, Chatwoot): **HMAC only the userId**, not email or other fields.

```
Server-side (customer's backend):
  hash = HMAC-SHA256(secret: widgetSecret, message: userData.id)

Example (Node.js):
  crypto.createHmac('sha256', widgetSecret).update(userData.id).digest('hex')
```

**Security note**: Without HMAC verification enabled, any page that embeds the widget can send identity postMessages with arbitrary user data. Non-HMAC mode is suitable only for internal tools. Production deployments should always enable HMAC verification.

Use `crypto.timingSafeEqual()` for comparison (reuse pattern from `api-key.service.ts`).

### Server-side Flow (`POST /api/widget/identify`)

```
1. Security gates:
   a. Check widgetConfig.enabled — reject with WIDGET_DISABLED if false
   b. Validate request with Zod schema — reject with VALIDATION_ERROR if invalid
2. If identifyVerification enabled:
   a. Require `hash` field — reject with VALIDATION_ERROR if missing
   b. Read widgetSecret from dedicated DB column (NOT from JSON config)
   c. Compute HMAC-SHA256(widgetSecret, id)
   d. Timing-safe compare (crypto.timingSafeEqual on hex buffers)
   e. Reject with HMAC_INVALID if mismatch
3. Look up user by email (db.query.user.findFirst)
   a. EXISTS → update name/avatarURL if changed
   b. NOT EXISTS → create user + principal (role: 'user')
4. Store external ID in user metadata: { widgetIdentifyId: id }
5. Look up existing valid session for this userId:
   a. EXISTS and not expired → return existing session token (idempotent)
   b. NOT EXISTS or expired → create new session:
      - id: crypto.randomUUID()
      - token: crypto.randomUUID()
      - userId, expiresAt (7 days), ipAddress, userAgent
      - updatedAt: new Date()  (required — column is notNull with no defaultNow)
6. Return { sessionToken: token, user: { id, name, email, avatarUrl } }
```

**Rate limiting**: Defer to reverse proxy (nginx, Cloudflare, etc.) for production deployments. Document this requirement. Do not build a custom in-memory rate limiter — it doesn't survive restarts, doesn't work across instances, and leaks memory.

**Known coupling**: Direct DB insert into Better Auth's session table couples to its internal schema. Check compatibility on every Better Auth upgrade.

---

## Widget UX Design

### Floating Trigger Button

Pill-shaped button, fixed to bottom-right of viewport (bottom-left if `placement: "left"`). Rendered by the SDK (not iframe) so it appears instantly.

The SDK embeds the portal's primary branding color (fetched at build time and injected into the SDK response). Overridable via `buttonColor` in config.

```
╭─────────────────────╮
│  💬  Feedback       │  pill button, high z-index
╰─────────────────────╯  hover: subtle lift + shadow
```

### Expanded Widget Panel

Floating panel anchored to the trigger button corner. Opacity transition on open/close. Respect `prefers-reduced-motion`.

```
╭──────────────────────────────────╮
│ [🦆] Acme Co              [ ✕ ] │  header: logo + name + close
├──────────────────────────────────┤
│   Feed      New Post             │  tabs (New Post hidden when anon)
│   ▔▔▔▔                          │
│  ┌────────────────────────────┐  │
│  │ ┌────┐                     │  │
│  │ │ ▲  │ ● Planned           │  │  compact post cards
│  │ │ 42 │ Dark mode support   │  │  reuse PostCard density="compact"
│  │ └────┘ 💬 3                │  │  links open portal in new tab
│  ├────────────────────────────┤  │
│  │ ┌────┐                     │  │
│  │ │ ▲  │ ● In Progress       │  │
│  │ │ 31 │ CSV export          │  │
│  │ └────┘ 💬 7                │  │
│  └────────────────────────────┘  │
│                                  │
│  ─── Powered by Quackback ───    │  footer link
╰──────────────────────────────────╯
```

When not identified, vote buttons are disabled and an info bar shows: "Voting requires authentication".

### New Post (identified users only)

"New Post" tab only visible when user is identified. Board selector, title input, plain text description textarea. Submit reuses existing post creation server function via `widgetFetch`.

### Mobile (< 640px)

Simple full-screen panel (100vw, 100vh). Same content as desktop. No drag handle, no swipe gestures, no backdrop overlay. Close via X button or Escape key. Bottom sheet polish deferred to v2.

### Accessibility

Baked into each component at creation time (not a separate phase):

- Trigger button: `aria-label="Open feedback widget"`, `aria-expanded`, `role="button"`
- Panel iframe: `title="Feedback Widget"`, sandbox attributes
- Tab bar: `role="tablist"` + `role="tab"` + `aria-selected`
- Vote buttons: `aria-pressed`, `aria-label`
- All touch targets >= 44x44px
- `prefers-reduced-motion: reduce` for transitions

---

## Embed API

### Integration Snippet

```html
<!-- 1. Configuration (before SDK loads) -->
<script>
  window.QuackbackConfig = {
    theme: 'auto', // "light", "dark", or "auto"
    placement: 'right', // "right" or "left"
    defaultBoard: 'feature-requests', // optional board slug
  }
</script>

<!-- 2. Load SDK (async, won't block page) -->
<script async src="https://feedback.acme.com/api/widget/v1/sdk.js"></script>

<!-- 3. Identify user (after SDK loads, or on page ready) -->
<script>
  // SDK sets window.QuackbackWidget when ready
  // Call identify on every page load
  document.addEventListener('quackback:ready', function () {
    QuackbackWidget.identify({
      id: 'user_123',
      email: 'jane@acme.com',
      name: 'Jane Doe',
      hash: 'a1b2c3d4...', // HMAC-SHA256 if verification enabled
    })
  })
</script>
```

The SDK reads `window.QuackbackConfig` on load, creates the trigger button, and fires a `quackback:ready` CustomEvent on `document` when the SDK is initialized. The iframe is created lazily on first `open()` or `identify()` call.

### Methods

| Method                           | Returns                       | Description                         |
| -------------------------------- | ----------------------------- | ----------------------------------- |
| `QuackbackWidget.identify(data)` | `Promise<{ success, user? }>` | Authenticate user via host identity |
| `QuackbackWidget.identify(null)` | `void`                        | Clear user identity                 |
| `QuackbackWidget.open()`         | `void`                        | Open the widget panel               |
| `QuackbackWidget.close()`        | `void`                        | Close the widget panel              |
| `QuackbackWidget.destroy()`      | `void`                        | Remove widget entirely              |

### Config Options

| Option         | Default           | Description                                             |
| -------------- | ----------------- | ------------------------------------------------------- |
| `theme`        | `"auto"`          | `"light"`, `"dark"`, or `"auto"` (prefers-color-scheme) |
| `placement`    | `"right"`         | `"right"` or `"left"` — trigger button position         |
| `defaultBoard` | _(all boards)_    | Board slug to filter/default to                         |
| `buttonText`   | `"Feedback"`      | Text on floating trigger button                         |
| `buttonColor`  | _(from branding)_ | Hex color override for trigger button                   |

---

## PostMessage Protocol

All messages use `quackback:` prefix. The SDK validates `event.origin` matches the Quackback instance origin (derived from the SDK script URL). The widget validates `event.source === window.parent`.

| Direction     | Type                         | Payload                                             | Purpose                           |
| ------------- | ---------------------------- | --------------------------------------------------- | --------------------------------- |
| Widget → Host | `quackback:ready`            | —                                                   | iframe loaded, ready for identify |
| Widget → Host | `quackback:close`            | —                                                   | User clicked close button         |
| Widget → Host | `quackback:identify-result`  | `{ success, user? }` or `{ success: false, error }` | Identity confirmation             |
| Widget → Host | `quackback:identify-expired` | —                                                   | Token expired, re-identify needed |
| Host → Widget | `quackback:identify`         | `{ id, email, name?, ... hash? }` or `null`         | Pass/clear user identity          |

**Removed from v1**: `quackback:resize` (no inline embed), `quackback:auth-change` (host already knows user), `quackback:set-theme` (set via query param at iframe creation), `quackback:navigate` (use `<a target="_blank">` with `allow-popups` sandbox).

**Origin validation**: The SDK stores the Quackback origin (derived from the `<script src="...">` URL) and checks `event.origin` on all inbound messages. The widget checks `event.source === window.parent`. Without HMAC verification, the postMessage channel is the only security boundary — any page embedding the widget can send identity data. This is why HMAC verification is strongly recommended for production.

---

## Implementation Phases

### Phase 1: Backend & Auth

**1. Database migration — add `widget_config` column + `widget_secret` column**

- File: `packages/db/src/migrations/XXXX_add_widget_config.ts`
- Add `widget_config TEXT` column to `settings` table (follows `brandingConfig`, `portalConfig` pattern)
- Add `widget_secret TEXT` column to `settings` table (separate from JSON config — structurally prevents accidental exposure)

**2. Widget config types**

- File: `apps/web/src/lib/server/domains/settings/settings.types.ts`

```typescript
interface WidgetConfig {
  enabled: boolean
  defaultBoard?: string
  position?: 'bottom-right' | 'bottom-left'
  buttonText?: string
  identifyVerification?: boolean
}

// Public subset — safe to include in TenantSettings / bootstrap data
type PublicWidgetConfig = Pick<WidgetConfig, 'enabled' | 'defaultBoard' | 'position' | 'buttonText'>

const DEFAULT_WIDGET_CONFIG: WidgetConfig = {
  enabled: false,
  identifyVerification: false,
}
```

- Note: `widgetSecret` stored in its own DB column, NOT in the JSON config

**3. Settings service — widget config CRUD**

- File: `apps/web/src/lib/server/domains/settings/settings.service.ts`
- Add `getWidgetConfig()`, `updateWidgetConfig()`, `getWidgetSecret()` following existing patterns
- Add `generateWidgetSecret()`: `'wgt_' + crypto.randomBytes(32).toString('hex')`
- Add `getPublicWidgetConfig()` → returns `PublicWidgetConfig` (no secret, safe for client)
- Add `publicWidgetConfig` to `getTenantSettings()` and `TenantSettings` interface
- **Important**: `widgetSecret` is NEVER in `TenantSettings` — loaded only by admin settings page

**4. Widget identify API endpoint**

- File: `apps/web/src/routes/api/widget/identify.ts`
- `POST /api/widget/identify` — same-origin request from widget iframe (no CORS needed)
- Security gates: widget-enabled check, Zod validation, HMAC verification (when enabled)
- Session reuse: find existing valid session for userId before creating new one
- Set `updatedAt: new Date()` on session insert (column is `notNull` with no `defaultNow`)
- Returns `{ sessionToken, user }` in response body
- Error responses use defined error codes (HMAC_INVALID, WIDGET_DISABLED, etc.)

**5. Widget auth helper**

- File: `apps/web/src/lib/server/functions/widget-auth.ts` (NEW)
- `getWidgetSession()`: reads `Authorization: Bearer <token>` header, looks up session by token, validates expiry, returns `AuthContext | null`
- Does NOT modify `getSessionDirect()` or `requireAuth()` — existing auth pathway untouched
- Widget-only scope: limits Bearer token surface to widget routes

**6. Frame headers via route loader**

- Set `Content-Security-Policy: frame-ancestors *` on `/_widget` routes using `setResponseHeader()` in the `_widget.tsx` route loader
- No Nitro middleware needed — avoids introducing a new infrastructure concept
- Also set a strict CSP for the widget page content: `default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'none'`

**7. Root route update**

- File: `apps/web/src/routes/__root.tsx`
- Add `'/_widget'` to `ONBOARDING_EXEMPT_PATHS` array

### Phase 2: Widget UI

**8. Widget layout route**

- File: `apps/web/src/routes/_widget.tsx`
- Extract shared branding/theme resolution from `_portal.tsx` into a utility (e.g., `resolvePortalBranding()` in server functions) — both `_portal.tsx` and `_widget.tsx` call it
- Accept query params: `?board=`, `?theme=`
- Theme override: if `?theme=light|dark`, force that mode
- Render: branding `<style>` tags + `<WidgetAuthProvider>` + shell (header, tabs, footer) + `<Outlet>`
- No `PortalHeader`, no max-width constraint, `body { overflow: hidden; margin: 0; }`
- Set frame headers via `setResponseHeader()` in loader

**9. Widget auth provider + postMessage bridge**

- File: `apps/web/src/components/widget/widget-auth-provider.tsx`
- Combined: auth context (token + user + `widgetFetch`) AND postMessage handling (send/receive)
- Stores token in `useRef` (always current for `widgetFetch`) and user in `useState`
- Sends `quackback:ready` on mount, listens for `quackback:identify` from host
- On identify: calls `POST /api/widget/identify`, stores token, sends `quackback:identify-result`
- On identify(null): clears auth, sends identify-result with null
- On 401 from any `widgetFetch` call: sends `quackback:identify-expired` to host, auto-retries identify with buffered data
- Close button sends `quackback:close` via postMessage

**10. Widget feed page**

- File: `apps/web/src/routes/_widget/index.tsx`
- Loader: fetch boards, posts, statuses (reuse `portalQueries.portalData()` pattern)
- Compact post list with scroll. Reuses `PostCard` with `density="compact"`
- Post links: `<a target="_blank">` to full post on portal (uses `allow-popups` sandbox, no postMessage needed)
- Empty state: icon + "No feedback yet" + CTA to switch to New Post tab
- Loading state: skeleton cards

**11. Widget data hooks**

- File: `apps/web/src/lib/client/hooks/use-widget-data.ts`
- Thin wrappers around portal server functions that inject auth via `widgetFetch` from context
- `useWidgetPosts()`, `useWidgetVote()`, `useWidgetCreatePost()`
- Each wrapper is ~5-10 lines — calls the same server function with Authorization header

**12. Widget new post form**

- Inline in `_widget/index.tsx` initially (extract to component if > 300 lines)
- Board selector, title input, plain text description textarea
- Only visible when user is identified
- Submit uses `useWidgetCreatePost()`. On success: switch to Feed tab

### Phase 3: SDK

**13. SDK source file (real JS, not template string)**

- File: `packages/widget-sdk/src/sdk.ts` (new package, or `apps/web/src/lib/widget-sdk/sdk.ts`)
- Written as actual TypeScript — gets type checking, linting, syntax highlighting
- Built with esbuild (single command) → `sdk.js` output (~10KB)
- `baseUrl` injected at serve time via single string replacement (the SDK URL itself contains the origin)
- Functionality:
  - Reads `window.QuackbackConfig` on load
  - Creates trigger button with inline styles (branding color embedded in SDK response)
  - Lazy iframe: only created on first `open()` or `identify()` call
  - `QuackbackWidget` object: `{ identify, open, close, destroy }`
  - `identify()` buffers identity if iframe not ready, sends on `quackback:ready`
  - `identify()` returns Promise that bridges `quackback:identify-result`
  - On `quackback:identify-expired`: auto-re-identify with buffered identity
  - Fires `quackback:ready` CustomEvent on `document` when SDK initialized
  - Mobile detection: `window.innerWidth < 640` → full-screen panel (no gestures)
  - iframe sandbox: `allow-scripts allow-forms allow-same-origin allow-popups`
  - Origin validation: store `baseUrl` origin, check `event.origin` on all inbound postMessages
- z-index: use `2147483000` (high but not max int — avoids collision with other widgets)
- Script insertion: `document.head.appendChild(s)` (not `insertBefore` — more robust)

**14. SDK API route**

- File: `apps/web/src/routes/api/widget/v1/sdk.js.ts`
- Versioned path (`/v1/`) — allows breaking changes without invalidating cached SDKs
- GET handler reads built SDK file, injects `baseUrl` and branding primary color
- Headers: `Content-Type: application/javascript`, `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`
- Checks `widgetConfig.enabled` — returns empty script with `console.warn` if disabled

### Phase 4: Admin Settings

**15. Widget settings page**

- File: `apps/web/src/routes/admin/settings.widget.tsx`
- Follow `settings.mcp.tsx` pattern (loader with `requireWorkspaceRole`, `useSuspenseQuery`, `SettingsCard`)
- Sections:
  - **General**: Enable/disable toggle, default board selector
  - **User Identification**: "Require HMAC verification (recommended)" toggle, widget secret (masked + copy + regenerate), code snippet showing HMAC computation
  - **Embed Code**: `<script>` snippet with copy button (pre-filled with instance URL)
- No live preview (link to `/_widget/?board=feature-requests` in a new tab instead)
- Server functions inline in loader (extract only if reused elsewhere)

**16. Settings navigation**

- File: `apps/web/src/components/admin/settings/settings-nav.tsx`
- Add "Widget" nav item after "Portal" / "Developer"

---

## Acceptance Criteria

### Functional Requirements

- [ ] Widget loads via `<script>` tag on any website
- [ ] Floating trigger button appears with portal branding colors
- [ ] Click trigger opens widget panel showing branded feedback feed
- [ ] Posts display with vote counts, status badges, comment counts
- [ ] Identified users can vote on posts
- [ ] Identified users can submit new posts via plain text form
- [ ] Anonymous users (not identified) can browse but not vote or post
- [ ] `QuackbackWidget.identify({ ... })` authenticates users via host identity
- [ ] Re-calling `identify()` on page load reuses existing session (idempotent)
- [ ] HMAC verification rejects tampered identity when enabled
- [ ] `QuackbackWidget.identify(null)` clears user identity
- [ ] Token expiry triggers `quackback:identify-expired` → automatic re-identify
- [ ] Error codes returned in identify-result for HMAC_INVALID, WIDGET_DISABLED, etc.
- [ ] Mobile: full-screen panel on screens < 640px
- [ ] Admin can enable/disable widget, configure HMAC verification, copy embed code

### Non-Functional Requirements

- [ ] SDK < 10KB gzipped
- [ ] No third-party cookie dependency (token-based auth)
- [ ] iframe sandboxed: `allow-scripts allow-forms allow-same-origin allow-popups`
- [ ] `Content-Security-Policy: frame-ancestors *` on widget routes
- [ ] Strict CSP on widget page content (`default-src 'self'`, etc.)
- [ ] All postMessage types namespaced with `quackback:` prefix
- [ ] SDK validates `event.origin` matches Quackback instance on all inbound messages
- [ ] Widget validates `event.source === window.parent` on all inbound messages
- [ ] `widgetSecret` never appears in TenantSettings / bootstrap data
- [ ] Bearer token auth scoped to `getWidgetSession()` — does not affect existing auth flow

---

## Key Files to Modify

| File                                                           | Change                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/db/src/schema/auth.ts`                               | Add `widgetConfig` + `widgetSecret` columns to settings table                   |
| `apps/web/src/routes/__root.tsx`                               | Add `/_widget` to `ONBOARDING_EXEMPT_PATHS`                                     |
| `apps/web/src/lib/server/domains/settings/settings.types.ts`   | Add `WidgetConfig`, `PublicWidgetConfig`, `DEFAULT_WIDGET_CONFIG`               |
| `apps/web/src/lib/server/domains/settings/settings.service.ts` | Add widget config CRUD, `getPublicWidgetConfig()`, add to `getTenantSettings()` |
| `apps/web/src/lib/server/domains/settings/index.ts`            | Export new types                                                                |
| `apps/web/src/routes/_portal.tsx`                              | Extract shared branding resolution into reusable utility                        |
| `apps/web/src/components/admin/settings/settings-nav.tsx`      | Add Widget nav item                                                             |

## New Files

| File                                                      | Purpose                                             |
| --------------------------------------------------------- | --------------------------------------------------- |
| `packages/db/src/migrations/XXXX_add_widget_config.ts`    | DB migration (widgetConfig + widgetSecret columns)  |
| `apps/web/src/lib/server/functions/widget-auth.ts`        | `getWidgetSession()` — Bearer token auth for widget |
| `apps/web/src/routes/_widget.tsx`                         | Widget layout (branding + auth provider + shell)    |
| `apps/web/src/routes/_widget/index.tsx`                   | Widget feed + new post form                         |
| `apps/web/src/components/widget/widget-auth-provider.tsx` | Auth context + `widgetFetch` + postMessage bridge   |
| `apps/web/src/lib/client/hooks/use-widget-data.ts`        | Widget-specific data hooks (thin wrappers)          |
| `apps/web/src/routes/api/widget/identify.ts`              | POST endpoint for identity verification             |
| `packages/widget-sdk/src/sdk.ts`                          | SDK source (TypeScript, bundled with esbuild)       |
| `apps/web/src/routes/api/widget/v1/sdk.js.ts`             | API route serving bundled SDK                       |
| `apps/web/src/routes/admin/settings.widget.tsx`           | Admin widget settings page                          |

## Critical Files to Reuse

| File                                                          | What to reuse                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/web/src/routes/_portal.tsx`                             | Template for widget layout loader (branding injection, extract shared utility) |
| `apps/web/src/components/public/post-card.tsx`                | Reuse directly with `density="compact"`                                        |
| `apps/web/src/lib/client/hooks/use-portal-posts-query.ts`     | Pattern for widget data hooks                                                  |
| `apps/web/src/lib/client/mutations/portal-posts.ts`           | Pattern for widget mutations                                                   |
| `apps/web/src/lib/shared/theme/generator.ts`                  | `generateThemeCSS()`                                                           |
| `apps/web/src/lib/shared/theme/index.ts`                      | `getGoogleFontsUrl()`                                                          |
| `apps/web/src/lib/server/domains/api-keys/api-key.service.ts` | Timing-safe comparison pattern                                                 |
| `apps/web/src/lib/server/functions/auth-helpers.ts`           | Principal auto-creation pattern (`getOptionalAuth`, lines 129-179)             |

---

## Deferred to v2

| Feature                                           | Why deferred                                                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Inline embed mode                                 | Requires resize protocol, different layout, second admin snippet — floating is the primary use case                    |
| Mobile bottom sheet (drag/swipe)                  | Complex gesture handling. Full-screen panel is sufficient for v1                                                       |
| Inline OAuth / email OTP auth                     | Significant complexity (popup flow, BroadcastChannel, token exchange). Identify-only covers the common case.           |
| Search bar in widget                              | <50 posts per board typically, scrolling suffices in 400px panel                                                       |
| Sort pills (Top/New/Trending)                     | Default sort sufficient for small panel                                                                                |
| Runtime theme switching (`set-theme` postMessage) | Set via `?theme=` query param. If theme changes, destroy/recreate widget.                                              |
| SDK command queue pattern                         | `window.QuackbackConfig` + `QuackbackWidget.*` methods is simpler. Queue can be added if users need pre-load commands. |
| Admin live preview                                | Link to `/_widget/` route in new tab instead                                                                           |
| Custom rate limiting                              | Defer to reverse proxy (nginx, Cloudflare). Document in deployment guide.                                              |

---

## Verification

1. **Unit test**: Widget config CRUD in settings service, `getWidgetSession()` auth helper
2. **Dev test**: Navigate to `http://localhost:3000/_widget/?board=feature-requests` — should render branded feed
3. **Embed test**: Create test HTML page with SDK script pointing to localhost — trigger button appears, click opens panel with posts
4. **Identify test**: `QuackbackWidget.identify({ id: 'u1', email: 'test@example.com', name: 'Test' })` → widget shows user as identified, can vote and post
5. **Identify test (secure)**: Enable HMAC verification, call `identify()` without hash → `HMAC_INVALID` error. With valid hash → succeeds
6. **Identify test (clear)**: `QuackbackWidget.identify(null)` → widget returns to anonymous state
7. **Identify test (new user)**: `identify()` with unknown email → user + principal created
8. **Identify test (idempotent)**: Call `identify()` twice with same user → same session token returned
9. **Token expiry test**: Expire session in DB → next widget API call returns 401 → widget sends `identify-expired` → re-identify succeeds
10. **Token auth test**: Verify widget API calls use `Authorization: Bearer` header via `widgetFetch`, not cookies
11. **Branding test**: Change portal branding colors → widget reflects changes
12. **Mobile test**: Resize browser to < 640px → verify full-screen panel
13. **Security test**: iframe has sandbox attributes, SDK validates `event.origin`, widget validates `event.source`
14. **SDK test**: Unit tests for SDK: config reading, trigger button creation, iframe lifecycle, postMessage dispatch, identify Promise bridging
15. **E2E test**: Playwright test that loads widget on a test page, identifies user, votes, creates post

---

## References & Research

### Internal References

- Portal layout: `apps/web/src/routes/_portal.tsx` (branding injection pattern)
- Settings config pattern: `apps/web/src/lib/server/domains/settings/settings.service.ts`
- API key auth: `apps/web/src/lib/server/domains/api-keys/api-key.service.ts` (timing-safe HMAC)
- Auth helpers: `apps/web/src/lib/server/functions/auth-helpers.ts` (session + principal auto-creation)
- Session schema: `packages/db/src/schema/auth.ts:43-61`
- Bootstrap data: `apps/web/src/lib/server/functions/bootstrap.ts` (TenantSettings → client, secrets must not appear here)

### External References

- [Canny Identify docs](https://help.canny.io/en/articles/1626097-installing-canny-identify)
- [Intercom Identity Verification](https://developers.intercom.com/installing-intercom/web/identity-verification)
- [Better Auth Session Management](https://www.better-auth.com/docs/concepts/session-management)
- [MDN frame-ancestors CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/frame-ancestors)
- [MDN postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
