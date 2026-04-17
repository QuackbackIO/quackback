# Widget SDK npm package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the Quackback web widget as `@quackback/widget` on npm (ESM + CJS + UMD, with types and a React adapter) without breaking existing script-tag integrations.

**Architecture:** Decompose `apps/web/src/lib/shared/widget/sdk-template.ts` (currently a string template with `BASE_URL` baked in at generation time) into real TypeScript modules under `packages/widget/`. Config and tenant URL move from generation-time to runtime. Tsup builds ESM/CJS/types for npm consumers and an IIFE bundle that `/api/widget/sdk.js` serves verbatim to script-tag users, so existing installs keep working byte-for-byte.

**Tech Stack:** TypeScript, bun workspaces, tsup, vitest + jsdom for core tests, `@testing-library/react` + happy-dom for the React adapter.

---

## Design principles

**Declarative setup + imperative changes.** Everything about the widget's _starting state_ goes into `init` / `configure`. Anything that changes at runtime is a method call. This split dictates what lives where:

| Concern                  | Declarative (init)       | Imperative (method)                 |
| ------------------------ | ------------------------ | ----------------------------------- |
| Where the widget appears | `placement`, `launcher`  | `showLauncher()` / `hideLauncher()` |
| Who the user is          | `identity`               | `identify(...)` / `logout()`        |
| Session context          | _(none — runtime only)_  | `metadata(...)`                     |
| Panel visibility         | _(always starts hidden)_ | `open(...)` / `close()`             |

Consequence for API design: if you already know the value at startup, you never need an extra method call — bundle it in `init`. If it changes, call the method.

**Cross-platform consistency where it matters, platform idioms where they don't.** Field names (`appUrl`, `placement`, `identity`) are unified across web, iOS, and Android — no vocabulary drift. Setup verb (`init` vs `configure`) follows each platform's ecosystem convention. Config shape (flat options vs typed struct) does the same.

## Scope

- **In scope — Phase 0:** Cross-platform surface unification across `~/quackback` (web), `~/quackback-ios`, `~/quackback-android`, `~/quackback-docs`. Field renames, missing parity methods, canonical API surface before npm work starts.
- **In scope — Phases 1–5:** `packages/widget/` (core + react subpath), updated `/api/widget/sdk.js` route, internal dogfood on `~/website`, v0.1.0 npm publish.
- **Out of scope:** Vue/Svelte adapters (defer until demand), protocol v2 changes (current postMessage contract is preserved exactly), Intercom-style `trackEvent` (defer).

## File Structure

**New package layout** (`~/quackback/packages/widget/`):

```
packages/widget/
├── package.json               # name: @quackback/widget; exports map; peerDeps (react optional)
├── tsconfig.json              # matches packages/ids/tsconfig.json style
├── tsup.config.ts             # builds dist/index.{js,cjs,d.ts} + dist/browser.js (IIFE)
├── README.md                  # install + quickstart + API
├── src/
│   ├── index.ts               # Public API: init, identify, logout, open, close, on, off, metadata, destroy, destroy
│   ├── types.ts               # InitOptions, Identity, EventMap, OpenOptions, WidgetTheme
│   ├── core/
│   │   ├── sdk.ts             # Orchestrator — holds state, wires modules, exposes dispatcher
│   │   ├── events.ts          # Typed event emitter (listeners by name)
│   │   ├── postmessage.ts     # Iframe message protocol (quackback:* in/out)
│   │   ├── theme.ts           # Dark-mode detection + color resolution
│   │   ├── launcher.ts         # Floating launcher DOM
│   │   ├── panel.ts           # Iframe panel + backdrop DOM
│   │   ├── config.ts          # Fetch /api/widget/config.json, merge with init overrides
│   │   └── style.ts           # Injects the one <style> tag (panel/backdrop CSS)
│   ├── browser-queue.ts       # IIFE entry: replays window.Quackback.q
│   └── react/
│       ├── index.ts           # Subpath exports (singleton + hooks, no provider)
│       ├── use-init.ts        # useQuackbackInit(options) — lifecycle hook
│       ├── use-quackback.ts   # useQuackback() — returns the Quackback singleton
│       └── use-event.ts       # useQuackbackEvent(name, handler)
└── __tests__/
    ├── events.test.ts
    ├── postmessage.test.ts
    ├── theme.test.ts
    ├── sdk.test.ts
    ├── config.test.ts
    ├── browser-queue.test.ts
    └── react/
        ├── use-init.test.tsx
        ├── use-quackback.test.tsx
        └── use-event.test.tsx
```

**Server changes** (`~/quackback/apps/web/`):

- Modify `src/routes/api/widget/sdk[.]js.ts` — serve the IIFE bundle produced by tsup, prepended with a tenant-specific config line.
- Delete `src/lib/shared/widget/sdk-template.ts` — replaced by the bundle.
- Update or delete `src/lib/shared/widget/__tests__/sdk-template.test.ts` — the new package has its own behavioral tests.
- Keep `src/lib/shared/widget/types.ts` — widens to re-export from the new package for internal consumers.

**Website** (`~/website/`):

- `package.json` — add `@quackback/widget` dep.
- `src/routes/__root.tsx` — replace script injection with `import { Quackback } from '@quackback/widget'` + `useEffect`.

**Monorepo wiring** (`~/quackback/`):

- `package.json` — workspaces already include `packages/*`, no change needed.
- Root `tsconfig.json` — add path alias only if needed (bun resolves workspace packages automatically).

---

## Tech notes

- **Bundle target:** ES2020. Not transpiling further — current SDK already uses modern JS.
- **Size budget:** core <15 KB min+gzip, react adapter <2 KB.
- **No runtime deps.** React is a peer dep of the `/react` subpath only.
- **Testing:** vitest everywhere (quackback repo default). jsdom for core, happy-dom for React (faster, no DOM API edge cases we need).
- **Backwards compat invariant:** anyone currently using the script-tag snippet MUST keep working unchanged. Their `window.Quackback("init", ...)` call still goes through the browser-queue replayer.

---

## Phase 0 — Cross-platform surface unification

Goal: before extracting the web SDK to npm, make sure all three surfaces (web, iOS, Android) share canonical field names and symmetric methods. Pre-production, so breaking changes are fine — no deprecation shims.

**Scope of changes:**

1. **Rename on iOS + Android:** `baseURL` → `appUrl`; `position` → `placement`
2. **Remove on iOS + Android:** `appId` from `QuackbackConfig` (vestigial — URL is the identifier)
3. **Add on iOS + Android:** `Quackback.metadata(_:)` method (web already has it)
4. **Add on iOS + Android:** `view` and `title` parameters to `Quackback.open(...)` (web already has them)
5. **Add on web:** `Quackback("showLauncher")` and `Quackback("hideLauncher")` imperative commands (mobile already has them)
6. **Documentation:** update `widget/mobile-sdks.mdx` and `widget/installation.mdx` to reflect the renames and new methods

These changes ship via ~/quackback, ~/quackback-ios, ~/quackback-android, ~/quackback-docs, and the live website deploy. Task 11 onwards (npm SDK extraction) starts from this canonical baseline.

### Task 0.1: iOS — rename config fields, add metadata, extend open

**Files:**

- Modify: `~/quackback-ios/Sources/Quackback/QuackbackConfig.swift`
- Modify: `~/quackback-ios/Sources/Quackback/Quackback.swift`
- Modify: `~/quackback-ios/Sources/Quackback/Internal/JSBridge.swift`
- Modify: `~/quackback-ios/Tests/QuackbackTests/QuackbackConfigTests.swift`
- Modify: `~/quackback-ios/Tests/QuackbackTests/JSBridgeTests.swift`
- Modify: `~/quackback-ios/README.md`
- Modify: `~/quackback-ios/Example/QuackbackExample/QuackbackExampleApp.swift`

- [ ] **Step 1: Audit `appId` usage**

Run: `grep -rn "appId" ~/quackback-ios/Sources/`
Expected: find every place `appId` is read. If it's only stored in config and never sent to the widget/iframe, it's vestigial — remove it. If it's part of the iframe URL or a postMessage payload, keep it and document why.

- [ ] **Step 2: Rename `baseURL` → `appUrl` and `position` → `placement` in `QuackbackConfig.swift`**

Rewrite the struct initializer so `appUrl: URL` and `placement: QuackbackPosition` are the canonical names. Drop `appId` if Step 1 confirmed it's vestigial. Keep `theme`, `buttonColor`, `locale` unchanged.

```swift
public struct QuackbackConfig {
    public let appUrl: URL
    public var theme: QuackbackTheme
    public var placement: QuackbackPosition
    public var buttonColor: String?
    public var locale: String?

    public init(
        appUrl: URL,
        theme: QuackbackTheme = .system,
        placement: QuackbackPosition = .bottomRight,
        buttonColor: String? = nil,
        locale: String? = nil
    ) {
        self.appUrl = appUrl
        self.theme = theme
        self.placement = placement
        self.buttonColor = buttonColor
        self.locale = locale
    }
}
```

- [ ] **Step 3: Update `Quackback.swift` call sites**

Every reference to `config.baseURL` becomes `config.appUrl`. Every `config.position` becomes `config.placement`. Update `fetchTheme(baseURL:)` parameter name too.

- [ ] **Step 4: Add `Quackback.metadata(_:)` method**

In `Quackback.swift`:

```swift
public static func metadata(_ patch: [String: String?]) {
    enqueue(JSBridge.metadataCommand(patch: patch))
}
```

In `JSBridge.swift`:

```swift
static func metadataCommand(patch: [String: String?]) -> String {
    let data = try! JSONSerialization.data(
        withJSONObject: patch.compactMapValues { $0 as Any? ?? NSNull() },
        options: [.sortedKeys]
    )
    let json = String(data: data, encoding: .utf8)!
    return "window.postMessage({type:'quackback:metadata',data:\(json)},'*');"
}
```

- [ ] **Step 5: Extend `Quackback.open(...)` with view and title**

Define an enum and update the method:

```swift
public enum OpenView: String {
    case home = "home"
    case newPost = "new-post"
    case changelog = "changelog"
}

public static func open(view: OpenView? = nil, title: String? = nil, board: String? = nil) {
    guard let config else { return }
    ensureWV(config)
    wvManager?.execute(JSBridge.openCommand(view: view, title: title, board: board))
    presentPanel()
}
```

Update `JSBridge.openCommand` to accept the new params and emit a JSON payload.

- [ ] **Step 6: Update tests**

Adjust `QuackbackConfigTests.swift` to use `appUrl` / `placement`. Add a `JSBridgeTests` case for `metadataCommand` and extended `openCommand` with view/title.

- [ ] **Step 7: Update example app and README**

`Example/QuackbackExample/QuackbackExampleApp.swift`: rename `baseURL:` → `appUrl:`. README: update the API table and quickstart.

- [ ] **Step 8: Verify**

Open `Package.swift` in Xcode (or run `swift build --package-path ~/quackback-ios` if available) and confirm it compiles. Run tests.

- [ ] **Step 9: Commit**

