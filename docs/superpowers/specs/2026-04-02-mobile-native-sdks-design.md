# Mobile Native SDKs Design

Native iOS and Android SDKs that let teams embed the Quackback feedback widget inside their mobile apps.

## Problem

There's no way to collect in-app feedback on mobile. Users have to leave the app to submit ideas, which adds friction and lowers engagement. Many products are mobile-first, and collecting feedback where users already are closes a key gap.

## Approach

**WebView wrapper with a native shell.** The SDKs provide a native trigger button, user identification, and event callbacks, but render the actual feedback UI in a WebView pointing at the existing `/widget` route. This gives full feature parity with the web widget (submit, vote, comment, search, changelog, help center) with minimal ongoing maintenance -- web widget improvements automatically ship to mobile.

The native SDK communicates with the WebView via a **JavaScript bridge**, injecting the same `Quackback('command', payload)` calls the web SDK uses, with events flowing back through `WKScriptMessageHandler` (iOS) / `@JavascriptInterface` (Android).

## SDK Public API

### iOS (Swift)

```swift
let config = QuackbackConfig(
    appId: "your-project-id",
    baseURL: URL(string: "https://feedback.yourapp.com")!,
    theme: .dark,              // .light | .dark | .system
    position: .bottomRight,    // trigger button placement
    buttonColor: "#6C47FF",    // optional, defaults to theme primary
    locale: "en"
)
Quackback.configure(config)

Quackback.identify(ssoToken: "eyJhbG...")
Quackback.identify(userId: "user_123", email: "jane@example.com", name: "Jane", avatarURL: "https://...")
Quackback.logout()

Quackback.open()
Quackback.open(board: "feature-requests")
Quackback.close()

Quackback.showTrigger()
Quackback.hideTrigger()

Quackback.on(.vote) { postId in ... }
Quackback.on(.submit) { postId in ... }

Quackback.destroy()
```

### Android (Kotlin)

```kotlin
val config = QuackbackConfig(
    appId = "your-project-id",
    baseURL = "https://feedback.yourapp.com",
    theme = QuackbackTheme.DARK,
    position = QuackbackPosition.BOTTOM_RIGHT,
    buttonColor = "#6C47FF",
    locale = "en"
)
Quackback.configure(context, config)

Quackback.identify(ssoToken = "eyJhbG...")
Quackback.identify(userId = "user_123", email = "jane@example.com", name = "Jane", avatarURL = "https://...")
Quackback.logout()

Quackback.open()
Quackback.open(board = "feature-requests")
Quackback.close()

Quackback.showTrigger()
Quackback.hideTrigger()

Quackback.on(QuackbackEvent.VOTE) { postId -> ... }
Quackback.on(QuackbackEvent.SUBMIT) { postId -> ... }

Quackback.destroy()
```

### Design decisions

- Singleton pattern (`Quackback.configure()` once, then `Quackback.open()` anywhere) mirrors the web SDK's global function.
- `appId` maps to the workspace/project, used to construct the widget URL.
- `baseURL` required for self-hosted instances.
- Both SSO token and attribute-based identification modes, matching the web widget.

## Architecture

### iOS (`~/quackback-ios`)

```
Sources/Quackback/
  Quackback.swift              # Public singleton API
  QuackbackConfig.swift        # Configuration types
  QuackbackEvent.swift         # Event types & listener management
  Internal/
    QuackbackWebView.swift     # WKWebView setup + JS bridge
    TriggerButton.swift        # Native floating button (UIKit)
    PanelController.swift      # Sheet presentation + lifecycle
    JSBridge.swift             # Message encoding/decoding
```

### Android (`~/quackback-android`)

```
quackback/src/main/kotlin/com/quackback/sdk/
  Quackback.kt                # Public singleton API
  QuackbackConfig.kt          # Configuration types
  QuackbackEvent.kt           # Event types & listener management
  internal/
    QuackbackWebView.kt       # WebView setup + JS bridge
    TriggerButton.kt          # Native floating button (View)
    PanelActivity.kt          # Bottom sheet dialog + lifecycle
    JSBridge.kt                # Message encoding/decoding
```

### Component responsibilities

- **Trigger button** -- Native FAB (not WebView). 48x48pt circular button with animated chat/close icon transition. Positioned bottom-right or bottom-left with safe area insets. Added to the app's key window (iOS) or activity decor view (Android).
- **Panel** -- iOS: `UISheetPresentationController` (medium/large detent). Android: `BottomSheetDialogFragment`. Contains the WebView. Full-screen on small devices.
- **WebView** -- Loads `{baseURL}/widget?source=native&platform=ios|android`. JS bridge injects commands and listens for events.
- **JS Bridge** -- Translates native calls into `Quackback('command', payload)` JS calls. Routes callbacks back to native event listeners.

### Lifecycle

