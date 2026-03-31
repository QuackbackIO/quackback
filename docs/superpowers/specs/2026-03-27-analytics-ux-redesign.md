# Analytics UX Redesign

**Date:** 2026-03-27
**Scope:** No schema or BullMQ changes. One read-only server function addition (changelog top entries).
**Branch:** feat/analytics-ux (new branch from main)

## Goal

Bring the analytics page to Featurebase-level polish by removing placeholder/misleading elements, improving chart types, and reorganising the information hierarchy. No backend changes.

## What changes

### 1. KPI summary cards

**Current:** Four plain cards with a number and a delta badge. No icons, no trend context.

**New:**

- Add a coloured icon per metric: Posts (indigo `📝`), Votes (green `👍`), Comments (amber `💬`), Users (violet `👤`)
- Delta badge moves to the top-right of the card (inline with the icon row)
- Add a **sparkline** of mini bar charts below the number, one bar per day in the selected period. Data comes from `dailyStats` already returned by the server function — no new queries needed.
- Each metric uses its own accent colour for the sparkline bars.

### 2. Activity over time chart

**Current:** Three overlaid area series (posts, votes, comments) with no way to isolate one. When votes >> posts the other series become visually negligible.

**New:**

- Keep the stacked area chart from recharts.
- Add **metric toggle pills** in the card header (Posts / Votes / Comments). Each pill is a toggle button; clicking hides/shows that series. All three are on by default.
- Pill active state uses the metric's accent colour (matching the KPI cards).

### 3. Status distribution

**Current:** Horizontal bar chart (BarChart, layout="vertical").

**New:** Replace with a **donut chart** (PieChart with innerRadius). Show percentage next to each legend label. Uses the status colours already returned from the server (`statusDistribution[].color`).

### 4. Board breakdown

**Current:** Horizontal bar chart with count labels only.

**New:** Keep horizontal bars. Add a **percentage of total** label on the right side of each bar (e.g. "48%"). Compute client-side from the total.

### 5. Source breakdown — removed

The service layer hardcodes all posts to `source: 'portal'`, so the chart always shows a single bar. It conveys no information and looks like a placeholder. **Remove this component entirely.** The freed space is used by the new changelog card.

### 6. Changelog stats — replaced

**Current:** A half-width card with one big number ("Total views: 3,150"). Looks unfinished.

**New:** Replace with a **"Changelog views" card** showing the top changelog entries ranked by view count, with a mini proportional bar and view count per entry. A "Total: X views" summary sits at the bottom.

The server function already returns `changelog.totalViews` (an aggregate). To support this card, the server function needs one additional query: fetch the top 5 `changelogEntries` ordered by `viewCount` desc. This is a read-only query against the existing `changelogEntries` table — no schema change. The `getAnalyticsData` handler returns a `changelog.topEntries` array alongside `changelog.totalViews`.

### 7. Page layout reorganisation

**Current:** Single column, Source and Changelog stacked as a half-half row.

**New layout (top to bottom):**

```
[Header: title + last-updated + period selector]

[KPI row: 4 cards, sparklines]

[Activity over time: full width, metric toggles]

[Breakdown row: 3 equal columns]
  [Status donut]  [Boards bar + %]  [Changelog ranked entries]

[Activity row: 3:2 split]
  [Top posts table]  [Top contributors with bars]
```

### 8. Top contributors

**Current:** Table with Posts / Votes / Comments / Total columns.

**New:** Remove the table columns. Show each contributor as a row with avatar, name, a proportional bar (width = their total / max total), and their total score on the right. Cleaner, more visual, no need for column headers.

### 9. Loading state

**Current:** Full-page centred spinner (`<Loader2>`).

**New:** Skeleton layout — render skeleton cards matching the KPI grid and chart positions. Use shadcn `<Skeleton>` component. Avoids layout shift on data load and looks intentional rather than broken.

## What does NOT change

- Period selector (7d / 30d / 90d / 12m) — keep as-is
- Top posts table — keep columns (rank, title, votes, comments, board, status)
- Server functions, DB schema, BullMQ jobs — untouched (except the one additional changelog query)
- Mobile layout — not in scope for this pass

## Files affected

| File                                                                     | Change                                        |
| ------------------------------------------------------------------------ | --------------------------------------------- |
| `apps/web/src/components/admin/analytics/analytics-page.tsx`             | New layout structure, skeleton loading state  |
| `apps/web/src/components/admin/analytics/analytics-summary-cards.tsx`    | Icons, sparklines, delta repositioning        |
| `apps/web/src/components/admin/analytics/analytics-activity-chart.tsx`   | Metric toggle pills                           |
| `apps/web/src/components/admin/analytics/analytics-status-chart.tsx`     | Swap BarChart → PieChart (donut)              |
| `apps/web/src/components/admin/analytics/analytics-board-chart.tsx`      | Add % labels                                  |
| `apps/web/src/components/admin/analytics/analytics-source-chart.tsx`     | **Delete**                                    |
| `apps/web/src/components/admin/analytics/analytics-top-contributors.tsx` | Replace table with bar rows                   |
| `apps/web/src/components/admin/analytics/analytics-changelog-card.tsx`   | **New file** — ranked entries list            |
| `apps/web/src/lib/server/functions/analytics.ts`                         | Add top 5 changelog entries query (read-only) |
| `apps/web/src/lib/client/queries/analytics.ts`                           | Update return type for `changelog.topEntries` |

## Out of scope

- Custom date range picker
- CSV export
- Admin response rate / resolution time metrics
- Mobile layout improvements
- Previous-period ghost line overlay on activity chart
