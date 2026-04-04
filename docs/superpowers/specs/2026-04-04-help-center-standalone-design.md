# Help Center — Standalone Subdomain Design

**Date:** 2026-04-04
**Status:** Approved

## Overview

Quackback's help center moves from a tab within the feedback portal (`/help`) to a standalone site on its own subdomain (`help.{slug}.quackback.app` or custom domain). The help center uses a hybrid layout: top-level category tabs, contextual sidebar within categories, and a clean article reading view with table of contents.

This is served from the same TanStack Start app via hostname-based routing — no separate deployment. Admin management stays in the existing admin panel with a new dedicated settings section. Branding is shared globally across portal, widget, and help center.

## Scope

### v1 (this spec)

- Subdomain routing with hostname detection
- Hybrid layout: landing page, category pages with sidebar, article detail with TOC
- Category nesting (optional subcategories via `parentId`)
- Category icons (emoji)
- Article ordering, excerpts, breadcrumbs, prev/next navigation
- Admin settings restructure: new Portal and Help Center sections
- Hybrid search: tsvector keyword + Gemini 2 pgvector semantic
- Custom domain support with CNAME verification
- SEO: structured data (JSON-LD), sitemap, meta tags
- Portal `/help` routes removed entirely
- Widget help tab updated to link to subdomain

### Out of scope (future phases)

- AI-powered search summaries
- Feedback-to-knowledge-base loop (auto-linking, content gap detection)
- AI article draft generation
- Multi-language / AI auto-translation
- Article revision history
- Scheduled publishing
- Article templates

## Architecture & Routing

### Hostname Detection

The root route (`__root.tsx`) `beforeLoad` parses the request hostname and determines `appMode`:

```typescript
interface RouterContext {
  queryClient: QueryClient
  baseUrl?: string
  session?: BootstrapData['session']
  settings?: TenantSettings | null
  userRole?: 'admin' | 'member' | 'user' | null
  themeCookie?: BootstrapData['themeCookie']
  helpCenterHost: boolean // true when hostname matches help center subdomain/custom domain
}
```

Hostname matching order:

1. Check against `helpCenterConfig.customDomain` (e.g., `help.acme.com`)
2. Check against convention-based subdomain (e.g., `help.{slug}.quackback.app`)
3. Default to `false`

Admin (`/admin/*`) and widget (`/widget/*`) routes are path-matched and work on any hostname. Only portal and help center layouts use `helpCenterHost` for routing decisions.

### Layout Route Guards

- `_helpcenter.tsx` — `beforeLoad` throws `notFound()` if `helpCenterHost` is `false` OR `helpCenter` feature flag is off OR help center is not enabled in settings
- `_portal.tsx` — `beforeLoad` redirects to help center root if `helpCenterHost` is `true`
- `admin.tsx` — no change, works on any hostname
- `widget.tsx` — no change, works on any hostname

### Route Tree

```
_helpcenter.tsx                              -> layout (header, category tabs, search, theme)
_helpcenter/
  index.tsx                                  -> landing page (hero search + category grid)
  sitemap.xml.ts                             -> sitemap generation
  $categorySlug.tsx                          -> category layout (adds sidebar)
  $categorySlug/
    index.tsx                                -> category overview (article list cards)
    $articleSlug.tsx                          -> article detail (content + TOC + feedback)
```

### URL Examples

```
help.acme.com/                               -> landing page
help.acme.com/getting-started                -> category with sidebar
help.acme.com/getting-started/quick-start    -> article detail
help.acme.com/sitemap.xml                    -> sitemap
```

### Dev Experience

- `HELP_CENTER_DEV=true` env var forces `helpCenterHost = true` on `localhost:3000`
- `?mode=help-center` query param for quick switching during development
- Both skip hostname detection since subdomains don't work with localhost

## Database Schema Changes

### Modified Tables

**`kb_categories`** — add nesting and icons:

| Column     | Type                                         | Notes                       |
| ---------- | -------------------------------------------- | --------------------------- |
| `parentId` | `TEXT REFERENCES kb_categories(id) SET NULL` | Nullable, for subcategories |
| `icon`     | `TEXT`                                       | Emoji or icon identifier    |