```bash
cd ~/quackback-ios
git add -A
git commit -m "feat: unify surface — rename baseURL→appUrl, position→placement; add metadata and open options

- QuackbackConfig: baseURL → appUrl, position → placement, drop vestigial appId
- New Quackback.metadata(_:) method for parity with web
- Quackback.open(view:title:board:) for parity with web
- Pre-production breaking change, no deprecation shims"
git push origin master:main
```

---

### Task 0.2: Android — same renames and additions

**Files:**

- Modify: `~/quackback-android/quackback/src/main/kotlin/com/quackback/sdk/QuackbackConfig.kt`
- Modify: `~/quackback-android/quackback/src/main/kotlin/com/quackback/sdk/Quackback.kt`
- Modify: `~/quackback-android/quackback/src/main/kotlin/com/quackback/sdk/internal/JSBridge.kt`
- Modify: `~/quackback-android/quackback/src/test/kotlin/com/quackback/sdk/QuackbackConfigTest.kt`
- Modify: `~/quackback-android/quackback/src/test/kotlin/com/quackback/sdk/JSBridgeTest.kt`
- Modify: `~/quackback-android/README.md`
- Modify: `~/quackback-android/app/src/main/kotlin/com/quackback/example/ExampleApplication.kt`

Same approach as Task 0.1 but in Kotlin. Concrete shapes:

- [ ] **Step 1: Audit `appId` usage**

Run: `grep -rn "appId" ~/quackback-android/quackback/src/main/`
If vestigial, remove.

- [ ] **Step 2: Rename `QuackbackConfig`**

```kotlin
data class QuackbackConfig(
    val appUrl: String,
    val theme: QuackbackTheme = QuackbackTheme.SYSTEM,
    val placement: QuackbackPosition = QuackbackPosition.BOTTOM_RIGHT,
    val buttonColor: String? = null,
    val locale: String? = null,
)
```

- [ ] **Step 3: Update `Quackback.kt` call sites** — `config.baseURL` → `config.appUrl`, `config.position` → `config.placement`.

- [ ] **Step 4: Add metadata method**

```kotlin
fun metadata(patch: Map<String, String?>) {
    enqueue(JSBridge.metadataCommand(patch))
}
```

In `JSBridge.kt`:

```kotlin
fun metadataCommand(patch: Map<String, String?>): String {
    val obj = JSONObject()
    for ((k, v) in patch) obj.put(k, v ?: JSONObject.NULL)
    return "window.postMessage({type:'quackback:metadata',data:$obj},'*');"
}
```

- [ ] **Step 5: Extend `open(...)`**

```kotlin
enum class OpenView(val value: String) {
    HOME("home"), NEW_POST("new-post"), CHANGELOG("changelog")
}

fun open(view: OpenView? = null, title: String? = null, board: String? = null) {
    val cfg = config ?: return
    val act = currentActivity ?: return
    ensureWV(cfg)
    wvManager?.execute(JSBridge.openCommand(view, title, board))
    present(act)
}
```

- [ ] **Step 6–8: Update tests, example, README.**
- [ ] **Step 9: Commit + push.**

```bash
cd ~/quackback-android
git add -A
git commit -m "feat: unify surface — rename baseURL→appUrl, position→placement; add metadata and open options

Matches the iOS and web surface. Pre-production breaking change."
git push origin master:main
```

---

### Task 0.3: Web SDK — add `showLauncher` / `hideLauncher` commands

**Files:**

- Modify: `~/quackback/apps/web/src/lib/shared/widget/sdk-template.ts`
- Modify: `~/quackback/apps/web/src/lib/shared/widget/__tests__/sdk-template.test.ts`

These commands exist on mobile and give developers an imperative hook to show/hide the launcher at runtime. The web SDK currently only supports the declarative `launcher: false` init option.

- [ ] **Step 1: Write failing tests**

Append to `sdk-template.test.ts`:

```ts
it('handles showLauncher and hideLauncher commands', () => {
  const result = buildWidgetSDK('https://feedback.acme.com')
  expect(result).toContain('case "showLauncher"')
  expect(result).toContain('case "hideLauncher"')
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd ~/quackback && bunx vitest run apps/web/src/lib/shared/widget/__tests__/sdk-template.test.ts`
Expected: FAIL — new test case fails string match.

- [ ] **Step 3: Implement the commands in `sdk-template.ts`**

Inside the `dispatch` switch (near the existing `init`/`identify`/`logout` cases):

```js
case "showLauncher":
  if (!launcher && !(config && config.launcher === false)) createLauncher();
  else if (launcher) launcher.style.display = "flex";
  break;

case "hideLauncher":
  if (launcher) launcher.style.display = "none";
  break;
```

- [ ] **Step 4: Run test, verify pass**

Run the same vitest command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/quackback
git add apps/web/src/lib/shared/widget
git commit -m "feat(widget): add showLauncher/hideLauncher imperative commands

Mirrors iOS/Android showLauncher()/hideLauncher(). The launcher init
option remains for declarative control at startup; these commands
let apps toggle launcher visibility at runtime."
git push origin main
```

---

### Task 0.4: Docs — update mobile-sdks and installation for the unified surface

**Files:**

- Modify: `~/quackback-docs/widget/mobile-sdks.mdx`
- Modify: `~/quackback-docs/widget/installation.mdx`

- [ ] **Step 1: Update `mobile-sdks.mdx`**

Replace every `baseURL` with `appUrl`, every `position` with `placement`. Drop the `appId` parameter from all `QuackbackConfig` examples. Add sections for `metadata(...)` and the extended `open(...)` signature. Keep the design-principle line visible: _"Everything about startup state goes in `configure`; changes at runtime are method calls."_

- [ ] **Step 2: Update `installation.mdx`**

Add `showLauncher` / `hideLauncher` rows to the SDK commands reference table. Example block:

```js
Quackback('showLauncher') // show the launcher
Quackback('hideLauncher') // hide it
```

Note under `init` options: _"Set `launcher: false` to start with the button hidden. Use `Quackback("showLauncher")` / `Quackback("hideLauncher")` to toggle at runtime."_

- [ ] **Step 3: Commit + push**

```bash
cd ~/quackback-docs
git add widget/
git commit -m "docs(widget): unified surface — appUrl, placement, metadata, showLauncher/hideLauncher"
git push origin main
```

---

### Task 0.5: Redeploy website (docs are build-time fetched)

- [ ] **Step 1: Confirm production widget URL**

Check that `~/website/src/routes/__root.tsx` still uses `https://feedback.quackback.io/api/widget/sdk.js` (not the ngrok local URL).

- [ ] **Step 2: Deploy**

```bash
cd ~/website
bun run deploy
```

Expected: Cloudflare Worker deploys successfully.

- [ ] **Step 3: Verify**

```bash
curl -s https://quackback.io/docs/widget/installation | grep -c 'showLauncher'
```

Expected: at least 1 match.

- [ ] **Step 4: Restore ngrok URL locally if used for dev** (not committed).

---

### Task 1: Create `packages/widget` scaffold

**Files:**

- Create: `packages/widget/package.json`
- Create: `packages/widget/tsconfig.json`
- Create: `packages/widget/README.md` (stub)
- Create: `packages/widget/src/index.ts` (empty placeholder)

- [ ] **Step 1: Create `packages/widget/package.json`**

```json
{
  "name": "@quackback/widget",
  "version": "0.1.0",
  "private": true,
  "license": "AGPL-3.0",
  "description": "Quackback feedback widget — embed on your site with a tiny SDK.",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./react": "./src/react/index.ts"
  },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "react": ">=16.8"
  },
  "peerDependenciesMeta": {
    "react": { "optional": true }
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "@testing-library/react": "^14.0.0",
    "happy-dom": "^13.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/widget/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "__tests__"]
}
```

