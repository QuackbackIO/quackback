# @quackback/widget

The official SDK for embedding the [Quackback](https://quackback.io) feedback widget in your app. Ships with TypeScript types and a React adapter.

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

// When you know who the user is:
Quackback.identify({ id: 'u_123', email: 'ada@example.com', name: 'Ada' })

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
    identity: user ? { id: user.id, email: user.email, name: user.name } : undefined,
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

## API

### Methods

| Method                                        | Description                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| `Quackback.init(options)`                     | Create launcher + iframe. `options.instanceUrl` required.                      |
| `Quackback.identify(identity?)`               | Attribute activity to a user. Omit for anonymous.                              |
| `Quackback.logout()`                          | Clear identity; widget stays visible in anonymous mode.                        |
| `Quackback.open(options?)`                    | Open the panel; optional deep-link payload (see below).                        |
| `Quackback.close()`                           | Close the panel.                                                               |
| `Quackback.showLauncher()` / `hideLauncher()` | Toggle the floating button.                                                    |
| `Quackback.metadata(patch)`                   | Attach session context to submitted feedback. Pass `null` to remove a key.     |
| `Quackback.tracking(enabled)`                 | Allow or stop host-page visitor analytics. `false` also removes the device id. |
| `Quackback.on(event, handler)`                | Subscribe to a widget event. Returns an unsubscribe function.                  |
| `Quackback.off(event, handler?)`              | Remove a specific handler, or all listeners for the event.                     |
| `Quackback.destroy()`                         | Tear down all widget state and DOM.                                            |
| `Quackback.isOpen()`                          | Whether the panel is currently visible.                                        |
| `Quackback.getUser()`                         | The current identified user, or `null`.                                        |
| `Quackback.isIdentified()`                    | `true` when a user is identified (non-anonymous).                              |

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
  identity: { id, email, name } | { ssoToken }, // bundle identify into init
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
Quackback.identify({ id: 'u_123', email: 'ada@x.com', name: 'Ada' }) // unverified
Quackback.identify({ ssoToken: 'eyJ...' }) // verified
```

See the [Identify users guide](https://quackback.io/docs/widget/identify-users) for JWT claims and server examples.

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

## Docs

Full documentation: https://quackback.io/docs/widget

## License

AGPL-3.0
