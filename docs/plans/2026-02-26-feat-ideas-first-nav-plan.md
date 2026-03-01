# Plan: Ideas-First Navigation Restructure

**Date:** 2026-02-26
**Branch:** feat/feedback-aggregation

## Context

Posts are just another source of feedback signals - like Slack messages, Zendesk tickets, or
Intercom conversations. The admin's primary job is triaging **Ideas** (AI-clustered themes from
all signal sources), not managing a posts inbox. "Feedback" stays as "Feedback" in the nav
(it IS feedback), but Ideas becomes the primary workspace.

The Canny mental model: if posts came from an external service, nobody would build a "posts inbox"
inside their own product. They'd manage Ideas and click through to the source when needed.

### Key simplification

Since we're keeping the name "Feedback", the route `/admin/feedback` doesn't need renaming.
This eliminates the entire route-rename phase and all the mechanical find-and-replace that
would have entailed. The changes are:

1. **Sidebar order** - Ideas first, Feedback second
2. **Default landing** - `/admin/` -> `/admin/ideas` instead of `/admin/feedback`
3. **PostModal** - moves to admin layout level (so linked posts work from Ideas)
4. **Tab label** - "External" -> "Raw Items" (minor clarity)

---

## Overall Admin Shell

```
CURRENT:                                TARGET:
+----+-------------------------------+  +----+-------------------------------+
| [] | Content area (full height)    |  | [] | Content area (full height)    |
|    |                               |  |    |                               |
| FB |  (varies by route)            |  | ID |  (varies by route)            |
|    |                               |  |    |                               |
| ID |                               |  | FB |                               |
|    |                               |  |    |                               |
| CL |                               |  | CL |                               |
|    |                               |  |    |                               |
| US |                               |  | US |                               |
|    |                               |  |    |                               |
|    |                               |  |    |                               |
| -- |                               |  | -- |                               |
| ST |                               |  | ST |                               |
| NF |                               |  | NF |                               |
| GL |                               |  | GL |                               |
| AV |                               |  | AV |                               |
+----+-------------------------------+  +----+-------------------------------+

SIDEBAR KEY:                             SIDEBAR KEY:
[] = Logo -> /admin/feedback             [] = Logo -> /admin/ideas
FB = Feedback (ChatBubble) [DEFAULT]     ID = Ideas (LightBulb) [DEFAULT]
ID = Ideas (LightBulb)                   FB = Feedback (ChatBubble)
CL = Changelog (Document)               CL = Changelog (Document)
US = Users (Users)                       US = Users (Users)
-- = spacer                              -- = spacer
ST = Settings (Cog)                      ST = Settings (Cog)
NF = Notifications (Bell)               NF = Notifications (Bell)
GL = Globe (View Portal)                GL = Globe (View Portal)
AV = Avatar (User menu)                 AV = Avatar (User menu)
```

---

## CURRENT: /admin/feedback (Posts inbox) - DEFAULT LANDING

Route: `feedback.tsx` layout + `feedback.index.tsx`

```
+--------------------------------------------------------------+
|  Pipeline Stats Bar                                          |
|  [Inbox 142 Raw] [Bolt 89 Signals] [Bulb 12 Ideas]          |
|  | [23 Completed] [3 Processing] [2 Failed  Retry all]      |
|  [===========================--------====]  progress bar     |
+--------------------------------------------------------------+
|  [Posts]  [External]    <-- TabStrip                         |
+--------------------------------------------------------------+
|                                                              |
|  InboxContainer                                              |
|                                                              |
|  +----------------------------------------------------------+|
|  | Filters (collapsible)        | Posts Table                ||
|  |                              |                            ||
|  | BOARDS                       | [ ] Title  Author  Status  ||
|  |  [x] Feature Requests        | [o] Dark mode  john  Open  ||
|  |  [ ] Bug Reports             | [ ] Export    sarah Planned||
|  |                              | [ ] API docs  mike  Open   ||
|  | STATUS                       | [ ] Mobile    alex  Review ||
|  |  [x] Open                    |                            ||
|  |  [ ] Planned                 |                            ||
|  |                              |                            ||
|  | TAGS / SEGMENTS / etc.       |     Load more...           ||
|  +----------------------------------------------------------+|
|                                                              |
+--------------------------------------------------------------+
|  PostModal (URL-driven overlay, mounts here in feedback.tsx) |
|  Opens when ?post=post_xxx is in URL                         |
+--------------------------------------------------------------+
```

### PostModal overlay (when ?post=post_xxx):

