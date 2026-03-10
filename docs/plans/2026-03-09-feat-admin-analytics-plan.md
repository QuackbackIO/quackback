# Plan: Admin Analytics Page

Build a new top-level admin analytics surface at `/admin/analytics` after the logging foundation in [`2026-03-09-feat-ai-usage-log-plan.md`](./2026-03-09-feat-ai-usage-log-plan.md) has landed.

This plan is intentionally a **follow-on**. It depends on `ai_usage_log` and `pipeline_log` existing first.

## Scope

- Add a new admin analytics page and sidebar entry
- Build tabbed analytics views for pipeline health, suggestions, posts, engagement, and AI cost
- Add server-side aggregation functions and React Query bindings
- Use live queries against source tables only
- Scope the Suggestions tab to **feedback-pipeline suggestions** (`feedback_suggestions`) in v1; post-to-post merge suggestions stay represented separately in the Posts tab

## Non-goals

- No rollup tables in v1
- No warehouse/ETL work
- No attempt to make every metric available for every historical range

## Data constraints

The page must respect source retention windows directly:

| Tab                 | Main sources                                                          | Max range       |
| ------------------- | --------------------------------------------------------------------- | --------------- |
| `Overview`          | `raw_feedback_items`, `feedback_suggestions`, `pipeline_log`, `posts` | `180d`          |
| `Feedback Pipeline` | `raw_feedback_items`, `pipeline_log`, `feedback_signals`              | `180d`          |
| `Suggestions`       | `feedback_suggestions`, `pipeline_log`                                | `180d`          |
| `Posts`             | `posts`, `post_activity`, `merge_suggestions`, `post_sentiment`       | `12mo` + custom |
| `Engagement`        | `posts`, `votes`, `comments`, `principal`                             | `12mo` + custom |
| `AI Costs`          | `ai_usage_log`, `pipeline_log`                                        | `90d`           |

Use a shared time-range control in the analytics layout, but the available options should change by tab:

- `Overview`, `Feedback Pipeline`, `Suggestions`: `7d`, `30d`, `90d`, `180d`, custom up to `180d`
- `Posts`, `Engagement`: `7d`, `30d`, `90d`, `12mo`, custom
- `AI Costs`: `7d`, `30d`, `90d`, custom up to `90d`

If a requested comparison period would exceed the available history for a tab, show the absolute KPI and suppress the delta instead of fabricating or partial-computing it.

## Navigation

Add to `admin-sidebar.tsx` after `Users`:

```ts
{ name: 'Analytics', href: '/admin/analytics', icon: ChartBarIcon }
```

## Page structure

```text
/admin/analytics            Layout with time range picker + tabs
  /overview                 Cross-cutting summary
  /pipeline                 Feedback ingestion and processing
  /suggestions              Triage workflow health
  /posts                    Post lifecycle and content health
  /engagement               Community activity
  /costs                    AI token spend and latency
```

---

## Tab 1: Overview

High-level state of the product and pipeline.

### KPI cards

| KPI                    | Query source                                                  | Comparison                     |
| ---------------------- | ------------------------------------------------------------- | ------------------------------ |
| Feedback received      | `COUNT(*) FROM raw_feedback_items` in range                   | previous period when available |
| Pending suggestions    | `COUNT(*) FROM feedback_suggestions WHERE status = 'pending'` | current value only             |
| Posts created          | `COUNT(*) FROM posts WHERE deleted_at IS NULL` in range       | previous period when available |
| Suggestion accept rate | `accepted / total resolved` in range                          | previous period when available |
| Active users           | distinct principals who voted, commented, or posted           | previous period when available |

### Charts

**Feedback volume trend**

- Stacked area chart
- X: date bucket, Y: count, series: `source_type`
- Source: `raw_feedback_items`

**Pipeline funnel**

- Horizontal funnel/bar chart
- Stages: Received -> Gate passed -> Feedback signals extracted -> Suggestions created -> Accepted
- Sources: `raw_feedback_items`, `pipeline_log`, `feedback_signals`, `feedback_suggestions`

**Top voted posts**

- Table, top 10
- Columns: title, board, status, vote count, comment count, created
- Source: `posts`

---

## Tab 2: Feedback Pipeline

How feedback arrives and moves through the raw-feedback pipeline.

### Charts

**Volume by source**

- Stacked area chart over time
- Source: `raw_feedback_items` grouped by `source_type`

**Quality gate breakdown**

- Stacked bar chart per day
- Series: Tier 1 skip, Tier 2 auto-pass, Tier 3 LLM pass, Tier 3 LLM reject
- Source: `pipeline_log` where `event_type LIKE 'quality_gate.%'`

**Quality gate reject rate by source**

