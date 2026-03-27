# Analytics Dashboard & Auth Cleanup Design

Three complementary refactors: consolidate anonymous user detection to a single field, stop creating user records for passive widget visitors, and build an analytics dashboard for leadership.

## 1. Auth Cleanup: Consolidate to `principal.type`

### Problem

Two fields track whether a user is anonymous:

| Field              | Table       | Set by                            |
| ------------------ | ----------- | --------------------------------- |
| `user.isAnonymous` | `user`      | Better Auth anonymous plugin      |
| `principal.type`   | `principal` | `databaseHooks.user.create.after` |

They are always derived from each other and can never diverge, but app code checks both: the client reads `user.isAnonymous` (5 places), the server reads `principal.type` (7 places).

### Design

- **Single source of truth**: `principal.type` is the canonical field. All app code reads it.
- **`user.isAnonymous` stays in the DB** -- Better Auth's anonymous plugin requires it. It becomes an implementation detail that app code never reads directly.
- **Session serialization**: `getSession` (`auth.ts`) and `getBootstrapData` (`bootstrap.ts`) currently manually cast `(session.user as Record<string, unknown>).isAnonymous`. Instead, these functions resolve the principal record and include `principal.type` in the session response.
- **Client checks migrated**: The 5 client-side reads of `session.user.isAnonymous` switch to reading from the principal type on the session.
- **Bridge point**: The `databaseHooks.user.create.after` hook continues to derive `principal.type` from `user.isAnonymous` at creation time. This is the only place `user.isAnonymous` is read.

### Files Changed

| File                                             | Change                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| `lib/server/functions/auth.ts`                   | Add `principalType` to `SessionUser` interface; resolve principal in `getSession` |
| `lib/server/functions/bootstrap.ts`              | Use principal type instead of `user.isAnonymous`                                  |
| `routes/widget.tsx`                              | Check `principalType` instead of `user.isAnonymous`                               |
| `components/public/portal-header.tsx`            | Check `principalType`                                                             |
| `components/public/comment-form.tsx`             | Check `principalType`                                                             |
| `components/public/feedback/feedback-header.tsx` | Check `principalType`                                                             |
| `components/public/auth-comments-section.tsx`    | Check `principalType`                                                             |
| `routes/api/widget/session.ts`                   | Already uses `principal.type` -- no change                                        |

### No Migration Needed

The `user.isAnonymous` column stays. No schema changes.

---

## 2. Lazy Anonymous Session Creation

### Problem

Every widget visitor gets an anonymous user record created on mount, even if they never interact. This pollutes the users table with hundreds of passive visitor records (858 users, most anonymous).

### Design

**Current flow:**

```
Widget mounts -> ensureSession() -> signIn.anonymous() -> user + principal + session created
```

**New flow:**

```
Widget mounts -> no session -> visitor browses freely
First vote/comment/post -> ensureSessionThen(action) -> signIn.anonymous() -> proceed
```

#### Widget Auth Provider Changes

- Remove the eager `signIn.anonymous()` call from the `'anonymous'` case in `widget-auth-provider.tsx`.
- The widget loads with `session = null` for unidentified visitors.
- Read-only API calls (post lists, post detail, changelog) already work without auth via public server functions. No changes needed.

#### `ensureSessionThen` Wrapper

A new utility in the widget auth context:

```ts
ensureSessionThen(callback: () => void | Promise<void>): Promise<void>
```

- If session exists, calls `callback` immediately.
- If no session, calls `signIn.anonymous()`, waits for the token to be set, then calls `callback`.
- Holds a single in-flight promise to prevent concurrent callers from creating duplicate sessions (race protection).

#### Action Components

Each write-action component calls `ensureSessionThen` before submitting:

| Component                 | Action   |
| ------------------------- | -------- |
| `widget-vote-button.tsx`  | Vote     |
| `widget-comment-form.tsx` | Comment  |
| Widget post submission    | New post |

#### What Doesn't Change

- SDK `identify()` flow -- still creates/finds the identified user immediately on message receipt.
- Portal session hydration -- still passed through SSR when user is logged into the portal.
- Merge flow -- still works when an anonymous user later identifies.
- Server-side auth checks -- still gate on `principal.type`.

#### Edge Cases

- **Rapid clicks**: The `ensureSessionThen` promise deduplication prevents double user creation.
- **Session indicator**: Widget shell shows empty state until interaction, which is fine -- anonymous users display "Anonymous" anyway.

---

## 3. Analytics Dashboard

### 3a. Data Layer: Materialized Stats Tables

Regular tables refreshed hourly by a BullMQ job. No Postgres materialized views (avoids full-refresh lock contention).