_(If `tsconfig.base.json` doesn't exist at root, copy the relevant compiler options from `packages/ids/tsconfig.json` inline and drop `extends`.)_

- [ ] **Step 3: Create `packages/widget/src/index.ts`** (stub — filled in Task 12)

```ts
export {}
```

- [ ] **Step 4: Create `packages/widget/README.md`** (stub)

```markdown
# @quackback/widget

Quackback feedback widget for the web.

See https://quackback.io/docs/widget/installation for setup.
```

- [ ] **Step 5: Install workspace deps and verify**

Run: `cd ~/quackback && bun install`
Expected: `+ @quackback/widget@0.1.0` appears in output (workspace linked).

Run: `cd ~/quackback/packages/widget && bunx tsc --noEmit`
Expected: Exit code 0 (empty module typechecks).

- [ ] **Step 6: Commit**

```bash
cd ~/quackback
git add packages/widget package.json
git commit -m "feat(widget): scaffold @quackback/widget package"
```

---

### Task 2: Define public types

**Files:**

- Create: `packages/widget/src/types.ts`

- [ ] **Step 1: Write `types.ts`**

```ts
// Tenant Quackback URL — e.g. "https://feedback.acme.com"
export type AppUrl = string

/** Passed to `Quackback("init", ...)` or `Quackback.init(...)`. */
export interface InitOptions {
  /** Tenant Quackback URL — required when using the npm package. */
  appUrl: AppUrl
  placement?: 'left' | 'right'
  defaultBoard?: string
  /** Set `launcher: false` to hide the default floating button and open programmatically. */
  launcher?: boolean
  buttonColor?: string
  tabs?: { feedback?: boolean; changelog?: boolean; help?: boolean }
  locale?: 'en' | 'fr' | 'de' | 'es' | 'ar' | string
  /** Bundle identity into init — shorthand for init + identify. */
  identity?: Identity
  /** Override server-provided theme (see /api/widget/config.json). */
  theme?: WidgetTheme
}

/**
 * What the host app passes to identify the current user.
 *
 * For anonymous sessions, call `identify()` with no argument — don't pass
 * `{ anonymous: true }`. (The runtime still accepts `{ anonymous: true }` for
 * backwards-compat with muscle memory from Intercom/Featurebase, but it's not
 * in the type so TypeScript users get nudged to the cleaner form.)
 */
export type Identity =
  | { ssoToken: string }
  | ({ id: string; email: string; name?: string; avatarURL?: string } & Record<string, unknown>)

export interface OpenOptions {
  view?: 'home' | 'new-post' | 'changelog'
  title?: string
  board?: string
}

export interface WidgetTheme {
  lightPrimary?: string
  lightPrimaryForeground?: string
  darkPrimary?: string
  darkPrimaryForeground?: string
  radius?: string
  themeMode?: 'light' | 'dark' | 'user'
}

/** Events emitted by the widget iframe. */
export interface EventMap {
  ready: Record<string, never>
  open: Record<string, never>
  close: Record<string, never>
  'post:created': {
    id: string
    title: string
    board: { id: string; name: string; slug: string }
    statusId: string | null
  }
  vote: { postId: string; voted: boolean; voteCount: number }
  'comment:created': { postId: string; commentId: string; parentId: string | null }
  identify: {
    success: boolean
    user: { id: string; name: string; email: string } | null
    anonymous: boolean
    error?: string
  }
}

export type EventName = keyof EventMap
export type EventHandler<T extends EventName> = (payload: EventMap[T]) => void
export type Unsubscribe = () => void
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd ~/quackback/packages/widget && bunx tsc --noEmit`
Expected: Exit code 0.

- [ ] **Step 3: Commit**

```bash
git add packages/widget/src/types.ts
git commit -m "feat(widget): define public types"
```

---

## Phase 2 — Extract core modules

For each extraction task, the pattern is:

1. Create the file with a focused module.
2. Write tests that exercise its contract (not internal implementation).
3. Verify tests pass.
4. Commit.

The source logic lives in `apps/web/src/lib/shared/widget/sdk-template.ts`. Treat that file as the reference — the tests should pin behavior, then the implementation can be refactored freely.

### Task 3: Event emitter (`events.ts`)

**Files:**

- Create: `packages/widget/src/core/events.ts`
- Create: `packages/widget/__tests__/events.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/widget/__tests__/events.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createEmitter } from '../src/core/events'

describe('events', () => {
  it('calls a subscribed handler with the payload', () => {
    const e = createEmitter()
    const fn = vi.fn()
    e.on('vote', fn)
    e.emit('vote', { postId: 'p1', voted: true, voteCount: 5 })
    expect(fn).toHaveBeenCalledWith({ postId: 'p1', voted: true, voteCount: 5 })
  })

  it('returns an unsubscribe function from on()', () => {
    const e = createEmitter()
    const fn = vi.fn()
    const unsub = e.on('vote', fn)
    unsub()
    e.emit('vote', { postId: 'p1', voted: true, voteCount: 0 })
    expect(fn).not.toHaveBeenCalled()
  })

  it('off() removes a specific handler', () => {
    const e = createEmitter()
    const a = vi.fn()
    const b = vi.fn()
    e.on('vote', a)
    e.on('vote', b)
    e.off('vote', a)
    e.emit('vote', { postId: 'p1', voted: true, voteCount: 0 })
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledOnce()
  })

  it('off() with no handler removes all for that event', () => {
    const e = createEmitter()
    const a = vi.fn()
    const b = vi.fn()
    e.on('vote', a)
    e.on('vote', b)
    e.off('vote')
    e.emit('vote', { postId: 'p1', voted: true, voteCount: 0 })
    expect(a).not.toHaveBeenCalled()
    expect(b).not.toHaveBeenCalled()
  })

  it('swallows handler errors so one bad listener does not break others', () => {
    const e = createEmitter()
    const bad = vi.fn(() => {
      throw new Error('boom')
    })
    const good = vi.fn()
    e.on('vote', bad)
    e.on('vote', good)
    e.emit('vote', { postId: 'p1', voted: true, voteCount: 0 })
    expect(good).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/quackback/packages/widget && bunx vitest run __tests__/events.test.ts`
Expected: FAIL with "Cannot find module './src/core/events'".

- [ ] **Step 3: Write the implementation**

`packages/widget/src/core/events.ts`:

```ts
import type { EventName, EventMap, EventHandler, Unsubscribe } from '../types'

type Listeners = { [K in EventName]?: EventHandler<K>[] }

export interface Emitter {
  on<T extends EventName>(name: T, handler: EventHandler<T>): Unsubscribe
  off<T extends EventName>(name: T, handler?: EventHandler<T>): void
  emit<T extends EventName>(name: T, payload: EventMap[T]): void
}

export function createEmitter(): Emitter {
  const listeners: Listeners = {}

  return {
    on(name, handler) {
      const list = (listeners[name] ??= [] as EventHandler<typeof name>[])
      ;(list as EventHandler<typeof name>[]).push(handler)
      return () => {
        const current = listeners[name]
        if (!current) return
        listeners[name] = current.filter((h) => h !== handler) as typeof current
      }
    },

    off(name, handler) {
      if (!handler) {
        delete listeners[name]
        return
      }
      const current = listeners[name]
      if (!current) return
      listeners[name] = current.filter((h) => h !== handler) as typeof current
    },

    emit(name, payload) {
      const list = listeners[name]
      if (!list) return
      for (const h of list) {
        try {
          ;(h as EventHandler<typeof name>)(payload)
        } catch {
          // swallow — one bad handler shouldn't break the rest
        }
      }
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/quackback/packages/widget && bunx vitest run __tests__/events.test.ts`
Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add packages/widget/src/core/events.ts packages/widget/__tests__/events.test.ts
git commit -m "feat(widget): typed event emitter"
```

---

### Task 4: postMessage protocol (`postmessage.ts`)

**Files:**

- Create: `packages/widget/src/core/postmessage.ts`
- Create: `packages/widget/__tests__/postmessage.test.ts`

This module wraps the iframe message contract. Inbound types (SDK → iframe): `quackback:init`, `quackback:identify`, `quackback:metadata`, `quackback:open`, `quackback:locale`, `quackback:mobile`. Outbound types (iframe → SDK): `quackback:ready`, `quackback:close`, `quackback:navigate`, `quackback:identify-result`, `quackback:auth-change`, `quackback:event`.

- [ ] **Step 1: Write the failing test**

`packages/widget/__tests__/postmessage.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createBridge } from '../src/core/postmessage'

describe('postmessage bridge', () => {
  let postMessage: ReturnType<typeof vi.fn>
  let fakeIframe: { contentWindow: { postMessage: typeof postMessage } }

  beforeEach(() => {
    postMessage = vi.fn()
    fakeIframe = { contentWindow: { postMessage } }
  })

  afterEach(() => vi.restoreAllMocks())

  it('sendToWidget posts a typed message to the iframe origin', () => {
    const bridge = createBridge({
      getIframe: () => fakeIframe as unknown as HTMLIFrameElement,
      origin: 'https://feedback.acme.com',
    })
    bridge.send('quackback:identify', { anonymous: true })
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'quackback:identify', data: { anonymous: true } },
      'https://feedback.acme.com'
    )
  })

  it('ignores events from other origins', () => {
    const onRecv = vi.fn()
    const bridge = createBridge({
      getIframe: () => fakeIframe as unknown as HTMLIFrameElement,
      origin: 'https://feedback.acme.com',
    })
    bridge.onMessage(onRecv)
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.example',
        data: { type: 'quackback:ready' },
      })
    )
    expect(onRecv).not.toHaveBeenCalled()
  })

  it('forwards valid messages from the iframe origin', () => {
    const onRecv = vi.fn()
    const bridge = createBridge({
      getIframe: () => fakeIframe as unknown as HTMLIFrameElement,
      origin: 'https://feedback.acme.com',
    })
    bridge.onMessage(onRecv)
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://feedback.acme.com',
        data: { type: 'quackback:ready' },
      })
    )
    expect(onRecv).toHaveBeenCalledWith({ type: 'quackback:ready' })
  })

  it('ignores non-object data', () => {
    const onRecv = vi.fn()
    const bridge = createBridge({
      getIframe: () => fakeIframe as unknown as HTMLIFrameElement,
      origin: 'https://feedback.acme.com',
    })
    bridge.onMessage(onRecv)
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://feedback.acme.com',
        data: 'hello',
      })
    )
    expect(onRecv).not.toHaveBeenCalled()
  })
})
```

Ensure the package `vitest.config.ts` sets `environment: 'jsdom'`. Add it as Step 0 if missing:

`packages/widget/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
  },
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/quackback/packages/widget && bunx vitest run __tests__/postmessage.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

`packages/widget/src/core/postmessage.ts`:

```ts
export type InboundMessage =
  | { type: 'quackback:init'; data?: unknown }
  | { type: 'quackback:identify'; data: unknown }
  | { type: 'quackback:metadata'; data: Record<string, string> }
  | { type: 'quackback:open'; data?: unknown }
  | { type: 'quackback:locale'; data: string }
  | { type: 'quackback:mobile'; data: boolean }

export type OutboundMessage =
  | { type: 'quackback:ready' }
  | { type: 'quackback:close' }
  | { type: 'quackback:navigate'; url: string }
  | { type: 'quackback:identify-result'; success: boolean; user?: unknown; error?: string }
  | { type: 'quackback:auth-change'; user: unknown }
  | { type: 'quackback:event'; name: string; payload: unknown }

export interface BridgeOptions {
  getIframe: () => HTMLIFrameElement | null
  origin: string
}

export interface Bridge {
  send(type: InboundMessage['type'], data?: unknown): void
  onMessage(handler: (msg: OutboundMessage) => void): () => void
  dispose(): void
}

export function createBridge(opts: BridgeOptions): Bridge {
  const handlers = new Set<(msg: OutboundMessage) => void>()

  const listener = (event: MessageEvent) => {
    if (event.origin !== opts.origin) return
    const msg = event.data
    if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string')
      return
    for (const h of handlers) {
      try {
        h(msg as OutboundMessage)
      } catch {
        /* swallow */
      }
    }
  }
  window.addEventListener('message', listener)

  return {
    send(type, data) {
      const iframe = opts.getIframe()
      if (!iframe?.contentWindow) return
      iframe.contentWindow.postMessage({ type, data }, opts.origin)
    },
    onMessage(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    dispose() {
      window.removeEventListener('message', listener)
      handlers.clear()
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/quackback/packages/widget && bunx vitest run __tests__/postmessage.test.ts`
Expected: 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add packages/widget/src/core/postmessage.ts packages/widget/__tests__/postmessage.test.ts packages/widget/vitest.config.ts
git commit -m "feat(widget): iframe postmessage bridge"
```

---

### Task 5: Theme resolution (`theme.ts`)

Extract the `isDarkMode`, `getThemeColors`, and `applyLauncherColors` logic from `sdk-template.ts` lines 93–114.

**Files:**

- Create: `packages/widget/src/core/theme.ts`
- Create: `packages/widget/__tests__/theme.test.ts`

- [ ] **Step 1: Write failing test**

`packages/widget/__tests__/theme.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { resolveColors } from '../src/core/theme'

