---
title: 'feat: Widget Input-First UX Redesign'
type: feat
date: 2026-02-09
---

# Widget Input-First UX Redesign

## Overview

Redesign the embeddable widget UX around an **input-first** philosophy. The current widget opens to a feed view with a tab bar — the same pattern as a standalone portal. But the widget isn't a standalone portal. It's embedded inside someone else's SaaS product. The user is in the middle of doing real work. Every second spent navigating the widget is a second away from their actual task.

The redesigned widget opens with a single auto-focused input: **"What's on your mind?"** As the user types, existing matching posts appear inline as live search results. The user can either:

- **Vote on a match** (3-second path) — one tap, done
- **Submit as new idea** (10-second path) — title pre-filled from input, add optional details, submit

This eliminates the tab bar, removes the browse-first paradigm, and turns the widget into a **capture tool** rather than a mini-portal.

## Problem Statement / Motivation

The current widget UX has three problems:

1. **Wrong default view**: Opening to a feed makes the user browse instead of act. Most widget interactions should be "I have feedback → capture it quickly → get back to work."

2. **Tab bar creates friction**: "Feed" and "New Post" are separate modes. Users must decide which they want before they even start. The input-first design merges these — typing is simultaneously searching AND starting a new post.

3. **Auth gate too early**: The current widget shows "Sign in to your app to vote & post" at the bottom of the feed, making anonymous users feel unwelcome. The redesign gates at the _action_ (vote/submit), not the _door_ (opening the widget). Anyone can search and browse.

## Proposed Solution

Replace the tab-based feed/new-post split with a **unified input-first interface**:

```
┌──────────────────────────────────────────┐
│  [logo] Acme Feedback              [✕]  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ 🔍 What's on your mind?           │  │  ← auto-focused on open
│  └────────────────────────────────────┘  │
│  in [Feature Requests ▾]                 │  ← board selector (compact pill)
│                                          │
│  ┌─ Popular ideas ────────────────────┐  │  ← default: top voted posts
│  │ ▲ 42 │ Dark mode support           │  │
│  │ ▲ 31 │ CSV export                  │  │
│  │ ▲ 28 │ Mobile app                  │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ─── Powered by Quackback ───            │
└──────────────────────────────────────────┘

Board selector detail:
  ┌──────────────────────────────────────┐
  │ 🔍 What's on your mind?             │
  └──────────────────────────────────────┘
  in [Feature Requests ▾]                    12px text, pill style
       ↓ opens dropdown                     only shown if >1 board
  ┌──────────────────────┐
  │  All boards          │
  │  Feature Requests  ✓ │
  │  Bug Reports         │
  │  Integrations        │
  └──────────────────────┘

  Single board: no selector shown, posts scoped to that board
  defaultBoard param: pre-selects matching board
  "All boards": searches/shows posts across all public boards
```

When the user types, the view transitions to live search results:

```
┌──────────────────────────────────────────┐
│  [logo] Acme Feedback              [✕]  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ dark mo|                           │  │
│  └────────────────────────────────────┘  │
│  in [Feature Requests ▾]                 │
│                                          │
│  ┌─ Matching ideas ──────────────────┐  │
│  │ ▲ 42 │ Dark mode support     [+1] │  │  ← quick-vote button
│  │ ▲ 12 │ Dark theme for emails [+1] │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ Don't see your idea?              │  │
│  │ [Submit "dark mo" as new idea →]  │  │  ← CTA to create
│  └────────────────────────────────────┘  │
│                                          │
│  ─── Powered by Quackback ───            │
└──────────────────────────────────────────┘
```

If no matches, the CTA is more prominent:

```
│  ┌────────────────────────────────────┐  │
│  │ No matching ideas found            │  │
│  │ [Submit "dark mo" as new idea →]  │  │
│  └────────────────────────────────────┘  │
```

Clicking "Submit as new idea" expands to a minimal form. The board carries over from the home view selection:

```
┌──────────────────────────────────────────┐
│  [← Back]  New idea                [✕]  │
│                                          │
│  Board                                   │
│  ┌────────────────────────────────────┐  │
│  │ Feature Requests               ▾  │  │  ← carried from home selector
│  └────────────────────────────────────┘  │
│                                          │
│  Title                                   │
│  ┌────────────────────────────────────┐  │
│  │ dark mo                            │  │  ← pre-filled from search
│  └────────────────────────────────────┘  │
│                                          │
│  Details (optional)                      │
│  ┌────────────────────────────────────┐  │
│  │                                    │  │
│  │                                    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ Posting as jane@acme.com           │  │
│  │                    [Submit idea]   │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

After submission, show brief confirmation then auto-close:

```
┌──────────────────────────────────────────┐
│                                          │
│            ✓ Idea submitted!             │
│        Thank you for your feedback       │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ ▲ 1 │ dark mo           ● New     │  │  ← their new post
│  │      │ Feature Requests            │  │
│  └────────────────────────────────────┘  │
│                                          │
│  Auto-closing in 3s...                   │
│  [Keep open]  [Close now]                │
└──────────────────────────────────────────┘
```

---

## Technical Approach

### Architecture Changes

The redesign touches 4 existing widget components and adds 1 new widget API endpoint. No database changes, no schema changes, no new dependencies.

```
Current structure:              New structure:
widget-shell.tsx               widget-shell.tsx (simplified — no tab bar)
  ├─ widget-feed.tsx             ├─ widget-home.tsx (input + search + post list)
  └─ widget-new-post-form.tsx    └─ widget-new-post-form.tsx (minimal, receives pre-filled title)
