# Mobile Native SDKs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship iOS and Android SDKs that embed the Quackback feedback widget via WebView with a native trigger button, user identification, and event callbacks.

**Architecture:** WebView wrapper with native shell. A `sendToHost()` helper in the web widget detects `window.__quackbackNative` and routes messages through it instead of `window.parent.postMessage()`. Native SDKs (Swift/Kotlin) inject commands via `evaluateJavaScript` and receive events via `WKScriptMessageHandler` / `@JavascriptInterface`.

**Tech Stack:** TypeScript (server-side bridge), Swift 5.9+ / SPM (iOS), Kotlin / Gradle (Android)

**Spec:** `docs/superpowers/specs/2026-04-02-mobile-native-sdks-design.md`

---

## File Map

### Server-side (quackback monorepo)

| Action | File                                                         | Purpose                                              |
| ------ | ------------------------------------------------------------ | ---------------------------------------------------- |
| Create | `apps/web/src/lib/client/widget-bridge.ts`                   | `sendToHost()` helper + `isNativeWidget()` detection |
| Create | `apps/web/src/lib/client/__tests__/widget-bridge.test.ts`    | Unit tests for bridge                                |
| Modify | `apps/web/src/components/widget/widget-auth-provider.tsx`    | Replace 15 `window.parent.postMessage` calls         |
| Modify | `apps/web/src/lib/client/hooks/use-widget-vote.ts`           | Replace 1 call                                       |
| Modify | `apps/web/src/components/widget/widget-home.tsx`             | Replace 2 calls                                      |
| Modify | `apps/web/src/components/widget/widget-post-detail.tsx`      | Replace 1 call                                       |
| Modify | `apps/web/src/components/widget/widget-help-detail.tsx`      | Replace 1 call                                       |
| Modify | `apps/web/src/components/widget/widget-changelog-detail.tsx` | Replace 1 call                                       |

### iOS SDK (`~/quackback-ios`)

| Action | File                                                | Purpose                               |
| ------ | --------------------------------------------------- | ------------------------------------- |
| Create | `Package.swift`                                     | SPM manifest, iOS 15+                 |
| Create | `Sources/Quackback/QuackbackConfig.swift`           | Config types                          |
| Create | `Sources/Quackback/QuackbackEvent.swift`            | Event enum + EventEmitter             |
| Create | `Sources/Quackback/Quackback.swift`                 | Public singleton API                  |
| Create | `Sources/Quackback/Internal/JSBridge.swift`         | JS command builder + event parser     |
| Create | `Sources/Quackback/Internal/QuackbackWebView.swift` | WKWebView + WKScriptMessageHandler    |
| Create | `Sources/Quackback/Internal/PanelController.swift`  | UISheetPresentationController wrapper |
| Create | `Sources/Quackback/Internal/TriggerButton.swift`    | Native FAB                            |
| Create | `Tests/QuackbackTests/`                             | Unit tests                            |
| Create | `Example/`                                          | Sample SwiftUI app                    |

### Android SDK (`~/quackback-android`)

| Action | File                                                                       | Purpose                           |
| ------ | -------------------------------------------------------------------------- | --------------------------------- |
| Create | `settings.gradle.kts`                                                      | Gradle project config             |
| Create | `build.gradle.kts`                                                         | Root build file                   |
| Create | `quackback/build.gradle.kts`                                               | Library module with maven-publish |
| Create | `quackback/src/main/kotlin/com/quackback/sdk/QuackbackConfig.kt`           | Config types                      |
| Create | `quackback/src/main/kotlin/com/quackback/sdk/QuackbackEvent.kt`            | Event enum + emitter              |
| Create | `quackback/src/main/kotlin/com/quackback/sdk/Quackback.kt`                 | Public singleton API              |
| Create | `quackback/src/main/kotlin/com/quackback/sdk/internal/JSBridge.kt`         | JS command builder + event parser |
| Create | `quackback/src/main/kotlin/com/quackback/sdk/internal/QuackbackWebView.kt` | WebView + JavascriptInterface     |
| Create | `quackback/src/main/kotlin/com/quackback/sdk/internal/PanelBottomSheet.kt` | BottomSheetDialogFragment         |
| Create | `quackback/src/main/kotlin/com/quackback/sdk/internal/TriggerButton.kt`    | Native FAB                        |
| Create | `quackback/src/test/kotlin/com/quackback/sdk/`                             | Unit tests                        |
| Create | `app/`                                                                     | Sample app module                 |

---

## Phase 1: Server-Side Bridge

### Task 1: Create `sendToHost` bridge utility and replace all `postMessage` calls

Create a `sendToHost(msg)` function that auto-detects native vs iframe context, then replace all 21 `window.parent.postMessage` call sites across 6 files.

**Files:**

- Create: `apps/web/src/lib/client/widget-bridge.ts`
- Create: `apps/web/src/lib/client/__tests__/widget-bridge.test.ts`
- Modify: `apps/web/src/components/widget/widget-auth-provider.tsx`
- Modify: `apps/web/src/lib/client/hooks/use-widget-vote.ts`
- Modify: `apps/web/src/components/widget/widget-home.tsx`
- Modify: `apps/web/src/components/widget/widget-post-detail.tsx`
- Modify: `apps/web/src/components/widget/widget-help-detail.tsx`
- Modify: `apps/web/src/components/widget/widget-changelog-detail.tsx`

- [ ] **Step 1: Write the bridge test**

```typescript
// apps/web/src/lib/client/__tests__/widget-bridge.test.ts
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('widget-bridge', () => {
  beforeEach(() => {
    vi.stubGlobal('parent', { postMessage: vi.fn() })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.__quackbackNative = undefined
  })

  it('sends via postMessage in iframe mode', async () => {
    const { sendToHost } = await import('../widget-bridge')
    sendToHost({ type: 'quackback:ready' })
    expect(window.parent.postMessage).toHaveBeenCalledWith({ type: 'quackback:ready' }, '*')
  })

  it('sends via native dispatch when bridge exists', async () => {
    const dispatch = vi.fn()
    window.__quackbackNative = { dispatch }

    const { sendToHost } = await import('../widget-bridge')
    sendToHost({ type: 'quackback:event', name: 'vote', payload: { postId: 'post_abc' } })

    expect(dispatch).toHaveBeenCalledWith('event', {
      type: 'quackback:event',
      name: 'vote',
      payload: { postId: 'post_abc' },
    })
    expect(window.parent.postMessage).not.toHaveBeenCalled()
  })

  it('falls back to postMessage when native dispatch is missing', async () => {
    window.__quackbackNative = {} // no dispatch method

    const { sendToHost } = await import('../widget-bridge')
    sendToHost({ type: 'quackback:close' })
    expect(window.parent.postMessage).toHaveBeenCalledWith({ type: 'quackback:close' }, '*')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/lib/client/__tests__/widget-bridge.test.ts`
Expected: FAIL -- module not found

- [ ] **Step 3: Implement the bridge**