#### `analytics_daily_stats` Table

One row per day, pre-aggregated. The hourly job only recomputes today's row; historical rows are immutable.

| Column            | Type        | Description                                                                                    |
| ----------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `date`            | `date`      | Primary key                                                                                    |
| `new_posts`       | `integer`   | Posts created on this date                                                                     |
| `new_votes`       | `integer`   | Votes cast on this date                                                                        |
| `new_comments`    | `integer`   | Comments created on this date                                                                  |
| `new_users`       | `integer`   | Non-anonymous users created on this date                                                       |
| `posts_by_status` | `jsonb`     | Current snapshot of all active posts by status: `{ "status_slug": count, ... }`                |
| `posts_by_board`  | `jsonb`     | New posts created on this date by board: `{ "board_id": count, ... }`                          |
| `posts_by_source` | `jsonb`     | New posts created on this date by source: `{ "portal": count, "widget": count, "api": count }` |
| `computed_at`     | `timestamp` | When this row was last computed                                                                |

#### `analytics_top_posts` Table

Snapshot of top posts per preset period, refreshed hourly.

| Column          | Type           | Description                       |
| --------------- | -------------- | --------------------------------- |
| `period`        | `text`         | `"7d"`, `"30d"`, `"90d"`, `"12m"` |
| `rank`          | `integer`      | 1-10                              |
| `post_id`       | `TypeID<post>` | FK to posts                       |
| `title`         | `text`         | Denormalized for display          |
| `vote_count`    | `integer`      | Votes in this period              |
| `comment_count` | `integer`      | Comments in this period           |
| `board_name`    | `text`         | Denormalized                      |
| `status_name`   | `text`         | Denormalized                      |
| `computed_at`   | `timestamp`    | When this snapshot was computed   |

Primary key: `(period, rank)`.

### 3b. BullMQ Job

New **`{analytics}`** queue:

- **Cron**: `0 * * * *` (top of every hour)
- **Concurrency**: 1
- **Job name**: `refresh-analytics`
- **Logic**:
  1. Query source tables (posts, votes, comments, users) for today's date
  2. Upsert today's row in `analytics_daily_stats`
  3. For each preset period (7d, 30d, 90d, 12m): query top 10 posts by vote count within the date range, delete + insert into `analytics_top_posts`
- **Registration**: Added to `startup.ts` alongside existing queue initializations
- **Retention**: Remove completed jobs; keep failed for 7 days
- **Retry**: 3 attempts with 2000ms exponential backoff

### 3c. API Layer

New server function: `getAnalyticsData`

**Input**: `{ period: '7d' | '30d' | '90d' | '12m' }`

**Output**:

```ts
{
  summary: {
    posts: {
      total: number
      delta: number
    } // delta = % change vs previous period
    votes: {
      total: number
      delta: number
    }
    comments: {
      total: number
      delta: number
    }
    users: {
      total: number
      delta: number
    }
  }
  dailyStats: Array<{
    date: string
    posts: number
    votes: number
    comments: number
  }>
  statusDistribution: Array<{ status: string; color: string; count: number }>
  boardBreakdown: Array<{ board: string; count: number }>
  sourceBreakdown: Array<{ source: string; count: number }>
  topPosts: Array<{
    rank: number
    postId: string
    title: string
    voteCount: number
    commentCount: number
    boardName: string
    statusName: string
  }>
  topContributors: Array<{
    principalId: string
    displayName: string
    avatarUrl: string | null
    posts: number
    votes: number
    comments: number
    total: number
  }>
  changelog: {
    totalViews: number
    totalReactions: number
  }
}
```

**Logic**:

- Reads `analytics_daily_stats` for the date range
- Computes summary totals and deltas from daily rows
- Reads `analytics_top_posts` for the matching period
- Top contributors: queried live (small result set, acceptable latency)
- Status distribution: reads `posts_by_status` from the most recent day's row (current snapshot, not summed)
- Board breakdown and source breakdown: summed from daily stats JSONB columns across the date range

**Auth**: Requires `admin` or `member` role principal.

### 3d. Admin UI

**Route**: `/admin/analytics`

**Sidebar**: New "Analytics" entry with a `BarChart3` (lucide) icon, positioned between "Help Center" and "Users".

#### Component Library

Install the shadcn/ui `chart` component (`bunx shadcn@latest add chart`). This provides:

- `ChartContainer` -- responsive wrapper with CSS variable theming
- `ChartTooltip` + `ChartTooltipContent` -- styled tooltips matching the admin theme
- `ChartLegend` + `ChartLegendContent` -- accessible chart legends
- `ChartConfig` type -- defines color/label mapping per data series