New index: `kb_categories(parentId)`

**`kb_articles`** — add ordering and excerpts:

| Column        | Type      | Notes                                                        |
| ------------- | --------- | ------------------------------------------------------------ |
| `position`    | `INTEGER` | Ordering within category, nullable (falls back to createdAt) |
| `description` | `TEXT`    | Explicit excerpt/summary, max 300 chars                      |

New index: `kb_articles(categoryId, position)`

**`kb_articles`** — change embedding dimension:

Migrate `embedding` column from `vector(1536)` to `vector(768)` for Gemini text-embedding-004 compatibility. Existing embeddings will be re-generated.

**`settings`** — add help center config:

| Column             | Type    | Notes                                        |
| ------------------ | ------- | -------------------------------------------- |
| `helpCenterConfig` | `JSONB` | New column alongside existing config columns |

### New Table: `kb_domain_verifications`

| Column          | Type                           | Notes                                   |
| --------------- | ------------------------------ | --------------------------------------- |
| `id`            | `TEXT PRIMARY KEY`             | TypeID                                  |
| `settingsId`    | `TEXT REFERENCES settings(id)` |                                         |
| `domain`        | `TEXT NOT NULL`                | e.g., `help.acme.com`                   |
| `status`        | `TEXT NOT NULL`                | `'pending'` / `'verified'` / `'failed'` |
| `cnameTarget`   | `TEXT NOT NULL`                | What the customer should point to       |
| `lastCheckedAt` | `TIMESTAMPTZ`                  |                                         |
| `verifiedAt`    | `TIMESTAMPTZ`                  |                                         |
| `createdAt`     | `TIMESTAMPTZ DEFAULT now()`    |                                         |

### New Types

```typescript
interface HelpCenterConfig {
  enabled: boolean // master on/off (separate from feature flag)
  subdomain: string | null // e.g., 'help' -> help.{slug}.quackback.app
  customDomain: string | null // e.g., 'help.acme.com'
  domainVerified: boolean // CNAME verification status
  homepageTitle: string // default: "How can we help?"
  homepageDescription: string // subtitle text
  access: 'public' | 'authenticated'
}
```

## Help Center Layout & UI

### Three Page Types

**1. Landing Page** (`help.acme.com/`)

- Persistent header: logo (from shared branding), category tabs ("All" + top-level categories), theme toggle
- Hero section: customizable title and description, prominent search bar
- Category grid: cards with icon, name, description, article count
- Categories ordered by `position` column

**2. Category Page** (`help.acme.com/getting-started`)

- Header: active category tab highlighted, search moves to compact mode in header
- Sidebar: article list for the category, subcategories shown as indented groups with group heading
- Main area: breadcrumbs, category title with icon, article list as clickable cards with title + description
- Sidebar highlights current selection

**3. Article Detail** (`help.acme.com/getting-started/quick-start`)

- Header + sidebar: same as category page, current article highlighted in sidebar
- Main content: breadcrumbs, article title, rich text content (TipTap JSON rendering)
- Right rail: "On this page" table of contents, auto-generated from H2/H3 headings, scroll-spy active heading highlight
- Article feedback: thumbs up/down with counts at bottom of article
- Previous/next article navigation at bottom
- TOC right rail hides on narrow viewports (responsive)

### Responsive Behavior

- Desktop (1024px+): sidebar + content + TOC (3 columns)
- Tablet (768-1023px): sidebar + content (2 columns), TOC hidden
- Mobile (<768px): content only, sidebar accessible via hamburger/drawer, category tabs scroll horizontally

## Admin Settings Restructure

### Navigation Changes

From:

```
Workspace:  Team Members, Integrations
Feedback:   Boards, Statuses, Permissions, Widget
Appearance: Branding
Users:      Authentication, User Attributes
Developers: API Keys, Webhooks, MCP Server
Advanced:   Experimental
```

To:

```
Workspace:   Team Members, Integrations
Appearance:  Branding                                  (shared: portal + help center + widget)
Feedback:    Boards, Statuses, Permissions
Portal:      General, Widget                           (Widget moved from Feedback)
Help Center: General, SEO                              (new, gated by feature flag)
Users:       Authentication, User Attributes
Developers:  API Keys, Webhooks, MCP Server
Advanced:    Experimental
```

### Help Center > General

- Enable/disable toggle (second layer — feature flag must be on first)
- Subdomain display (auto-generated from workspace slug, read-only)
- Custom domain input + CNAME verification status indicator
- CNAME target display (what customer should point their DNS to)
- Homepage title input (default: "How can we help?")
- Homepage description input
- Access control: public / authenticated radio

### Help Center > SEO

- Default meta description template
- Sitemap toggle (on/off, default on)
- JSON-LD structured data toggle (on/off, default on)
- OG image override (optional, falls back to shared branding)

### Portal > General

- Portal feature toggles (public view, submissions, comments, voting) moved from scattered locations in `portalConfig.features`

### Portal > Widget

- Everything currently in Feedback > Widget
- Help tab toggle: only visible when `helpCenter` feature flag is ON and help center is enabled

### Visibility Hierarchy (Three Layers)

1. **Experimental flag** (`helpCenter`) — gates everything: admin sidebar Help Center item, Help Center settings section, widget help tab toggle visibility
2. **Help Center enabled** (`helpCenterConfig.enabled`) — controls whether the subdomain serves content
3. **Widget help tab toggle** (`widgetConfig.tabs.help`) — controls help tab in widget

## Search Architecture

### Hybrid Search Pipeline

**Keyword search (tsvector)** — existing:

- `searchVector` column with GIN index on `kb_articles`
- Title weighted 'A', content weighted 'B'
- `websearch_to_tsquery` for natural language queries

**Semantic search (pgvector + Gemini 2)** — new:

- `embedding vector(768)` column on `kb_articles`
- Cosine similarity via `<=>` operator
- Embeddings generated on article create/update via BullMQ job
- Query embedding generated at search time via Gemini API

**Hybrid ranking** — single SQL query combining both signals:

```sql
SELECT id, title, description,
  ts_rank(search_vector, query) AS keyword_score,
  1 - (embedding <=> query_embedding::vector) AS semantic_score,
  (0.4 * ts_rank(search_vector, query) +
   0.6 * (1 - (embedding <=> query_embedding::vector))) AS combined_score
FROM kb_articles
WHERE published_at IS NOT NULL
  AND deleted_at IS NULL
  AND (search_vector @@ query
       OR 1 - (embedding <=> query_embedding::vector) > 0.5)
ORDER BY combined_score DESC
LIMIT 10
```

### Fallback Behavior

- Gemini API unavailable or embeddings not yet generated: falls back to keyword-only
- Very short queries (1-2 words): bias toward keyword search (higher keyword weight)
- `embeddingModel` column tracks model version for re-embedding on model changes

### Search Surfaces

- Help center search bar (hero on landing, compact in header on inner pages)
- Widget help tab search (upgraded from keyword-only to hybrid)
- Admin article list search (keyword-only, unchanged)

### Debouncing

300ms on all search inputs, consistent with existing patterns.

## SEO & Structured Data

### Meta Tags

Every page gets SSR-rendered meta tags via TanStack Start `head()`:

- `<title>`, `<meta name="description">`, `<link rel="canonical">`
- Open Graph: `og:title`, `og:description`, `og:url`, `og:type`
- Twitter: `twitter:title`, `twitter:description`

When help center access is set to `authenticated`, add `<meta name="robots" content="noindex">`.

### Structured Data (JSON-LD)

**Article pages:**

```json
{
  "@type": "Article",
  "headline": "Quick Start Guide",
  "description": "...",
  "author": { "@type": "Person", "name": "..." },
  "datePublished": "...",
  "dateModified": "..."
}
```

**Category pages:**

```json
{
  "@type": "CollectionPage",
  "name": "Getting Started",
  "description": "...",
  "hasPart": [{ "@type": "Article" }, ...]
}
```

**Breadcrumbs** (category + article pages):