```typescript
// apps/web/src/lib/client/widget-bridge.ts

interface NativeBridge {
  dispatch: (event: string, data: unknown) => void
}

declare global {
  interface Window {
    __quackbackNative?: Partial<NativeBridge>
  }
}

/**
 * Send a message to the host (parent iframe or native SDK).
 * Auto-detects native bridge; falls back to postMessage for iframe embedding.
 */
export function sendToHost(message: Record<string, unknown>): void {
  if (window.__quackbackNative?.dispatch) {
    const rawType = typeof message.type === 'string' ? message.type : ''
    const eventType = rawType.startsWith('quackback:')
      ? rawType.slice('quackback:'.length)
      : rawType || 'unknown'
    window.__quackbackNative.dispatch(eventType, message)
    return
  }
  window.parent.postMessage(message, '*')
}

/** Returns true when the widget is running inside a native mobile WebView. */
export function isNativeWidget(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('source') === 'native'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/src/lib/client/__tests__/widget-bridge.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit the bridge**

```bash
git add apps/web/src/lib/client/widget-bridge.ts apps/web/src/lib/client/__tests__/widget-bridge.test.ts
git commit -m "feat(widget): add sendToHost bridge for native SDK support"
```

- [ ] **Step 6: Replace all `window.parent.postMessage` calls**

In each of the 6 files below, add the import and mechanically replace every `window.parent.postMessage(msg, '*')` with `sendToHost(msg)`.

Add to each file:

```typescript
import { sendToHost } from '@/lib/client/widget-bridge'
```

**Pattern A -- multi-line calls (drop the `'*'` arg and closing paren on its own line):**

```typescript
// Before:
window.parent.postMessage(
  { type: 'quackback:identify-result', success: true, user: result.user },
  '*'
)
// After:
sendToHost({ type: 'quackback:identify-result', success: true, user: result.user })
```

**Pattern B -- single-line calls:**

```typescript
// Before:
window.parent.postMessage({ type: 'quackback:close' }, '*')
// After:
sendToHost({ type: 'quackback:close' })
```

Files and call counts:

- `apps/web/src/components/widget/widget-auth-provider.tsx` -- 15 calls
- `apps/web/src/lib/client/hooks/use-widget-vote.ts` -- 1 call
- `apps/web/src/components/widget/widget-home.tsx` -- 2 calls
- `apps/web/src/components/widget/widget-post-detail.tsx` -- 1 call
- `apps/web/src/components/widget/widget-help-detail.tsx` -- 1 call
- `apps/web/src/components/widget/widget-changelog-detail.tsx` -- 1 call

- [ ] **Step 7: Verify no postMessage calls remain**

Run: `grep -rn "window.parent.postMessage" apps/web/src/components/widget/ apps/web/src/lib/client/hooks/use-widget-vote.ts`
Expected: no output

- [ ] **Step 8: Run typecheck and full test suite**

Run: `bun run --cwd apps/web typecheck && npx vitest run`
Expected: all pass (this is a pure refactor)

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/widget/ apps/web/src/lib/client/hooks/use-widget-vote.ts
git commit -m "refactor(widget): replace all postMessage calls with sendToHost bridge"
```

---

## Phase 2: iOS SDK (`~/quackback-ios`)

### Task 2: Initialize SPM package + config + events + JS bridge

Set up the repo and implement the three foundational types with TDD.

**Files:**

- Create: `~/quackback-ios/Package.swift`
- Create: `~/quackback-ios/.gitignore`
- Create: `~/quackback-ios/Sources/Quackback/Quackback.swift` (placeholder)
- Create: `~/quackback-ios/Sources/Quackback/QuackbackConfig.swift`
- Create: `~/quackback-ios/Sources/Quackback/QuackbackEvent.swift`
- Create: `~/quackback-ios/Sources/Quackback/Internal/JSBridge.swift`
- Create: `~/quackback-ios/Tests/QuackbackTests/QuackbackConfigTests.swift`
- Create: `~/quackback-ios/Tests/QuackbackTests/QuackbackEventTests.swift`
- Create: `~/quackback-ios/Tests/QuackbackTests/JSBridgeTests.swift`

- [ ] **Step 1: Create repo and SPM structure**

```bash
mkdir -p ~/quackback-ios/Sources/Quackback/Internal ~/quackback-ios/Tests/QuackbackTests
cd ~/quackback-ios && git init
```

- [ ] **Step 2: Create Package.swift**

```swift
// ~/quackback-ios/Package.swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Quackback",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "Quackback", targets: ["Quackback"]),
    ],
    targets: [
        .target(name: "Quackback", path: "Sources/Quackback"),
        .testTarget(name: "QuackbackTests", dependencies: ["Quackback"], path: "Tests/QuackbackTests"),
    ]
)
```

- [ ] **Step 3: Create .gitignore**

```
.DS_Store
.build/
.swiftpm/
*.xcodeproj
xcuserdata/
DerivedData/
```

- [ ] **Step 4: Create placeholder source**

```swift
// ~/quackback-ios/Sources/Quackback/Quackback.swift
import Foundation

public enum Quackback {
    static var isConfigured = false
}
```

- [ ] **Step 5: Build and verify**

```bash
cd ~/quackback-ios && swift build
```

- [ ] **Step 6: Commit**

```bash
cd ~/quackback-ios && git add -A && git commit -m "chore: initialize SPM package"
```

- [ ] **Step 7: Write QuackbackConfig test**

```swift
// ~/quackback-ios/Tests/QuackbackTests/QuackbackConfigTests.swift
import XCTest
@testable import Quackback

final class QuackbackConfigTests: XCTestCase {
    func testDefaults() {
        let c = QuackbackConfig(appId: "test", baseURL: URL(string: "https://fb.example.com")!)
        XCTAssertEqual(c.theme, .system)
        XCTAssertEqual(c.position, .bottomRight)
        XCTAssertNil(c.buttonColor)
        XCTAssertNil(c.locale)
    }

    func testWidgetURL() {
        let c = QuackbackConfig(appId: "test", baseURL: URL(string: "https://fb.example.com")!)
        let url = c.widgetURL
        XCTAssertEqual(url.path, "/widget")
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
        XCTAssertTrue(items.contains(URLQueryItem(name: "source", value: "native")))
        XCTAssertTrue(items.contains(URLQueryItem(name: "platform", value: "ios")))
    }
}
```

- [ ] **Step 8: Run test -- expect FAIL**

```bash
cd ~/quackback-ios && swift test
```

- [ ] **Step 9: Implement QuackbackConfig**

```swift
// ~/quackback-ios/Sources/Quackback/QuackbackConfig.swift
import Foundation

public enum QuackbackTheme: String, Sendable {
    case light, dark
    case system = "user"
}

public enum QuackbackPosition: Sendable {
    case bottomRight, bottomLeft
}

public struct QuackbackConfig: Sendable {
    public let appId: String
    public let baseURL: URL
    public let theme: QuackbackTheme
    public let position: QuackbackPosition
    public let buttonColor: String?
    public let locale: String?

    public init(
        appId: String,
        baseURL: URL,
        theme: QuackbackTheme = .system,
        position: QuackbackPosition = .bottomRight,
        buttonColor: String? = nil,
        locale: String? = nil
    ) {
        self.appId = appId
        self.baseURL = baseURL
        self.theme = theme
        self.position = position
        self.buttonColor = buttonColor
        self.locale = locale
    }

    public var widgetURL: URL {
        var c = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        c.path = "/widget"
        c.queryItems = [
            URLQueryItem(name: "source", value: "native"),
            URLQueryItem(name: "platform", value: "ios"),
        ]
        return c.url!
    }
}
```

- [ ] **Step 10: Run test -- expect PASS**

```bash
cd ~/quackback-ios && swift test
```

- [ ] **Step 11: Commit**

```bash
cd ~/quackback-ios && git add Sources/Quackback/QuackbackConfig.swift Tests/QuackbackTests/QuackbackConfigTests.swift && git commit -m "feat: add QuackbackConfig with theme, position, and widget URL"
```

- [ ] **Step 12: Write QuackbackEvent test**

```swift
// ~/quackback-ios/Tests/QuackbackTests/QuackbackEventTests.swift
import XCTest
@testable import Quackback

final class QuackbackEventTests: XCTestCase {
    func testAddAndFire() {
        let emitter = EventEmitter()
        let exp = expectation(description: "fired")
        emitter.on(.vote) { data in
            XCTAssertEqual(data["postId"] as? String, "post_abc")
            exp.fulfill()
        }
        emitter.emit(.vote, data: ["postId": "post_abc"])
        waitForExpectations(timeout: 1)
    }

    func testRemove() {
        let emitter = EventEmitter()
        var count = 0
        let token = emitter.on(.submit) { _ in count += 1 }
        emitter.emit(.submit, data: [:])
        XCTAssertEqual(count, 1)
        emitter.off(token)
        emitter.emit(.submit, data: [:])
        XCTAssertEqual(count, 1)
    }

    func testRemoveAll() {
        let emitter = EventEmitter()
        var count = 0
        emitter.on(.vote) { _ in count += 1 }
        emitter.on(.submit) { _ in count += 1 }
        emitter.emit(.vote, data: [:])
        emitter.emit(.submit, data: [:])
        XCTAssertEqual(count, 2)
        emitter.removeAll()
        emitter.emit(.vote, data: [:])
        XCTAssertEqual(count, 2)
    }
}
```