describe('theme.resolveColors', () => {
  const defaults = {
    lightPrimary: '#6366f1',
    lightPrimaryFg: '#ffffff',
    darkPrimary: '#818cf8',
    darkPrimaryFg: '#0f172a',
    themeMode: 'user' as const,
  }

  it('uses light colors when themeMode is light', () => {
    const c = resolveColors({ theme: { ...defaults, themeMode: 'light' }, matches: () => true })
    expect(c).toEqual({ bg: '#6366f1', fg: '#ffffff' })
  })

  it('uses dark colors when themeMode is dark', () => {
    const c = resolveColors({ theme: { ...defaults, themeMode: 'dark' }, matches: () => false })
    expect(c).toEqual({ bg: '#818cf8', fg: '#0f172a' })
  })

  it('follows system preference when themeMode is user', () => {
    const c = resolveColors({ theme: defaults, matches: () => true })
    expect(c.bg).toBe('#818cf8')
  })

  it('custom buttonColor overrides theme bg', () => {
    const c = resolveColors({ theme: defaults, matches: () => false, buttonColor: '#ff0000' })
    expect(c).toEqual({ bg: '#ff0000', fg: '#ffffff' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/quackback/packages/widget && bunx vitest run __tests__/theme.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`packages/widget/src/core/theme.ts`:

```ts
export interface ResolvedTheme {
  lightPrimary: string
  lightPrimaryFg: string
  darkPrimary: string
  darkPrimaryFg: string
  radius: string
  themeMode: 'light' | 'dark' | 'user'
}

export function withDefaults(partial?: Partial<ResolvedTheme>): ResolvedTheme {
  return {
    lightPrimary: partial?.lightPrimary ?? '#6366f1',
    lightPrimaryFg: partial?.lightPrimaryFg ?? '#ffffff',
    darkPrimary: partial?.darkPrimary ?? partial?.lightPrimary ?? '#6366f1',
    darkPrimaryFg: partial?.darkPrimaryFg ?? partial?.lightPrimaryFg ?? '#ffffff',
    radius: partial?.radius ?? '24px',
    themeMode: partial?.themeMode ?? 'user',
  }
}

export function isDark(theme: ResolvedTheme, matchesDark: () => boolean): boolean {
  if (theme.themeMode === 'light') return false
  if (theme.themeMode === 'dark') return true
  return matchesDark()
}

export interface ResolveColorsOptions {
  theme: ResolvedTheme
  matches: () => boolean // typically () => window.matchMedia('(prefers-color-scheme: dark)').matches
  buttonColor?: string
}

export function resolveColors({ theme, matches, buttonColor }: ResolveColorsOptions): {
  bg: string
  fg: string
} {
  const dark = isDark(theme, matches)
  return {
    bg: buttonColor || (dark ? theme.darkPrimary : theme.lightPrimary),
    fg: dark ? theme.darkPrimaryFg : theme.lightPrimaryFg,
  }
}
```

- [ ] **Step 4: Run test**

Run: `cd ~/quackback/packages/widget && bunx vitest run __tests__/theme.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/widget/src/core/theme.ts packages/widget/__tests__/theme.test.ts
git commit -m "feat(widget): extract theme resolution"
```

---

### Task 6: Launcher button (`launcher.ts`)

Extract the `createLauncher`, icon swap logic, and hover behavior from `sdk-template.ts` lines 115–198.

**Files:**

- Create: `packages/widget/src/core/launcher.ts`

No unit test — this is DOM plumbing that's exercised by `sdk.test.ts` integration tests in Task 9. A separate test would be mocking DOM state to re-assert what the browser already guarantees.

- [ ] **Step 1: Create `launcher.ts`**

Port lines 115–198 of `sdk-template.ts`. The module exports:

```ts
import type { ResolvedTheme } from './theme'
import { resolveColors } from './theme'

export interface LauncherOptions {
  theme: ResolvedTheme
  placement: 'left' | 'right'
  buttonColor?: string
  onClick: () => void
}

export interface LauncherHandle {
  el: HTMLButtonElement
  setOpen(open: boolean): void
  applyColors(): void
  remove(): void
}

const CHAT_ICON =
  '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M4.913 2.658c2.075-.27 4.19-.408 6.337-.408 2.147 0 4.262.139 6.337.408 1.922.25 3.291 1.861 3.405 3.727a4.403 4.403 0 0 0-1.032-.211 50.89 50.89 0 0 0-8.42 0c-2.358.196-4.04 2.19-4.04 4.434v4.286a4.47 4.47 0 0 0 2.433 3.984L7.28 21.53A.75.75 0 0 1 6 21v-4.03a48.527 48.527 0 0 1-1.087-.128C2.905 16.58 1.5 14.833 1.5 12.862V6.638c0-1.97 1.405-3.718 3.413-3.979Z"/><path d="M15.75 7.5c-1.376 0-2.739.057-4.086.169C10.124 7.797 9 9.103 9 10.609v4.285c0 1.507 1.128 2.814 2.67 2.94 1.243.102 2.5.157 3.768.165l2.782 2.781a.75.75 0 0 0 1.28-.53v-2.39l.33-.026c1.542-.125 2.67-1.433 2.67-2.94v-4.286c0-1.505-1.125-2.811-2.664-2.94A49.392 49.392 0 0 0 15.75 7.5Z"/></svg>'
const CLOSE_ICON =
  '<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M6 18L18 6M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

export function createLauncher(opts: LauncherOptions): LauncherHandle {
  const btn = document.createElement('button')
  const colors = resolveColors({
    theme: opts.theme,
    matches: () => window.matchMedia('(prefers-color-scheme: dark)').matches,
    buttonColor: opts.buttonColor,
  })

  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '24px',
    [opts.placement === 'left' ? 'left' : 'right']: '24px',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '48px',
    height: '48px',
    padding: '0',
    border: 'none',
    borderRadius: '50%',
    backgroundColor: colors.bg,
    color: colors.fg,
    fontSize: '14px',
    fontWeight: '600',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    transition:
      'transform 200ms ease, box-shadow 200ms ease, background-color 200ms ease, color 200ms ease',
  })
  btn.setAttribute('aria-label', 'Open feedback widget')
  btn.setAttribute('aria-expanded', 'false')

  const wrapper = document.createElement('div')
  Object.assign(wrapper.style, {
    position: 'relative',
    display: 'flex',
    width: '28px',
    height: '28px',
    flexShrink: '0',
  })

  const iconTransition =
    'opacity 220ms cubic-bezier(0.34,1.56,0.64,1), transform 220ms cubic-bezier(0.34,1.56,0.64,1)'
  const iconChat = document.createElement('span')
  Object.assign(iconChat.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    display: 'flex',
    opacity: '1',
    transform: 'rotate(0deg)',
    transition: iconTransition,
  })
  iconChat.innerHTML = CHAT_ICON
  const iconClose = document.createElement('span')
  Object.assign(iconClose.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    display: 'flex',
    opacity: '0',
    transform: 'rotate(-90deg)',
    transition: iconTransition,
  })
  iconClose.innerHTML = CLOSE_ICON
  wrapper.appendChild(iconChat)
  wrapper.appendChild(iconClose)
  btn.appendChild(wrapper)

  btn.addEventListener('mouseenter', () => {
    btn.style.transform = 'translateY(-2px)'
    btn.style.boxShadow = '0 6px 20px rgba(0,0,0,0.2)'
  })
  btn.addEventListener('mouseleave', () => {
    btn.style.transform = 'translateY(0)'
    btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'
  })
  btn.addEventListener('click', opts.onClick)

  document.body.appendChild(btn)

  const mediaQuery =
    opts.theme.themeMode === 'user' ? window.matchMedia('(prefers-color-scheme: dark)') : null
  const applyColors = () => {
    const c = resolveColors({
      theme: opts.theme,
      matches: () => mediaQuery?.matches ?? false,
      buttonColor: opts.buttonColor,
    })
    btn.style.backgroundColor = c.bg
    btn.style.color = c.fg
  }
  mediaQuery?.addEventListener('change', applyColors)

  return {
    el: btn,
    setOpen(open) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false')
      btn.setAttribute('aria-label', open ? 'Close feedback widget' : 'Open feedback widget')
      iconChat.style.opacity = open ? '0' : '1'
      iconChat.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)'
      iconClose.style.opacity = open ? '1' : '0'
      iconClose.style.transform = open ? 'rotate(0deg)' : 'rotate(-90deg)'
    },
    applyColors,
    remove() {
      mediaQuery?.removeEventListener('change', applyColors)
      btn.remove()
    },
  }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd ~/quackback/packages/widget && bunx tsc --noEmit`
Expected: Exit code 0.

- [ ] **Step 3: Commit**

```bash
git add packages/widget/src/core/launcher.ts
git commit -m "feat(widget): extract launcher module"
```

---

### Task 7: Panel + iframe (`panel.ts`) and styles (`style.ts`)

Extract the `createPanel`, `showPanel`, `hidePanel`, and the stylesheet injection from `sdk-template.ts` lines 204–339.

**Files:**

- Create: `packages/widget/src/core/style.ts`
- Create: `packages/widget/src/core/panel.ts`

- [ ] **Step 1: Create `style.ts`**

Extract the CSS string from `sdk-template.ts` lines 215–244:

```ts
const STYLE_ID = 'quackback-widget-styles'

export function ensureStyles(side: 'left' | 'right'): void {
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = [
    '.quackback-panel{position:fixed;z-index:2147483647;overflow:hidden;pointer-events:none;',
    `bottom:88px;${side}:24px;width:400px;height:min(600px,calc(100vh - 108px));`,
    `border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.12);`,
    `opacity:0;transform:scale(0);transform-origin:bottom ${side};`,
    'transition:opacity 280ms cubic-bezier(0.34,1.56,0.64,1),transform 280ms cubic-bezier(0.34,1.56,0.64,1)}',
    '.quackback-panel.quackback-open{opacity:1;transform:scale(1);pointer-events:auto}',
    '.quackback-panel.quackback-closing{opacity:0;transform:scale(0);pointer-events:none;',
    'transition:opacity 200ms cubic-bezier(0.4,0,1,1),transform 200ms cubic-bezier(0.4,0,1,1)}',
    '@media(max-width:639px){',
    '.quackback-panel{top:0;left:0;right:0;bottom:0;width:100%;height:100vh;',
    'border-radius:0;box-shadow:none;',
    'opacity:1;transform:translateY(100%);transform-origin:center;',
    'transition:transform 300ms cubic-bezier(0.4,0,0.2,1)}',
    '.quackback-panel.quackback-open{transform:translateY(0)}',
    '.quackback-panel.quackback-closing{transform:translateY(100%);transition:transform 200ms cubic-bezier(0.4,0,1,1)}}',
    '.quackback-backdrop{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.4);',
    'opacity:0;pointer-events:none;transition:opacity 200ms ease}',
    '.quackback-backdrop.quackback-open{opacity:1;pointer-events:auto}',
    '@media(min-width:640px){.quackback-backdrop{display:none!important}}',
  ].join('')
  document.head.appendChild(el)
}

export function removeStyles(): void {
  document.getElementById(STYLE_ID)?.remove()
}
```

- [ ] **Step 2: Create `panel.ts`**

Port `createPanel`/`showPanel`/`hidePanel` from the template (lines 204–339). Export a handle:

```ts
import { ensureStyles } from './style'

export interface PanelOptions {
  widgetUrl: string // e.g. "https://feedback.acme.com/widget"
  placement: 'left' | 'right'
  defaultBoard?: string
  showCloseButton?: boolean
  locale?: string
  onBackdropClick: () => void
}

export interface PanelHandle {
  iframe: HTMLIFrameElement
  show(): void
  hide(): void
  destroy(): void
}

export function createPanel(opts: PanelOptions): PanelHandle {
  ensureStyles(opts.placement)

  const params: string[] = []
  if (opts.defaultBoard) params.push(`board=${encodeURIComponent(opts.defaultBoard)}`)
  if (opts.showCloseButton) params.push('showClose=1')
  if (opts.locale) params.push(`locale=${encodeURIComponent(opts.locale)}`)
  const url = opts.widgetUrl + (params.length ? '?' + params.join('&') : '')

  const backdrop = document.createElement('div')
  backdrop.className = 'quackback-backdrop'
  backdrop.addEventListener('click', opts.onBackdropClick)
  document.body.appendChild(backdrop)

  const panel = document.createElement('div')
  panel.className = 'quackback-panel quackback-widget-iframe-wrapper'
  document.body.appendChild(panel)

  const iframe = document.createElement('iframe')
  Object.assign(iframe.style, {
    width: '100%',
    height: '100%',
    border: 'none',
    colorScheme: 'normal',
  })
  iframe.setAttribute('src', url)
  iframe.setAttribute('title', 'Feedback Widget')
  iframe.setAttribute(
    'sandbox',
    'allow-scripts allow-forms allow-same-origin allow-popups allow-downloads'
  )
  iframe.setAttribute('allow', 'clipboard-write')
  iframe.className = 'quackback-widget-iframe'
  panel.appendChild(iframe)

  let open = false

  return {
    iframe,
    show() {
      if (open) return
      open = true
      panel.classList.remove('quackback-closing')
      backdrop.classList.remove('quackback-closing')
      void panel.offsetHeight // force reflow
      panel.classList.add('quackback-open')
      backdrop.classList.add('quackback-open')
    },
    hide() {
      if (!open) return
      open = false
      panel.classList.remove('quackback-open')
      panel.classList.add('quackback-closing')
      backdrop.classList.remove('quackback-open')
      backdrop.classList.add('quackback-closing')
      setTimeout(() => {
        panel.classList.remove('quackback-closing')
        backdrop.classList.remove('quackback-closing')
      }, 300)
    },
    destroy() {
      panel.remove()
      backdrop.remove()
    },
  }
}
```

- [ ] **Step 3: Verify typecheck**

Run: `cd ~/quackback/packages/widget && bunx tsc --noEmit`
Expected: Exit code 0.

- [ ] **Step 4: Commit**

```bash
git add packages/widget/src/core/style.ts packages/widget/src/core/panel.ts
git commit -m "feat(widget): extract panel, iframe, and styles"
```

---

### Task 8: Remote config (`config.ts`)

The current template bakes theme at generation time. npm users get theme from `/api/widget/config.json` at init.

**Files:**

- Create: `packages/widget/src/core/config.ts`
- Create: `packages/widget/__tests__/config.test.ts`

- [ ] **Step 1: Write failing test**

`packages/widget/__tests__/config.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchServerConfig } from '../src/core/config'

describe('config.fetchServerConfig', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches and returns theme from /api/widget/config.json', async () => {
    const mock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ theme: { lightPrimary: '#ff0000' } }),
    }))
    vi.stubGlobal('fetch', mock)
    const cfg = await fetchServerConfig('https://feedback.acme.com')
    expect(mock).toHaveBeenCalledWith('https://feedback.acme.com/api/widget/config.json')
    expect(cfg.theme?.lightPrimary).toBe('#ff0000')
  })

  it('returns empty config if fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    )
    const cfg = await fetchServerConfig('https://feedback.acme.com')
    expect(cfg).toEqual({})
  })

  it('swallows network errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      })
    )
    const cfg = await fetchServerConfig('https://feedback.acme.com')
    expect(cfg).toEqual({})
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd ~/quackback/packages/widget && bunx vitest run __tests__/config.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`packages/widget/src/core/config.ts`:

```ts
import type { WidgetTheme } from '../types'

export interface ServerConfig {
  theme?: WidgetTheme
  tabs?: { feedback?: boolean; changelog?: boolean; help?: boolean }
  imageUploadsInWidget?: boolean
  hmacRequired?: boolean
}

export async function fetchServerConfig(appUrl: string): Promise<ServerConfig> {
  try {
    const res = await fetch(`${appUrl}/api/widget/config.json`)
    if (!res.ok) return {}
    return (await res.json()) as ServerConfig
  } catch {
    return {}
  }
}
```

- [ ] **Step 4: Run test**

Run: `cd ~/quackback/packages/widget && bunx vitest run __tests__/config.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/widget/src/core/config.ts packages/widget/__tests__/config.test.ts
git commit -m "feat(widget): remote config fetch"
```

---

### Task 9: SDK orchestrator (`sdk.ts`)

Wires launcher + panel + postmessage + config + events into the dispatcher that replaces the old string template. Ports the state machine from `sdk-template.ts` lines 402–500.

**Files:**

- Create: `packages/widget/src/core/sdk.ts`
- Create: `packages/widget/__tests__/sdk.test.ts`

- [ ] **Step 1: Write the failing test (high-level behavior)**

`packages/widget/__tests__/sdk.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSDK } from '../src/core/sdk'

describe('sdk', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.head.innerHTML = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ theme: {} }) }))
    )
  })

  afterEach(() => vi.restoreAllMocks())

  it('init creates a launcher and iframe', async () => {
    const sdk = createSDK()
    sdk.dispatch('init', { appUrl: 'https://feedback.acme.com' })
    await Promise.resolve()
    expect(document.querySelector('button[aria-label="Open feedback widget"]')).not.toBeNull()
    expect(document.querySelector('iframe[title="Feedback Widget"]')).not.toBeNull()
  })

  it('init with { launcher: false } does not create a button', async () => {
    const sdk = createSDK()
    sdk.dispatch('init', { appUrl: 'https://feedback.acme.com', launcher: false })
    await Promise.resolve()
    expect(document.querySelector('button[aria-label="Open feedback widget"]')).toBeNull()
  })

  it('init defaults identity to anonymous', () => {
    const sdk = createSDK()
    const postMessage = vi.fn()
    const origSpy = vi
      .spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get')
      .mockReturnValue({ postMessage } as unknown as Window)
    sdk.dispatch('init', { appUrl: 'https://feedback.acme.com' })
    // Simulate iframe ready:
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://feedback.acme.com',
        data: { type: 'quackback:ready' },
      })
    )
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'quackback:identify', data: { anonymous: true } },
      'https://feedback.acme.com'
    )
    origSpy.mockRestore()
  })

  it('identify sends the given payload after ready', () => {
    const sdk = createSDK()
    const postMessage = vi.fn()
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue({
      postMessage,
    } as unknown as Window)
    sdk.dispatch('init', { appUrl: 'https://feedback.acme.com' })
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://feedback.acme.com',
        data: { type: 'quackback:ready' },
      })
    )
    sdk.dispatch('identify', { id: 'u', email: 'a@b.c', name: 'A' })
    expect(postMessage).toHaveBeenLastCalledWith(
      { type: 'quackback:identify', data: { id: 'u', email: 'a@b.c', name: 'A' } },
      'https://feedback.acme.com'
    )
  })

  it('logout sends null identify and keeps the launcher visible', () => {
    const sdk = createSDK()
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue({
      postMessage: vi.fn(),
    } as unknown as Window)
    sdk.dispatch('init', { appUrl: 'https://feedback.acme.com' })
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://feedback.acme.com',
        data: { type: 'quackback:ready' },
      })
    )
    sdk.dispatch('logout')
    const launcher = document.querySelector(
      'button[aria-label="Open feedback widget"]'
    ) as HTMLButtonElement
    expect(launcher).not.toBeNull()
    expect(launcher.style.display).not.toBe('none')
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd ~/quackback/packages/widget && bunx vitest run __tests__/sdk.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `sdk.ts`**