```
+--------------------------------------------------------------+
|  FULL-SCREEN DIALOG                                          |
|  +----------------------------------------------------------+|
|  | [Feedback] Dark mode support    [Merge] [Lock] [Del] 3/47||
|  +----------------------------------------------------------+|
|  |                                 |                         ||
|  |  Title: Dark mode support       |  METADATA SIDEBAR       ||
|  |                                 |  Status: [Planned v]    ||
|  |  [Rich Text Editor]            |  Board: Features        ||
|  |  Please add dark mode to...    |  Tags: [UI] [Theme]     ||
|  |                                 |  Author: John Smith     ||
|  |                                 |  Votes: 47              ||
|  |                                 |  Roadmap: [v2.1]       ||
|  +----------------------------------------------------------+|
|  | [Merge Actions]                                           ||
|  +----------------------------------------------------------+|
|  | COMMENTS                                                  ||
|  | > Great idea! +1  (pinned)                                ||
|  | > We need this for accessibility                          ||
|  +----------------------------------------------------------+|
|  |  [Cancel]                       [Save Changes]            ||
|  +----------------------------------------------------------+|
+--------------------------------------------------------------+
```

---

## CURRENT: /admin/feedback/stream (External items)

Route: `feedback.tsx` layout + `feedback.stream.tsx`

```
+--------------------------------------------------------------+
|  Pipeline Stats Bar  (same as above, shared from layout)     |
+--------------------------------------------------------------+
|  [Posts]  [External]    <-- TabStrip, External active         |
+--------------------------------------------------------------+
|                                                              |
|  +----------+-----------------------------------------------+|
|  | SOURCE   | STREAM FEED                                   ||
|  | SIDEBAR  |                                               ||
|  |          | Source / Feedback / Status                     ||
|  | STATUS   | +---------+---------------------+----------+  ||
|  | [*] All  | | [Slack] | "Add dark mode"     | Complete |  ||
|  | [ ] Done | |  icon   |  Please add dark...  |          |  ||
|  | [ ] Fail | |         |  John - Slack - Feb  |          |  ||
|  | [ ] Extr | +---------+---------------------+----------+  ||
|  | [ ] Intr | | [Zendesk| "Bug: login fails"  | Failed   |  ||
|  | [ ] Ready| |  icon]  |  When I try to...   | [Retry]  |  ||
|  | [ ] Pend | |         |  Sarah - ZD - Feb 2 |          |  ||
|  |          | +---------+---------------------+----------+  ||
|  | SOURCES  | | [API]   | "Feature: webhooks" | Extractng|  ||
|  | [*] All  | |  icon   |  We need webhook...  |          |  ||
|  | [Slack]  | |         |  - API - Jan 28      |          |  ||
|  | [Zendesk]| +---------+---------------------+----------+  ||
|  | [API]    |                                               ||
|  +----------+-----------------------------------------------+|
|                                                              |
+--------------------------------------------------------------+
```

---

## CURRENT: /admin/ideas (Ideas list) + /admin/ideas/roadmap

Route: `ideas.tsx` layout + `ideas.index.tsx`

```
+--------------------------------------------------------------+
|  [Ideas]  [Roadmap]    <-- TabStrip                          |
+--------------------------------------------------------------+
|                                                              |
|  +------+-------------------+-------------------------------+|
|  |FILTER| THEME LIST        | THEME DETAIL                  ||
|  |SIDEBAR| (400-480px)      | (flex-1)                      ||
|  |(224px)|                   |                               ||
|  |      | [! 2 failed Retry]| Title: Dark mode support       ||
|  |STATUS| [~ 3 merge cands] | Summary: Users want dark...   ||
|  |[*]Rev|                   | [Under Review v] [...menu]    ||
|  |[ ]Pln| Ideas     12 of 47| [x] Update 3 linked posts     ||
|  |[ ]Prg| [Search ideas...] |                               ||
|  |[ ]Shp|                   | [42 signals] [18 authors]     ||
|  |[ ]Mrg| Source/Idea/Strngth| [8.4 strength] [Features]    ||
|  |[ ]Arc|                   |                               ||
|  |      | +---+----------+-+| Sources: [Slack 12] [QB 8]    ||
|  |SORT  | |Slk| ● Dark   |8| Sentiment: [neg 12] [neu 8]   ||
|  |[*]Str| |QB |  mode    |.| --------------------------------||
|  |[ ]New| |   |  Users...|4| LINKED POSTS (3)               ||
|  |[ ]Sig| |   |  42s 18a | | [Link] Dark mode  auto  47v [x||
|  |      | +---+----------+-+| [Link] Night theme manual 12v ||
|  |BOARD | |API| ◆ Export  |5| --------------------------------||
|  |[*]All| |   |  data    |.| SIGNALS (42)                   ||
|  |[ ]Fea| |   |  Admin...|2| +------------------------------+||
|  |[ ]Bug| |   |  12s 5a  | | | [Slack] feature_request      ||
|  |      | +---+----------+-+| | neg | high | 94% | [Move]   ||
|  |      |                   | | "Users want dark mode..."    ||
|  |      |  Load more ideas  | | Need: Reduce eye strain      ||
|  |      |                   | | > "dark mode please" - John   ||
|  +------+-------------------+-------------------------------+|
|                                                              |
+--------------------------------------------------------------+
```