- [ ] **Step 13: Run test -- expect FAIL**

- [ ] **Step 14: Implement QuackbackEvent + EventEmitter**

```swift
// ~/quackback-ios/Sources/Quackback/QuackbackEvent.swift
import Foundation

public enum QuackbackEvent: String, Sendable {
    case ready, vote, submit, close, navigate
}

public struct EventToken: Hashable, Sendable {
    let id = UUID()
}

public typealias EventListener = @Sendable ([String: Any]) -> Void

final class EventEmitter: @unchecked Sendable {
    private let lock = NSLock()
    private var listeners: [QuackbackEvent: [(token: EventToken, handler: EventListener)]] = [:]

    @discardableResult
    func on(_ event: QuackbackEvent, handler: @escaping EventListener) -> EventToken {
        let token = EventToken()
        lock.lock()
        listeners[event, default: []].append((token, handler))
        lock.unlock()
        return token
    }

    func off(_ token: EventToken) {
        lock.lock()
        for event in listeners.keys {
            listeners[event]?.removeAll { $0.token == token }
        }
        lock.unlock()
    }

    func emit(_ event: QuackbackEvent, data: [String: Any]) {
        lock.lock()
        let handlers = listeners[event] ?? []
        lock.unlock()
        for (_, handler) in handlers { handler(data) }
    }

    func removeAll() {
        lock.lock()
        listeners.removeAll()
        lock.unlock()
    }
}
```

- [ ] **Step 15: Run test -- expect PASS**

- [ ] **Step 16: Commit**

```bash
cd ~/quackback-ios && git add Sources/Quackback/QuackbackEvent.swift Tests/QuackbackTests/QuackbackEventTests.swift && git commit -m "feat: add event emitter for widget events"
```

- [ ] **Step 17: Write JSBridge test**

```swift
// ~/quackback-ios/Tests/QuackbackTests/JSBridgeTests.swift
import XCTest
@testable import Quackback

final class JSBridgeTests: XCTestCase {
    func testInitCommand() {
        let config = QuackbackConfig(appId: "app1", baseURL: URL(string: "https://x.com")!, theme: .dark, locale: "fr")
        let js = JSBridge.initCommand(config: config)
        XCTAssertTrue(js.contains("Quackback('init'"))
        XCTAssertTrue(js.contains("\"appId\":\"app1\""))
        XCTAssertTrue(js.contains("\"theme\":\"dark\""))
        XCTAssertTrue(js.contains("\"locale\":\"fr\""))
    }

    func testIdentifySSO() {
        let js = JSBridge.identifyCommand(ssoToken: "tok123")
        XCTAssertTrue(js.contains("\"ssoToken\":\"tok123\""))
    }

    func testIdentifyAttrs() {
        let js = JSBridge.identifyCommand(userId: "u1", email: "a@b.c", name: "A", avatarURL: nil)
        XCTAssertTrue(js.contains("\"id\":\"u1\""))
        XCTAssertTrue(js.contains("\"email\":\"a@b.c\""))
    }

    func testOpenBoard() {
        XCTAssertTrue(JSBridge.openCommand(board: "bugs").contains("\"board\":\"bugs\""))
    }

    func testOpenNil() {
        XCTAssertEqual(JSBridge.openCommand(board: nil), "Quackback('open');")
    }

    func testLogout() {
        XCTAssertEqual(JSBridge.logoutCommand(), "Quackback('logout');")
    }

    func testParseVoteEvent() {
        let json = #"{"event":"vote","data":{"type":"quackback:event","name":"vote","payload":{"postId":"post_abc"}}}"#
        let p = JSBridge.parseEvent(json)!
        XCTAssertEqual(p.event, .vote)
        XCTAssertEqual(p.data["postId"] as? String, "post_abc")
    }

    func testParseReady() {
        let json = #"{"event":"ready","data":{"type":"quackback:ready"}}"#
        XCTAssertEqual(JSBridge.parseEvent(json)!.event, .ready)
    }

    func testParseInvalid() {
        XCTAssertNil(JSBridge.parseEvent("bad"))
    }
}
```

- [ ] **Step 18: Run test -- expect FAIL**

- [ ] **Step 19: Implement JSBridge**

```swift
// ~/quackback-ios/Sources/Quackback/Internal/JSBridge.swift
import Foundation

enum JSBridge {
    struct ParsedEvent {
        let event: QuackbackEvent
        let data: [String: Any]
    }

    static func initCommand(config: QuackbackConfig) -> String {
        var p: [String: String] = ["appId": config.appId, "theme": config.theme.rawValue]
        if let l = config.locale { p["locale"] = l }
        return "Quackback('init', \(json(p)));"
    }

    static func identifyCommand(ssoToken: String) -> String {
        "Quackback('identify', \(json(["ssoToken": ssoToken])));"
    }

    static func identifyCommand(userId: String, email: String, name: String?, avatarURL: String?) -> String {
        var p: [String: String] = ["id": userId, "email": email]
        if let n = name { p["name"] = n }
        if let a = avatarURL { p["avatarURL"] = a }
        return "Quackback('identify', \(json(p)));"
    }

    static func openCommand(board: String?) -> String {
        guard let b = board else { return "Quackback('open');" }
        return "Quackback('open', \(json(["board": b])));"
    }

    static func logoutCommand() -> String { "Quackback('logout');" }

    static func parseEvent(_ jsonString: String) -> ParsedEvent? {
        guard let data = jsonString.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let name = obj["event"] as? String,
              let event = QuackbackEvent(rawValue: name)
        else { return nil }

        var eventData: [String: Any] = [:]
        if let d = obj["data"] as? [String: Any] {
            eventData = (d["payload"] as? [String: Any]) ?? d
        }
        return ParsedEvent(event: event, data: eventData)
    }

    static var bridgeScript: String {
        """
        (function(){
          var dispatch=function(e,d){
            var m=JSON.stringify({event:e,data:d});
            window.webkit.messageHandlers.quackback.postMessage(m);
          };
          window.__quackbackNative={dispatch:dispatch};
        })();
        """
    }

    private static func json(_ dict: [String: String]) -> String {
        let d = try! JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys])
        return String(data: d, encoding: .utf8)!
    }
}
```

- [ ] **Step 20: Run test -- expect PASS**

```bash
cd ~/quackback-ios && swift test
```

Expected: 14 tests pass (1 placeholder + 2 config + 3 event + 9 bridge - 1 placeholder = 14)

- [ ] **Step 21: Commit**

```bash
cd ~/quackback-ios && git add Sources/Quackback/Internal/JSBridge.swift Tests/QuackbackTests/JSBridgeTests.swift && git commit -m "feat: add JS bridge for native-to-WebView communication"
```

---

### Task 3: iOS WebView + Panel + Trigger + Public API

Wire all internal UI components and the public Quackback singleton. These are tightly coupled UIKit components that can't be unit tested without a simulator.

**Files:**

- Create: `~/quackback-ios/Sources/Quackback/Internal/QuackbackWebView.swift`
- Create: `~/quackback-ios/Sources/Quackback/Internal/PanelController.swift`
- Create: `~/quackback-ios/Sources/Quackback/Internal/TriggerButton.swift`
- Modify: `~/quackback-ios/Sources/Quackback/Quackback.swift`

- [ ] **Step 1: Implement QuackbackWebView**