- Grouped bar chart
- Source: `pipeline_log` grouped by `detail->>'sourceType'`

**Duplicate rate**

- Line chart over time
- `ingestion.deduplicated / ingestion.received`

**Source quality table**

- Columns: source name, items received, gate pass rate, suggestions created, accept rate
- Aggregated from `raw_feedback_items`, `pipeline_log`, `feedback_suggestions`

**Processing time distribution**

- Histogram or bucketed bar chart
- End-to-end time per raw item from first `pipeline_log` event to last
- Buckets: `<1s`, `1-5s`, `5-15s`, `15-30s`, `30s-1m`, `>1m`

---

## Tab 3: Suggestions

Feedback-pipeline triage health and AI suggestion quality.

This tab is intentionally scoped to `feedback_suggestions` only. Post-to-post merge suggestions are a separate system and remain covered by the Posts tab's merge-rate views in v1.

### Charts

**Suggestion outcomes**

- Donut chart
- Segments: accepted, dismissed, expired, pending
- Source: `feedback_suggestions`

**Triage activity**

- Stacked area chart over time
- Series: accepted, dismissed, expired
- Source: `feedback_suggestions` grouped by `resolved_at` and `status`

**Time to triage**

- Histogram
- Distribution of `resolved_at - created_at` for resolved suggestions
- Buckets: `<1h`, `1-4h`, `4-12h`, `12h-1d`, `1-3d`, `3-7d`, `>7d`

**AI suggestion quality**

- Horizontal bar chart
- Bars: `% title changed`, `% body changed`, `% board changed`, `% author changed`
- Source: `pipeline_log` `suggestion.accepted` with `detail->'edits'`

**Accept rate by source type**

- Bar chart
- Source: `pipeline_log` `suggestion.accepted` grouped by `detail->>'sourceType'`

**Dismiss reason distribution**

- Bar or donut chart
- Source: `feedback_suggestions.dismiss_reason_code` and `pipeline_log` `suggestion.dismissed`
- Goal: identify systematic rejection patterns

**Suggestion type ratio**

- Donut chart
- `create_post` vs `vote_on_post`
- Source: `feedback_suggestions`

**Dedup skip rate**

- Single stat + line trend
- Source: `pipeline_log` `interpretation.suggestion_skipped` vs `interpretation.suggestion_created`

---

## Tab 4: Posts

Board activity, post lifecycle, and content health.

### Charts

**Posts created**

- Stacked area chart over time
- Series: organic vs from accepted suggestions
- Organic = posts where `id NOT IN (accepted suggestion result_post_id)`

**Posts by board**

- Horizontal bar chart
- Source: `posts` joined to `boards`

**Status distribution**

- Stacked bar or donut chart
- Source: `posts` joined to `post_statuses`

**Status velocity**

- Horizontal bar chart
- Average days posts spend in each status category
- Source: `post_activity` where `type = 'status.changed'`

**Post merge rate**

- Line chart
- Accepted merge suggestions per day
- Source: `merge_suggestions`

**Trending posts**

- Table, top 10
- Sort by vote velocity in the selected range

**Sentiment distribution**

- Donut chart
- Source: `post_sentiment`

**Sentiment by board**

- Grouped bar chart
- Source: `post_sentiment` joined to `posts` and `boards`

---

## Tab 5: Engagement

User activity and contribution health.

### Charts

**Active users**

- Line chart over time
- Distinct principals with any activity per day
- Series: voters, commenters, post creators

**Vote activity**

- Area chart over time
- Optional split: organic vs proxy votes

**Comment activity**

- Area chart over time
- Split: team member vs user comments

**Top contributors**

- Table, top 20
- Columns: name, role, posts created, votes cast, comments made

**Team response time**

- Single stat + trend
- Time from post creation to first team-member comment

**User growth**

- Area chart
- New principals of type `user`

**Feedback loop closure**

- Single stat
- `% of posts in a complete-category status`

---

## Tab 6: AI Costs

Token spend, cost efficiency, and model performance.

This tab is capped at `90d` because `ai_usage_log` is retained for `90 days`.

### Charts

**Token spend**

- Stacked area chart over time
- Series: `quality_gate`, `extraction`, `suggestion`, `signal_embedding`, `post_embedding`, `sentiment`
- Source: `ai_usage_log`

**Cost by step**

- Horizontal bar chart
- Total input + output tokens per `pipeline_step`

**Useful cost per accepted raw item**

- Line chart over time
- Rolling average: total tokens for raw items that produced at least one accepted suggestion / accepted raw-item count
- Source: `ai_usage_log` joined to a `DISTINCT raw_feedback_item_id` set from accepted `feedback_suggestions`

**Cost efficiency trend**