```json
{
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "name": "Help Center", "item": "help.acme.com/" },
    { "name": "Getting Started", "item": "help.acme.com/getting-started" },
    { "name": "Quick Start", "item": "help.acme.com/getting-started/quick-start" }
  ]
}
```

### Sitemap

- Auto-generated at `_helpcenter/sitemap.xml.ts`
- Includes all published category and article pages
- `<lastmod>` from article `updatedAt`
- Toggleable in Help Center > SEO settings

## Custom Domain Verification

### Flow

1. Admin enters custom domain in Help Center > General (e.g., `help.acme.com`)
2. UI shows CNAME target (e.g., `help-proxy.quackback.app`)
3. Record created in `kb_domain_verifications` with status `pending`
4. BullMQ repeatable job checks DNS every 60 seconds for pending domains
5. On CNAME match: status `verified`, `helpCenterConfig.domainVerified = true`
6. After 72 hours unverified: status `failed`, admin sees error state
7. Periodic re-check (every 24h) for verified domains to detect DNS removal

DNS resolution uses Node's `dns.resolveCname()` — no external dependencies.

### SSL

Auto-provision via Let's Encrypt once CNAME is verified. Requires reverse proxy configuration (Caddy or nginx with ACME support).

## Widget Changes

- "Open full article" link in widget article view points to help center subdomain instead of portal `/help/...`
- Widget help tab toggle in Portal > Widget settings only visible when feature flag ON and help center enabled
- `/api/widget/kb-search` endpoint upgraded to hybrid search
- Inline article rendering in widget unchanged

## Component Architecture

### New Files

```
routes/
  _helpcenter.tsx
  _helpcenter/
    index.tsx
    sitemap.xml.ts
    $categorySlug.tsx
    $categorySlug/
      index.tsx
      $articleSlug.tsx
  admin/
    settings.portal.tsx
    settings.portal-widget.tsx
    settings.help-center.tsx
    settings.help-center-seo.tsx

components/
  help-center/
    help-center-header.tsx
    help-center-sidebar.tsx
    help-center-search.tsx
    help-center-category-grid.tsx
    help-center-article-content.tsx
    help-center-article-feedback.tsx
    help-center-toc.tsx
    help-center-breadcrumbs.tsx
    help-center-prev-next.tsx
  admin/settings/
    help-center/
      help-center-general.tsx
      help-center-seo.tsx
    portal/
      portal-general.tsx
      portal-widget.tsx

lib/
  server/domains/help-center/
    help-center-embedding.service.ts
    help-center-search.service.ts
    help-center-domain.service.ts
  server/domains/settings/
    settings.types.ts                        (add HelpCenterConfig)
  shared/schemas/
    help-center.ts                           (add schemas for new fields)
```

### Deleted Files

```
routes/_portal/help.index.tsx
routes/_portal/help.$categorySlug.index.tsx
routes/_portal/help.$categorySlug.$articleSlug.tsx
components/portal/help-center/              (entire directory)
routes/admin/settings.widget.tsx            (moved to settings.portal-widget.tsx)
```

### Modified Files

```
routes/__root.tsx                            (hostname detection, appMode in context)
routes/_portal.tsx                           (redirect if help-center host, remove Help nav)
components/public/portal-header.tsx          (remove Help nav item)
components/admin/settings/settings-nav.tsx   (restructure nav sections)
packages/db/src/schema/kb.ts                (add columns, change vector dimension)
components/widget/                           (update "open in portal" links to subdomain)
```

### Reused From Existing Codebase

- `RichTextContent` component for article rendering
- `RichTextEditor` for admin article editing
- Article feedback mutation/optimistic update logic (restyle only)
- Theme/branding CSS injection (identical to portal pattern)
- i18n provider (wrap help center layout same as portal)

## Error States

- Category not found: 404 with "Category not found" and link back to landing
- Article not found: 404 with "Article not found" and link back to category
- Help center disabled (`enabled: false`): entire `_helpcenter` layout returns 404
- Feature flag off: same, 404 everything
- Custom domain not verified: help center accessible via default subdomain; custom domain shows "domain not configured" page