```swift
// ~/quackback-ios/Sources/Quackback/Internal/QuackbackWebView.swift
import UIKit
import WebKit

protocol QuackbackWebViewDelegate: AnyObject {
    func webViewDidReceiveEvent(_ event: QuackbackEvent, data: [String: Any])
    func webViewDidBecomeReady()
}

final class QuackbackWebView: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    private(set) var webView: WKWebView?
    private let config: QuackbackConfig
    weak var delegate: QuackbackWebViewDelegate?
    private var isReady = false
    private var pendingCommands: [String] = []

    init(config: QuackbackConfig) {
        self.config = config
        super.init()
    }

    func loadIfNeeded() {
        guard webView == nil else { return }
        let wkConfig = WKWebViewConfiguration()
        let ucc = WKUserContentController()
        ucc.addUserScript(WKUserScript(source: JSBridge.bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        ucc.add(self, name: "quackback")
        wkConfig.userContentController = ucc

        let wv = WKWebView(frame: .zero, configuration: wkConfig)
        wv.navigationDelegate = self
        wv.isOpaque = false
        wv.backgroundColor = .clear
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        wv.load(URLRequest(url: config.widgetURL))
        webView = wv
    }

    func execute(_ js: String) {
        guard isReady else { pendingCommands.append(js); return }
        webView?.evaluateJavaScript(js)
    }

    func tearDown() {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "quackback")
        webView?.stopLoading()
        webView = nil
        isReady = false
        pendingCommands.removeAll()
    }

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "quackback",
              let body = message.body as? String,
              let parsed = JSBridge.parseEvent(body) else { return }
        if parsed.event == .ready {
            isReady = true
            webView?.evaluateJavaScript(JSBridge.initCommand(config: config))
            pendingCommands.forEach { webView?.evaluateJavaScript($0) }
            pendingCommands.removeAll()
            delegate?.webViewDidBecomeReady()
            return
        }
        delegate?.webViewDidReceiveEvent(parsed.event, data: parsed.data)
    }

    func webView(_ wv: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.navigationType == .linkActivated, let url = action.request.url, url.host != config.baseURL.host {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}
```

- [ ] **Step 2: Implement PanelController**

```swift
// ~/quackback-ios/Sources/Quackback/Internal/PanelController.swift
import UIKit

final class PanelController: UIViewController {
    private let webViewManager: QuackbackWebView
    var onDismiss: (() -> Void)?

    init(webViewManager: QuackbackWebView) {
        self.webViewManager = webViewManager
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .pageSheet
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        webViewManager.loadIfNeeded()
        guard let wv = webViewManager.webView else { return }
        wv.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(wv)
        NSLayoutConstraint.activate([
            wv.topAnchor.constraint(equalTo: view.topAnchor),
            wv.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            wv.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            wv.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        if let sheet = sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = true
        }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || presentingViewController == nil { onDismiss?() }
    }
}
```

- [ ] **Step 3: Implement TriggerButton**

```swift
// ~/quackback-ios/Sources/Quackback/Internal/TriggerButton.swift
import UIKit

final class TriggerButton: UIButton {
    private let position: QuackbackPosition
    private var isOpen = false
    private let size: CGFloat = 48
    private let inset: CGFloat = 16

    init(position: QuackbackPosition, color: UIColor) {
        self.position = position
        super.init(frame: .zero)
        backgroundColor = color
        layer.cornerRadius = size / 2
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOffset = CGSize(width: 0, height: 2)
        layer.shadowOpacity = 0.25
        layer.shadowRadius = 4
        translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: size),
            heightAnchor.constraint(equalToConstant: size),
        ])
        updateIcon(animated: false)
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    func install(in window: UIWindow) {
        window.addSubview(self)
        let guide = window.safeAreaLayoutGuide
        var constraints = [bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -inset)]
        switch position {
        case .bottomRight: constraints.append(trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -inset))
        case .bottomLeft: constraints.append(leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: inset))
        }
        NSLayoutConstraint.activate(constraints)
    }

    func setOpen(_ open: Bool) {
        guard open != isOpen else { return }
        isOpen = open
        updateIcon(animated: true)
    }

    private func updateIcon(animated: Bool) {
        let name = isOpen ? "xmark" : "bubble.left.fill"
        let img = UIImage(systemName: name)?
            .withConfiguration(UIImage.SymbolConfiguration(pointSize: 20, weight: .medium))
            .withTintColor(.white, renderingMode: .alwaysOriginal)
        if animated {
            UIView.transition(with: self, duration: 0.25, options: .transitionCrossDissolve) { self.setImage(img, for: .normal) }
        } else {
            setImage(img, for: .normal)
        }
    }
}
```

- [ ] **Step 4: Implement Quackback singleton**

Replace `~/quackback-ios/Sources/Quackback/Quackback.swift`:

```swift
// ~/quackback-ios/Sources/Quackback/Quackback.swift
import UIKit

public enum Quackback {
    private static var config: QuackbackConfig?
    private static var wvManager: QuackbackWebView?
    private static var trigger: TriggerButton?
    private static var panel: PanelController?
    private static let emitter = EventEmitter()
    private static var isShowing = false
    private static var pendingIdentify: String?

    public static func configure(_ config: QuackbackConfig) { self.config = config }

    public static func identify(ssoToken: String) {
        enqueue(JSBridge.identifyCommand(ssoToken: ssoToken))
    }

    public static func identify(userId: String, email: String, name: String? = nil, avatarURL: String? = nil) {
        enqueue(JSBridge.identifyCommand(userId: userId, email: email, name: name, avatarURL: avatarURL))
    }

    public static func logout() { enqueue(JSBridge.logoutCommand()) }

    public static func open(board: String? = nil) {
        guard let config else { return }
        ensureWV(config)
        wvManager?.execute(JSBridge.openCommand(board: board))
        presentPanel()
    }

    public static func close() { dismissPanel() }

    public static func showTrigger() {
        guard let config, trigger == nil else { return }
        let color = parseHex(config.buttonColor) ?? .systemBlue
        let btn = TriggerButton(position: config.position, color: color)
        btn.addTarget(self, action: #selector(triggerTapped), for: .touchUpInside)
        if let w = keyWindow { btn.install(in: w) }
        trigger = btn
    }

    public static func hideTrigger() { trigger?.removeFromSuperview(); trigger = nil }

    @discardableResult
    public static func on(_ event: QuackbackEvent, handler: @escaping @Sendable ([String: Any]) -> Void) -> EventToken {
        emitter.on(event, handler: handler)
    }

    public static func off(_ token: EventToken) { emitter.off(token) }

    public static func destroy() {
        dismissPanel(); hideTrigger()
        wvManager?.tearDown(); wvManager = nil
        emitter.removeAll(); config = nil; pendingIdentify = nil
    }

    // MARK: - Internal

    private static func ensureWV(_ config: QuackbackConfig) {
        guard wvManager == nil else { return }
        let m = QuackbackWebView(config: config)
        m.delegate = Delegate.shared
        wvManager = m
    }

    private static func enqueue(_ js: String) {
        if wvManager?.webView != nil { wvManager?.execute(js) } else { pendingIdentify = js }
    }

    private static func presentPanel() {
        guard !isShowing, let wvManager else { return }
        let pc = PanelController(webViewManager: wvManager)
        pc.onDismiss = { isShowing = false; trigger?.setOpen(false) }
        guard let top = topVC else { return }
        top.present(pc, animated: true)
        isShowing = true; trigger?.setOpen(true); panel = pc
    }

    private static func dismissPanel() {
        panel?.dismiss(animated: true); panel = nil; isShowing = false; trigger?.setOpen(false)
    }

    @objc private static func triggerTapped() { isShowing ? close() : open() }

    private static var keyWindow: UIWindow? {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first { $0.isKeyWindow }
    }

    private static var topVC: UIViewController? {
        var vc = keyWindow?.rootViewController
        while let p = vc?.presentedViewController { vc = p }
        return vc
    }

    private static func parseHex(_ hex: String?) -> UIColor? {
        guard let hex, hex.hasPrefix("#"), hex.count == 7 else { return nil }
        var rgb: UInt64 = 0
        Scanner(string: String(hex.dropFirst())).scanHexInt64(&rgb)
        return UIColor(red: CGFloat((rgb >> 16) & 0xFF) / 255, green: CGFloat((rgb >> 8) & 0xFF) / 255, blue: CGFloat(rgb & 0xFF) / 255, alpha: 1)
    }

    private final class Delegate: QuackbackWebViewDelegate {
        static let shared = Delegate()
        func webViewDidReceiveEvent(_ event: QuackbackEvent, data: [String: Any]) {
            if event == .close { dismissPanel() }
            emitter.emit(event, data: data)
        }
        func webViewDidBecomeReady() {
            if let js = pendingIdentify { wvManager?.execute(js); pendingIdentify = nil }
        }
    }
}
```

