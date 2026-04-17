# @quackback/widget

A real npm package for the [Quackback](https://quackback.io) feedback widget — types, tree-shaking, SSR-safe, no dynamic script injection.

- Tiny — core <10 KB min+gzip, React adapter <2 KB, zero runtime dependencies
- TypeScript-first — discriminated `Identity` union, typed `EventMap`, autocompleting `open()` deep-link arguments
- SSR-safe — all DOM access behind effects; `use-init` starts nothing on the server
- Works without npm too — script-tag integrations continue to work unchanged via `<script src="https://your-quackback.example/api/widget/sdk.js">`

## Install

```bash
npm install @quackback/widget
# or:  pnpm add @quackback/widget
# or:  bun add @quackback/widget
```

## Quick start — vanilla

```js
import { Quackback } from '@quackback/widget'

Quackback.init({ instanceUrl: 'https://feedback.acme.com' })

// Later, when you know who the user is:
Quackback.identify({ id: 'u_123', email: 'ada@example.com', name: 'Ada' })

// Deep-link to a specific board / post / article:
Quackback.open({ view: 'new-post', title: 'Bug:', board: 'bugs' })
```

## Quick start — React

No provider. Quackback is a singleton; the hooks wrap its lifecycle.

```tsx
import { useQuackbackInit, useQuackback, useQuackbackEvent } from '@quackback/widget/react'

function App() {
  const { user } = useAuth()

  useQuackbackInit({
    instanceUrl: 'https://feedback.acme.com',
    identity: user ? { id: user.id, email: user.email, name: user.name } : undefined,
    shouldInitialize: true, // optional — gate on a feature flag
    initializeDelay: 0, // optional — defer init N ms for perf
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

## API

### Methods

| Method                                        | Description                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| `Quackback.init(options)`                     | Create launcher + iframe. `options.instanceUrl` required.                  |
| `Quackback.identify(identity?)`               | Attribute activity to a user. Omit for anonymous.                          |
| `Quackback.logout()`                          | Clear identity; widget stays visible in anonymous mode.                    |
| `Quackback.open(options?)`                    | Open the panel; optional deep-link payload (see below).                    |
| `Quackback.close()`                           | Close the panel.                                                           |
| `Quackback.showLauncher()` / `hideLauncher()` | Toggle the floating button.                                                |
| `Quackback.metadata(patch)`                   | Attach session context to submitted feedback. Pass `null` to remove a key. |
| `Quackback.on(event, handler)`                | Subscribe to a widget event. Returns an unsubscribe function.              |
| `Quackback.off(event, handler?)`              | Remove a specific handler, or all listeners for the event.                 |
| `Quackback.destroy()`                         | Tear down all widget state + DOM.                                          |
| `Quackback.isOpen()`                          | Returns whether the panel is currently visible.                            |
| `Quackback.getUser()`                         | Returns the current identified user, or `null`.                            |
| `Quackback.isIdentified()`                    | Returns `true` when a user is identified (non-anonymous).                  |

### `init` options

```ts
Quackback.init({
  instanceUrl: 'https://feedback.acme.com', // required
  placement: 'right' | 'left', // default 'right'
  defaultBoard: 'bugs', // filter widget to one board
  launcher: true, // false = hide default button
  locale: 'en' | 'fr' | 'de' | 'es' | 'ar', // override browser/device auto-detect
  identity: { id, email, name } | { ssoToken }, // bundle identify into init
})
```

Theme colors and tab visibility are configured in your Quackback admin (Admin → Settings → Widget) — there's no client override.

### `identify` shapes

```ts
Quackback.identify() // anonymous
Quackback.identify({ id: 'u_123', email: 'ada@x.com', name: 'Ada' }) // unverified
Quackback.identify({ ssoToken: 'eyJ...' }) // verified
```

See the [Identify users guide](https://quackback.io/docs/widget/identify-users) for JWT claims and server examples.

### `open` — deep-link targets

```ts
Quackback.open() // home
Quackback.open({ view: 'new-post', title: 'Bug:', body: '...' }) // pre-filled form
Quackback.open({ view: 'changelog' }) // changelog feed
Quackback.open({ view: 'help', query: 'pricing' }) // help search
Quackback.open({ postId: 'post_01h...' }) // specific post
Quackback.open({ articleId: 'art_01h...' }) // help article
```

`view`, `title`, and `board` are handled today. `body`, `query`, `postId`, `articleId`, `entryId` pass through the postMessage protocol; full iframe rendering lands in a follow-up release.

### Events

```ts
const unsubscribe = Quackback.on('vote', (payload) => {
  console.log('Voted on', payload.postId)
})
// Later:
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

## Other frameworks

Vue, Svelte, Angular, Solid — use the core `Quackback` import directly; it's framework-agnostic. Dedicated adapters will ship when there's demand.

## Docs

Full documentation: https://quackback.io/docs/widget

## License

AGPL-3.0