`packages/widget/src/core/sdk.ts`:

```ts
import type { InitOptions, Identity, OpenOptions, EventName, EventHandler } from '../types'
import { createEmitter, type Emitter } from './events'
import { createBridge, type Bridge } from './postmessage'
import { createLauncher, type LauncherHandle } from './launcher'
import { createPanel, type PanelHandle } from './panel'
import { withDefaults, type ResolvedTheme } from './theme'
import { fetchServerConfig } from './config'
import { removeStyles } from './style'

type Command =
  | 'init'
  | 'identify'
  | 'logout'
  | 'open'
  | 'close'
  | 'showLauncher'
  | 'hideLauncher'
  | 'destroy'
  | 'metadata'
  | 'on'
  | 'off'

export interface SDK {
  dispatch(command: Command, arg1?: unknown, arg2?: unknown): unknown
}

export function createSDK(): SDK {
  let config: InitOptions | null = null
  let theme: ResolvedTheme | null = null
  let launcher: LauncherHandle | null = null
  let panel: PanelHandle | null = null
  let bridge: Bridge | null = null
  let ready = false
  let metadata: Record<string, string> | null = null
  let pendingIdentify: Identity | null = null
  let pendingOpen: OpenOptions | null = null
  const emitter: Emitter = createEmitter()

  function iframeOrigin(): string {
    return new URL(config!.appUrl).origin
  }

  function ensurePanel(): PanelHandle {
    if (panel) return panel
    panel = createPanel({
      widgetUrl: `${config!.appUrl}/widget`,
      placement: config!.placement ?? 'right',
      defaultBoard: config!.defaultBoard,
      showCloseButton: config!.launcher === false,
      locale: config!.locale,
      onBackdropClick: () => dispatch('close'),
    })
    bridge = createBridge({
      getIframe: () => panel!.iframe,
      origin: iframeOrigin(),
    })
    bridge.onMessage(onIframeMessage)
    return panel
  }

  function onIframeMessage(msg: { type: string; [k: string]: unknown }) {
    switch (msg.type) {
      case 'quackback:ready':
        ready = true
        if (pendingIdentify !== null) {
          bridge!.send('quackback:identify', pendingIdentify)
          pendingIdentify = null
        }
        if (config?.locale) bridge!.send('quackback:locale', config.locale)
        if (metadata) bridge!.send('quackback:metadata', metadata)
        if (pendingOpen) {
          bridge!.send('quackback:open', pendingOpen)
          pendingOpen = null
        }
        emitter.emit('ready', {})
        break
      case 'quackback:close':
        dispatch('close')
        break
      case 'quackback:identify-result':
        emitter.emit('identify', {
          success: !!(msg as { success: boolean }).success,
          user: (msg as { user?: { id: string; name: string; email: string } }).user ?? null,
          anonymous: !!(msg as { success: boolean }).success && !(msg as { user?: unknown }).user,
          error: (msg as { error?: string }).error,
        })
        break
      case 'quackback:event': {
        const name = (msg as { name?: string }).name
        if (name)
          emitter.emit(name as EventName, ((msg as { payload?: unknown }).payload ?? {}) as never)
        break
      }
      case 'quackback:navigate': {
        const url = (msg as { url?: string }).url
        if (url) window.open(url, '_blank')
        break
      }
    }
  }

  function sendIdentity(data: unknown) {
    if (ready) bridge!.send('quackback:identify', data)
    else pendingIdentify = data as Identity
  }

  function dispatch(cmd: Command, a?: unknown, b?: unknown): unknown {
    switch (cmd) {
      case 'init': {
        config = { ...(a as InitOptions) }
        if (!config.appUrl) throw new Error('Quackback: init requires { appUrl }')
        theme = withDefaults(config.theme)
        if (config.launcher !== false) {
          launcher = createLauncher({
            theme,
            placement: config.placement ?? 'right',
            buttonColor: config.buttonColor,
            onClick: () => {
              if (panel && panel.iframe.offsetParent !== null) dispatch('close')
              else dispatch('open')
            },
          })
        }
        ensurePanel()
        // Internal wire format — the iframe's resolveIdentifyAction keys on
        // `anonymous: true`. Public types don't expose this; it's what we send
        // to the iframe when no identity is provided.
        const initialIdentity: Identity | { anonymous: true } = config.identity ?? {
          anonymous: true,
        }
        sendIdentity(initialIdentity)
        // Fire-and-forget remote theme fetch; override only if caller didn't supply
        if (!config.theme) {
          void fetchServerConfig(config.appUrl).then((serverCfg) => {
            if (serverCfg.theme) {
              theme = withDefaults(serverCfg.theme)
              launcher?.applyColors()
            }
          })
        }
        return
      }
      case 'identify':
        // Undefined/null → anonymous; anything else passes through to the iframe.
        // Runtime is lenient: legacy `{ anonymous: true }` callers still work even
        // though the type no longer advertises that shape.
        sendIdentity(
          (a as Identity | { anonymous: true } | undefined | null) ?? { anonymous: true }
        )
        return
      case 'logout':
        panel?.hide()
        launcher?.setOpen(false)
        if (ready) bridge!.send('quackback:identify', null as unknown as undefined)
        else pendingIdentify = null
        return
      case 'open': {
        const opts = (a as OpenOptions | undefined) ?? {}
        if (ready && bridge) bridge.send('quackback:open', opts)
        else pendingOpen = opts
        panel?.show()
        launcher?.setOpen(true)
        return
      }
      case 'close':
        panel?.hide()
        launcher?.setOpen(false)
        emitter.emit('close', {})
        return
      case 'showLauncher':
        if (!launcher && config && config.launcher !== false) {
          launcher = createLauncher({
            theme: theme!,
            placement: config.placement ?? 'right',
            buttonColor: config.buttonColor,
            onClick: () => {
              if (panel && panel.iframe.offsetParent !== null) dispatch('close')
              else dispatch('open')
            },
          })
        } else if (launcher) {
          launcher.el.style.display = 'flex'
        }
        return
      case 'hideLauncher':
        if (launcher) launcher.el.style.display = 'none'
        return
      case 'on':
        return emitter.on(a as EventName, b as EventHandler<EventName>)
      case 'off':
        emitter.off(a as EventName, b as EventHandler<EventName> | undefined)
        return
      case 'metadata': {
        const patch = a as Record<string, string | null>
        metadata = metadata ?? {}
        for (const k of Object.keys(patch)) {
          const v = patch[k]
          if (v === null) delete metadata[k]
          else metadata[k] = String(v)
        }
        if (ready && bridge) bridge.send('quackback:metadata', metadata)
        return
      }
      case 'destroy':
        panel?.destroy()
        launcher?.remove()
        bridge?.dispose()
        removeStyles()
        panel = null
        launcher = null
        bridge = null
        ready = false
        metadata = null
        pendingIdentify = null
        pendingOpen = null
        config = null
        theme = null
        return
    }
  }

  return { dispatch }
}
```