- [ ] **Step 5: Build**

```bash
cd ~/quackback-ios && swift build
```

- [ ] **Step 6: Commit**

```bash
cd ~/quackback-ios && git add Sources/ && git commit -m "feat: implement WebView, panel, trigger, and public Quackback API"
```

---

### Task 4: iOS example app + README

**Files:**

- Create: `~/quackback-ios/Example/QuackbackExample/QuackbackExampleApp.swift`
- Create: `~/quackback-ios/Example/QuackbackExample/ContentView.swift`
- Create: `~/quackback-ios/README.md`

- [ ] **Step 1: Create example app**

```bash
mkdir -p ~/quackback-ios/Example/QuackbackExample
```

```swift
// ~/quackback-ios/Example/QuackbackExample/QuackbackExampleApp.swift
import SwiftUI
import Quackback

@main
struct QuackbackExampleApp: App {
    init() {
        Quackback.configure(QuackbackConfig(
            appId: "example",
            baseURL: URL(string: "http://localhost:3000")!
        ))
        Quackback.identify(userId: "user_example", email: "demo@example.com", name: "Demo User")
        Quackback.on(.vote) { print("[Quackback] vote:", $0) }
        Quackback.on(.submit) { print("[Quackback] submit:", $0) }
        Quackback.showTrigger()
    }
    var body: some Scene { WindowGroup { ContentView() } }
}
```

```swift
// ~/quackback-ios/Example/QuackbackExample/ContentView.swift
import SwiftUI
import Quackback

struct ContentView: View {
    var body: some View {
        VStack(spacing: 20) {
            Text("Quackback Example").font(.largeTitle)
            Button("Open Feedback") { Quackback.open() }.buttonStyle(.borderedProminent)
            Button("Open Feature Requests") { Quackback.open(board: "feature-requests") }.buttonStyle(.bordered)
        }.padding()
    }
}
```

- [ ] **Step 2: Write README.md**

````markdown
# Quackback iOS SDK

Embed in-app feedback collection in your iOS app.

## Requirements

- iOS 15.0+
- Swift 5.9+

## Installation

Add the package in Xcode: File > Add Package Dependencies > enter the repo URL.

## Quick Start

```swift
import Quackback

Quackback.configure(QuackbackConfig(
    appId: "your-project-id",
    baseURL: URL(string: "https://feedback.yourapp.com")!
))
Quackback.identify(ssoToken: "your-jwt-token")
Quackback.showTrigger()
```
````

## API

| Method                                   | Description                        |
| ---------------------------------------- | ---------------------------------- |
| `configure(_:)`                          | Initialize with config (call once) |
| `identify(ssoToken:)`                    | Identify user via SSO JWT          |
| `identify(userId:email:name:avatarURL:)` | Identify user via attributes       |
| `logout()`                               | Clear user identity                |
| `open(board:)`                           | Open the feedback widget           |
| `close()`                                | Close the widget                   |
| `showTrigger()`                          | Show floating button               |
| `hideTrigger()`                          | Hide floating button               |
| `on(_:handler:)`                         | Listen for events                  |
| `off(_:)`                                | Remove event listener              |
| `destroy()`                              | Tear down SDK                      |

## Events

- `.vote` -- User voted on a post
- `.submit` -- User submitted feedback
- `.ready` -- Widget loaded
- `.close` -- Widget closed
- `.navigate` -- Route changed

## License

MIT

````

- [ ] **Step 3: Commit**

```bash
cd ~/quackback-ios && git add Example/ README.md && git commit -m "docs: add example app and README"
````

---

## Phase 3: Android SDK (`~/quackback-android`)

### Task 5: Initialize Gradle project + config + events + JS bridge

Set up the Android repo and implement the three foundational types with tests.

**Files:**

- Create: `~/quackback-android/settings.gradle.kts`
- Create: `~/quackback-android/build.gradle.kts`
- Create: `~/quackback-android/gradle.properties`
- Create: `~/quackback-android/quackback/build.gradle.kts`
- Create: `~/quackback-android/quackback/src/main/AndroidManifest.xml`
- Create: `~/quackback-android/.gitignore`
- Create: `~/quackback-android/quackback/src/main/kotlin/com/quackback/sdk/QuackbackConfig.kt`
- Create: `~/quackback-android/quackback/src/main/kotlin/com/quackback/sdk/QuackbackEvent.kt`
- Create: `~/quackback-android/quackback/src/main/kotlin/com/quackback/sdk/internal/JSBridge.kt`
- Create: `~/quackback-android/quackback/src/test/kotlin/com/quackback/sdk/QuackbackConfigTest.kt`
- Create: `~/quackback-android/quackback/src/test/kotlin/com/quackback/sdk/QuackbackEventTest.kt`
- Create: `~/quackback-android/quackback/src/test/kotlin/com/quackback/sdk/JSBridgeTest.kt`

- [ ] **Step 1: Create repo and directory structure**

```bash
mkdir -p ~/quackback-android/quackback/src/{main/kotlin/com/quackback/sdk/internal,test/kotlin/com/quackback/sdk}
cd ~/quackback-android && git init
```

- [ ] **Step 2: Create build files**

`~/quackback-android/settings.gradle.kts`:

```kotlin
rootProject.name = "quackback-android"
include(":quackback")
```

`~/quackback-android/build.gradle.kts`:

```kotlin
plugins {
    id("com.android.library") version "8.2.0" apply false
    id("org.jetbrains.kotlin.android") version "1.9.22" apply false
}
```

`~/quackback-android/gradle.properties`:

```properties
android.useAndroidX=true
kotlin.code.style=official
```

`~/quackback-android/quackback/build.gradle.kts`:

```kotlin
plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("maven-publish")
}

android {
    namespace = "com.quackback.sdk"
    compileSdk = 34
    defaultConfig { minSdk = 24 }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_1_8; targetCompatibility = JavaVersion.VERSION_1_8 }
    kotlinOptions { jvmTarget = "1.8" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.webkit:webkit:1.9.0")
    testImplementation("junit:junit:4.13.2")
}

publishing {
    publications {
        register<MavenPublication>("release") {
            groupId = "com.quackback"; artifactId = "sdk"; version = "0.1.0"
            afterEvaluate { from(components["release"]) }
        }
    }
}
```

`~/quackback-android/quackback/src/main/AndroidManifest.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
```

`~/quackback-android/.gitignore`:

```
.gradle/
build/
local.properties
*.iml
.idea/
.DS_Store
```

- [ ] **Step 3: Create placeholder and commit**

```kotlin
// ~/quackback-android/quackback/src/main/kotlin/com/quackback/sdk/Quackback.kt
package com.quackback.sdk

object Quackback { internal var isConfigured = false }
```

```bash
cd ~/quackback-android && git add -A && git commit -m "chore: initialize Gradle project"
```

- [ ] **Step 4: Write tests for config + events + bridge**

`~/quackback-android/quackback/src/test/kotlin/com/quackback/sdk/QuackbackConfigTest.kt`:

```kotlin
package com.quackback.sdk

import org.junit.Assert.*
import org.junit.Test

class QuackbackConfigTest {
    @Test fun `defaults`() {
        val c = QuackbackConfig(appId = "t", baseURL = "https://x.com")
        assertEquals(QuackbackTheme.SYSTEM, c.theme)
        assertEquals(QuackbackPosition.BOTTOM_RIGHT, c.position)
        assertNull(c.buttonColor)
    }

    @Test fun `widget URL has native params`() {
        val c = QuackbackConfig(appId = "t", baseURL = "https://x.com")
        assertTrue(c.widgetURL.contains("source=native"))
        assertTrue(c.widgetURL.contains("platform=android"))
    }
}
```

`~/quackback-android/quackback/src/test/kotlin/com/quackback/sdk/QuackbackEventTest.kt`:

```kotlin
package com.quackback.sdk