1. `configure()` -- stores config, no heavy work
2. `showTrigger()` -- adds the FAB to the app's key window / current activity
3. User taps trigger -> `open()` -- lazily creates the WebView, loads the widget URL, presents the panel
4. JS bridge sends `init` + `identify` once the page loads
5. User interacts with the web widget normally
6. Events (vote, submit) flow back through the bridge to native listeners
7. `close()` -- dismisses the panel, WebView stays warm in memory
8. `destroy()` -- tears down WebView, removes trigger, clears listeners

### Key decisions

- Lazy WebView creation -- don't load until first `open()`, saves memory and startup time.
- Warm WebView on close -- keep alive after dismissal so reopening is instant.
- Native trigger button -- always accessible, matches host app frame rates and animations.

## WebView & JS Bridge

### Widget URL

```
{baseURL}/widget?source=native&platform=ios|android
```

The `source=native` query param tells the widget it's inside a native app:

- Skip rendering its own trigger button
- Use `__quackbackNative.dispatch` instead of `postMessage`
- Disable iframe-specific behaviors

### Native to WebView (commands)

Calls `evaluateJavaScript()` with the same command interface the web SDK uses:

```javascript
Quackback('init', { appId: '...', theme: 'dark', locale: 'en' })
Quackback('identify', { ssoToken: '...' })
Quackback('identify', { id: '...', email: '...', name: '...' })
Quackback('open', { board: 'feature-requests' })
Quackback('logout')
```

### WebView to Native (events)

A shim injected at page load via `WKUserScript` / `WebViewClient.onPageStarted`:

```javascript
;(function () {
  var dispatch = function (event, data) {
    var msg = JSON.stringify({ event: event, data: data })
    // iOS
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.quackback) {
      window.webkit.messageHandlers.quackback.postMessage(msg)
    }
    // Android
    if (window.QuackbackBridge) {
      window.QuackbackBridge.onEvent(msg)
    }
  }
  window.__quackbackNative = { dispatch: dispatch }
})()
```

The widget calls `window.__quackbackNative.dispatch('vote', { postId })` at the same points it currently calls `postMessage`.

### Events

| Event      | Payload              | When                               |
| ---------- | -------------------- | ---------------------------------- |
| `ready`    | `{}`                 | Widget page loaded and initialized |
| `vote`     | `{ postId: string }` | User votes on a post               |
| `submit`   | `{ postId: string }` | User submits new feedback          |
| `close`    | `{}`                 | User taps close/back inside widget |
| `navigate` | `{ path: string }`   | Route change within widget         |

### Server-side changes

Minimal. The widget code currently uses `window.parent.postMessage(msg, '*')` to send events to the embedding context. We introduce a `sendToHost(msg)` helper that auto-detects whether `window.__quackbackNative` exists and routes through it, falling back to `postMessage` for iframe embedding.

This is a find-and-replace refactor across ~6 widget files -- no new routes or endpoints needed.

## Theming & Trigger Button

### Theme passthrough

Handled entirely by the web widget. The native SDK passes the mode via `init`:

```javascript
Quackback('init', { appId: '...', theme: 'dark' })
```

The widget's existing OKLch theming, custom CSS, and Google Fonts all work inside a WebView with zero native-side work.

### Native trigger button

- 48x48pt circular FAB with shadow
- Chat bubble icon (open) / X icon (close) with animated transition
- Color defaults to host app tint, overridable via `config.buttonColor`
- `bottomRight` or `bottomLeft` with 16pt inset, respects safe area
- iOS: added to key window. Android: added to activity decor view
- Tap toggles open/close. Hidden when panel is presented, shown on dismiss.

## Platform Requirements

### iOS

- Minimum iOS 15.0 (UISheetPresentationController, async/await, modern WKWebView)
- Zero third-party dependencies (Foundation, UIKit, WebKit only)

### Android

- Minimum API 24 (Android 7.0)
- AndroidX only (core-ktx, appcompat, material) -- no third-party libraries

## Repo Structure & Distribution

### iOS (`~/quackback-ios`)

```
Package.swift
Sources/Quackback/
Tests/QuackbackTests/
Example/
LICENSE
README.md
```

Distributed via Swift Package Manager. Tagged Git releases (`1.0.0`).

### Android (`~/quackback-android`)

```
quackback/
  src/main/kotlin/...
  src/test/kotlin/...
  build.gradle.kts
app/
  src/main/kotlin/...
  build.gradle.kts
build.gradle.kts
gradle.properties
settings.gradle.kts
LICENSE
README.md
```

Published to Maven Central via Gradle + maven-publish plugin.

## Testing Strategy

- **Unit tests:** Config validation, JS bridge message encoding/decoding, event routing
- **Integration tests:** WebView loads widget URL, bridge commands execute, events fire back
- **Sample apps:** Minimal apps in each repo demonstrating configure -> identify -> open flow