widget-auth-provider.tsx       widget-auth-provider.tsx (remove activeTab state)
sdk-template.ts                sdk-template.ts (unchanged)
```

### View States

The widget has 3 view states, managed by a single `view` state variable:

| State      | Trigger                    | Shows                                                 |
| ---------- | -------------------------- | ----------------------------------------------------- |
| `home`     | Default / back             | Input + popular posts (or search results when typing) |
| `new-post` | Click "Submit as new idea" | Pre-filled form with title from search input          |
| `success`  | Post submitted             | Confirmation + auto-close countdown                   |

### Search Implementation

**Existing infrastructure** — no new backend needed for basic search:

- `post.public.ts:132-134`: Full-text search via `websearch_to_tsquery('english', ...)` on `posts.searchVector`
- `portal.ts:74-77`: `fetchPortalData` already accepts `search` param
- `portalQueries.portalData()` passes `search` through to the server function

**New widget search endpoint** — needed for fast, lightweight client-side search in the widget:

The existing `portalQueries.portalData()` fetches boards, statuses, tags, and subscription info alongside posts — too heavy for search-as-you-type. A dedicated lightweight endpoint returns only matched posts.

- File: `apps/web/src/routes/api/widget/search.ts`
- `GET /api/widget/search?q=dark+mode&board=feature-requests&limit=5`
- `board` param filters by board slug (matches the home view board selector); omit for all boards
- Returns: `{ data: { posts: [{ id, title, voteCount, statusId, commentCount, board }] } }`
- No auth required (public posts only)
- Uses `listPublicPosts()` with `search` and `boardSlug` params
- Lightweight: no votes, no avatars, no tags — just enough for search results

**Client-side search debounce**: 250ms debounce on input. Show "Searching..." indicator during fetch. Cache results by query string to avoid re-fetching when backspacing.

### Vote From Search Results

Search result cards show a `[+1]` quick-vote button. Tapping it:

1. If identified: optimistic vote + API call (reuse existing `widgetFetch('/api/widget/vote', ...)` pattern from `widget-feed.tsx:86-89`)
2. If not identified: show inline prompt "Sign in to your app to vote"
3. After voting: brief visual confirmation (checkmark flash), card stays in place

### Auth Gating Strategy

| Action          | Requires auth? | Behavior when not identified                   |
| --------------- | -------------- | ---------------------------------------------- |
| Open widget     | No             | Opens normally                                 |
| Search          | No             | Works fully                                    |
| Browse posts    | No             | Works fully                                    |
| Vote            | Yes            | Inline prompt: "Sign in to your app to vote"   |
| Submit new idea | Yes            | Inline prompt: "Sign in to your app to submit" |

This is a shift from the current approach where the tab bar hides "New Post" and the auth bar sits at the bottom permanently.

---

## Implementation Phases

### Phase 1: Widget Home View (replaces feed + tab bar)

**1. Simplify widget-auth-provider.tsx**

- Remove `activeTab` and `setActiveTab` from context
- Remove `WidgetTab` type
- The view state moves to the parent component (widget page)

**2. Rewrite widget-shell.tsx**

- Remove tab bar entirely
- Keep: header (logo + org name + avatar + close button)
- Keep: "Powered by Quackback" footer
- Add: back button in header when not on home view (replaces close button position)
- The shell becomes a thin frame around whatever view is active

**3. Create widget-home.tsx** (new file)

- Auto-focused search input with placeholder "What's on your mind?"
- Board selector pill below the input: `in [Feature Requests ▾]`
  - Only shown when workspace has more than 1 public board
  - Compact pill style (12px text, subtle border, dropdown on click)
  - Options: "All boards" + each public board
  - Default: `defaultBoard` from URL param, or "All boards" if not specified
  - Changing board re-fetches popular posts and re-runs active search
  - Single board: no selector shown, all queries scoped to that board
- Below input + board: section showing either "Popular ideas" (default) or "Matching ideas" (when searching)
- Post cards are compact: `[▲ count] title [+1 vote btn]` — no author, no date, no comments (less noise)
- When search query is non-empty and has results: show matches + "Don't see your idea? Submit as new" CTA
- When search query is non-empty and no results: show "No matching ideas. Submit as new idea" CTA
- CTA text dynamically includes the truncated search query: `Submit "dark mo..." as new idea`
- Clicking CTA transitions to `new-post` view with title pre-filled AND selected board carried over
- Search uses 250ms debounce, fetches from `GET /api/widget/search?q=...&board=...`
- Default state (no search): show top 10 voted posts via data already loaded in route loader

**4. Add widget search API endpoint**

- File: `apps/web/src/routes/api/widget/search.ts`
- `GET /api/widget/search?q=...&board=...&limit=5`
- CORS headers (same as other widget API routes)
- Uses `listPublicPosts({ search: q, boardSlug, sort: 'top', limit })` from `post.public.ts`
- Returns minimal post data for search display

**5. Update widget/index.tsx (route)**

- Remove `activeTab` check that switches between `WidgetFeed` and `WidgetNewPostForm`
- Add `view` state: `'home' | 'new-post' | 'success'`
- Add `searchQuery` state (lifted from widget-home so it persists across view transitions)
- Add `selectedBoardSlug` state (lifted so it carries from home → new post form)
- Render `WidgetHome` or `WidgetNewPostForm` based on `view`
- Pass `onSubmitNew={(title) => { setPrefilledTitle(title); setView('new-post') }}` to WidgetHome
- Pass `prefilledTitle`, `selectedBoardSlug`, `onBack` and `onSuccess` to WidgetNewPostForm

### Phase 2: Streamlined New Post Form

**6. Update widget-new-post-form.tsx**

- Accept `prefilledTitle?: string` prop — pre-populate title input
- Accept `selectedBoardSlug?: string` prop — pre-select board from home view's board selector
- Accept `onBack: () => void` prop — navigate back to home view
- Accept `onSuccess: (post) => void` prop — notify parent of successful submission
- Remove internal success state (parent handles it)
- Remove the "Sign in to submit" empty state (parent gates this)
- Board selector: full-width dropdown at top of form (same as current), pre-selected from `selectedBoardSlug`
- If only 1 board: no selector shown (same as current behavior)
- Auto-focus on description field if title is pre-filled (title came from search)

### Phase 3: Success State + Auto-Close

**7. Add success view in widget/index.tsx**

- After successful post creation, switch to `view: 'success'`
- Show: checkmark icon, "Idea submitted!" heading, the new post card
- Start 3-second countdown, then send `quackback:close` postMessage
- "Keep open" button cancels countdown and switches to home view
- "Close now" sends immediate close

### Phase 4: Quick-Vote in Search Results

**8. Add voting to widget-home.tsx search results**

- Each search result card has a `[+1]` / `[▲ voted]` button on the right
- Reuse the optimistic vote pattern from current `widget-feed.tsx`
- Fetch voted post IDs on mount (reuse existing `/api/widget/voted-posts` call)
- After voting: brief green checkmark flash on the button (200ms)
- If not identified: clicking vote shows subtle inline text "Sign in to your app to vote" below the post

### Phase 5: Polish

**9. Hide TanStack Router devtools in widget**

- The `<TanStackRouterDevtools>` badge is visible in the widget iframe during development
- Conditionally hide it on widget routes (check `location.pathname.startsWith('/widget')`)
- File: `apps/web/src/routes/__root.tsx`

**10. Animations and transitions**

- Home → new-post: slide left (200ms ease-out)
- New-post → home (back): slide right (200ms ease-out)
- Search results: fade in (150ms)
- Vote confirmation: scale bounce on count (200ms)
- Success → auto-close: panel close animation from SDK

**11. Keyboard shortcuts**

- `Escape` in input: clear search (if has text), close widget (if empty)
- `Enter` in input with no results: go to new post form
- `Enter` in input with results: no-op (user should click a result or the CTA)

---

## Acceptance Criteria

### Functional

- [ ] Widget opens with auto-focused "What's on your mind?" input
- [ ] Board selector pill shown below input when workspace has >1 public board
- [ ] Board selector defaults to `defaultBoard` URL param or "All boards"
- [ ] Changing board re-filters popular posts and re-runs active search
- [ ] Selected board carries over to new post form
- [ ] Default view below input shows top voted posts (from route loader data)
- [ ] Typing triggers live search (250ms debounce)
- [ ] Search results show matching posts with `[+1]` quick-vote buttons
- [ ] "Submit as new idea" CTA appears when search has results (below results)
- [ ] "No matching ideas" + prominent CTA appears when search has no results
- [ ] CTA text includes truncated search query
- [ ] Clicking CTA navigates to new post form with title pre-filled
- [ ] New post form auto-focuses description when title is pre-filled
- [ ] Back button in new post form returns to home view (search state preserved)
- [ ] After submission: success view with auto-close countdown (3s)
- [ ] "Keep open" cancels countdown, "Close now" closes immediately
- [ ] Quick-vote works with optimistic UI and server confirmation
- [ ] Non-identified users can search and browse but see inline prompt when trying to vote/submit
- [ ] No tab bar exists
- [ ] TanStack Router devtools badge hidden in widget iframe

### Non-Functional

- [ ] Search endpoint responds in < 100ms for typical queries
- [ ] Search debounce prevents excessive API calls (250ms)
- [ ] Query results cached client-side (Map keyed by query string)
- [ ] View transitions feel smooth (200ms animations)
- [ ] All touch targets >= 44x44px
- [ ] `prefers-reduced-motion: reduce` respected

---

## Files to Modify

| File                                                      | Change                                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `apps/web/src/components/widget/widget-auth-provider.tsx` | Remove `activeTab`, `setActiveTab`, `WidgetTab` type                                      |
| `apps/web/src/components/widget/widget-shell.tsx`         | Remove tab bar, add back button support, simplify to thin frame                           |
| `apps/web/src/components/widget/widget-new-post-form.tsx` | Accept `prefilledTitle`, `onBack`, `onSuccess` props; remove internal success/auth states |
| `apps/web/src/components/widget/widget-feed.tsx`          | Delete entirely (replaced by widget-home.tsx)                                             |
| `apps/web/src/routes/widget/index.tsx`                    | Replace tab switching with view state machine (home/new-post/success)                     |
| `apps/web/src/routes/__root.tsx`                          | Hide TanStack Router devtools on widget routes                                            |

## New Files

| File                                             | Purpose                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| `apps/web/src/components/widget/widget-home.tsx` | Input-first home view: search input + post list + vote + submit CTA |
| `apps/web/src/routes/api/widget/search.ts`       | Lightweight search endpoint for widget search-as-you-type           |

## Files to Delete

| File                                             | Reason                        |
| ------------------------------------------------ | ----------------------------- |
| `apps/web/src/components/widget/widget-feed.tsx` | Replaced by `widget-home.tsx` |

## Key Files to Reuse

| File                                                   | What to reuse                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| `apps/web/src/lib/server/domains/posts/post.public.ts` | `listPublicPosts()` with `search` param for the search endpoint |
| `apps/web/src/routes/api/widget/vote.ts`               | Vote API pattern (quick-vote reuses same endpoint)              |
| `apps/web/src/routes/api/widget/voted-posts.ts`        | Fetch voted state for search result vote buttons                |
| `apps/web/src/routes/api/widget/posts.ts`              | Post creation (new post form reuses same endpoint)              |

---

## Verification

1. **Input-first test**: Open widget → input should be auto-focused, cursor blinking
2. **Board selector test**: Widget with >1 board → pill shown below input. Select "Bug Reports" → posts filter. Switch to "All boards" → shows all. Single-board workspace → no selector shown.
3. **Search test**: Type "dark" → matching posts appear within 300ms, scoped to selected board, with vote buttons
4. **Vote test**: Click `[+1]` on search result → count increments, button shows voted state
5. **Pre-fill test**: Click "Submit as new idea" → form opens with search text as title AND selected board pre-selected, cursor in description
6. **Back test**: Click back from form → returns to home with search text and board selection preserved
7. **Submit test**: Submit new idea → success view with countdown → widget auto-closes after 3s
8. **Keep open test**: Click "Keep open" during countdown → countdown stops, switches to home
9. **Auth gate test**: Open widget without identify → can search/browse, voting shows "Sign in" prompt
10. **Empty search test**: Search for gibberish → "No matching ideas" + prominent CTA
11. **Keyboard test**: Escape in empty input → closes widget. Escape with text → clears input.
12. **Devtools test**: TanStack Router devtools badge not visible in widget iframe