import org.junit.Assert.*
import org.junit.Test

class EventEmitterTest {
    @Test fun `fires listener`() {
        val e = EventEmitter()
        var got: Map<String, Any>? = null
        e.on(QuackbackEvent.VOTE) { got = it }
        e.emit(QuackbackEvent.VOTE, mapOf("postId" to "p1"))
        assertEquals("p1", got!!["postId"])
    }

    @Test fun `removes by token`() {
        val e = EventEmitter()
        var n = 0
        val tok = e.on(QuackbackEvent.SUBMIT) { n++ }
        e.emit(QuackbackEvent.SUBMIT, emptyMap()); assertEquals(1, n)
        e.off(tok)
        e.emit(QuackbackEvent.SUBMIT, emptyMap()); assertEquals(1, n)
    }
}
```

`~/quackback-android/quackback/src/test/kotlin/com/quackback/sdk/JSBridgeTest.kt`:

```kotlin
package com.quackback.sdk

import com.quackback.sdk.internal.JSBridge
import org.junit.Assert.*
import org.junit.Test

class JSBridgeTest {
    @Test fun `init command`() {
        val c = QuackbackConfig(appId = "a", baseURL = "https://x.com", theme = QuackbackTheme.DARK, locale = "fr")
        val js = JSBridge.initCommand(c)
        assertTrue(js.contains("\"appId\":\"a\"")); assertTrue(js.contains("\"theme\":\"dark\""))
    }

    @Test fun `identify SSO`() { assertTrue(JSBridge.identifyCommand(ssoToken = "t").contains("\"ssoToken\":\"t\"")) }

    @Test fun `identify attrs`() {
        val js = JSBridge.identifyCommand(userId = "u", email = "e", name = "n", avatarURL = null)
        assertTrue(js.contains("\"id\":\"u\"")); assertFalse(js.contains("avatarURL"))
    }

    @Test fun `open with board`() { assertTrue(JSBridge.openCommand("bugs").contains("\"board\":\"bugs\"")) }
    @Test fun `open nil`() { assertEquals("Quackback('open');", JSBridge.openCommand(null)) }
    @Test fun `logout`() { assertEquals("Quackback('logout');", JSBridge.logoutCommand()) }

    @Test fun `parse vote`() {
        val p = JSBridge.parseEvent("""{"event":"vote","data":{"type":"quackback:event","payload":{"postId":"p1"}}}""")!!
        assertEquals(QuackbackEvent.VOTE, p.event); assertEquals("p1", p.data["postId"])
    }

    @Test fun `parse invalid`() { assertNull(JSBridge.parseEvent("bad")) }
}
```

- [ ] **Step 5: Implement QuackbackConfig**

```kotlin
// ~/quackback-android/quackback/src/main/kotlin/com/quackback/sdk/QuackbackConfig.kt
package com.quackback.sdk

import android.net.Uri

enum class QuackbackTheme(val value: String) { LIGHT("light"), DARK("dark"), SYSTEM("user") }
enum class QuackbackPosition { BOTTOM_RIGHT, BOTTOM_LEFT }

data class QuackbackConfig(
    val appId: String,
    val baseURL: String,
    val theme: QuackbackTheme = QuackbackTheme.SYSTEM,
    val position: QuackbackPosition = QuackbackPosition.BOTTOM_RIGHT,
    val buttonColor: String? = null,
    val locale: String? = null
) {
    val widgetURL: String get() = Uri.parse(baseURL).buildUpon()
        .path("/widget")
        .appendQueryParameter("source", "native")
        .appendQueryParameter("platform", "android")
        .build().toString()
}
```

- [ ] **Step 6: Implement QuackbackEvent + EventEmitter**

```kotlin
// ~/quackback-android/quackback/src/main/kotlin/com/quackback/sdk/QuackbackEvent.kt
package com.quackback.sdk

import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

enum class QuackbackEvent(val value: String) {
    READY("ready"), VOTE("vote"), SUBMIT("submit"), CLOSE("close"), NAVIGATE("navigate");
    companion object { fun fromValue(v: String) = entries.find { it.value == v } }
}

data class EventToken(val id: String = UUID.randomUUID().toString())
typealias EventListener = (Map<String, Any>) -> Unit

internal class EventEmitter {
    private data class Entry(val token: EventToken, val handler: EventListener)
    private val listeners = ConcurrentHashMap<QuackbackEvent, CopyOnWriteArrayList<Entry>>()

    fun on(event: QuackbackEvent, handler: EventListener): EventToken {
        val t = EventToken()
        listeners.getOrPut(event) { CopyOnWriteArrayList() }.add(Entry(t, handler))
        return t
    }
    fun off(token: EventToken) { for (l in listeners.values) l.removeIf { it.token == token } }
    fun emit(event: QuackbackEvent, data: Map<String, Any>) { listeners[event]?.forEach { it.handler(data) } }
    fun removeAll() { listeners.clear() }
}
```

- [ ] **Step 7: Implement JSBridge**

```kotlin
// ~/quackback-android/quackback/src/main/kotlin/com/quackback/sdk/internal/JSBridge.kt
package com.quackback.sdk.internal

import com.quackback.sdk.QuackbackConfig
import com.quackback.sdk.QuackbackEvent
import org.json.JSONObject

internal data class ParsedEvent(val event: QuackbackEvent, val data: Map<String, Any>)

internal object JSBridge {
    fun initCommand(config: QuackbackConfig): String {
        val p = JSONObject().apply {
            put("appId", config.appId); put("theme", config.theme.value)
            config.locale?.let { put("locale", it) }
        }
        return "Quackback('init', $p);"
    }

    fun identifyCommand(ssoToken: String) = "Quackback('identify', ${JSONObject().apply { put("ssoToken", ssoToken) }});"

    fun identifyCommand(userId: String, email: String, name: String?, avatarURL: String?): String {
        val p = JSONObject().apply {
            put("id", userId); put("email", email)
            name?.let { put("name", it) }; avatarURL?.let { put("avatarURL", it) }
        }
        return "Quackback('identify', $p);"
    }

    fun openCommand(board: String?): String =
        if (board != null) "Quackback('open', ${JSONObject().apply { put("board", board) }});"
        else "Quackback('open');"

    fun logoutCommand() = "Quackback('logout');"

    fun parseEvent(json: String): ParsedEvent? = try {
        val obj = JSONObject(json)
        val event = QuackbackEvent.fromValue(obj.optString("event")) ?: return null
        val data = mutableMapOf<String, Any>()
        obj.optJSONObject("data")?.let { d ->
            val src = d.optJSONObject("payload") ?: d
            for (k in src.keys()) data[k] = src.get(k)
        }
        ParsedEvent(event, data)
    } catch (_: Exception) { null }

    val bridgeScript = """
        (function(){
          var dispatch=function(e,d){
            var m=JSON.stringify({event:e,data:d});
            QuackbackBridge.onEvent(m);
          };
          window.__quackbackNative={dispatch:dispatch};
        })();
    """.trimIndent()
}
```

- [ ] **Step 8: Run tests**

```bash
cd ~/quackback-android && ./gradlew :quackback:test
```

- [ ] **Step 9: Commit**

```bash
cd ~/quackback-android && git add quackback/src/ && git commit -m "feat: add config, events, and JS bridge"
```

---

### Task 6: Android WebView + Panel + Trigger + Public API

Wire all internal UI components and the public Quackback singleton.

**Files:**

- Create: `~/quackback-android/quackback/src/main/kotlin/com/quackback/sdk/internal/QuackbackWebView.kt`
- Create: `~/quackback-android/quackback/src/main/kotlin/com/quackback/sdk/internal/PanelBottomSheet.kt`
- Create: `~/quackback-android/quackback/src/main/kotlin/com/quackback/sdk/internal/TriggerButton.kt`
- Modify: `~/quackback-android/quackback/src/main/kotlin/com/quackback/sdk/Quackback.kt`

- [ ] **Step 1: Implement QuackbackWebViewManager**

```kotlin
// ~/quackback-android/quackback/src/main/kotlin/com/quackback/sdk/internal/QuackbackWebView.kt
package com.quackback.sdk.internal

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.*
import com.quackback.sdk.QuackbackConfig
import com.quackback.sdk.QuackbackEvent