### Ideas Roadmap tab (/admin/ideas/roadmap):

```
+--------------------------------------------------------------+
|  [Ideas]  [Roadmap]    <-- TabStrip, Roadmap active          |
+--------------------------------------------------------------+
|                                                              |
|  DnD Kanban (3 columns)                                      |
|                                                              |
|  PLANNED (4)         IN PROGRESS (2)      SHIPPED (6)        |
|  +----------------+  +----------------+  +----------------+  |
|  | [12v] Export   |  | [47v] Dark     |  | [8v] API v2   |  |
|  |  data export   |  |  mode support  |  |  New REST API |  |
|  |  8s 3a 1p      |  |  42s 18a 3p    |  |  22s 10a 2p   |  |
|  |  [Features]    |  |  [Features]    |  |  [Dev]        |  |
|  +----------------+  +----------------+  +----------------+  |
|  | [5v] Webhooks  |  | [23v] Mobile   |  | [31v] SSO     |  |
|  |  webhook mgmt  |  |  responsive    |  |  Single sign  |  |
|  |  12s 5a 0p     |  |  15s 8a 1p     |  |  18s 9a 1p    |  |
|  |  [Dev]         |  |  [Features]    |  |  [Security]   |  |
|  +----------------+  +----------------+  +----------------+  |
|  | [3v] CSV imp.  |                     | ...              |  |
|  +----------------+                     +----------------+  |
|                                                              |
|  Card: [votes] title / summary / Ns Na Np / [board]          |
|  Drag between columns to change status                       |
+--------------------------------------------------------------+
```

---

## TARGET: New Navigation Layout

### /admin/ redirect

```
CURRENT:  /admin/ --> redirect --> /admin/feedback
TARGET:   /admin/ --> redirect --> /admin/ideas
```

### /admin/ideas (Ideas list) - NEW DEFAULT LANDING

No changes to the Ideas page itself. It already works correctly as the primary workspace.
The only change is that it's now the default landing page after login, and linked posts
in theme-detail become clickable (opening PostModal).

```
+--------------------------------------------------------------+
|  [Ideas]  [Roadmap]    <-- TabStrip (unchanged)              |
+--------------------------------------------------------------+
|                                                              |
|  +------+-------------------+-------------------------------+|
|  |FILTER| THEME LIST        | THEME DETAIL                  ||
|  |      |                   |                               ||
|  |      |  (same as current | Title: Dark mode support       ||
|  |      |   -- no changes)  | [Under Review v] [...menu]    ||
|  |      |                   |                               ||
|  |      |                   | LINKED POSTS (3)               ||
|  |      |                   | [Link] Dark mode  auto  47v   ||
|  |      |                   |    ^                           ||
|  |      |                   |    |                           ||
|  |      |                   |    +-- NOW CLICKABLE!          ||
|  |      |                   |        Opens PostModal overlay ||
|  |      |                   |        via ?post=post_xxx      ||
|  |      |                   |                               ||
|  |      |                   | SIGNALS (42)                   ||
|  |      |                   |  (same as current)             ||
|  +------+-------------------+-------------------------------+|
|                                                              |
+--------------------------------------------------------------+
|  PostModal (NOW MOUNTED IN admin.tsx layout, not here)       |
|  Opens when ?post=post_xxx is in URL, from ANY admin page    |
+--------------------------------------------------------------+
```

### /admin/ideas/roadmap (Ideas Roadmap)

**No changes.** Same DnD kanban as current.

---

### /admin/feedback (Posts + Raw Items) - UNCHANGED ROUTE

Route stays as `feedback.tsx` layout + `feedback.index.tsx` + `feedback.stream.tsx`.
Only change: tab label "External" -> "Raw Items", and PostModal removed from here
(now lives at admin.tsx level).

