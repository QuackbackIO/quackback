# @quackback/widget

The official SDK for embedding the [Quackback](https://quackback.io) widget (feedback, live chat and help articles) in your app. Ships with TypeScript types and a React adapter.

## Install

```bash
npm install @quackback/widget
# or:  pnpm add @quackback/widget
# or:  bun add @quackback/widget
```

## Vanilla JS

```js
import { Quackback } from '@quackback/widget'

Quackback.init({ instanceUrl: 'https://feedback.yourcompany.com' })

// When you know who the user is, pass a short-lived token your server signed
// with the widget secret (HS256). Never sign tokens in the browser.
Quackback.identify({ ssoToken })

// Deep-link to a specific view:
Quackback.open({ view: 'new-post', title: 'Bug:', board: 'bugs' })
```

## React

```tsx
import { useQuackbackInit, useQuackback, useQuackbackEvent } from '@quackback/widget/react'

function App() {
  const { user } = useAuth()

  useQuackbackInit({
    instanceUrl: 'https://feedback.yourcompany.com',
    identity: user ? { ssoToken: user.quackbackToken } : undefined, // signed by your server
  })

  useQuackbackEvent('post:created', (post) => {
    analytics.track('feedback_submitted', { postId: post.id })
  })

  return <Layout />
}

function FeedbackButton() {
  const qb = useQuackback()
  return <button onClick={() => qb.open({ view: 'new-post' })}>Feedback</button>
}
```

No provider needed — Quackback is a singleton and the hooks wrap its lifecycle.

## Other frameworks

Vue, Svelte, Angular, Solid: import `Quackback` from the main entry and call it directly. Framework adapters ship on request.

## Prefer a script tag?

Drop this in your `<head>` and skip the install step entirely:

```html
<script src="https://feedback.yourcompany.com/api/widget/sdk.js" defer></script>
```

A script-tag install calls the global function with the method name: `Quackback('open')`, `Quackback('on', 'close', handler)`. The state methods return their value the same way once `sdk.js` has loaded:

```js
Quackback('on', 'ready', () => {
  console.log(Quackback('isOpen'), Quackback('isIdentified'), Quackback('getUser'))
})
```

Before `sdk.js` loads, the install snippet only queues calls, so a state read made that early returns `undefined`. Read state inside a `ready` handler, or after your own code knows the script has loaded.

## API

### Methods

| Method                                        | Description                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| `Quackback.init(options)`                     | Create launcher + iframe. `options.instanceUrl` required.                      |
| `Quackback.identify(identity?)`               | Attribute activity to a user. Omit for anonymous.                              |
| `Quackback.logout()`                          | Clear identity; widget stays visible in anonymous mode.                        |
| `Quackback.open(options?)`                    | Open the panel; optional deep-link payload (see below).                        |
| `Quackback.close()`                           | Close the panel.                                                               |
| `Quackback.showLauncher()` / `hideLauncher()` | Show or hide the floating button and its greeting. See below.                  |
| `Quackback.metadata(patch)`                   | Attach session context to submitted feedback. Pass `null` to remove a key.     |
| `Quackback.tracking(enabled)`                 | Allow or stop host-page visitor analytics. `false` also removes the device id. |
| `Quackback.on(event, handler)`                | Subscribe to a widget event. Returns an unsubscribe function.                  |
| `Quackback.off(event, handler?)`              | Remove a specific handler, or all listeners for the event.                     |
| `Quackback.destroy()`                         | Tear down all widget state and DOM.                                            |
| `Quackback.isOpen()`                          | Whether the panel is currently visible.                                        |
| `Quackback.getUser()`                         | The current identified user, or `null`.                                        |
| `Quackback.isIdentified()`                    | `true` when a user is identified (non-anonymous).                              |

### The launcher

The floating button is named "Open help" for screen readers (or your launcher label, when one is set), with the unread count added when there is one: "Open help, 2 unread". While the panel is open it reads "Close help". The panel is a labelled dialog: opening it with a click or key press moves keyboard focus into it, and closing it returns focus to the element that opened it, or to the launcher when that element is gone. An open while the visitor is typing in a field leaves their focus there.

When the workspace turns on "Announce new updates above the launcher", a visitor with unread changelog entries sees a card above the closed launcher with the newest one. Clicking it opens the widget on that entry. Dismissing it hides the card until a newer entry is published; the unread badge stays until the visitor reads the entries in the widget. The card takes the place of the greeting bubble while it shows.

`hideLauncher()` hides the button and its greeting bubble together. `showLauncher()` brings them back, and also works after `init({ launcher: false })`, so you can start with your own button and show the default one later.

### `init` options

```ts
Quackback.init({
  instanceUrl: 'https://feedback.yourcompany.com', // required
  placement: 'right' | 'left', // default 'right'
  defaultBoard: 'bugs', // filter widget to one board
  launcher: true, // false = hide default button
  locale:
    'en' |
    'fr' |
    'de' |
    'es' |
    'ar' |
    'ru' |
    'pt-BR' |
    'zh-CN' |
    'zh-TW' |
    'nl' |
    'pl' |
    'th' |
    'uk', // override auto-detect
  identity: { ssoToken }, // bundle identify into init
  tracking: true, // false = no pageview beacons or new device id until tracking(true)
})
```

Theme colors and tab visibility come from your Quackback admin (Admin → Settings → Widget).

### Visitor analytics and consent

When the instance has visitor analytics on, the widget reports host-page views and may keep a device id in the host page's `localStorage`. If your site asks visitors for analytics consent, start with `tracking: false` and switch it on once they accept:

```ts
Quackback.init({ instanceUrl, tracking: false })
onAnalyticsConsent((granted) => Quackback.tracking(granted))
```

The launcher and panel work either way; only pageview tracking waits for consent. Withdrawing with `tracking(false)` stops future pageviews and removes the stored device id; visits the instance already recorded stay in its analytics.

### `identify` shapes

```ts
Quackback.identify() // anonymous
Quackback.identify({ ssoToken: 'eyJ...' }) // signed by your server
```

The server only accepts a signed `ssoToken`. An unsigned `{ id, email, name }` identity is rejected with `VALIDATION_ERROR`, so nobody can pose as another user. See the [Identify users guide](https://feedback.quackback.io/hc/en/articles/55-identify-users) for the JWT claims and server examples.

### `open` deep-links

```ts
Quackback.open() // home
Quackback.open({ view: 'new-post', title: 'Bug:', body: '...', board: 'bugs' }) // pre-filled form
Quackback.open({ view: 'changelog' }) // changelog feed
Quackback.open({ view: 'help', query: 'pricing' }) // help search
Quackback.open({ view: 'messages' }) // messenger conversations
Quackback.open({ view: 'tickets' }) // the visitor's tickets, or messages when unavailable
Quackback.open({ postId: 'post_01h...' }) // specific post
Quackback.open({ articleId: 'article_01h...' }) // help article TypeID or slug
```

`postId` and `articleId` win over `view` if both are set. `board` on `open` only applies to `view: 'new-post'`. Home / Popular Ideas filtering uses `init({ defaultBoard })` or the iframe `?board=` param.

Every `open` field is live. A disabled surface or an unseen board fails closed — the panel still opens, but the widget does not invent access.

### Events

```ts
const unsubscribe = Quackback.on('vote', (payload) => {
  console.log('Voted on', payload.postId)
})
unsubscribe()
```

| Event             | Payload                                    |
| ----------------- | ------------------------------------------ |
| `ready`           | `{}`                                       |
| `open`            | `{ view?, postId?, articleId?, entryId? }` |
| `close`           | `{}`                                       |
| `post:created`    | `{ id, title, board, statusId }`           |
| `vote`            | `{ postId, voted, voteCount }`             |
| `comment:created` | `{ postId, commentId, parentId }`          |
| `identify`        | `{ success, user, anonymous, error? }`     |
| `email-submitted` | `{ email }`                                |
| `unread`          | `{ count }`                                |
| `whats-new`       | `{ count, entryId }`                       |

## Docs

Full documentation: https://feedback.quackback.io/hc

## License

[MIT](LICENSE). This package and the `sdk.js` script built from it are MIT, so you can ship them in closed-source apps. The Quackback server is AGPL-3.0.