internal interface WebViewEventListener {
    fun onEvent(event: QuackbackEvent, data: Map<String, Any>)
    fun onReady()
}

@SuppressLint("SetJavaScriptEnabled")
internal class QuackbackWebViewManager(private val config: QuackbackConfig) {
    var webView: WebView? = null; private set
    var listener: WebViewEventListener? = null
    private var isReady = false
    private val pending = mutableListOf<String>()

    fun loadIfNeeded(ctx: Context) {
        if (webView != null) return
        val wv = WebView(ctx).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun onPageStarted(v: WebView?, u: String?, f: android.graphics.Bitmap?) {
                    v?.evaluateJavascript(JSBridge.bridgeScript, null)
                }
                override fun shouldOverrideUrlLoading(v: WebView?, r: WebResourceRequest?): Boolean {
                    val url = r?.url ?: return false
                    if (url.host != Uri.parse(config.baseURL).host) { ctx.startActivity(Intent(Intent.ACTION_VIEW, url)); return true }
                    return false
                }
            }
            addJavascriptInterface(Bridge(), "QuackbackBridge")
        }
        wv.loadUrl(config.widgetURL)
        webView = wv
    }

    fun execute(js: String) { if (!isReady) { pending.add(js); return }; webView?.evaluateJavascript(js, null) }

    fun tearDown() {
        webView?.removeJavascriptInterface("QuackbackBridge")
        webView?.stopLoading(); webView?.destroy(); webView = null; isReady = false; pending.clear()
    }

    private inner class Bridge {
        @JavascriptInterface fun onEvent(json: String) {
            val p = JSBridge.parseEvent(json) ?: return
            if (p.event == QuackbackEvent.READY) {
                isReady = true
                webView?.post { webView?.evaluateJavascript(JSBridge.initCommand(config), null) }
                pending.forEach { cmd -> webView?.post { webView?.evaluateJavascript(cmd, null) } }
                pending.clear(); listener?.onReady(); return
            }
            listener?.onEvent(p.event, p.data)
        }
    }
}
```

- [ ] **Step 2: Implement PanelBottomSheet**

```kotlin
// ~/quackback-android/quackback/src/main/kotlin/com/quackback/sdk/internal/PanelBottomSheet.kt
package com.quackback.sdk.internal

import android.os.Bundle
import android.view.*
import android.widget.FrameLayout
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialogFragment

internal class PanelBottomSheet(private val wvManager: QuackbackWebViewManager) : BottomSheetDialogFragment() {
    var onDismissed: (() -> Unit)? = null

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, state: Bundle?): View {
        wvManager.loadIfNeeded(requireContext())
        val layout = FrameLayout(requireContext()).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        wvManager.webView?.let { (it.parent as? ViewGroup)?.removeView(it); layout.addView(it, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)) }
        return layout
    }

    override fun onStart() {
        super.onStart()
        dialog?.findViewById<FrameLayout>(com.google.android.material.R.id.design_bottom_sheet)?.let {
            BottomSheetBehavior.from(it).apply { state = BottomSheetBehavior.STATE_EXPANDED; peekHeight = (resources.displayMetrics.heightPixels * 0.5).toInt() }
        }
    }

    override fun onDestroyView() { wvManager.webView?.let { (it.parent as? ViewGroup)?.removeView(it) }; super.onDestroyView() }
    override fun onDestroy() { super.onDestroy(); onDismissed?.invoke() }
}
```

- [ ] **Step 3: Implement TriggerButton**

```kotlin
// ~/quackback-android/quackback/src/main/kotlin/com/quackback/sdk/internal/TriggerButton.kt
package com.quackback.sdk.internal

import android.animation.ObjectAnimator
import android.app.Activity
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import com.quackback.sdk.QuackbackPosition

internal class TriggerButton(
    private val activity: Activity,
    private val position: QuackbackPosition,
    color: String?,
    private val onClick: () -> Unit
) {
    private var button: FrameLayout? = null
    private var isOpen = false
    private val dp = activity.resources.displayMetrics.density
    private val sizePx = (48 * dp).toInt()
    private val marginPx = (16 * dp).toInt()
    private val bgColor = parseColor(color)

    fun install() {
        if (button != null) return
        val icon = ImageView(activity).apply { setImageResource(android.R.drawable.ic_dialog_info); scaleType = ImageView.ScaleType.CENTER_INSIDE }
        val bg = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(bgColor) }
        val btn = FrameLayout(activity).apply {
            background = bg; elevation = 6 * dp
            addView(icon, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            setOnClickListener { onClick() }
        }
        val gravity = Gravity.BOTTOM or if (position == QuackbackPosition.BOTTOM_RIGHT) Gravity.END else Gravity.START
        val params = FrameLayout.LayoutParams(sizePx, sizePx).apply { this.gravity = gravity; setMargins(marginPx, marginPx, marginPx, marginPx) }
        (activity.window.decorView as FrameLayout).addView(btn, params)
        button = btn
    }

    fun remove() { button?.let { (it.parent as? FrameLayout)?.removeView(it) }; button = null }

    fun setOpen(open: Boolean) {
        if (open == isOpen) return; isOpen = open
        button?.let { ObjectAnimator.ofFloat(it, View.ROTATION, if (open) 45f else 0f).apply { duration = 250 }.start() }
    }

    private fun parseColor(hex: String?): Int =
        if (hex != null && hex.startsWith("#") && hex.length == 7) try { Color.parseColor(hex) } catch (_: Exception) { Color.parseColor("#2563EB") }
        else Color.parseColor("#2563EB")
}
```

- [ ] **Step 4: Implement Quackback singleton**

Replace `~/quackback-android/quackback/src/main/kotlin/com/quackback/sdk/Quackback.kt`:

```kotlin
package com.quackback.sdk

import android.app.Activity
import android.app.Application
import android.os.Bundle
import androidx.fragment.app.FragmentActivity
import com.quackback.sdk.internal.*

object Quackback {
    private var config: QuackbackConfig? = null
    private var wvManager: QuackbackWebViewManager? = null
    private var trigger: TriggerButton? = null
    private var panel: PanelBottomSheet? = null
    private val emitter = EventEmitter()
    private var isShowing = false
    private var pendingIdentify: String? = null
    private var currentActivity: Activity? = null

    private val lifecycle = object : Application.ActivityLifecycleCallbacks {
        override fun onActivityResumed(a: Activity) { currentActivity = a }
        override fun onActivityPaused(a: Activity) { if (currentActivity == a) currentActivity = null }
        override fun onActivityCreated(a: Activity, s: Bundle?) {}
        override fun onActivityStarted(a: Activity) {}
        override fun onActivityStopped(a: Activity) {}
        override fun onActivitySaveInstanceState(a: Activity, s: Bundle) {}
        override fun onActivityDestroyed(a: Activity) {}
    }

    private val wvListener = object : WebViewEventListener {
        override fun onEvent(event: QuackbackEvent, data: Map<String, Any>) {
            if (event == QuackbackEvent.CLOSE) close()
            emitter.emit(event, data)
        }
        override fun onReady() { pendingIdentify?.let { wvManager?.execute(it); pendingIdentify = null } }
    }

    fun configure(context: android.content.Context, config: QuackbackConfig) {
        this.config = config
        (context.applicationContext as? Application)?.registerActivityLifecycleCallbacks(lifecycle)
    }

    fun identify(ssoToken: String) { enqueue(JSBridge.identifyCommand(ssoToken = ssoToken)) }
    fun identify(userId: String, email: String, name: String? = null, avatarURL: String? = null) {
        enqueue(JSBridge.identifyCommand(userId, email, name, avatarURL))
    }
    fun logout() { enqueue(JSBridge.logoutCommand()) }