- Line chart
- Tokens per raw feedback item processed over time

**Latency by step**

- Grouped bar chart
- Average and p95 `duration_ms` per `pipeline_step`

**Error and retry rates**

- Line chart over time
- Source: `ai_usage_log` where `status = 'error'` or `retry_count > 0`

**Model usage**

- Donut chart
- Token distribution by model

**Wasted spend**

- Single stat + breakdown
- Tokens spent on raw items later rejected by the quality gate

---

## Technical implementation

### Route files

```text
apps/web/src/routes/admin/analytics.tsx
apps/web/src/routes/admin/analytics.index.tsx
apps/web/src/routes/admin/analytics.pipeline.tsx
apps/web/src/routes/admin/analytics.suggestions.tsx
apps/web/src/routes/admin/analytics.posts.tsx
apps/web/src/routes/admin/analytics.engagement.tsx
apps/web/src/routes/admin/analytics.costs.tsx
```

### Server functions

**New file:** `apps/web/src/lib/server/functions/analytics.ts`

Each function returns pre-aggregated data only. Shared input:

```ts
type AnalyticsRange = {
  startDate: string
  endDate: string
  bucket: 'day' | 'week' | 'month'
}
```

Each function should validate that the requested range is allowed for the tab/data source before querying.

Key function groups:

- `fetchAnalyticsOverview`
- `fetchFeedbackVolume`
- `fetchPipelineFunnel`
- `fetchQualityGateStats`
- `fetchSuggestionStats`
- `fetchDismissReasonStats`
- `fetchPostStats`
- `fetchStatusVelocity`
- `fetchEngagementStats`
- `fetchTopContributors`
- `fetchAiCostStats`
- `fetchLatencyStats`

### Client queries

**New file:** `apps/web/src/lib/client/queries/analytics.ts`

```ts
export const analyticsQueries = {
  overview: (range: DateRange) =>
    queryOptions({
      queryKey: ['analytics', 'overview', range],
      queryFn: () => fetchAnalyticsOverview({ data: range }),
      staleTime: 5 * 60 * 1000,
    }),
}
```

### Components

```text
apps/web/src/components/admin/analytics/
├── analytics-layout.tsx
├── kpi-card.tsx
├── overview-tab.tsx
├── pipeline-tab.tsx
├── suggestions-tab.tsx
├── posts-tab.tsx
├── engagement-tab.tsx
├── costs-tab.tsx
└── charts/
    ├── area-chart.tsx
    ├── bar-chart.tsx
    ├── donut-chart.tsx
    ├── funnel-chart.tsx
    ├── histogram-chart.tsx
    └── analytics-table.tsx
```

All chart components are thin wrappers around Recharts, styled with Tailwind, and rendered inside shadcn Card components.

### Color palette

Define once in a shared constant:

```ts
export const CHART_COLORS = {
  primary: 'hsl(var(--primary))',
  sources: { slack: '#4A154B', api: '#3B82F6', quackback: '#F59E0B' },
  status: { accepted: '#22C55E', dismissed: '#EF4444', expired: '#9CA3AF', pending: '#F59E0B' },
  sentiment: { positive: '#22C55E', neutral: '#6B7280', negative: '#EF4444' },
  steps: {
    quality_gate: '#8B5CF6',
    extraction: '#3B82F6',
    suggestion: '#F59E0B',
    signal_embedding: '#14B8A6',
    post_embedding: '#06B6D4',
    sentiment: '#EC4899',
  },
}
```

## Files summary

| File                                                  | Purpose                                   |
| ----------------------------------------------------- | ----------------------------------------- |
| `apps/web/src/routes/admin/analytics.tsx`             | Layout with time range picker and tab nav |
| `apps/web/src/routes/admin/analytics.index.tsx`       | Overview tab route                        |
| `apps/web/src/routes/admin/analytics.pipeline.tsx`    | Feedback Pipeline tab route               |
| `apps/web/src/routes/admin/analytics.suggestions.tsx` | Suggestions tab route                     |
| `apps/web/src/routes/admin/analytics.posts.tsx`       | Posts tab route                           |
| `apps/web/src/routes/admin/analytics.engagement.tsx`  | Engagement tab route                      |
| `apps/web/src/routes/admin/analytics.costs.tsx`       | AI Costs tab route                        |
| `apps/web/src/lib/server/functions/analytics.ts`      | Server-side aggregation queries           |
| `apps/web/src/lib/client/queries/analytics.ts`        | React Query definitions                   |
| `apps/web/src/components/admin/analytics/*.tsx`       | Tab content and reusable chart components |
| `apps/web/src/components/admin/admin-sidebar.tsx`     | Add Analytics nav item                    |