```
+--------------------------------------------------------------+
|  Pipeline Stats Bar                                          |
|  [Inbox 142 Raw] [Bolt 89 Signals] [Bulb 12 Ideas]          |
|  [23 Completed] [3 Processing] [2 Failed  Retry all]        |
|  [===========================--------====]  progress bar     |
+--------------------------------------------------------------+
|  [Posts]  [Raw Items]    <-- TabStrip ("External" renamed)   |
+--------------------------------------------------------------+
|                                                              |
|  (Posts tab = same InboxContainer as before)                 |
|  (Raw Items tab = same StreamLayout as before)               |
|                                                              |
+--------------------------------------------------------------+
|  PostModal REMOVED from here (now in admin.tsx)              |
+--------------------------------------------------------------+
```

### /admin/feedback/ (Posts tab - default)

Unchanged from current.

```
+--------------------------------------------------------------+
|  Pipeline Stats Bar (from feedback.tsx layout)               |
+--------------------------------------------------------------+
|  [Posts]  [Raw Items]                                        |
+--------------------------------------------------------------+
|                                                              |
|  InboxContainer (unchanged)                                  |
|                                                              |
|  +----------------------------------------------------------+|
|  | Filters (collapsible)        | Posts Table                ||
|  |                              |                            ||
|  | BOARDS                       | [ ] Title  Author  Status  ||
|  |  [x] Feature Requests        | [o] Dark mode  john  Open  ||
|  |  [ ] Bug Reports             | [ ] Export    sarah Planned||
|  |                              |                            ||
|  | STATUS                       |                            ||
|  |  [x] Open                    |                            ||
|  |                              |                            ||
|  | TAGS / SEGMENTS / etc.       |     Load more...           ||
|  +----------------------------------------------------------+|
|                                                              |
+--------------------------------------------------------------+
```

### /admin/feedback/stream (Raw Items tab)

Unchanged from current.

```
+--------------------------------------------------------------+
|  Pipeline Stats Bar (from feedback.tsx layout)               |
+--------------------------------------------------------------+
|  [Posts]  [Raw Items]                                        |
+--------------------------------------------------------------+
|                                                              |
|  +----------+-----------------------------------------------+|
|  | SOURCE   | STREAM FEED (unchanged)                       ||
|  | SIDEBAR  |                                               ||
|  |          | Source / Feedback / Status                     ||
|  | STATUS   | +--------+----------------------+---------+   ||
|  | [*] All  | | [Slack]| "Add dark mode"      | Complete|   ||
|  | [ ] Done | | [ZD]   | "Bug: login fails"   | Failed  |   ||
|  | [ ] Fail | | [API]  | "Feature: webhooks"  | Extract |   ||
|  |          | +--------+----------------------+---------+   ||
|  | SOURCES  |                                               ||
|  | [*] All  |                                               ||
|  | [Slack]  |                                               ||
|  | [Zendesk]|                                               ||
|  +----------+-----------------------------------------------+|
|                                                              |
+--------------------------------------------------------------+
```

---

## PostModal Architecture Change

### Current: PostModal tied to feedback route

```
admin.tsx
  +-- feedback.tsx  <-- PostModal mounted HERE, reads Route.useSearch().post
  |     +-- feedback.index.tsx (posts)
  |     +-- feedback.stream.tsx
  +-- ideas.tsx
  |     +-- ideas.index.tsx   <-- linked posts are dead <a href="/admin/posts/..."> tags
  |     +-- ideas.roadmap.tsx
```

### Target: PostModal at admin layout level

```
admin.tsx  <-- PostModal mounted HERE (global), reads ?post from raw URL
  +-- feedback.tsx  <-- PostModal REMOVED from here
  |     +-- feedback.index.tsx (posts)
  |     +-- feedback.stream.tsx
  +-- ideas.tsx
  |     +-- ideas.index.tsx   <-- linked posts open ?post=xxx -> triggers global modal
  |     +-- ideas.roadmap.tsx
```

### How it works:

```
1. admin.tsx reads ?post= from raw URL via useRouterState
2. Passes postId to <PostModal> mounted at admin level
3. PostModal uses useUrlModal with route=location.pathname (current page)
4. close() navigates to current page with ?post removed
5. navigateTo() navigates to current page with ?post=newId

Any child page opens a post by:
  navigate({ search: (prev) => ({ ...prev, post: 'post_xxx' }) })

This works from Ideas, Feedback, or any other admin page.
```

### How linked posts become clickable in theme-detail:

```
CURRENT (dead link):
  <a href={`/admin/posts/${link.post?.id}`}>    <-- no such route exists!
    {link.post?.title ?? 'Untitled post'}
  </a>

TARGET (opens modal overlay):
  <button onClick={() => navigate({
    search: (prev) => ({ ...prev, post: link.post?.id })
  })}>
    {link.post?.title ?? 'Untitled post'}
  </button>
```

---

## Settings Navigation (No Changes)

```
Settings sidebar:            (unchanged)
+------------------------+
| WORKSPACE              |
|   Team Members         |
|   Integrations         |
|                        |
| FEEDBACK               |
|   Boards               |
|   Statuses             |
|   Sources              |   -> /admin/settings/feedback-sources
|                        |
| APPEARANCE             |
|   Branding             |
|   Widget               |
|                        |
| USERS                  |
|   Authentication       |
|   User Attributes      |
|                        |
| DEVELOPERS             |
|   API Keys             |
|   Webhooks             |
|   MCP Server           |
+------------------------+
```

---

## Mobile Navigation

### Current:

```
+--[HAMBURGER]----[LOGO]-------[BELL][AVATAR]--+
|                                               |
| Sheet (from left):                            |
| +--------------------+                        |
| | [LOGO] Quackback   |  -> /admin/feedback    |
| |                    |                        |
| | [FB] Feedback      |  <- DEFAULT            |
| | [ID] Ideas         |                        |
| | [CL] Changelog     |                        |
| | [US] Users         |                        |
| | ---------          |                        |
| | [ST] Settings      |                        |
| | [GL] View Portal   |                        |
| +--------------------+                        |
```

### Target:

```
+--[HAMBURGER]----[LOGO]-------[BELL][AVATAR]--+
|                                               |
| Sheet (from left):                            |
| +--------------------+                        |
| | [LOGO] Quackback   |  -> /admin/ideas       |
| |                    |                        |
| | [ID] Ideas         |  <- DEFAULT            |
| | [FB] Feedback      |                        |
| | [CL] Changelog     |                        |
| | [US] Users         |                        |
| | ---------          |                        |
| | [ST] Settings      |                        |
| | [GL] View Portal   |                        |
| +--------------------+                        |
```

---

## Implementation Phases

### Phase 1: Sidebar Reorder + Default Landing

**Goal:** Make Ideas the primary admin workspace.

#### FILE: `apps/web/src/components/admin/admin-sidebar.tsx`

**What it does:** Renders the 64px icon sidebar (desktop) and hamburger sheet (mobile).
Contains `navItems` array (line 37-42) and 3 hardcoded logo links.

**Changes:**

1. **Lines 37-42: Reorder navItems (Ideas first)**

   ```
   CURRENT:
     { label: 'Feedback',  href: '/admin/feedback',  icon: ChatBubbleLeftIcon },
     { label: 'Ideas',     href: '/admin/ideas',     icon: LightBulbIcon },

   TARGET:
     { label: 'Ideas',     href: '/admin/ideas',     icon: LightBulbIcon },
     { label: 'Feedback',  href: '/admin/feedback',  icon: ChatBubbleLeftIcon },
   ```

   Changelog and Users stay in the same position.

2. **Line 108: Desktop logo link**

   ```
   CURRENT: to="/admin/feedback"
   TARGET:  to="/admin/ideas"
   ```

3. **Line 209: Mobile sheet logo link**

   ```
   CURRENT: <Link to="/admin/feedback" onClick={() => setMobileMenuOpen(false)}>
   TARGET:  <Link to="/admin/ideas" onClick={() => setMobileMenuOpen(false)}>
   ```

4. **Line 261: Mobile header center logo link**
   ```
   CURRENT: <Link to="/admin/feedback" className="absolute left-1/2 -translate-x-1/2">
   TARGET:  <Link to="/admin/ideas" className="absolute left-1/2 -translate-x-1/2">
   ```

#### FILE: `apps/web/src/routes/admin/index.tsx`

**What it does:** Redirects `/admin/` to the default landing page (line 5).

**Changes:**

1. **Line 5: Change redirect target**
   ```
   CURRENT: throw redirect({ to: '/admin/feedback' })
   TARGET:  throw redirect({ to: '/admin/ideas' })
   ```

---

### Phase 2: PostModal at Admin Level

**Goal:** Move PostModal from `feedback.tsx` to `admin.tsx` so it can be opened from
any admin page (especially Ideas -> linked posts).

#### FILE: `apps/web/src/routes/admin.tsx`