All charts use these wrappers around recharts primitives. No raw recharts components in page code -- everything goes through the shadcn chart layer for consistent theming, dark mode support, and accessible tooltips.

#### Full Page Wireframe

```
+------------------------------------------------------------------------+
|  SIDEBAR  |                                                            |
|           |  Analytics                                                 |
|  ...      |                                                            |
|  Feedback |  +------------------------------------------------------+ |
|  Roadmap  |  |                  Period Selector                      | |
|  Changelog|  |  [ 7 days ]  [ 30 days ]  [ 90 days ]  [ 12 months ] | |
|  Help Ctr |  +------------------------------------------------------+ |
| >Analytics|                                                            |
|  Users    |  +------------+ +------------+ +------------+ +----------+ |
|  Settings |  | Posts      | | Votes      | | Comments   | | Users    | |
|           |  |            | |            | |            | |          | |
|           |  |   142      | |   891      | |    67      | |   23     | |
|           |  |  +12.4%  ^ | |   +8.1%  ^| |  -3.2%  v | | +15.0% ^ | |
|           |  +------------+ +------------+ +------------+ +----------+ |
|           |                                                            |
|           |  +------------------------------------------------------+ |
|           |  | Activity Over Time                                    | |
|           |  |                                                       | |
|           |  |  900 +                                                | |
|           |  |      |            ..                                   | |
|           |  |  600 +         ..    ..        Votes (green)           | |
|           |  |      |      ..         ..  ..                         | |
|           |  |  300 +   ..               .                           | |
|           |  |      |                                                | |
|           |  |  150 + --*---*---*--*---*---*- Posts (blue)            | |
|           |  |      | __x___x___x__x___x___x_ Comments (orange)     | |
|           |  |    0 +----+----+----+----+----+----+---               | |
|           |  |      Mar 1   5    10   15   20   25  27               | |
|           |  |                                                       | |
|           |  |  [Legend: * Posts  . Votes  x Comments ]              | |
|           |  +------------------------------------------------------+ |
|           |                                                            |
|           |  +-------------------------+ +-------------------------+  |
|           |  | Status Distribution     | | Feedback by Board       |  |
|           |  |                         | |                         |  |
|           |  | Open        ========= 45| | Feature Req  ======= 38|  |
|           |  | Under Review  ====    18| | Bug Reports    ====  22|  |
|           |  | Planned       =====   24| | Integrations    ==   12|  |
|           |  | In Progress    ===    14| | UI/UX            =    8|  |
|           |  | Complete      =======  32| | Other            =    6|  |
|           |  | Closed         ====   19| |                         |  |
|           |  |                         | |                         |  |
|           |  | (bars use status colors)| | (bars use board colors) |  |
|           |  +-------------------------+ +-------------------------+  |
|           |                                                            |
|           |  +-------------------------+ +-------------------------+  |
|           |  | Feedback Sources        | | Changelog               |  |
|           |  |                         | |                         |  |
|           |  |       .......           | |  Views     1,247        |  |
|           |  |     ..  Portal ..       | |  Reactions    89        |  |
|           |  |    .    62%      .      | |                         |  |
|           |  |   .  .........    .     | |  "Last computed         |  |
|           |  |    . Widget 28% .       | |   42 minutes ago"       |  |
|           |  |     ..........         | |                         |  |
|           |  |      API 10%           | |                         |  |
|           |  +-------------------------+ +-------------------------+  |
|           |                                                            |
|           |  +------------------------------------------------------+ |
|           |  | Top Posts                                             | |
|           |  |                                                       | |
|           |  | #  Title                    Votes  Cmnts Board Status | |
|           |  | -- ------------------------ ------ ----- ----- ------ | |
|           |  | 1  Dark mode support          128    24  UI/UX Plnnd | |
|           |  | 2  API rate limit config       94    18  API   Open  | |
|           |  | 3  Slack integration           87    31  Integ InProg| |
|           |  | 4  Export to CSV               76    12  Feat  Open  | |
|           |  | 5  Mobile responsive view      65     8  UI/UX Plnnd | |
|           |  | ...                                                   | |
|           |  +------------------------------------------------------+ |
|           |                                                            |
|           |  +------------------------------------------------------+ |
|           |  | Top Contributors                                     | |
|           |  |                                                       | |
|           |  | Avatar  Name            Posts  Votes  Comments  Total | |
|           |  | ------  --------------  -----  -----  --------  ----- | |
|           |  | [JD]    Jane Doe            8     42        15     65 | |
|           |  | [AS]    Alex Smith          5     38        21     64 | |
|           |  | [MK]    Maria Kim           3     51         8     62 | |
|           |  | [BW]    Bob Wilson          12     22        14     48 | |
|           |  | [CL]    Chris Lee           2     35        10     47 | |
|           |  +------------------------------------------------------+ |
|           |                                                            |
+------------------------------------------------------------------------+
```

