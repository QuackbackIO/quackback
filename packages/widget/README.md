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
| `Quackback.whatsNew(enabled)`                 | Show or hide the "What's new" card on this page. The badge is unchanged.       |
| `Quackback.on(event, handler)`                | Subscribe to a widget event. Returns an unsubscribe function.                  |
| `Quackback.off(event, handler?)`              | Remove a specific handler, or all listeners for the event.                     |
| `Quackback.destroy()`                         | Tear down all widget state and DOM.                                            |
| `Quackback.isOpen()`                          | Whether the panel is currently visible.                                        |
| `Quackback.getUser()`                         | The current identified user, or `null`.                                        |
| `Quackback.isIdentified()`                    | `true` when a user is identified (non-anonymous).                              |

### The launcher

The floating button is named "Open help" for screen readers (or your launcher label, when one is set), with the unread count added when there is one: "Open help, 2 unread". While the panel is open it reads "Close help". The panel is a labelled dialog: opening it with a click or key press moves keyboard focus into it, and closing it returns focus to the element that opened it, or to the launcher when that element is gone. An open while the visitor is typing in a field leaves their focus there.

When the workspace turns on "Announce new updates above the launcher", a visitor with unread changelog entries sees a "What's new" card above the closed launcher with the newest one. Clicking it opens the widget on that entry. Dismissing it hides the card until a newer entry is published; the unread badge stays until the visitor reads the entries in the widget. The card takes the place of the greeting bubble while it shows. The host page remembers dismissed entries per instance and per visitor: each identified user has their own memory, and anonymous visitors share one. The `whats-new` event fires the first time the card shows an entry to a visitor, not on every page load.

Each changelog entry can turn off "Announce above the launcher" in its settings. Such an entry still counts towards the unread badge and shows in the widget's changelog, but the card skips it: it shows the newest unread entry that is announced, and its count ("2 new updates") counts only announced entries.

Unread changelog entries are those published after a visitor's first visit on a device. The first time the widget loads there, every entry published before then is recorded as seen, including entries the visitor can only see after signing in, so a visitor sees the badge and the card for later entries even if they never open the changelog. The card also keeps its own record per visitor: the first time it could show for a visitor on a device, while the workspace announces updates, entries that are already unread are recorded without showing the card or firing `whats-new`, and the badge still counts them. If the host page blocks storage, the card skips this step, and a dismiss lasts for the page load.

To keep the card off on one page, such as a checkout, pass `init({ whatsNew: false })`, or call `Quackback.whatsNew(false)` and `Quackback.whatsNew(true)` while the page is open. This changes only the page, not the workspace setting, and the badge stays as it is. Like `tracking`, a later `init` without the option keeps the last choice, and a call made before `init` holds.