- [ ] **Step 4: Run tests**

Run: `cd ~/quackback/packages/widget && bunx vitest run __tests__/sdk.test.ts`
Expected: 5 passing. If failures, check state transitions — the test file is the contract.

- [ ] **Step 5: Commit**

```bash
git add packages/widget/src/core/sdk.ts packages/widget/__tests__/sdk.test.ts
git commit -m "feat(widget): SDK orchestrator"
```

---

### Task 10: Public API (`index.ts`)

Exports a singleton `Quackback` object with typed methods, plus named types.

**Files:**

- Modify: `packages/widget/src/index.ts`

- [ ] **Step 1: Replace `index.ts` content**

```ts
import { createSDK } from './core/sdk'
import type {
  InitOptions,
  Identity,
  OpenOptions,
  EventName,
  EventMap,
  EventHandler,
  Unsubscribe,
} from './types'

export type { InitOptions, Identity, OpenOptions, EventName, EventMap, EventHandler, Unsubscribe }

const sdk = createSDK()

export const Quackback = {
  init(options: InitOptions): void {
    sdk.dispatch('init', options)
  },
  identify(identity?: Identity): void {
    sdk.dispatch('identify', identity)
  },
  logout(): void {
    sdk.dispatch('logout')
  },
  open(options?: OpenOptions): void {
    sdk.dispatch('open', options)
  },
  close(): void {
    sdk.dispatch('close')
  },
  showLauncher(): void {
    sdk.dispatch('showLauncher')
  },
  hideLauncher(): void {
    sdk.dispatch('hideLauncher')
  },
  on<T extends EventName>(name: T, handler: EventHandler<T>): Unsubscribe {
    return sdk.dispatch('on', name, handler) as Unsubscribe
  },
  off<T extends EventName>(name: T, handler?: EventHandler<T>): void {
    sdk.dispatch('off', name, handler)
  },
  metadata(patch: Record<string, string | null>): void {
    sdk.dispatch('metadata', patch)
  },
  destroy(): void {
    sdk.dispatch('destroy')
  },
}

export default Quackback
```

- [ ] **Step 2: Add an index-level test**

`packages/widget/__tests__/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import Quackback, { type InitOptions } from '../src'

describe('public API', () => {
  it('exports the expected surface', () => {
    expect(typeof Quackback.init).toBe('function')
    expect(typeof Quackback.identify).toBe('function')
    expect(typeof Quackback.logout).toBe('function')
    expect(typeof Quackback.open).toBe('function')
    expect(typeof Quackback.close).toBe('function')
    expect(typeof Quackback.showLauncher).toBe('function')
    expect(typeof Quackback.hideLauncher).toBe('function')
    expect(typeof Quackback.on).toBe('function')
    expect(typeof Quackback.off).toBe('function')
    expect(typeof Quackback.metadata).toBe('function')
    expect(typeof Quackback.destroy).toBe('function')
  })

  it('init requires appUrl', () => {
    expect(() => Quackback.init({} as InitOptions)).toThrow(/appUrl/)
  })

  it('accepts legacy `{ anonymous: true }` without erroring', () => {
    // Not in the public Identity type, but runtime tolerates it for anyone
    // migrating from Intercom/Featurebase muscle memory.
    Quackback.init({ appUrl: 'https://feedback.acme.com' })
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Quackback.identify({ anonymous: true } as any)
    ).not.toThrow()
    Quackback.destroy()
  })
})
```

- [ ] **Step 3: Run tests**

Run: `cd ~/quackback/packages/widget && bunx vitest run`
Expected: All tests passing.

- [ ] **Step 4: Commit**

```bash
git add packages/widget/src/index.ts packages/widget/__tests__/index.test.ts
git commit -m "feat(widget): public API singleton"
```

---

## Phase 3 — IIFE bundle for script-tag users

### Task 11: Browser-queue entry

Script-tag users use `window.Quackback("cmd", arg)` — a queued dispatcher. Our IIFE needs to:

1. Replay anything already queued before the SDK loaded.
2. Replace `window.Quackback` with a real dispatcher function.

**Files:**

- Create: `packages/widget/src/browser-queue.ts`
- Create: `packages/widget/__tests__/browser-queue.test.ts`

- [ ] **Step 1: Write failing test**

`packages/widget/__tests__/browser-queue.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('browser-queue', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { Quackback?: unknown }).Quackback = undefined
  })

  it('replays queued commands after SDK loads', async () => {
    // Simulate the inline snippet's queue
    const q: IArguments[] = []
    ;(globalThis as unknown as { Quackback: Record<string, unknown> }).Quackback = Object.assign(
      function (this: void) {
        // eslint-disable-next-line prefer-rest-params
        q.push(arguments)
      },
      { q }
    )
    ;(globalThis as unknown as { Quackback: { q: IArguments[] } }).Quackback('init', {
      appUrl: 'https://feedback.acme.com',
    })
    // Pre-fill baked URL the server will inject:
    ;(globalThis as unknown as { __QUACKBACK_URL__?: string }).__QUACKBACK_URL__ =
      'https://feedback.acme.com'
    const dispatched: unknown[] = []
    vi.doMock('../src/core/sdk', () => ({
      createSDK: () => ({
        dispatch: (...args: unknown[]) => dispatched.push(args),
      }),
    }))
    await import('../src/browser-queue')
    expect(dispatched.length).toBeGreaterThan(0)
    expect(dispatched[0]).toEqual(['init', { appUrl: 'https://feedback.acme.com' }, undefined])
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd ~/quackback/packages/widget && bunx vitest run __tests__/browser-queue.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`packages/widget/src/browser-queue.ts`:

```ts
import { createSDK } from './core/sdk'
import type { InitOptions } from './types'

declare global {
  interface Window {
    Quackback?: ((...args: unknown[]) => unknown) & { q?: IArguments[] }
    __QUACKBACK_URL__?: string
  }
}

const sdk = createSDK()
const w = window

// Capture any queued calls from the inline snippet
const queued = w.Quackback?.q ?? []

// If the server baked a URL (via the /api/widget/sdk.js endpoint), auto-fire init
// with sensible defaults. Host apps can still call Quackback("init", ...) to override.
const bakedUrl = w.__QUACKBACK_URL__
if (bakedUrl && !queued.some((args) => args[0] === 'init')) {
  sdk.dispatch('init', { appUrl: bakedUrl } satisfies InitOptions)
}

// Replace the queue with a live dispatcher
w.Quackback = function (...args: unknown[]) {
  return sdk.dispatch(args[0] as 'init', args[1], args[2])
}

// Replay any queued commands
for (const args of queued) {
  sdk.dispatch(
    (args as unknown as unknown[])[0] as 'init',
    (args as unknown as unknown[])[1],
    (args as unknown as unknown[])[2]
  )
}
```

- [ ] **Step 4: Run test**

Run: `cd ~/quackback/packages/widget && bunx vitest run __tests__/browser-queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/widget/src/browser-queue.ts packages/widget/__tests__/browser-queue.test.ts
git commit -m "feat(widget): browser queue replay for script-tag users"
```

---

### Task 12: tsup build configuration

**Files:**

- Create: `packages/widget/tsup.config.ts`
- Modify: `packages/widget/package.json` (add `files`, fix `exports` to point at `dist`)

- [ ] **Step 1: Create `tsup.config.ts`**

```ts
import { defineConfig } from 'tsup'