#### Summary Cards Detail

Each summary card is a shadcn `Card` with:

- Muted label text (e.g. "Posts") at top
- Large numeric value (e.g. "142") as the focal point
- Delta badge below: green with up arrow for positive, red with down arrow for negative
- Delta compares the selected period to the equivalent previous period (e.g. last 30d vs the 30d before that)

```
+-------------------+
| Posts             |  <-- CardDescription, text-muted-foreground, text-sm
|                   |
|        142        |  <-- text-3xl font-bold tracking-tight
|                   |
|     +12.4%  ^     |  <-- Badge variant: green/destructive, text-xs
+-------------------+
```

#### Activity Chart Detail

- `ChartContainer` wrapping a recharts `AreaChart` (filled area, not just lines -- more visually polished)
- Smooth `monotone` curve type for organic feel
- Semi-transparent fill under each line (10-15% opacity of the line color)
- `ChartTooltip` shows all three values on hover with formatted date
- `ChartLegend` below the chart, interactive -- click to toggle series visibility
- X-axis: daily ticks for 7d/30d, weekly for 90d, monthly for 12m
- Y-axis: auto-scaled, abbreviated labels (1.2k not 1200)
- Grid lines: subtle horizontal only, no vertical

#### Status & Board Charts Detail

- Horizontal `BarChart` inside `ChartContainer`
- Status bars use the status color from the DB (each status has a hex color)
- Board bars use a generated palette from the chart config
- Rounded bar corners (`radius={4}`)
- Labels on left, count on right of each bar
- `ChartTooltip` on hover showing count and percentage of total
- Sorted descending by count

#### Source Breakdown Detail

- `PieChart` with `Pie` using `innerRadius` for a donut style
- Center label shows total count
- `ChartTooltip` on hover per segment
- `ChartLegend` below with source name + percentage
- Three colors from chart config: portal, widget, API

#### Tables Detail

- shadcn `Table` component with `TableHeader` / `TableBody` / `TableRow`
- Top Posts: rank column is muted, title is a link to the post detail page, board and status shown as colored badges
- Top Contributors: avatar (initials fallback), name, three metric columns, total column sorted descending
- No pagination needed (capped at 10 and 5 rows respectively)

#### UX Principles

- **Instant feedback**: Period selector switches optimistically -- show stale data with a subtle loading indicator while new data fetches, don't blank the page
- **Empty states**: Each chart card has a friendly empty state ("No data for this period" with a muted illustration) rather than broken/empty charts
- **Loading state**: On initial load, show skeleton placeholders matching the card shapes (shadcn `Skeleton` component)
- **Freshness indicator**: Small muted text at bottom of page: "Last updated 42 minutes ago" from `computed_at`
- **Responsive**: Summary cards stack 2x2 on medium screens, 1-column on mobile. Chart grid goes single-column below `lg` breakpoint
- **Consistent card style**: Every section is wrapped in a `Card` with `CardHeader` (title) and `CardContent` (chart/table). Uniform padding and spacing throughout.
- **Dark mode**: All chart colors defined via CSS variables in `ChartConfig` so they adapt automatically

### 3e. Changelog Analytics

- Add `view_count` column to the changelog entries table (integer, default 0).
- Increment on public/widget page load via a lightweight server function (fire-and-forget, no auth required).
- Reaction counts already exist on changelog entries.
- The analytics page shows aggregate changelog views + reactions for the selected period.
- Per-entry view/reaction stats are shown on the changelog admin page (future enhancement, not in this scope).

---

## Scope Summary

| Workstream       | Schema changes           | New files            | Modified files  |
| ---------------- | ------------------------ | -------------------- | --------------- |
| Auth cleanup     | None                     | None                 | ~8 files        |
| Lazy sessions    | None                     | None                 | ~4 widget files |
| Analytics tables | 2 new tables + 1 column  | Migration file       | Schema index    |
| Analytics job    | None                     | Queue + worker file  | `startup.ts`    |
| Analytics API    | None                     | Server function file | None            |
| Analytics UI     | shadcn `chart` component | Route + components   | Admin sidebar   |

## Ordering

1. **Auth cleanup** first -- unblocks cleaner session checks in the widget
2. **Lazy sessions** second -- depends on the auth cleanup for consistent `principal.type` checks
3. **Analytics** third -- independent but benefits from the reduced anonymous user noise