**What it does:** Root admin layout. Handles auth (beforeLoad), fetches user avatar
(loader), renders `AdminSidebar` + `<Outlet />`. Currently has NO PostModal.

**Changes:**

1. **Add `usePostIdFromUrl` helper and mount PostModal in AdminLayout**

   ```
   CURRENT AdminLayout() (lines 55-74):
     function AdminLayout() {
       const { initialUserData } = Route.useLoaderData()
       if (!initialUserData) return <Outlet />

       return (
         <div className="flex h-screen bg-background">
           <AdminSidebar initialUserData={initialUserData} />
           <main className="flex-1 min-w-0 overflow-hidden sm:h-screen sm:p-2 p-0">
             <div className="h-full sm:pt-0 pt-14 sm:rounded-lg sm:border sm:border-border overflow-hidden">
               <Outlet />
             </div>
           </main>
         </div>
       )
     }

   TARGET AdminLayout():
     function usePostIdFromUrl(): string | undefined {
       return useRouterState({
         select: (s) => {
           const params = new URLSearchParams(s.location.searchStr)
           return params.get('post') ?? undefined
         },
       })
     }

     function AdminLayout() {
       const { initialUserData, currentUser } = Route.useLoaderData()
       const postId = usePostIdFromUrl()
       if (!initialUserData) return <Outlet />

       return (
         <div className="flex h-screen bg-background">
           <AdminSidebar initialUserData={initialUserData} />
           <main className="flex-1 min-w-0 overflow-hidden sm:h-screen sm:p-2 p-0">
             <div className="h-full sm:pt-0 pt-14 sm:rounded-lg sm:border sm:border-border overflow-hidden">
               <Outlet />
             </div>
           </main>
           {currentUser && <PostModal postId={postId} currentUser={currentUser} />}
         </div>
       )
     }
   ```

2. **Update loader to return `currentUser` (lines 26-51)**
   The loader already has `user` from auth context. We need `principal.id` too:

   ```
   CURRENT loader return (line 47-50):
     return { user, initialUserData }

   TARGET loader return:
     return {
       user,
       initialUserData,
       currentUser: {
         name: user.name,
         email: user.email,
         principalId: principal.id,
       },
     }
   ```

   `principal` is already available from `beforeLoad` context (line 18).

3. **Add imports**
   ```
   + import { useRouterState } from '@tanstack/react-router'
   + import { PostModal } from '@/components/admin/feedback/post-modal'
   ```

#### FILE: `apps/web/src/components/admin/feedback/post-modal.tsx`

**What it does:** Full-screen post editor modal. Currently tightly coupled to the
`/admin/feedback` route:

- Line 48: `import { Route } from '@/routes/admin/feedback'`
- Line 495: `const search = Route.useSearch()`
- Line 500: `route: '/admin/feedback'` passed to `useUrlModal`

**Changes to make it route-agnostic:**

1. **Line 48: Remove Route import**

   ```
   CURRENT: import { Route } from '@/routes/admin/feedback'
   TARGET:  (remove entirely)
   ```

2. **Lines 494-501: Rewrite PostModal to use raw URL**

   ```
   CURRENT:
     export function PostModal({ postId: urlPostId, currentUser }: PostModalProps) {
       const search = Route.useSearch()
       const { open, validatedId, close, navigateTo } = useUrlModal<PostId>({
         urlId: urlPostId,
         idPrefix: 'post',
         searchParam: 'post',
         route: '/admin/feedback',
         search,
       })

   TARGET:
     export function PostModal({ postId: urlPostId, currentUser }: PostModalProps) {
       const location = useRouterState({ select: (s) => s.location })
       const search = Object.fromEntries(new URLSearchParams(location.searchStr))
       const { open, validatedId, close, navigateTo } = useUrlModal<PostId>({
         urlId: urlPostId,
         idPrefix: 'post',
         searchParam: 'post',
         route: location.pathname,   // stay on current page when closing
         search,
       })
   ```

   The key change: `route` is now `location.pathname` instead of hardcoded
   `/admin/feedback`. Closing the modal returns to wherever you were.

3. **Add import**
   ```
   + import { useRouterState } from '@tanstack/react-router'
   ```

#### FILE: `apps/web/src/routes/admin/feedback.tsx`

**What it does:** Feedback layout. Renders PipelineStatsBar + TabStrip + Outlet + PostModal.

**Changes (remove PostModal, rename tab):**

1. **Line 6: Remove PostModal import**

   ```
   CURRENT: import { PostModal } from '@/components/admin/feedback/post-modal'
   TARGET:  (remove)
   ```