When a teammate or the AI assistant replies and the widget is closed, a card above the launcher previews the newest unread replies of the visitor's most recent conversation, from its latest author, beside their photo or initials. Clicking a reply or "Reply to ..." opens the widget on that conversation, with the message box focused on larger screens. Dismissing the card hides it until a newer reply arrives; nothing is marked read, so the badge stays. On phones the card shows the newest reply with the number of new replies from that person. The workspace chooses between this preview, the whole reply, or the badge alone under "Reply alerts", and can also flash "Alex replied" in the page title while the visitor is on another tab. The title flashes once per new reply that the visitor has not seen or dismissed, and stops when they come back to the page. The reply preview goes ahead of the "What's new" card, which goes ahead of the greeting bubble: one card shows at a time.

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
    'uk', // each user's own language in your app; leave out for a fixed one (see Language)
  identity: { ssoToken }, // bundle identify into init
  tracking: true, // false = no pageview beacons or new device id until tracking(true)
  whatsNew: true, // false = no "What's new" card on this page; the badge is unchanged
})
```

Theme colors and tab visibility come from your Quackback admin (Admin → Settings → Widget).

### Language

The widget picks its language in this order: the `locale` you pass, the language the identified person chose in their Quackback preferences, the workspace's main language when the workspace shows it to every visitor, the visitor's browser language, then the workspace's main language.

Pass `locale` only when it is each user's own language in your app, for example from their profile or your page's `lang`. Then the widget matches the app around it, and Quackback records it as an identified person's language for emails. If your app has one fixed language for everyone, leave `locale` out: a fixed value would hide each visitor's browser language and the language they chose in Quackback.

```ts
Quackback.init({ instanceUrl, locale: currentUser.locale }) // each user's own language, or leave it out
```

A language Quackback does not have falls through to the next step, so any BCP-47 tag is safe to pass.

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

### Signing out and switching users

When your user signs out, call `logout()`. It closes the panel, clears the user straight away and ends their widget session. The widget stays on the page for anonymous visitors.

```ts
Quackback.logout()
```

To switch to another user (an account switcher, a shared device), log out first, then identify the next person:

```ts
Quackback.logout()
Quackback.identify({ ssoToken: tokenForNextUser })
```

`identify` on its own also replaces the user, but it leaves an open panel showing the previous person's conversations until the new sign-in completes. Logging out first closes it. There is no need to `destroy()` and `init()` again.

If an `identify` fails (an expired or invalid token), the widget signs the previous user out rather than keep acting as them, and `getUser()` returns `null`.

With React, `useQuackbackInit` calls `identify` when `identity` changes and `logout` when it goes back to `undefined`. Call `Quackback.logout()` yourself before switching from one user to another.

### `open` deep-links

```ts
Quackback.open() // home
Quackback.open({ view: 'feedback' }) // feedback list
Quackback.open({ view: 'new-post', title: 'Bug:', body: '...', board: 'bugs' }) // pre-filled form
Quackback.open({ view: 'changelog' }) // changelog feed
Quackback.open({ view: 'help', query: 'pricing' }) // help search
Quackback.open({ view: 'messages' }) // messenger conversations
Quackback.open({ view: 'messages', conversationId: 'conversation_01h...' }) // one conversation, message box focused
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

| Event             | Payload                                                     |
| ----------------- | ----------------------------------------------------------- |
| `ready`           | `{}`                                                        |
| `open`            | `{ view?, postId?, articleId?, entryId?, conversationId? }` |
| `close`           | `{}`                                                        |
| `post:created`    | `{ id, title, board, statusId }`                            |
| `vote`            | `{ postId, voted, voteCount }`                              |
| `comment:created` | `{ postId, commentId, parentId }`                           |
| `identify`        | `{ success, user, anonymous, error? }`                      |
| `email-submitted` | `{ email }`                                                 |
| `unread`          | `{ count, messages, changelog, tickets }`                   |
| `whats-new`       | `{ count, entryId }`                                        |
| `message`         | `{ conversationId, author: { name, avatarUrl }, preview }`  |

`unread.count` is the total the launcher badge shows; `messages`, `changelog` and `tickets` are its parts. `message` fires once for each new unread reply from a teammate or the AI assistant, in any of the visitor's conversations, whichever way the workspace shows replies, including the badge only, so you can build your own indicator. The widget checks the 20 newest unread replies each time the unread count is read (about every 30 seconds, and when the visitor comes back to the page), so a burst of more than 20 replies between checks reports only the newest 20. It covers replies that arrive while the page is open, and those since the visitor's last visit on that device: the first time a visitor loads the widget on a device, replies that were already unread are recorded without firing the event. `preview` is the reply as plain text, cut to 280 characters with an ellipsis. The host page remembers which replies it reported, per instance and per visitor, so a reload does not repeat them.

The `open` payload reports the view and deep-link the host requested, not the view that is showing. When that surface is turned off, the panel opens without switching to it and the event still names the requested view.

## Docs

Full documentation: https://feedback.quackback.io/hc

## License

[MIT](LICENSE). This package and the `sdk.js` script built from it are MIT, so you can ship them in closed-source apps. The Quackback server is AGPL-3.0.