    fun open(board: String? = null) {
        val cfg = config ?: return; val act = currentActivity ?: return
        ensureWV(cfg); wvManager?.execute(JSBridge.openCommand(board)); present(act)
    }

    fun close() { dismiss() }
    fun showTrigger() {
        val cfg = config ?: return; val act = currentActivity ?: return; if (trigger != null) return
        trigger = TriggerButton(act, cfg.position, cfg.buttonColor) { if (isShowing) close() else open() }.also { it.install() }
    }
    fun hideTrigger() { trigger?.remove(); trigger = null }
    fun on(event: QuackbackEvent, handler: EventListener) = emitter.on(event, handler)
    fun off(token: EventToken) { emitter.off(token) }

    fun destroy() {
        dismiss(); hideTrigger(); wvManager?.tearDown(); wvManager = null; emitter.removeAll()
        config = null; pendingIdentify = null
        (currentActivity?.applicationContext as? Application)?.unregisterActivityLifecycleCallbacks(lifecycle)
        currentActivity = null
    }

    private fun ensureWV(cfg: QuackbackConfig) { if (wvManager != null) return; wvManager = QuackbackWebViewManager(cfg).also { it.listener = wvListener } }
    private fun enqueue(js: String) { if (wvManager?.webView != null) wvManager?.execute(js) else pendingIdentify = js }
    private fun present(act: Activity) {
        if (isShowing) return; val m = wvManager ?: return; val fa = act as? FragmentActivity ?: return
        m.loadIfNeeded(act)
        val sheet = PanelBottomSheet(m).also { it.onDismissed = { isShowing = false; trigger?.setOpen(false); panel = null } }
        sheet.show(fa.supportFragmentManager, "quackback"); isShowing = true; trigger?.setOpen(true); panel = sheet
    }
    private fun dismiss() { panel?.dismiss(); panel = null; isShowing = false; trigger?.setOpen(false) }
}
```

- [ ] **Step 5: Build**

```bash
cd ~/quackback-android && ./gradlew :quackback:assembleDebug
```

- [ ] **Step 6: Commit**

```bash
cd ~/quackback-android && git add quackback/src/ && git commit -m "feat: implement WebView, panel, trigger, and public Quackback API"
```

---

### Task 7: Android example app + README

**Files:**

- Modify: `~/quackback-android/settings.gradle.kts`
- Create: `~/quackback-android/app/build.gradle.kts`
- Create: `~/quackback-android/app/src/main/AndroidManifest.xml`
- Create: `~/quackback-android/app/src/main/kotlin/com/quackback/example/ExampleApplication.kt`
- Create: `~/quackback-android/app/src/main/kotlin/com/quackback/example/MainActivity.kt`
- Create: `~/quackback-android/README.md`

- [ ] **Step 1: Add app module to settings**

Update `~/quackback-android/settings.gradle.kts`:

```kotlin
rootProject.name = "quackback-android"
include(":quackback")
include(":app")
```

- [ ] **Step 2: Create app build file**

```kotlin
// ~/quackback-android/app/build.gradle.kts
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.quackback.example"
    compileSdk = 34
    defaultConfig { applicationId = "com.quackback.example"; minSdk = 24; targetSdk = 34; versionCode = 1; versionName = "1.0" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_1_8; targetCompatibility = JavaVersion.VERSION_1_8 }
    kotlinOptions { jvmTarget = "1.8" }
}

dependencies {
    implementation(project(":quackback"))
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
}
```

- [ ] **Step 3: Create AndroidManifest + example classes**

```bash
mkdir -p ~/quackback-android/app/src/main/kotlin/com/quackback/example
```

`~/quackback-android/app/src/main/AndroidManifest.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <application android:name=".ExampleApplication" android:label="Quackback Example" android:theme="@style/Theme.Material3.DayNight">
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

```kotlin
// ~/quackback-android/app/src/main/kotlin/com/quackback/example/ExampleApplication.kt
package com.quackback.example

import android.app.Application
import com.quackback.sdk.*

class ExampleApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        Quackback.configure(this, QuackbackConfig(appId = "example", baseURL = "http://10.0.2.2:3000"))
        Quackback.identify(userId = "user_example", email = "demo@example.com", name = "Demo User")
        Quackback.on(QuackbackEvent.VOTE) { println("[Quackback] vote: $it") }
        Quackback.on(QuackbackEvent.SUBMIT) { println("[Quackback] submit: $it") }
    }
}
```

```kotlin
// ~/quackback-android/app/src/main/kotlin/com/quackback/example/MainActivity.kt
package com.quackback.example

import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import androidx.appcompat.app.AppCompatActivity
import com.quackback.sdk.Quackback

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(48, 48, 48, 48) }
        layout.addView(Button(this).apply { text = "Open Feedback"; setOnClickListener { Quackback.open() } })
        layout.addView(Button(this).apply { text = "Feature Requests"; setOnClickListener { Quackback.open(board = "feature-requests") } })
        layout.addView(Button(this).apply { text = "Show Trigger"; setOnClickListener { Quackback.showTrigger() } })
        setContentView(layout)
    }
}
```

- [ ] **Step 4: Write README.md**

````markdown
# Quackback Android SDK

Embed in-app feedback collection in your Android app.

## Requirements

- Android API 24+ (Android 7.0)
- AndroidX

## Installation

Add to your module's `build.gradle.kts`:

```kotlin
dependencies {
    implementation("com.quackback:sdk:0.1.0")
}
```
````

## Quick Start

```kotlin
import com.quackback.sdk.Quackback
import com.quackback.sdk.QuackbackConfig

Quackback.configure(this, QuackbackConfig(
    appId = "your-project-id",
    baseURL = "https://feedback.yourapp.com"
))
Quackback.identify(ssoToken = "your-jwt-token")
Quackback.showTrigger()
```

## API

| Method                                       | Description                        |
| -------------------------------------------- | ---------------------------------- |
| `configure(context, config)`                 | Initialize with config (call once) |
| `identify(ssoToken)`                         | Identify user via SSO JWT          |
| `identify(userId, email, name?, avatarURL?)` | Identify user via attributes       |
| `logout()`                                   | Clear user identity                |
| `open(board?)`                               | Open the feedback widget           |
| `close()`                                    | Close the widget                   |
| `showTrigger()`                              | Show floating button               |
| `hideTrigger()`                              | Hide floating button               |
| `on(event, handler)`                         | Listen for events                  |
| `off(token)`                                 | Remove event listener              |
| `destroy()`                                  | Tear down SDK                      |

## Events

- `VOTE` -- User voted on a post
- `SUBMIT` -- User submitted feedback
- `READY` -- Widget loaded
- `CLOSE` -- Widget closed
- `NAVIGATE` -- Route changed

## License

MIT

````

- [ ] **Step 5: Commit**

```bash
cd ~/quackback-android && git add app/ settings.gradle.kts README.md && git commit -m "docs: add example app and README"
````

---

## Phase 4: Verification

### Task 8: End-to-end verification

- [ ] **Step 1: Verify no postMessage calls remain**

```bash
cd /home/james/quackback
grep -rn "window.parent.postMessage" apps/web/src/components/widget/ apps/web/src/lib/client/hooks/use-widget-vote.ts
```

Expected: no output.

- [ ] **Step 2: Run web tests**

```bash
bun run --cwd apps/web typecheck && npx vitest run
```

Expected: all pass.

- [ ] **Step 3: Run iOS tests**

```bash
cd ~/quackback-ios && swift test
```

Expected: all pass.

- [ ] **Step 4: Run Android tests**

```bash
cd ~/quackback-android && ./gradlew :quackback:test
```

Expected: all pass.

- [ ] **Step 5: Manual browser test**

Start dev server (`bun run dev`), open `http://localhost:3000/widget?source=native&platform=ios`. In the browser console:

```javascript
window.__quackbackNative = { dispatch: (e, d) => console.log('[NATIVE]', e, d) }
```

Interact with the widget (vote on a post). Console should log `[NATIVE] event {...}`.