2. **Line 34: Rename "External" tab label**

   ```
   CURRENT: { label: 'External', to: '/admin/feedback/stream', icon: SignalIcon, ... },
   TARGET:  { label: 'Raw Items', to: '/admin/feedback/stream', icon: SignalIcon, ... },
   ```

3. **Line 82: Remove PostModal mount**

   ```
   CURRENT: <PostModal postId={search.post} currentUser={currentUser} />
   TARGET:  (remove this line)
   ```

4. **Lines 55-61: currentUser in loader return**
   `currentUser` was only needed for PostModal here. But check: `feedback.index.tsx`
   accesses `Route.useLoaderData()` to get `currentUser` (line 99) for `InboxContainer`.
   However, looking at `InboxContainer` props (line 26-32), `currentUser` is destructured
   but never used inside the component body (the table view doesn't reference it).

   Actually wait - `InboxContainer` passes `currentUser` nowhere. Let me re-check...
   Looking at `inbox-container.tsx` line 26: it destructures `currentUser` but the
   only place it was used was for PostModal (which was in the parent layout). So
   `currentUser` in the feedback layout loader is now unused.

   **Action: Remove `currentUser` from feedback layout loader return.** Clean up
   `feedback.index.tsx` if it references `currentUser` from parent loader data.

#### FILE: `apps/web/src/routes/admin/feedback.index.tsx`

**What it does:** Posts inbox page. Gets `currentUser` from parent's loader (line 99).

**Changes (if currentUser removed from parent):**

1. **Line 99: Check usage**

   ```
   CURRENT: const { currentUser } = Route.useLoaderData()
   ```

   If `currentUser` is only passed to `InboxContainer` and `InboxContainer` doesn't
   actually use it, we can remove it from both places. But `InboxContainer` receives
   it as a prop (line 132) -- need to trace if it's actually used.

   Looking at the component: `InboxContainer` destructures `currentUser` from props
   but never references it in JSX or handlers. It WAS used when PostModal was inline.
   Since PostModal is now at admin level, `currentUser` is dead code here.

   **Action: Remove `currentUser` from `InboxContainer` props and from
   `feedback.index.tsx` loader data destructure.**

   BUT: This is a cleanup item, not critical. The code works fine with the unused
   prop. Defer this to Phase 3 (cleanup) to keep Phase 2 focused.

---

### Phase 3: Clickable Linked Posts + Cleanup

**Goal:** Make linked posts in theme-detail actually open PostModal. Clean up dead code.

#### FILE: `apps/web/src/components/admin/feedback/insights/theme-detail.tsx`

**What it does:** Renders the detail panel for a selected idea. Linked posts section
(lines 255-302) shows posts as `<a>` tags with `href="/admin/posts/${link.post?.id}"`
(line 272). This is a **dead URL** -- there is no `/admin/posts/:id` route.

**Changes:**

1. **Add `useNavigate` import and call**
   ThemeDetail does not currently import or use `useNavigate`.

   ```
   + import { useNavigate } from '@tanstack/react-router'
   ```

   Add at top of component body:

   ```
   + const navigate = useNavigate()
   ```

2. **Lines 271-276: Replace dead `<a>` with clickable button**

   ```
   CURRENT:
     <a
       href={`/admin/posts/${link.post?.id}`}
       className="text-sm text-foreground hover:underline truncate"
     >
       {link.post?.title ?? 'Untitled post'}
     </a>

   TARGET:
     <button
       type="button"
       onClick={() => {
         void navigate({
           search: (prev: Record<string, unknown>) => ({
             ...prev,
             post: link.post?.id,
           }),
         })
       }}
       className="text-sm text-foreground hover:underline truncate text-left"
     >
       {link.post?.title ?? 'Untitled post'}
     </button>
   ```

#### FILE: `apps/web/src/components/public/post-card.tsx`

**What it does:** Public post card with a "Copy link" admin action. The copied URL
(line 137) points to `/admin/feedback/posts/${id}` which is a dead URL.

**Changes:**

1. **Line 137: Fix copy link URL to use PostModal param**
   ```
   CURRENT: const url = `${window.location.origin}/admin/feedback/posts/${id}`
   TARGET:  const url = `${window.location.origin}/admin/feedback?post=${id}`
   ```

#### FILE: `apps/web/src/components/admin/feedback/inbox-container.tsx`

**What it does:** `handleNavigateToPost` (line 83-101) navigates to `/admin/feedback`
with `?post=postId`. With PostModal now at admin level, we can use a relative
navigate (just update search params, stay on current page).

**Changes:**

1. **Lines 92-99: Use relative navigate (no `to:` needed)**

   ```
   CURRENT:
     navigate({
       to: '/admin/feedback',
       search: {
         ...search,
         post: postId,
       },
     })

   TARGET:
     navigate({
       search: {
         ...search,
         post: postId,
       },
     })
   ```

   By omitting `to:`, TanStack Router stays on the current page and just updates
   search params. This is more robust and works regardless of the route.

   Actually, this may not work without `to:` in TanStack Router. If not, keep
   `to: '/admin/feedback'` which is fine since this component only runs under
   the feedback route anyway.

#### Typecheck & lint

```bash
bun run typecheck
bun run lint
```

---

## Complete File List

### Files RENAMED: None

No route renames needed since we're keeping "Feedback" as the name.

### Files CREATED: None

### Files MODIFIED (6):

| File                                                  | Phase | What Changes                                                              |
| ----------------------------------------------------- | ----- | ------------------------------------------------------------------------- |
| `components/admin/admin-sidebar.tsx`                  | 1     | Reorder navItems (Ideas first), update 3 logo links to `/admin/ideas`     |
| `routes/admin/index.tsx`                              | 1     | Redirect: `/admin/feedback` -> `/admin/ideas`                             |
| `routes/admin.tsx`                                    | 2     | Mount PostModal, add `usePostIdFromUrl`, return `currentUser` from loader |
| `routes/admin/feedback.tsx`                           | 2     | Remove PostModal mount + import, rename "External" tab to "Raw Items"     |
| `components/admin/feedback/post-modal.tsx`            | 2     | Make route-agnostic: remove `Route` import, use `location.pathname`       |
| `components/admin/feedback/insights/theme-detail.tsx` | 3     | Linked posts: dead `<a>` -> clickable `<button>` with navigate            |

### Optional cleanup files (3):

| File                                            | What Changes                                 |
| ----------------------------------------------- | -------------------------------------------- |
| `components/public/post-card.tsx`               | Fix dead copy-link URL                       |
| `components/admin/feedback/inbox-container.tsx` | Use relative navigate for post modal         |
| `routes/admin/feedback.index.tsx`               | Remove unused `currentUser` from loader data |

### Files NOT CHANGED:

Everything else stays exactly as-is. No route renames, no URL find-and-replace needed.
The entire `components/admin/feedback/` directory, all its internal imports, all navigate
URLs to `/admin/feedback` and `/admin/feedback/stream` -- all unchanged.

The following files have `/admin/feedback` references that do NOT need updating:

- `inbox-container.tsx` line 94 - navigates to `/admin/feedback` (correct, it IS feedback)
- `use-inbox-filters.ts` lines 35, 61 - navigates to `/admin/feedback` (correct)
- `pipeline-stats-bar.tsx` line 42 - navigates to `/admin/feedback/stream` (correct)
- `stream-source-sidebar.tsx` lines 44, 71, 97 - navigates to `/admin/feedback/stream` (correct)
- `use-navigation-context.ts` line 4 - `DEFAULT_BACK_URL = '/admin/feedback'` (correct)

---

## Decision Log

| Decision                 | Choice                          | Rationale                                                        |
| ------------------------ | ------------------------------- | ---------------------------------------------------------------- |
| Keep "Feedback" name     | Yes                             | It IS feedback. Naming it "Sources" is naming it after plumbing. |
| Route rename             | None needed                     | Keeping the name means zero mechanical find-and-replace          |
| PostModal mounting       | Admin layout level              | Allows opening posts from any admin page                         |
| PostModal route reading  | `useRouterState` raw URL        | Route-agnostic, no coupling to specific route schema             |
| PostModal close behavior | Navigate to `location.pathname` | Stays on current page (Ideas, Feedback, etc)                     |
| Tab label "External"     | Rename to "Raw Items"           | More descriptive                                                 |
| Ideas page changes       | Linked posts only               | Already correct as primary workspace                             |

## Risk Assessment

- **Low risk:** Sidebar reorder, default landing change - purely cosmetic, 2 files
- **Medium risk:** PostModal extraction to admin level - the `useUrlModal` hook's `close()`
  navigates to `route` with params removed. Using `location.pathname` means it stays on the
  current page. Need to verify TanStack Router handles this correctly and that keyboard
  navigation (prev/next) still works.
- **Low risk:** Linked posts clickable - small onClick handler change in theme-detail