export default defineConfig([
  // Library build — ESM + CJS + dts
  {
    entry: {
      index: 'src/index.ts',
      'react/index': 'src/react/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    target: 'es2020',
    clean: true,
    external: ['react'],
  },
  // Browser IIFE — served by /api/widget/sdk.js
  {
    entry: { browser: 'src/browser-queue.ts' },
    format: ['iife'],
    globalName: 'QuackbackBundle',
    minify: true,
    sourcemap: false,
    target: 'es2020',
    outExtension: () => ({ js: '.js' }),
  },
])
```

- [ ] **Step 2: Update `package.json`** to point exports at `dist` (for npm consumers) while keeping `src` paths for local workspace resolution.

Use conditional exports:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "development": "./src/index.ts"
    },
    "./react": {
      "types": "./dist/react/index.d.ts",
      "import": "./dist/react/index.js",
      "require": "./dist/react/index.cjs",
      "development": "./src/react/index.ts"
    },
    "./browser.js": "./dist/browser.js"
  },
  "files": ["dist", "src", "README.md"]
}
```

_(Bun resolves the `development` condition in workspaces; published packages use the compiled `dist/`.)_

- [ ] **Step 3: Run the build**

Run: `cd ~/quackback/packages/widget && bun run build`
Expected: creates `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts`, `dist/browser.js`, plus react subpath.

- [ ] **Step 4: Sanity check the IIFE bundle**

Run: `wc -c ~/quackback/packages/widget/dist/browser.js`
Expected: under 20 KB (target budget <15 KB gzipped — raw will be larger).

- [ ] **Step 5: Commit**

```bash
git add packages/widget/tsup.config.ts packages/widget/package.json
git commit -m "build(widget): tsup config for ESM/CJS/IIFE"
```

---

### Task 13: Serve IIFE bundle from `/api/widget/sdk.js`

Replace the `buildWidgetSDK` string-generator with a loader that reads the IIFE bundle from disk (or imports it as a raw string via a Vite asset import) and prepends a tenant-specific `window.__QUACKBACK_URL__` line.

**Files:**

- Modify: `apps/web/src/routes/api/widget/sdk[.]js.ts`
- Delete: `apps/web/src/lib/shared/widget/sdk-template.ts`
- Update: `apps/web/src/lib/shared/widget/__tests__/sdk-template.test.ts` (or delete — behavior moves to `packages/widget/__tests__`)

- [ ] **Step 1: Import the IIFE bundle as a raw string**

Vite supports `?raw` imports. Add a build-time import:

`apps/web/src/routes/api/widget/sdk[.]js.ts` — replace the old `buildWidgetSDK` call:

```ts
import { createFileRoute } from '@tanstack/react-router'
import { config } from '@/lib/server/config'
// Vite ?raw import — ships the bundle content as a string at build time.
// Relative path from this file to packages/widget/dist/browser.js:
import widgetBundle from '../../../../../packages/widget/dist/browser.js?raw'

function jsResponse(body: string, maxAge: number): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': `public, max-age=${maxAge}`,
    },
  })
}

export const Route = createFileRoute('/api/widget/sdk.js')({
  server: {
    handlers: {
      GET: async () => {
        const { getWidgetConfig } = await import('@/lib/server/domains/settings/settings.widget')
        const widgetConfig = await getWidgetConfig()
        if (!widgetConfig.enabled) {
          return jsResponse(
            '/* Quackback widget is disabled */ console.warn("Quackback: Widget is disabled for this workspace.");',
            60
          )
        }
        const prelude = `window.__QUACKBACK_URL__=${JSON.stringify(config.baseUrl)};`
        return jsResponse(prelude + widgetBundle, 3600)
      },
    },
  },
})
```

**Note:** the theme resolution that used to happen in this route is now handled by `/api/widget/config.json` (which the SDK fetches at init). Verify that endpoint already returns the theme fields the SDK expects; if not, add a task here to extend it.

- [ ] **Step 2: Delete `sdk-template.ts`**

```bash
rm apps/web/src/lib/shared/widget/sdk-template.ts
```

- [ ] **Step 3: Update or delete the old test file**

Most existing string-matching tests in `apps/web/src/lib/shared/widget/__tests__/sdk-template.test.ts` are now invalid (they checked for specific substrings in the generated IIFE). Delete the file — equivalent behavior tests live in `packages/widget/__tests__/`:

```bash
rm apps/web/src/lib/shared/widget/__tests__/sdk-template.test.ts
```

- [ ] **Step 4: Ensure build order**

Add a root script so `bun run build` builds the widget package before the web app:

`package.json` (root) — update the build script to include widget first:

```json
{
  "scripts": {
    "build": "bun run --filter @quackback/widget build && bun run --filter @quackback/web build"
  }
}
```

_(Adjust depending on how the existing root scripts are structured — the principle is that `packages/widget/dist/browser.js` must exist before `apps/web` is built.)_

- [ ] **Step 5: Verify full build succeeds**

Run: `cd ~/quackback && bun run build`
Expected: widget package builds, web app builds, no errors. `apps/web/.output/` contains the bundled widget.

- [ ] **Step 6: Smoke test against a running dev instance**

Run: `cd ~/quackback && bun run dev`
In another terminal: `curl -s http://localhost:3000/api/widget/sdk.js | head -5`
Expected: starts with `window.__QUACKBACK_URL__="http://localhost:3000";(function(){...`

Open a browser tab to http://localhost:3000, DevTools console, run:

```js
const s = document.createElement('script')
s.src = '/api/widget/sdk.js'
document.head.appendChild(s)
s.onload = () => Quackback('init', { appUrl: location.origin })
```

Expected: the widget button appears in the bottom-right, clicking it opens the panel.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/routes/api/widget/sdk[.]js.ts apps/web/src/lib/shared/widget package.json
git commit -m "refactor(widget): serve IIFE bundle from @quackback/widget

The /api/widget/sdk.js endpoint now serves the pre-built IIFE bundle
from packages/widget/dist/browser.js with a tenant-specific URL
prelude, replacing the string-template generator. Existing script-tag
integrations keep working unchanged."
```

---

## Phase 4 — React adapter

### Task 14: `useQuackbackInit` hook (singleton lifecycle)

**Files:**

- Create: `packages/widget/src/react/use-init.ts`
- Create: `packages/widget/__tests__/react/use-init.test.tsx`

**Design note:** No provider. Quackback is a singleton; one widget per page. `useQuackbackInit` wraps the singleton's lifecycle in a React hook that can be called anywhere in the tree (typically at the app root). Sibling hooks (`useQuackback`, `useQuackbackEvent`) read the same singleton directly.

- [ ] **Step 1: Write failing test**

`packages/widget/__tests__/react/use-init.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useQuackbackInit } from '../../src/react/use-init'
import Quackback from '../../src'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({}) }))
  )
  document.body.innerHTML = ''
})

describe('useQuackbackInit', () => {
  it('inits the widget on mount and destroys on unmount', () => {
    const destroy = vi.spyOn(Quackback, 'destroy')
    function C() {
      useQuackbackInit({ appUrl: 'https://feedback.acme.com' })
      return null
    }
    const { unmount } = render(<C />)
    expect(document.querySelector('iframe[title="Feedback Widget"]')).not.toBeNull()
    unmount()
    expect(destroy).toHaveBeenCalled()
  })

  it('re-calls identify when the identity option changes', () => {
    const identify = vi.spyOn(Quackback, 'identify')
    function C({ user }: { user: { id: string; email: string } | null }) {
      useQuackbackInit({
        appUrl: 'https://feedback.acme.com',
        identity: user ? { id: user.id, email: user.email } : undefined,
      })
      return null
    }
    const { rerender } = render(<C user={{ id: 'u1', email: 'a@b.c' }} />)
    identify.mockClear()
    act(() => rerender(<C user={{ id: 'u2', email: 'x@y.z' }} />))
    expect(identify).toHaveBeenCalledWith({ id: 'u2', email: 'x@y.z' })
  })

  it('does not init when shouldInitialize is false', () => {
    function C() {
      useQuackbackInit({ appUrl: 'https://feedback.acme.com', shouldInitialize: false })
      return null
    }
    render(<C />)
    expect(document.querySelector('iframe[title="Feedback Widget"]')).toBeNull()
  })

  it('inits later when shouldInitialize flips to true', () => {
    function C({ enabled }: { enabled: boolean }) {
      useQuackbackInit({ appUrl: 'https://feedback.acme.com', shouldInitialize: enabled })
      return null
    }
    const { rerender } = render(<C enabled={false} />)
    expect(document.querySelector('iframe[title="Feedback Widget"]')).toBeNull()
    act(() => rerender(<C enabled={true} />))
    expect(document.querySelector('iframe[title="Feedback Widget"]')).not.toBeNull()
  })

  it('respects initializeDelay', async () => {
    vi.useFakeTimers()
    function C() {
      useQuackbackInit({ appUrl: 'https://feedback.acme.com', initializeDelay: 500 })
      return null
    }
    render(<C />)
    expect(document.querySelector('iframe[title="Feedback Widget"]')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(document.querySelector('iframe[title="Feedback Widget"]')).not.toBeNull()
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd ~/quackback/packages/widget && bunx vitest run __tests__/react/use-init.test.tsx`
Expected: FAIL (hook not implemented).

- [ ] **Step 3: Implement `use-init.ts`**

`packages/widget/src/react/use-init.ts`:

```ts
import { useEffect, useMemo } from 'react'
import Quackback from '../index'
import type { InitOptions, Identity } from '../types'

export interface UseQuackbackInitOptions extends Omit<InitOptions, 'identity'> {
  identity?: Identity
  /** Skip init (e.g. feature flag gate). Flipping true later inits on that render. */
  shouldInitialize?: boolean
  /** Defer init by N milliseconds after mount (perf). */
  initializeDelay?: number
}

export function useQuackbackInit(options: UseQuackbackInitOptions): void {
  const { identity, shouldInitialize, initializeDelay, ...init } = options
  // Stable init deps — stringified so object identity doesn't retrigger effects
  const initKey = useMemo(() => JSON.stringify(init), [init])
  const shouldInit = shouldInitialize !== false

  useEffect(() => {
    if (!shouldInit) return

    let cancelled = false
    let started = false

    const start = () => {
      if (cancelled) return
      started = true
      Quackback.init({ ...init, identity })
    }

    if (initializeDelay && initializeDelay > 0) {
      const id = setTimeout(start, initializeDelay)
      return () => {
        cancelled = true
        clearTimeout(id)
        if (started) Quackback.destroy()
      }
    }
    start()
    return () => {
      if (started) Quackback.destroy()
    }
    // identity is handled in a separate effect; excluded here deliberately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initKey, shouldInit, initializeDelay])

  const identityKey = useMemo(
    () => (identity === undefined ? null : JSON.stringify(identity)),
    [identity]
  )
  useEffect(() => {
    if (!shouldInit) return
    if (identityKey === null) return
    Quackback.identify(identity)
    // identity derives from identityKey; safe to exclude
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey, shouldInit])
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd ~/quackback/packages/widget && bunx vitest run __tests__/react/use-init.test.tsx`
Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add packages/widget/src/react/use-init.ts packages/widget/__tests__/react/use-init.test.tsx
git commit -m "feat(widget): useQuackbackInit hook (singleton lifecycle)"
```

---

### Task 15: `useQuackback` hook + `useQuackbackEvent` hook

**Files:**

- Create: `packages/widget/src/react/use-quackback.ts`
- Create: `packages/widget/src/react/use-event.ts`
- Create: `packages/widget/src/react/index.ts`
- Create: `packages/widget/__tests__/react/use-quackback.test.tsx`
- Create: `packages/widget/__tests__/react/use-event.test.tsx`

- [ ] **Step 1: Write failing tests**

`packages/widget/__tests__/react/use-quackback.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useQuackback } from '../../src/react/use-quackback'
import Quackback from '../../src'

describe('useQuackback', () => {
  it('returns the singleton', () => {
    const { result } = renderHook(() => useQuackback())
    expect(result.current).toBe(Quackback)
    expect(typeof result.current.open).toBe('function')
  })
})
```

`packages/widget/__tests__/react/use-event.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useQuackbackEvent } from '../../src/react/use-event'
import Quackback from '../../src'

describe('useQuackbackEvent', () => {
  it('subscribes via Quackback.on and unsubscribes on unmount', () => {
    const unsub = vi.fn()
    const on = vi.spyOn(Quackback, 'on').mockReturnValue(unsub)
    function C() {
      useQuackbackEvent('vote', () => {})
      return null
    }
    const { unmount } = render(<C />)
    expect(on).toHaveBeenCalledWith('vote', expect.any(Function))
    unmount()
    expect(unsub).toHaveBeenCalled()
    on.mockRestore()
  })

  it('resubscribes when event name changes', () => {
    const unsubA = vi.fn()
    const unsubB = vi.fn()
    const on = vi.spyOn(Quackback, 'on').mockReturnValueOnce(unsubA).mockReturnValueOnce(unsubB)
    function C({ name }: { name: 'vote' | 'post:created' }) {
      useQuackbackEvent(name, () => {})
      return null
    }
    const { rerender } = render(<C name="vote" />)
    rerender(<C name="post:created" />)
    expect(unsubA).toHaveBeenCalled()
    expect(on).toHaveBeenLastCalledWith('post:created', expect.any(Function))
    on.mockRestore()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd ~/quackback/packages/widget && bunx vitest run __tests__/react`
Expected: FAIL.

- [ ] **Step 3: Implement the hooks**

`packages/widget/src/react/use-quackback.ts`:

```ts
import Quackback from '../index'

/**
 * Returns the Quackback singleton. Equivalent to importing it directly —
 * exists for React-idiomatic usage.
 */
export function useQuackback(): typeof Quackback {
  return Quackback
}
```

`packages/widget/src/react/use-event.ts`:

```ts
import { useEffect } from 'react'
import Quackback from '../index'
import type { EventName, EventHandler } from '../types'

/**
 * Subscribe to a widget event for the component's lifetime.
 * The handler is called synchronously when the event fires.
 */
export function useQuackbackEvent<T extends EventName>(name: T, handler: EventHandler<T>): void {
  useEffect(() => {
    const unsub = Quackback.on(name, handler)
    return unsub
  }, [name, handler])
}
```

- [ ] **Step 4: Implement `react/index.ts`**

```ts
export { useQuackbackInit } from './use-init'
export type { UseQuackbackInitOptions } from './use-init'
export { useQuackback } from './use-quackback'
export { useQuackbackEvent } from './use-event'

// Re-export the singleton so users who prefer `Quackback.open()` can import
// it from the same subpath as the hooks.
export { default as Quackback } from '../index'
export type {
  InitOptions,
  Identity,
  OpenOptions,
  EventName,
  EventMap,
  EventHandler,
  Unsubscribe,
} from '../types'
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cd ~/quackback/packages/widget && bunx vitest run __tests__/react`
Expected: all tests passing.

- [ ] **Step 6: Commit**

```bash
git add packages/widget/src/react packages/widget/__tests__/react/use-quackback.test.tsx packages/widget/__tests__/react/use-event.test.tsx
git commit -m "feat(widget): useQuackback and useQuackbackEvent hooks"
```

---

## Phase 5 — Dogfood and publish

### Task 16: Migrate `~/website` to npm import

**Files:**

- Modify: `~/website/package.json` (add `@quackback/widget` via relative path for now, or npm once published)
- Modify: `~/website/src/routes/__root.tsx`

- [ ] **Step 1: Add dependency**

_(Since the package isn't published yet, use `file:` protocol for internal testing, or use workspace if the website is added to the quackback monorepo — it isn't today. Simpler: publish 0.1.0 first (Task 18), then add as a normal npm dep. Or use `link` for dev.)_

For now, stub it out — keep the script tag until publish is live. Add a comment pointing to Task 18.

- [ ] **Step 2: After Task 18 succeeds, update `__root.tsx`**

Replace the script injection block with the React hook from the `/react` subpath:

```tsx
import { useQuackbackInit } from '@quackback/widget/react'

// inside RootDocument component (replace the old useEffect that loaded /sdk.js):
useQuackbackInit({ appUrl: 'https://feedback.quackback.io' })
```

Drop the manual `document.createElement("script")` block entirely — the npm package manages its own DOM.

- [ ] **Step 3: Commit (after Task 18)**

```bash
cd ~/website
git add package.json bun.lockb src/routes/__root.tsx
git commit -m "chore(widget): migrate to @quackback/widget npm package"
```

---

### Task 17: CI workflow for npm publish

**Files:**

- Create: `~/quackback/.github/workflows/publish-widget.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: Publish @quackback/widget
on:
  push:
    tags: ['widget-v*']
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run --filter @quackback/widget test
      - run: bun run --filter @quackback/widget typecheck
      - run: bun run --filter @quackback/widget build
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: cd packages/widget && npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 2: Add `NPM_TOKEN` secret to the repo**

_(Manual step — done via GitHub settings. Document in the commit message.)_

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/publish-widget.yml
git commit -m "ci: publish-widget workflow"
```

---

### Task 18: Prepare for v0.1.0 publish

**Files:**

- Modify: `~/quackback/packages/widget/package.json` (flip `private: true` → remove)
- Modify: `~/quackback/packages/widget/README.md` (full quickstart)
- Create: `~/quackback/packages/widget/CHANGELOG.md`

- [ ] **Step 1: Flip to public**

Remove `"private": true` from `packages/widget/package.json`. Add a `"repository"` field pointing to `github:QuackbackIO/quackback` with a `"directory"` key.

- [ ] **Step 2: Write `README.md`**

Full quickstart covering:

- **Positioning line:** _"A real npm package for the Quackback widget — types, tree-shaking, SSR-safe, no dynamic script injection."_ (This is what differentiates us from Canny and Featurebase, both script-tag-only.)
- Install: `npm install @quackback/widget`
- Minimal usage: `Quackback.init({ appUrl: '...' })`
- Identity variants (with details / ssoToken / anonymous by omitting the argument)
- React hooks example: `useQuackbackInit`, `useQuackback`, `useQuackbackEvent` (no provider — show why)
- Section **"Other frameworks"**: Vue/Svelte/Angular users can import from `@quackback/widget` directly (vanilla API works everywhere). Dedicated adapters will ship when there's demand.
- Link to full docs at https://quackback.io/docs/widget/installation

- [ ] **Step 3: Write `CHANGELOG.md`**

```markdown
# @quackback/widget

## 0.1.0 — 2026-04-17

Initial release. Extracted from the Quackback monorepo.

- Vanilla JS: `Quackback.init`, `.identify`, `.logout`, `.open`, `.close`, `.on`, `.off`, `.metadata`, `.destroy`
- React (`@quackback/widget/react`): `useQuackbackInit`, `useQuackback`, `useQuackbackEvent` — singleton + hooks, no provider
- TypeScript types for all methods and events; discriminated Identity union (`{id, email, ...} | {ssoToken}`). Anonymous is the default when no identity is passed
- IIFE bundle for script-tag users (served by Quackback at `/api/widget/sdk.js`)
```

- [ ] **Step 4: Tag and push**

```bash
cd ~/quackback
git tag widget-v0.1.0
git push origin widget-v0.1.0
```

- [ ] **Step 5: Verify publish**

Watch the `publish-widget` workflow run to success. Check https://www.npmjs.com/package/@quackback/widget.

- [ ] **Step 6: Commit any README/changelog tweaks**

```bash
git add packages/widget/README.md packages/widget/CHANGELOG.md packages/widget/package.json
git commit -m "chore(widget): prepare v0.1.0 publish"
```

---

## Self-Review

**Spec coverage:** Each section of the design maps to a task group:

- Cross-platform unification → Tasks 0.1–0.5
- Extract SDK into real modules → Tasks 3–9
- Public API surface + types → Tasks 2, 10 (including `showLauncher` / `hideLauncher`)
- Server compat layer → Tasks 11–13
- React adapter → Tasks 14–15
- Dogfood on website → Task 16
- Publishing pipeline → Tasks 17–18

**Known gaps / follow-ups:**

1. **Theme endpoint** — Task 13 assumes `/api/widget/config.json` returns theme fields. Confirm this is already the case (the mobile SDKs already consume it) before Task 13 executes; if not, add a small "extend config.json to include theme" task before Task 13.
2. **Vue / Svelte adapters** — explicitly out of scope; add when user demand shows up.
3. **Protocol versioning** — noted in the analysis; safe to defer because the current protocol is preserved byte-for-byte.
4. **Size budget verification** — only sanity-checked in Task 12; add a CI guard once 0.1.0 is shipped.
5. **Intercom-style `trackEvent`** — not added yet; reassess once feedback widgets grow into event analytics.

**Type consistency check:** `InitOptions`, `Identity`, `OpenOptions`, `WidgetTheme`, `EventMap`, `EventName`, `EventHandler`, `Unsubscribe` names stay consistent from Task 2 through Task 18. The dispatcher's `Command` union in Task 9 (`init | identify | logout | open | close | showLauncher | hideLauncher | destroy | metadata | on | off`) matches the method surface exposed in Task 10. Mobile field names (`appUrl`, `placement`) from Phase 0 match web's `InitOptions` in Task 2. `ResolvedTheme` is internal to `theme.ts` only.

**Placeholder scan:** no "TBD", "similar to Task N", or unimplemented code paths. Task 14's second test (`rerender` + `identify` spy) is intentionally a behavioral smoke test — sharpen if the provider API exposes a spy-friendly hook during implementation. Task 0.1 Step 1 (audit `appId`) is a real audit that may or may not surface code to delete — if `appId` IS in use, plan only removes the config field after finding a replacement.

---

## Risks & mitigations

- **Circular-dep risk with Vite `?raw` import** (Task 13) — the web app imports a file from `packages/widget/dist/`, which only exists after the widget is built. The root `build` script chains them correctly. For dev mode, the `?raw` import would fail until the widget is built once; suggest adding a `postinstall` hook or a dev-mode fallback that reads from disk at request time.
- **`.` vs `./react` exports map** — the `development` condition is bun-specific; verify this works in the quackback repo's bun version. If not, drop it and require `bun run build` before `bun run dev`.
- **Cross-repo publish flow** — CI token and @quackback npm org claim need to happen before Task 18.
- **Existing integrations regression** — Task 13's Step 6 manual smoke test is the only guard; add a Playwright test that loads `/api/widget/sdk.js` and asserts the launcher renders before shipping to production.
