# Help Center Standalone Subdomain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the help center from a portal tab to a standalone subdomain with hybrid layout, semantic search, custom domain support, and restructured admin settings.

**Architecture:** Same TanStack Start app serves the help center on a separate hostname via `helpCenterHost` boolean in RouterContext. New `_helpcenter` layout route with category tabs, contextual sidebar, and article detail with TOC. Hybrid search combines existing tsvector with new Gemini 2 pgvector embeddings.

**Tech Stack:** TanStack Start/Router, Drizzle ORM, PostgreSQL (tsvector + pgvector), Gemini text-embedding-004, BullMQ, React, Tailwind v4, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-04-04-help-center-standalone-design.md`

---

## Task 1: Database Schema Migrations

**Files:**

- Modify: `packages/db/src/schema/kb.ts`
- Modify: `packages/db/src/schema/auth.ts`
- Create: `packages/db/drizzle/NNNN_help_center_standalone.sql` (via drizzle-kit)

### Steps

- [ ] **Step 1: Add `parentId` and `icon` columns to `kb_categories`**

In `packages/db/src/schema/kb.ts`, add to the `helpCenterCategories` table definition:

```typescript
parentId: typeIdColumnNullable('helpcenter_category')('parent_id').references(
  () => helpCenterCategories.id,
  { onDelete: 'set null' }
),
icon: text('icon'),
```

- [ ] **Step 2: Add `position` and `description` columns to `kb_articles`**

In `packages/db/src/schema/kb.ts`, add to the `helpCenterArticles` table definition:

```typescript
position: integer('position'),
description: text('description'),
```

- [ ] **Step 3: Change embedding dimension from 1536 to 768**

In `packages/db/src/schema/kb.ts`, update the custom vector type:

```typescript
const vector = customType<{ data: number[] }>({
  dataType() {
    return 'vector(768)'
  },
})
```

- [ ] **Step 4: Add indexes for new columns**

In `packages/db/src/schema/kb.ts`, add to the existing indexes section of each table:

```typescript
// In helpCenterCategories indexes:
parentIdIdx: index('kb_categories_parent_id_idx').on(table.parentId),

// In helpCenterArticles indexes:
categoryPositionIdx: index('kb_articles_category_position_idx').on(table.categoryId, table.position),
```

- [ ] **Step 5: Update category relations for self-referencing parent/children**

In `packages/db/src/schema/kb.ts`, update `helpCenterCategoriesRelations`:

```typescript
export const helpCenterCategoriesRelations = relations(helpCenterCategories, ({ one, many }) => ({
  parent: one(helpCenterCategories, {
    fields: [helpCenterCategories.parentId],
    references: [helpCenterCategories.id],
    relationName: 'categoryParent',
  }),
  children: many(helpCenterCategories, { relationName: 'categoryParent' }),
  articles: many(helpCenterArticles),
}))
```

- [ ] **Step 6: Add `helpCenterConfig` column to settings table**

In `packages/db/src/schema/auth.ts`, add to the settings table:

```typescript
helpCenterConfig: jsonb('help_center_config'),
```

- [ ] **Step 7: Create `kb_domain_verifications` table**

In `packages/db/src/schema/kb.ts`, add a new table:

```typescript
export const kbDomainVerifications = pgTable('kb_domain_verifications', {
  id: typeIdWithDefault('helpcenter_domain')('id').primaryKey(),
  settingsId: text('settings_id')
    .notNull()
    .references(() => settings.id, { onDelete: 'cascade' }),
  domain: text('domain').notNull(),
  status: text('status', { enum: ['pending', 'verified', 'failed'] })
    .notNull()
    .default('pending'),
  cnameTarget: text('cname_target').notNull(),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

Register the new TypeID prefix `helpcenter_domain` in `packages/ids/src/index.ts`.

- [ ] **Step 8: Generate and run migration**

```bash
cd packages/db && bun run db:generate && cd ../.. && bun run db:migrate
```

Review the generated SQL migration to confirm it includes:

- `ALTER TABLE kb_categories ADD COLUMN parent_id`, `icon`
- `ALTER TABLE kb_articles ADD COLUMN position`, `description`
- `ALTER TABLE kb_articles ALTER COLUMN embedding TYPE vector(768)` (drops existing embeddings — expected)
- `ALTER TABLE settings ADD COLUMN help_center_config`
- `CREATE TABLE kb_domain_verifications`
- New indexes

- [ ] **Step 9: Commit**

```bash
git add packages/db/ packages/ids/
git commit -m "feat(db): add schema changes for standalone help center"
```

---

## Task 2: Settings Types & Service for HelpCenterConfig

**Files:**

- Modify: `apps/web/src/lib/server/domains/settings/settings.types.ts`
- Modify: `apps/web/src/lib/server/domains/settings/settings.service.ts`
- Modify: `apps/web/src/lib/shared/schemas/help-center.ts`
- Create: `apps/web/src/lib/server/functions/help-center-settings.ts`

### Steps

- [ ] **Step 1: Add HelpCenterConfig interface to settings types**

In `apps/web/src/lib/server/domains/settings/settings.types.ts`:

```typescript
export interface HelpCenterConfig {
  enabled: boolean
  subdomain: string | null
  customDomain: string | null
  domainVerified: boolean
  homepageTitle: string
  homepageDescription: string
  access: 'public' | 'authenticated'
}

export const DEFAULT_HELP_CENTER_CONFIG: HelpCenterConfig = {
  enabled: false,
  subdomain: null,
  customDomain: null,
  domainVerified: false,
  homepageTitle: 'How can we help?',
  homepageDescription: 'Search our knowledge base or browse by category',
  access: 'public',
}
```

- [ ] **Step 2: Add HelpCenterConfig to TenantSettings**

In the `TenantSettings` interface in the same file, add:

```typescript
helpCenterConfig: HelpCenterConfig
```

- [ ] **Step 3: Add HelpCenterSeoConfig interface**

```typescript
export interface HelpCenterSeoConfig {
  metaDescription: string
  sitemapEnabled: boolean
  structuredDataEnabled: boolean
  ogImageKey: string | null
}

export const DEFAULT_HELP_CENTER_SEO_CONFIG: HelpCenterSeoConfig = {
  metaDescription: '',
  sitemapEnabled: true,
  structuredDataEnabled: true,
  ogImageKey: null,
}
```

Add `helpCenterSeoConfig` to `HelpCenterConfig` as a nested field, or keep it as a separate concern within `helpCenterConfig`. Simplest approach — nest it:

```typescript
export interface HelpCenterConfig {
  // ...existing fields
  seo: HelpCenterSeoConfig
}

export const DEFAULT_HELP_CENTER_CONFIG: HelpCenterConfig = {
  // ...existing defaults
  seo: DEFAULT_HELP_CENTER_SEO_CONFIG,
}
```

- [ ] **Step 4: Add parsing and service functions for help center config**

In `apps/web/src/lib/server/domains/settings/settings.service.ts`:

```typescript
export async function getHelpCenterConfig(): Promise<HelpCenterConfig> {
  const org = await getOrgSettings()
  return {
    ...DEFAULT_HELP_CENTER_CONFIG,
    ...(org.helpCenterConfig
      ? typeof org.helpCenterConfig === 'string'
        ? JSON.parse(org.helpCenterConfig)
        : org.helpCenterConfig
      : {}),
  }
}

export async function updateHelpCenterConfig(
  input: Partial<HelpCenterConfig>
): Promise<HelpCenterConfig> {
  const current = await getHelpCenterConfig()
  const updated = { ...current, ...input }
  const org = await getOrgSettings()

  await db.update(settings).set({ helpCenterConfig: updated }).where(eq(settings.id, org.id))
  await invalidateSettingsCache()

  return updated
}
```

Include `helpCenterConfig` in `getTenantSettings()` return value by adding the parsing alongside existing configs.

- [ ] **Step 5: Add Zod schemas for help center config updates**

In `apps/web/src/lib/shared/schemas/help-center.ts`:

```typescript
export const updateHelpCenterConfigSchema = z.object({
  enabled: z.boolean().optional(),
  customDomain: z.string().max(253).nullable().optional(),
  homepageTitle: z.string().min(1).max(200).optional(),
  homepageDescription: z.string().max(500).optional(),
  access: z.enum(['public', 'authenticated']).optional(),
})

export const updateHelpCenterSeoSchema = z.object({
  metaDescription: z.string().max(500).optional(),
  sitemapEnabled: z.boolean().optional(),
  structuredDataEnabled: z.boolean().optional(),
})
```

- [ ] **Step 6: Create server functions for help center settings**

Create `apps/web/src/lib/server/functions/help-center-settings.ts`:

```typescript
import { createServerFn } from '@tanstack/react-start'
import { requireWorkspaceRole } from './auth'
import { getHelpCenterConfig, updateHelpCenterConfig } from '../domains/settings/settings.service'
import {
  updateHelpCenterConfigSchema,
  updateHelpCenterSeoSchema,
} from '@/lib/shared/schemas/help-center'

export const getHelpCenterConfigFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })
  return getHelpCenterConfig()
})

export const updateHelpCenterConfigFn = createServerFn({ method: 'POST' })
  .inputValidator(updateHelpCenterConfigSchema)
  .handler(async ({ data }) => {
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })
    return updateHelpCenterConfig(data)
  })

export const updateHelpCenterSeoFn = createServerFn({ method: 'POST' })
  .inputValidator(updateHelpCenterSeoSchema)
  .handler(async ({ data }) => {
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })
    const current = await getHelpCenterConfig()
    return updateHelpCenterConfig({ seo: { ...current.seo, ...data } })
  })
```

- [ ] **Step 7: Update existing schemas for new article/category fields**

In `apps/web/src/lib/shared/schemas/help-center.ts`, update:

```typescript
// Update createCategorySchema to include parentId and icon
export const createCategorySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  isPublic: z.boolean().optional(),
  position: z.number().int().optional(),
  parentId: z.string().nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
})

// Update createArticleSchema to include position and description
export const createArticleSchema = z.object({
  categoryId: z.string(),
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  contentJson: tiptapContentSchema.optional(),
  slug: z.string().max(200).optional(),
  position: z.number().int().optional(),
  description: z.string().max(300).optional(),
})
```

Update the corresponding update schemas similarly.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/
git commit -m "feat(settings): add HelpCenterConfig types, service, and server functions"
```

---

## Task 3: Hostname Detection & Routing Infrastructure

**Files:**

- Modify: `apps/web/src/routes/__root.tsx`
- Modify: `apps/web/src/lib/server/functions/bootstrap.ts`
- Modify: `apps/web/src/routes/_portal.tsx`
- Modify: `apps/web/src/lib/server/config.ts`

### Steps

- [ ] **Step 1: Add `HELP_CENTER_DEV` to config**

In `apps/web/src/lib/server/config.ts`, add a new getter:

```typescript
get helpCenterDev() {
  return process.env.HELP_CENTER_DEV === 'true'
},
```

- [ ] **Step 2: Add `helpCenterHost` to RouterContext**

In `apps/web/src/routes/__root.tsx`, update the `RouterContext` interface:

```typescript
export interface RouterContext {
  queryClient: QueryClient
  baseUrl?: string
  session?: BootstrapData['session']
  settings?: TenantSettings | null
  userRole?: 'admin' | 'member' | 'user' | null
  themeCookie?: BootstrapData['themeCookie']
  helpCenterHost: boolean
}
```

- [ ] **Step 3: Add hostname detection to bootstrap**

In `apps/web/src/lib/server/functions/bootstrap.ts`, add a helper function:

```typescript
function isHelpCenterHost(host: string, settings: TenantSettings | null): boolean {
  if (!settings) return false

  const helpCenterConfig = settings.helpCenterConfig
  if (!helpCenterConfig?.enabled) return false

  const hostname = host.split(':')[0] // Strip port

  // Check custom domain
  if (helpCenterConfig.customDomain && helpCenterConfig.domainVerified) {
    if (hostname === helpCenterConfig.customDomain) return true
  }

  // Check convention subdomain: help.{slug}.quackback.app
  const slug = settings.settings?.slug
  if (slug) {
    const expectedSubdomain = `help.${slug}.${getBaseDomainFromConfig()}`
    if (hostname === expectedSubdomain) return true
  }

  return false
}
```

Add `helpCenterHost` to the bootstrap return value. Access the `Host` header via `getRequestHeaders()`.

- [ ] **Step 4: Wire `helpCenterHost` into root route context**

In `apps/web/src/routes/__root.tsx` `beforeLoad`:

```typescript
beforeLoad: async ({ location }) => {
  const { baseUrl, session, settings, userRole, themeCookie, helpCenterHost } =
    await getBootstrapData()

  // ... existing onboarding check

  return { baseUrl, session, settings, userRole, themeCookie, helpCenterHost }
},
```

- [ ] **Step 5: Add dev mode override**

In the bootstrap function, after the hostname check:

```typescript
// Dev mode: HELP_CENTER_DEV=true or ?mode=help-center query param
let helpCenterHost = isHelpCenterHost(host, tenantSettings)
if (!helpCenterHost && config.isDev) {
  if (config.helpCenterDev) {
    helpCenterHost = true
  }
  // Query param check happens client-side in root route
}
```

In `__root.tsx` `beforeLoad`, add client-side query param check:

```typescript
// Dev mode query param override
let resolvedHelpCenterHost = helpCenterHost
if (!resolvedHelpCenterHost && location.search.includes('mode=help-center')) {
  resolvedHelpCenterHost = true
}
```

- [ ] **Step 6: Guard `_portal.tsx` against help center hostname**

In `apps/web/src/routes/_portal.tsx`, add to the `beforeLoad` or beginning of `loader`:

```typescript
const { helpCenterHost } = context
if (helpCenterHost) {
  throw redirect({ to: '/' }) // Redirect portal routes to help center root
}
```

This ensures that when the help center subdomain is active, portal layout routes don't render.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/
git commit -m "feat(routing): add hostname detection and helpCenterHost context"
```

---

## Task 4: Help Center Layout & Landing Page

**Files:**

- Create: `apps/web/src/routes/_helpcenter.tsx`
- Create: `apps/web/src/routes/_helpcenter/index.tsx`
- Create: `apps/web/src/components/help-center/help-center-header.tsx`
- Create: `apps/web/src/components/help-center/help-center-category-grid.tsx`
- Create: `apps/web/src/components/help-center/help-center-search.tsx`

### Steps

- [ ] **Step 1: Create the help center layout route**

Create `apps/web/src/routes/_helpcenter.tsx`:

```typescript
import { createFileRoute, Outlet, redirect, notFound } from '@tanstack/react-router'
import { HelpCenterHeader } from '@/components/help-center/help-center-header'
import { PortalIntlProvider } from '@/components/portal/portal-intl-provider'
import { generateThemeCSS } from '@/lib/shared/theme/generator'
import { getGoogleFontsUrl } from '@/lib/shared/theme/fonts'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'

export const Route = createFileRoute('/_helpcenter')({
  beforeLoad: async ({ context }) => {
    const { helpCenterHost, settings } = context

    // Guard: only render on help center hostname
    if (!helpCenterHost) throw notFound()

    // Guard: feature flag must be on
    const flags = settings?.featureFlags as FeatureFlags | undefined
    if (!flags?.helpCenter) throw notFound()

    // Guard: help center must be enabled in settings
    const helpCenterConfig = settings?.helpCenterConfig
    if (!helpCenterConfig?.enabled) throw notFound()
  },
  loader: async ({ context }) => {
    const { settings, session, baseUrl } = context
    const org = settings?.settings
    const brandingConfig = settings?.brandingConfig ?? {}
    const customCss = settings?.customCss ?? ''
    const helpCenterConfig = settings?.helpCenterConfig

    const hasThemeConfig = brandingConfig.light || brandingConfig.dark
    const themeStyles = hasThemeConfig ? generateThemeCSS(brandingConfig) : ''
    const googleFontsUrl = getGoogleFontsUrl(brandingConfig)

    // Fetch public categories for the header tabs
    const { listPublicCategoriesFn } = await import('@/lib/server/functions/help-center')
    const categories = await listPublicCategoriesFn()

    return {
      org,
      baseUrl,
      session,
      categories,
      helpCenterConfig,
      themeStyles,
      customCss,
      googleFontsUrl,
      brandingData: settings?.brandingData,
    }
  },
  component: HelpCenterLayout,
  head: ({ loaderData }) => {
    const faviconUrl = loaderData?.brandingData?.faviconUrl
    return {
      links: faviconUrl ? [{ rel: 'icon', href: faviconUrl }] : [],
    }
  },
})

function HelpCenterLayout() {
  const {
    org,
    categories,
    helpCenterConfig,
    themeStyles,
    customCss,
    googleFontsUrl,
    brandingData,
  } = Route.useLoaderData()

  return (
    <PortalIntlProvider>
      {googleFontsUrl && <link rel="stylesheet" href={googleFontsUrl} />}
      {themeStyles && <style dangerouslySetInnerHTML={{ __html: themeStyles }} />}
      {customCss && <style dangerouslySetInnerHTML={{ __html: customCss }} />}

      <div className="min-h-screen bg-background text-foreground">
        <HelpCenterHeader
          brandingData={brandingData}
          categories={categories}
          helpCenterConfig={helpCenterConfig}
        />
        <Outlet />
      </div>
    </PortalIntlProvider>
  )
}
```

- [ ] **Step 2: Create the help center header component**

Create `apps/web/src/components/help-center/help-center-header.tsx`:

This component renders:

- Logo + workspace name (from brandingData)
- Category tabs ("All" + top-level categories, active state based on current route)
- Compact search input (on inner pages — landing page has hero search instead)
- Theme toggle

```typescript
import { Link, useMatches } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import type { SettingsBrandingData } from '@/lib/server/domains/settings/settings.types'

interface HelpCenterHeaderProps {
  brandingData: SettingsBrandingData | null
  categories: Array<{ id: string; slug: string; name: string; icon: string | null }>
  helpCenterConfig: { homepageTitle: string } | null
}

export function HelpCenterHeader({ brandingData, categories, helpCenterConfig }: HelpCenterHeaderProps) {
  const matches = useMatches()
  const currentCategorySlug = matches.find((m) => m.params?.categorySlug)?.params?.categorySlug

  // Only show compact search on inner pages (not landing)
  const isLanding = matches.length <= 2 // root + helpcenter layout only

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2.5 sm:px-6">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 font-semibold text-foreground">
          {brandingData?.logoUrl && (
            <img src={brandingData.logoUrl} alt="" className="h-6 w-6 rounded" />
          )}
          <span className="text-sm">{brandingData?.name ?? 'Help Center'}</span>
        </Link>

        {/* Category tabs */}
        <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
          <Link
            to="/"
            className={cn(
              'whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              !currentCategorySlug
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            All
          </Link>
          {categories
            .filter((c) => !('parentId' in c) || !(c as any).parentId)
            .map((category) => (
              <Link
                key={category.id}
                to="/$categorySlug"
                params={{ categorySlug: category.slug }}
                className={cn(
                  'whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  currentCategorySlug === category.slug
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {category.icon && <span className="mr-1">{category.icon}</span>}
                {category.name}
              </Link>
            ))}
        </nav>

        {/* Compact search (inner pages only) */}
        {!isLanding && (
          <div className="hidden sm:block">
            <HelpCenterCompactSearch />
          </div>
        )}
      </div>
    </header>
  )
}

function HelpCenterCompactSearch() {
  // Compact search input that opens search results overlay
  // Reuses HelpCenterSearch component in compact mode
  return (
    <button className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted">
      <span>Search...</span>
      <kbd className="rounded border border-border bg-background px-1 text-[10px]">
        /
      </kbd>
    </button>
  )
}
```

Note: This is the initial structure. The compact search button will open a search dialog/overlay implemented in Task 7.

- [ ] **Step 3: Create the help center search component**

Create `apps/web/src/components/help-center/help-center-search.tsx`:

```typescript
import { useState, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useDebouncedCallback } from 'use-debounce'
import { Input } from '@/components/ui/input'

interface HelpCenterSearchProps {
  variant: 'hero' | 'compact'
  className?: string
}

export function HelpCenterSearch({ variant, className }: HelpCenterSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const navigate = useNavigate()

  const debouncedSearch = useDebouncedCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([])
      return
    }
    setIsSearching(true)
    try {
      const res = await fetch(`/api/widget/kb-search?q=${encodeURIComponent(q)}&limit=8`)
      const data = await res.json()
      setResults(data.data?.articles ?? [])
    } finally {
      setIsSearching(false)
    }
  }, 300)

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value)
      debouncedSearch(e.target.value)
    },
    [debouncedSearch]
  )

  const handleSelectArticle = (article: SearchResult) => {
    navigate({
      to: '/$categorySlug/$articleSlug',
      params: { categorySlug: article.categorySlug, articleSlug: article.slug },
    })
    setQuery('')
    setResults([])
  }

  if (variant === 'hero') {
    return (
      <div className={cn('relative mx-auto w-full max-w-xl', className)}>
        <Input
          value={query}
          onChange={handleChange}
          placeholder="Search articles..."
          className="h-12 pl-10 text-base"
        />
        <SearchIcon className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" />
        {results.length > 0 && (
          <SearchResults results={results} onSelect={handleSelectArticle} />
        )}
      </div>
    )
  }

  // Compact variant renders in a dialog/popover — implement in search dialog task
  return null
}

interface SearchResult {
  id: string
  slug: string
  title: string
  content: string
  categorySlug: string
  categoryName: string
}

function SearchResults({
  results,
  onSelect,
}: {
  results: SearchResult[]
  onSelect: (r: SearchResult) => void
}) {
  return (
    <div className="absolute top-full z-50 mt-2 w-full rounded-lg border border-border bg-popover p-1 shadow-lg">
      {results.map((r) => (
        <button
          key={r.id}
          onClick={() => onSelect(r)}
          className="flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left hover:bg-muted"
        >
          <span className="text-sm font-medium text-foreground">{r.title}</span>
          <span className="text-xs text-muted-foreground">
            {r.categoryName} &middot; {r.content}
          </span>
        </button>
      ))}
    </div>
  )
}
```

Note: The search currently hits `/api/widget/kb-search` which returns keyword results. Task 10 upgrades this to hybrid search.

- [ ] **Step 4: Create the category grid component**

Create `apps/web/src/components/help-center/help-center-category-grid.tsx`:

```typescript
import { Link } from '@tanstack/react-router'

interface Category {
  id: string
  slug: string
  name: string
  description: string | null
  icon: string | null
  articleCount: number
}

interface HelpCenterCategoryGridProps {
  categories: Category[]
}

export function HelpCenterCategoryGrid({ categories }: HelpCenterCategoryGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {categories.map((category) => (
        <Link
          key={category.id}
          to="/$categorySlug"
          params={{ categorySlug: category.slug }}
          className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-foreground/20 hover:bg-muted/50"
        >
          {category.icon && (
            <span className="mb-3 block text-2xl">{category.icon}</span>
          )}
          <h3 className="mb-1 text-sm font-semibold text-foreground group-hover:text-primary">
            {category.name}
          </h3>
          {category.description && (
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              {category.description}
            </p>
          )}
          <span className="text-xs text-muted-foreground/70">
            {category.articleCount} {category.articleCount === 1 ? 'article' : 'articles'}
          </span>
        </Link>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Create the landing page route**

Create `apps/web/src/routes/_helpcenter/index.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { HelpCenterSearch } from '@/components/help-center/help-center-search'
import { HelpCenterCategoryGrid } from '@/components/help-center/help-center-category-grid'

export const Route = createFileRoute('/_helpcenter/')({
  component: HelpCenterLanding,
  head: ({ parentLoaderData }) => {
    const org = parentLoaderData?._helpcenter?.org
    const config = parentLoaderData?._helpcenter?.helpCenterConfig
    const workspaceName = org?.name ?? 'Help Center'
    const title = `${workspaceName} Help Center`
    const description = config?.homepageDescription ?? 'Search our knowledge base or browse by category'

    return {
      meta: [
        { title },
        { name: 'description', content: description },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
      ],
    }
  },
})

function HelpCenterLanding() {
  const { categories, helpCenterConfig } = Route.useRouteContext()

  return (
    <main>
      {/* Hero section */}
      <section className="border-b border-border px-4 py-12 text-center sm:px-6 sm:py-16">
        <h1 className="mb-2 text-2xl font-bold text-foreground sm:text-3xl">
          {helpCenterConfig?.homepageTitle ?? 'How can we help?'}
        </h1>
        <p className="mb-8 text-sm text-muted-foreground">
          {helpCenterConfig?.homepageDescription ??
            'Search our knowledge base or browse by category'}
        </p>
        <HelpCenterSearch variant="hero" />
      </section>

      {/* Category grid */}
      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <HelpCenterCategoryGrid categories={categories} />
      </section>
    </main>
  )
}
```

- [ ] **Step 6: Verify the layout renders**

```bash
HELP_CENTER_DEV=true bun run dev
```

Navigate to `localhost:3000`. You should see the help center landing page with the header tabs and category grid. Feature flag must be enabled and help center must be enabled in settings for this to render.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/routes/_helpcenter* apps/web/src/components/help-center/
git commit -m "feat(help-center): add layout route, header, search, and landing page"
```

---

## Task 5: Help Center Category Page with Sidebar

**Files:**

- Create: `apps/web/src/routes/_helpcenter/$categorySlug.tsx`
- Create: `apps/web/src/routes/_helpcenter/$categorySlug/index.tsx`
- Create: `apps/web/src/components/help-center/help-center-sidebar.tsx`
- Create: `apps/web/src/components/help-center/help-center-breadcrumbs.tsx`
- Modify: `apps/web/src/lib/server/domains/help-center/help-center.service.ts`

### Steps

- [ ] **Step 1: Update the service to support parent categories and article ordering**

In `apps/web/src/lib/server/domains/help-center/help-center.service.ts`:

Update `listPublicCategories()` to include `parentId`, `icon`, and order by `position`:

```typescript
export async function listPublicCategories() {
  const categories = await db
    .select({
      id: helpCenterCategories.id,
      slug: helpCenterCategories.slug,
      name: helpCenterCategories.name,
      description: helpCenterCategories.description,
      icon: helpCenterCategories.icon,
      parentId: helpCenterCategories.parentId,
      position: helpCenterCategories.position,
      articleCount: sql<number>`count(${helpCenterArticles.id})::int`,
    })
    .from(helpCenterCategories)
    .leftJoin(
      helpCenterArticles,
      and(
        eq(helpCenterArticles.categoryId, helpCenterCategories.id),
        isNotNull(helpCenterArticles.publishedAt),
        isNull(helpCenterArticles.deletedAt)
      )
    )
    .where(and(eq(helpCenterCategories.isPublic, true), isNull(helpCenterCategories.deletedAt)))
    .groupBy(helpCenterCategories.id)
    .orderBy(asc(helpCenterCategories.position), asc(helpCenterCategories.name))

  return categories
}
```

Add a new function `listPublicArticlesForCategory()` that returns articles ordered by position:

```typescript
export async function listPublicArticlesForCategory(categoryId: string) {
  return db
    .select({
      id: helpCenterArticles.id,
      slug: helpCenterArticles.slug,
      title: helpCenterArticles.title,
      description: helpCenterArticles.description,
      position: helpCenterArticles.position,
      publishedAt: helpCenterArticles.publishedAt,
    })
    .from(helpCenterArticles)
    .where(
      and(
        eq(helpCenterArticles.categoryId, categoryId),
        isNotNull(helpCenterArticles.publishedAt),
        isNull(helpCenterArticles.deletedAt)
      )
    )
    .orderBy(asc(helpCenterArticles.position), asc(helpCenterArticles.publishedAt))
}
```

- [ ] **Step 2: Add server function for category articles**

In `apps/web/src/lib/server/functions/help-center.ts`, add:

```typescript
export const listPublicArticlesForCategoryFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ categoryId: z.string() }))
  .handler(async ({ data }) => {
    const articles = await helpCenterService.listPublicArticlesForCategory(data.categoryId)
    return articles.map((a) => ({
      ...a,
      publishedAt: toIsoStringOrNull(a.publishedAt),
    }))
  })
```

- [ ] **Step 3: Create the breadcrumbs component**

Create `apps/web/src/components/help-center/help-center-breadcrumbs.tsx`:

```typescript
import { Link } from '@tanstack/react-router'
import { ChevronRightIcon } from '@heroicons/react/16/solid'

interface Breadcrumb {
  label: string
  to?: string
  params?: Record<string, string>
}

export function HelpCenterBreadcrumbs({ items }: { items: Breadcrumb[] }) {
  return (
    <nav className="mb-4 flex items-center gap-1 text-xs text-muted-foreground">
      <Link to="/" className="hover:text-foreground">
        Help Center
      </Link>
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          <ChevronRightIcon className="h-3 w-3" />
          {item.to ? (
            <Link to={item.to} params={item.params} className="hover:text-foreground">
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
```

- [ ] **Step 4: Create the sidebar component**

Create `apps/web/src/components/help-center/help-center-sidebar.tsx`:

```typescript
import { Link, useParams } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

interface SidebarCategory {
  id: string
  slug: string
  name: string
  icon: string | null
  parentId: string | null
}

interface SidebarArticle {
  id: string
  slug: string
  title: string
}

interface HelpCenterSidebarProps {
  category: SidebarCategory
  subcategories: SidebarCategory[]
  articles: SidebarArticle[]
  subcategoryArticles: Record<string, SidebarArticle[]>
}

export function HelpCenterSidebar({
  category,
  subcategories,
  articles,
  subcategoryArticles,
}: HelpCenterSidebarProps) {
  const { articleSlug } = useParams({ strict: false })

  return (
    <aside className="w-56 shrink-0 border-r border-border overflow-y-auto">
      <nav className="p-4">
        {/* Main category articles */}
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {category.icon && <span className="mr-1">{category.icon}</span>}
          {category.name}
        </div>
        <ul className="mb-4 space-y-0.5">
          {articles.map((article) => (
            <li key={article.id}>
              <Link
                to="/$categorySlug/$articleSlug"
                params={{ categorySlug: category.slug, articleSlug: article.slug }}
                className={cn(
                  'block rounded-md px-2.5 py-1.5 text-xs transition-colors',
                  articleSlug === article.slug
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
              >
                {article.title}
              </Link>
            </li>
          ))}
        </ul>

        {/* Subcategories */}
        {subcategories.map((sub) => (
          <div key={sub.id} className="mb-4">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {sub.icon && <span className="mr-1">{sub.icon}</span>}
              {sub.name}
            </div>
            <ul className="space-y-0.5">
              {(subcategoryArticles[sub.id] ?? []).map((article) => (
                <li key={article.id}>
                  <Link
                    to="/$categorySlug/$articleSlug"
                    params={{ categorySlug: category.slug, articleSlug: article.slug }}
                    className={cn(
                      'block rounded-md px-2.5 py-1.5 pl-4 text-xs transition-colors',
                      articleSlug === article.slug
                        ? 'bg-muted font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    )}
                  >
                    {article.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  )
}
```

- [ ] **Step 5: Create the category layout route**

Create `apps/web/src/routes/_helpcenter/$categorySlug.tsx`:

```typescript
import { createFileRoute, Outlet, notFound } from '@tanstack/react-router'
import { HelpCenterSidebar } from '@/components/help-center/help-center-sidebar'

export const Route = createFileRoute('/_helpcenter/$categorySlug')({
  loader: async ({ params, context }) => {
    const { getPublicCategoryBySlugFn, listPublicArticlesForCategoryFn } =
      await import('@/lib/server/functions/help-center')

    const category = await getPublicCategoryBySlugFn({ data: { slug: params.categorySlug } })
    if (!category) throw notFound()

    // Fetch articles for this category
    const articles = await listPublicArticlesForCategoryFn({ data: { categoryId: category.id } })

    // Fetch subcategories and their articles
    const allCategories = context.settings?.helpCenterConfig
      ? await (await import('@/lib/server/functions/help-center')).listPublicCategoriesFn()
      : []

    const subcategories = allCategories.filter((c: any) => c.parentId === category.id)
    const subcategoryArticles: Record<string, any[]> = {}

    for (const sub of subcategories) {
      subcategoryArticles[sub.id] = await listPublicArticlesForCategoryFn({
        data: { categoryId: sub.id },
      })
    }

    return { category, articles, subcategories, subcategoryArticles }
  },
  component: CategoryLayout,
})

function CategoryLayout() {
  const { category, articles, subcategories, subcategoryArticles } = Route.useLoaderData()

  return (
    <div className="mx-auto flex max-w-7xl">
      <HelpCenterSidebar
        category={category}
        subcategories={subcategories}
        articles={articles}
        subcategoryArticles={subcategoryArticles}
      />
      <main className="min-w-0 flex-1 px-6 py-6 sm:px-10">
        <Outlet />
      </main>
    </div>
  )
}
```

- [ ] **Step 6: Create the category index page**

Create `apps/web/src/routes/_helpcenter/$categorySlug/index.tsx`:

```typescript
import { createFileRoute, Link } from '@tanstack/react-router'
import { HelpCenterBreadcrumbs } from '@/components/help-center/help-center-breadcrumbs'

export const Route = createFileRoute('/_helpcenter/$categorySlug/')({
  component: CategoryIndex,
  head: ({ parentLoaderData }) => {
    const category = parentLoaderData?.['_helpcenter/$categorySlug']?.category
    const org = parentLoaderData?._helpcenter?.org
    const title = category
      ? `${category.name} - ${org?.name ?? 'Help Center'}`
      : 'Help Center'

    return {
      meta: [
        { title },
        { name: 'description', content: category?.description ?? '' },
        { property: 'og:title', content: title },
      ],
    }
  },
})

function CategoryIndex() {
  const { category, articles } = Route.useRouteContext()

  return (
    <div>
      <HelpCenterBreadcrumbs
        items={[{ label: category.name }]}
      />

      <div className="mb-6">
        <h1 className="mb-1 text-xl font-bold text-foreground">
          {category.icon && <span className="mr-2">{category.icon}</span>}
          {category.name}
        </h1>
        {category.description && (
          <p className="text-sm text-muted-foreground">{category.description}</p>
        )}
      </div>

      <div className="space-y-2">
        {articles.map((article: any) => (
          <Link
            key={article.id}
            to="/$categorySlug/$articleSlug"
            params={{ categorySlug: category.slug, articleSlug: article.slug }}
            className="group flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-muted/50"
          >
            <div>
              <h3 className="text-sm font-medium text-foreground group-hover:text-primary">
                {article.title}
              </h3>
              {article.description && (
                <p className="mt-0.5 text-xs text-muted-foreground">{article.description}</p>
              )}
            </div>
            <span className="text-muted-foreground/50">&rarr;</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/
git commit -m "feat(help-center): add category page with sidebar and breadcrumbs"
```

---

## Task 6: Help Center Article Detail Page

**Files:**

- Create: `apps/web/src/routes/_helpcenter/$categorySlug/$articleSlug.tsx`
- Create: `apps/web/src/components/help-center/help-center-toc.tsx`
- Create: `apps/web/src/components/help-center/help-center-prev-next.tsx`
- Create: `apps/web/src/components/help-center/help-center-article-feedback.tsx`

### Steps

- [ ] **Step 1: Create the table of contents component**

Create `apps/web/src/components/help-center/help-center-toc.tsx`:

```typescript
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface TocHeading {
  id: string
  text: string
  level: number
}

interface HelpCenterTocProps {
  headings: TocHeading[]
}

export function HelpCenterToc({ headings }: HelpCenterTocProps) {
  const [activeId, setActiveId] = useState<string>('')

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
          }
        }
      },
      { rootMargin: '-80px 0px -80% 0px' }
    )

    for (const heading of headings) {
      const el = document.getElementById(heading.id)
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [headings])

  if (headings.length === 0) return null

  return (
    <aside className="hidden w-40 shrink-0 xl:block">
      <div className="sticky top-20">
        <h4 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          On this page
        </h4>
        <ul className="space-y-1">
          {headings.map((h) => (
            <li key={h.id}>
              <a
                href={`#${h.id}`}
                className={cn(
                  'block text-[11px] leading-relaxed transition-colors',
                  h.level === 3 ? 'pl-3' : '',
                  activeId === h.id
                    ? 'border-l-2 border-primary pl-2 font-medium text-foreground'
                    : 'text-muted-foreground/70 hover:text-foreground'
                )}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}

/**
 * Extract headings from TipTap JSON content for TOC generation.
 */
export function extractHeadings(contentJson: any): TocHeading[] {
  const headings: TocHeading[] = []
  if (!contentJson?.content) return headings

  for (const node of contentJson.content) {
    if (node.type === 'heading' && (node.attrs?.level === 2 || node.attrs?.level === 3)) {
      const text = node.content?.map((c: any) => c.text ?? '').join('') ?? ''
      const id = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')

      headings.push({ id, text, level: node.attrs.level })
    }
  }

  return headings
}
```

- [ ] **Step 2: Create the prev/next navigation component**

Create `apps/web/src/components/help-center/help-center-prev-next.tsx`:

```typescript
import { Link } from '@tanstack/react-router'

interface Article {
  slug: string
  title: string
}

interface HelpCenterPrevNextProps {
  categorySlug: string
  prev: Article | null
  next: Article | null
}

export function HelpCenterPrevNext({ categorySlug, prev, next }: HelpCenterPrevNextProps) {
  if (!prev && !next) return null

  return (
    <div className="mt-10 flex items-center justify-between border-t border-border pt-6">
      {prev ? (
        <Link
          to="/$categorySlug/$articleSlug"
          params={{ categorySlug, articleSlug: prev.slug }}
          className="group"
        >
          <span className="text-[10px] text-muted-foreground">&larr; Previous</span>
          <span className="block text-xs font-medium text-primary group-hover:underline">
            {prev.title}
          </span>
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link
          to="/$categorySlug/$articleSlug"
          params={{ categorySlug, articleSlug: next.slug }}
          className="group text-right"
        >
          <span className="text-[10px] text-muted-foreground">Next &rarr;</span>
          <span className="block text-xs font-medium text-primary group-hover:underline">
            {next.title}
          </span>
        </Link>
      ) : (
        <div />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create the article feedback component**

Create `apps/web/src/components/help-center/help-center-article-feedback.tsx`:

Reuse the logic from the existing `apps/web/src/components/portal/help-center/help-center-article-feedback.tsx` but with updated styling. The component uses `recordArticleFeedbackFn` and optimistic updates.

```typescript
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { recordArticleFeedbackFn } from '@/lib/server/functions/help-center'

interface HelpCenterArticleFeedbackProps {
  articleId: string
  helpfulCount: number
  notHelpfulCount: number
  userFeedback?: boolean | null
}

export function HelpCenterArticleFeedback({
  articleId,
  helpfulCount: initialHelpful,
  notHelpfulCount: initialNotHelpful,
  userFeedback: initialFeedback,
}: HelpCenterArticleFeedbackProps) {
  const [feedback, setFeedback] = useState<boolean | null>(initialFeedback ?? null)
  const [helpfulCount, setHelpfulCount] = useState(initialHelpful)
  const [notHelpfulCount, setNotHelpfulCount] = useState(initialNotHelpful)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleFeedback = async (helpful: boolean) => {
    if (isSubmitting) return

    // Optimistic update
    const prevFeedback = feedback
    const prevHelpful = helpfulCount
    const prevNotHelpful = notHelpfulCount

    if (feedback === helpful) {
      // Toggle off — not supported by current API, just ignore
      return
    }

    setFeedback(helpful)
    if (helpful) {
      setHelpfulCount((c) => c + 1)
      if (prevFeedback === false) setNotHelpfulCount((c) => c - 1)
    } else {
      setNotHelpfulCount((c) => c + 1)
      if (prevFeedback === true) setHelpfulCount((c) => c - 1)
    }

    setIsSubmitting(true)
    try {
      await recordArticleFeedbackFn({ data: { articleId, helpful } })
    } catch {
      // Revert on error
      setFeedback(prevFeedback)
      setHelpfulCount(prevHelpful)
      setNotHelpfulCount(prevNotHelpful)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex items-center gap-3 border-t border-border pt-6">
      <span className="text-xs text-muted-foreground">Was this article helpful?</span>
      <button
        onClick={() => handleFeedback(true)}
        disabled={isSubmitting}
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
          feedback === true
            ? 'border-green-500/30 bg-green-500/10 text-green-600'
            : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted'
        )}
      >
        <span>👍</span> {helpfulCount}
      </button>
      <button
        onClick={() => handleFeedback(false)}
        disabled={isSubmitting}
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
          feedback === false
            ? 'border-red-500/30 bg-red-500/10 text-red-600'
            : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted'
        )}
      >
        <span>👎</span> {notHelpfulCount}
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Create the article detail route**

Create `apps/web/src/routes/_helpcenter/$categorySlug/$articleSlug.tsx`:

```typescript
import { createFileRoute, notFound } from '@tanstack/react-router'
import { RichTextContent } from '@/components/ui/rich-text-content'
import { HelpCenterBreadcrumbs } from '@/components/help-center/help-center-breadcrumbs'
import { HelpCenterToc, extractHeadings } from '@/components/help-center/help-center-toc'
import { HelpCenterPrevNext } from '@/components/help-center/help-center-prev-next'
import { HelpCenterArticleFeedback } from '@/components/help-center/help-center-article-feedback'

export const Route = createFileRoute('/_helpcenter/$categorySlug/$articleSlug')({
  loader: async ({ params }) => {
    const { getPublicArticleBySlugFn } = await import('@/lib/server/functions/help-center')
    const article = await getPublicArticleBySlugFn({ data: { slug: params.articleSlug } })
    if (!article) throw notFound()
    return { article }
  },
  component: ArticleDetail,
  head: ({ loaderData, parentLoaderData }) => {
    const article = loaderData?.article
    const org = parentLoaderData?._helpcenter?.org
    if (!article) return {}

    const title = `${article.title} - ${org?.name ?? 'Help Center'}`
    const description = article.description ?? article.content?.slice(0, 160) ?? ''

    return {
      meta: [
        { title },
        { name: 'description', content: description },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { property: 'og:type', content: 'article' },
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
      ],
    }
  },
})

function ArticleDetail() {
  const { article } = Route.useLoaderData()
  const { category, articles } = Route.useRouteContext()

  // Extract TOC headings from TipTap JSON
  const headings = article.contentJson ? extractHeadings(article.contentJson) : []

  // Find prev/next articles
  const currentIndex = articles.findIndex((a: any) => a.slug === article.slug)
  const prev = currentIndex > 0 ? articles[currentIndex - 1] : null
  const next = currentIndex < articles.length - 1 ? articles[currentIndex + 1] : null

  return (
    <div className="flex gap-8">
      {/* Article content */}
      <article className="min-w-0 flex-1">
        <HelpCenterBreadcrumbs
          items={[
            {
              label: category.name,
              to: '/$categorySlug',
              params: { categorySlug: category.slug },
            },
            { label: article.title },
          ]}
        />

        <h1 className="mb-6 text-2xl font-bold text-foreground">{article.title}</h1>

        {article.contentJson ? (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <RichTextContent content={article.contentJson} />
          </div>
        ) : (
          <div className="whitespace-pre-wrap text-sm text-muted-foreground">
            {article.content}
          </div>
        )}

        <HelpCenterArticleFeedback
          articleId={article.id}
          helpfulCount={article.helpfulCount ?? 0}
          notHelpfulCount={article.notHelpfulCount ?? 0}
        />

        <HelpCenterPrevNext
          categorySlug={category.slug}
          prev={prev}
          next={next}
        />
      </article>

      {/* Table of contents */}
      <HelpCenterToc headings={headings} />
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/
git commit -m "feat(help-center): add article detail page with TOC, feedback, and prev/next nav"
```

---

## Task 7: Admin Settings Restructure

**Files:**

- Modify: `apps/web/src/components/admin/settings/settings-nav.tsx`
- Create: `apps/web/src/routes/admin/settings.portal.tsx`
- Create: `apps/web/src/routes/admin/settings.portal-widget.tsx`
- Create: `apps/web/src/routes/admin/settings.help-center.tsx`
- Create: `apps/web/src/routes/admin/settings.help-center-seo.tsx`
- Modify: `apps/web/src/routes/admin/settings.widget.tsx` (redirect to new location)

### Steps

- [ ] **Step 1: Update the settings navigation**

In `apps/web/src/components/admin/settings/settings-nav.tsx`, update the `navSections` array:

```typescript
const navSections: NavSection[] = [
  {
    label: 'Workspace',
    items: [
      { label: 'Team Members', to: '/admin/settings/team', icon: UsersIcon },
      { label: 'Integrations', to: '/admin/settings/integrations', icon: PuzzlePieceIcon },
    ],
  },
  {
    label: 'Appearance',
    items: [{ label: 'Branding', to: '/admin/settings/branding', icon: PaintBrushIcon }],
  },
  {
    label: 'Feedback',
    items: [
      { label: 'Boards', to: '/admin/settings/boards', icon: Squares2X2Icon },
      { label: 'Statuses', to: '/admin/settings/statuses', icon: Cog6ToothIcon },
      { label: 'Permissions', to: '/admin/settings/permissions', icon: ShieldCheckIcon },
    ],
  },
  {
    label: 'Portal',
    items: [
      { label: 'General', to: '/admin/settings/portal', icon: GlobeAltIcon },
      { label: 'Widget', to: '/admin/settings/portal-widget', icon: ChatBubbleLeftRightIcon },
    ],
  },
  // Help Center section — only visible when feature flag is on
  ...(flags?.helpCenter
    ? [
        {
          label: 'Help Center',
          items: [
            { label: 'General', to: '/admin/settings/help-center', icon: BookOpenIcon },
            { label: 'SEO', to: '/admin/settings/help-center-seo', icon: MagnifyingGlassIcon },
          ],
        },
      ]
    : []),
  {
    label: 'Users',
    items: [
      { label: 'Authentication', to: '/admin/settings/portal-auth', icon: LockClosedIcon },
      {
        label: 'User Attributes',
        to: '/admin/settings/user-attributes',
        icon: AdjustmentsHorizontalIcon,
      },
    ],
  },
  {
    label: 'Developers',
    items: [
      { label: 'API Keys', to: '/admin/settings/api-keys', icon: KeyIcon },
      { label: 'Webhooks', to: '/admin/settings/webhooks', icon: BoltIcon },
      { label: 'MCP Server', to: '/admin/settings/mcp', icon: CommandLineIcon },
    ],
  },
  {
    label: 'Advanced',
    items: [{ label: 'Experimental', to: '/admin/settings/experimental', icon: BeakerIcon }],
  },
]
```

The `flags` object needs to be passed as a prop or loaded from context. Check the existing component to see how it accesses route context and add `featureFlags` access.

- [ ] **Step 2: Create Help Center > General settings page**

Create `apps/web/src/routes/admin/settings.help-center.tsx`:

This page contains:

- Enable/disable toggle
- Subdomain display (read-only, derived from workspace slug)
- Custom domain input with CNAME verification status
- Homepage title and description inputs
- Access control (public/authenticated) radio

Use the existing `SettingsCard` component pattern from other settings pages. Fetch help center config via `getHelpCenterConfigFn` and save via `updateHelpCenterConfigFn`.

- [ ] **Step 3: Create Help Center > SEO settings page**

Create `apps/web/src/routes/admin/settings.help-center-seo.tsx`:

This page contains:

- Meta description template input
- Sitemap toggle
- Structured data toggle
- OG image upload (optional)

- [ ] **Step 4: Create Portal > General settings page**

Create `apps/web/src/routes/admin/settings.portal.tsx`:

Move portal feature toggles here from wherever they currently live (publicView, submissions, comments, voting from `portalConfig.features`).

- [ ] **Step 5: Create Portal > Widget settings page (moved)**

Create `apps/web/src/routes/admin/settings.portal-widget.tsx`:

Copy contents from existing `settings.widget.tsx`. Add the help tab toggle, visible only when help center feature flag is on AND help center is enabled:

```typescript
{flags?.helpCenter && helpCenterConfig?.enabled && (
  <div className="flex items-center justify-between">
    <div>
      <Label>Help tab</Label>
      <p className="text-xs text-muted-foreground">
        Show the help center tab in the widget
      </p>
    </div>
    <Switch
      checked={widgetConfig.tabs?.help ?? false}
      onCheckedChange={(checked) => handleTabToggle('help', checked)}
    />
  </div>
)}
```

- [ ] **Step 6: Redirect old widget settings route**

Modify `apps/web/src/routes/admin/settings.widget.tsx` to redirect:

```typescript
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/settings/widget')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/portal-widget' })
  },
})
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/
git commit -m "feat(settings): restructure admin settings with Portal and Help Center sections"
```

---

## Task 8: Gemini Embedding Service

**Files:**

- Create: `apps/web/src/lib/server/domains/help-center/help-center-embedding.service.ts`
- Modify: `apps/web/src/lib/server/domains/help-center/help-center.service.ts`

### Steps

- [ ] **Step 1: Write a test for embedding text formatting**

Create `apps/web/src/lib/server/domains/help-center/__tests__/help-center-embedding.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { formatArticleText } from '../help-center-embedding.service'

describe('formatArticleText', () => {
  it('combines title (repeated for weight) and content', () => {
    const result = formatArticleText('Quick Start', 'Follow these steps to get started.')
    expect(result).toBe('Quick Start\n\nQuick Start\n\nFollow these steps to get started.')
  })

  it('includes category name as context', () => {
    const result = formatArticleText('Install Widget', 'Run npm install', 'Getting Started')
    expect(result).toContain('Category: Getting Started')
  })

  it('truncates to 8000 chars', () => {
    const longContent = 'a'.repeat(10000)
    const result = formatArticleText('Title', longContent)
    expect(result.length).toBeLessThanOrEqual(8000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test -- --run apps/web/src/lib/server/domains/help-center/__tests__/help-center-embedding.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the Gemini embedding service**

Create `apps/web/src/lib/server/domains/help-center/help-center-embedding.service.ts`:

```typescript
import { db, eq, sql } from '@/lib/server/db'
import { helpCenterArticles } from '@quackback/db/schema'
import { getOpenAI } from '@/lib/server/domains/ai/config'
import { withRetry } from '@/lib/server/domains/ai/retry'
import type { HelpCenterArticleId } from '@quackback/ids'

export const KB_EMBEDDING_MODEL = 'google/text-embedding-004'
const KB_EMBEDDING_DIMENSIONS = 768

/**
 * Format article text for embedding generation.
 * Title repeated for emphasis. Category included as context.
 */
export function formatArticleText(title: string, content: string, categoryName?: string): string {
  const parts = [title, title, content || '']
  if (categoryName) {
    parts.push(`Category: ${categoryName}`)
  }
  return parts.join('\n\n').slice(0, 8000)
}

/**
 * Generate embedding for text using Gemini via OpenAI-compatible interface.
 */
export async function generateKbEmbedding(text: string): Promise<number[] | null> {
  const openai = getOpenAI()
  if (!openai) return null

  try {
    const { result: response } = await withRetry(() =>
      openai.embeddings.create({
        model: KB_EMBEDDING_MODEL,
        input: text,
        dimensions: KB_EMBEDDING_DIMENSIONS,
      })
    )
    return response.data[0]?.embedding ?? null
  } catch (error) {
    console.error('[KB Embedding] Gemini embedding failed:', error)
    return null
  }
}

/**
 * Generate and save embedding for a help center article.
 */
export async function generateArticleEmbedding(
  articleId: string,
  title: string,
  content: string,
  categoryName?: string
): Promise<boolean> {
  const text = formatArticleText(title, content, categoryName)
  const embedding = await generateKbEmbedding(text)

  if (!embedding) {
    console.error(`[KB Embedding] Failed to generate for article ${articleId}`)
    return false
  }

  const vectorStr = `[${embedding.join(',')}]`
  await db
    .update(helpCenterArticles)
    .set({
      embedding: sql`${vectorStr}::vector`,
      embeddingModel: KB_EMBEDDING_MODEL,
      embeddingUpdatedAt: new Date(),
    })
    .where(eq(helpCenterArticles.id, articleId))

  return true
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun run test -- --run apps/web/src/lib/server/domains/help-center/__tests__/help-center-embedding.test.ts
```

Expected: PASS

- [ ] **Step 5: Trigger embedding generation on article create/update**

In `apps/web/src/lib/server/domains/help-center/help-center.service.ts`, add fire-and-forget embedding calls at the end of `createArticle()` and `updateArticle()`:

```typescript
// At end of createArticle(), after the insert:
import { generateArticleEmbedding } from './help-center-embedding.service'

// Fire-and-forget
generateArticleEmbedding(article.id, input.title, input.content, category?.name).catch((err) =>
  console.error(`[KB Embedding] Failed for article ${article.id}:`, err)
)
```

Same pattern at end of `updateArticle()` when title or content changed.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/domains/help-center/
git commit -m "feat(help-center): add Gemini embedding service for KB articles"
```

---

## Task 9: Hybrid Search Service

**Files:**

- Create: `apps/web/src/lib/server/domains/help-center/help-center-search.service.ts`
- Modify: `apps/web/src/routes/api/widget/kb-search.ts`
- Modify: `apps/web/src/lib/server/functions/help-center.ts`

### Steps

- [ ] **Step 1: Write tests for hybrid search ranking**

Create `apps/web/src/lib/server/domains/help-center/__tests__/help-center-search.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeHybridScore } from '../help-center-search.service'

describe('computeHybridScore', () => {
  it('combines keyword and semantic scores', () => {
    const score = computeHybridScore(0.5, 0.8)
    // 0.4 * 0.5 + 0.6 * 0.8 = 0.68
    expect(score).toBeCloseTo(0.68, 2)
  })

  it('returns keyword-only score when no semantic score', () => {
    const score = computeHybridScore(0.5, null)
    expect(score).toBeCloseTo(0.5, 2)
  })

  it('returns semantic-only score when no keyword score', () => {
    const score = computeHybridScore(null, 0.8)
    expect(score).toBeCloseTo(0.8, 2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test -- --run apps/web/src/lib/server/domains/help-center/__tests__/help-center-search.test.ts
```

- [ ] **Step 3: Create the hybrid search service**

Create `apps/web/src/lib/server/domains/help-center/help-center-search.service.ts`:

```typescript
import { db, sql, and, isNotNull, isNull } from '@/lib/server/db'
import { helpCenterArticles, helpCenterCategories } from '@quackback/db/schema'
import { generateKbEmbedding } from './help-center-embedding.service'

const KEYWORD_WEIGHT = 0.4
const SEMANTIC_WEIGHT = 0.6
const SEMANTIC_THRESHOLD = 0.5

export function computeHybridScore(
  keywordScore: number | null,
  semanticScore: number | null
): number {
  if (keywordScore != null && semanticScore != null) {
    return KEYWORD_WEIGHT * keywordScore + SEMANTIC_WEIGHT * semanticScore
  }
  if (keywordScore != null) return keywordScore
  if (semanticScore != null) return semanticScore
  return 0
}

interface HybridSearchResult {
  id: string
  slug: string
  title: string
  description: string | null
  content: string
  categoryId: string
  categorySlug: string
  categoryName: string
  score: number
}

/**
 * Hybrid search combining tsvector keyword search with pgvector semantic search.
 * Falls back to keyword-only if embeddings are unavailable.
 */
export async function hybridSearch(query: string, limit = 10): Promise<HybridSearchResult[]> {
  // Generate query embedding (may return null if Gemini unavailable)
  const queryEmbedding = await generateKbEmbedding(query)

  if (queryEmbedding) {
    return hybridSearchWithEmbedding(query, queryEmbedding, limit)
  }

  // Fallback: keyword-only search
  return keywordSearch(query, limit)
}

async function hybridSearchWithEmbedding(
  query: string,
  queryEmbedding: number[],
  limit: number
): Promise<HybridSearchResult[]> {
  const vectorStr = `[${queryEmbedding.join(',')}]`
  const tsQuery = sql`websearch_to_tsquery('english', ${query})`

  const results = await db
    .select({
      id: helpCenterArticles.id,
      slug: helpCenterArticles.slug,
      title: helpCenterArticles.title,
      description: helpCenterArticles.description,
      content: helpCenterArticles.content,
      categoryId: helpCenterArticles.categoryId,
      categorySlug: helpCenterCategories.slug,
      categoryName: helpCenterCategories.name,
      keywordScore: sql<number>`ts_rank(${helpCenterArticles.searchVector}, ${tsQuery})`,
      semanticScore: sql<number>`1 - (${helpCenterArticles.embedding} <=> ${vectorStr}::vector)`,
      combinedScore: sql<number>`(
        ${KEYWORD_WEIGHT} * COALESCE(ts_rank(${helpCenterArticles.searchVector}, ${tsQuery}), 0) +
        ${SEMANTIC_WEIGHT} * COALESCE(1 - (${helpCenterArticles.embedding} <=> ${vectorStr}::vector), 0)
      )`,
    })
    .from(helpCenterArticles)
    .innerJoin(
      helpCenterCategories,
      sql`${helpCenterArticles.categoryId} = ${helpCenterCategories.id}`
    )
    .where(
      and(
        isNotNull(helpCenterArticles.publishedAt),
        isNull(helpCenterArticles.deletedAt),
        isNull(helpCenterCategories.deletedAt),
        sql`(
          ${helpCenterArticles.searchVector} @@ ${tsQuery}
          OR (${helpCenterArticles.embedding} IS NOT NULL
              AND 1 - (${helpCenterArticles.embedding} <=> ${vectorStr}::vector) > ${SEMANTIC_THRESHOLD})
        )`
      )
    )
    .orderBy(
      sql`(
      ${KEYWORD_WEIGHT} * COALESCE(ts_rank(${helpCenterArticles.searchVector}, ${tsQuery}), 0) +
      ${SEMANTIC_WEIGHT} * COALESCE(1 - (${helpCenterArticles.embedding} <=> ${vectorStr}::vector), 0)
    ) DESC`
    )
    .limit(limit)

  return results.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    content: r.content,
    categoryId: r.categoryId,
    categorySlug: r.categorySlug,
    categoryName: r.categoryName,
    score: Number(r.combinedScore),
  }))
}

async function keywordSearch(query: string, limit: number): Promise<HybridSearchResult[]> {
  const tsQuery = sql`websearch_to_tsquery('english', ${query})`

  const results = await db
    .select({
      id: helpCenterArticles.id,
      slug: helpCenterArticles.slug,
      title: helpCenterArticles.title,
      description: helpCenterArticles.description,
      content: helpCenterArticles.content,
      categoryId: helpCenterArticles.categoryId,
      categorySlug: helpCenterCategories.slug,
      categoryName: helpCenterCategories.name,
      score: sql<number>`ts_rank(${helpCenterArticles.searchVector}, ${tsQuery})`,
    })
    .from(helpCenterArticles)
    .innerJoin(
      helpCenterCategories,
      sql`${helpCenterArticles.categoryId} = ${helpCenterCategories.id}`
    )
    .where(
      and(
        isNotNull(helpCenterArticles.publishedAt),
        isNull(helpCenterArticles.deletedAt),
        isNull(helpCenterCategories.deletedAt),
        sql`${helpCenterArticles.searchVector} @@ ${tsQuery}`
      )
    )
    .orderBy(sql`ts_rank(${helpCenterArticles.searchVector}, ${tsQuery}) DESC`)
    .limit(limit)

  return results.map((r) => ({
    ...r,
    score: Number(r.score),
  }))
}
```

- [ ] **Step 4: Run tests**

```bash
bun run test -- --run apps/web/src/lib/server/domains/help-center/__tests__/help-center-search.test.ts
```

- [ ] **Step 5: Update widget kb-search endpoint to use hybrid search**

In `apps/web/src/routes/api/widget/kb-search.ts`, replace the existing `listPublicArticles` call with:

```typescript
import { hybridSearch } from '@/lib/server/domains/help-center/help-center-search.service'

// Replace the existing search call:
const articles = await hybridSearch(q, limit)

// Map to existing response format (truncate content to 200 chars):
const response = articles.map((a) => ({
  id: a.id,
  slug: a.slug,
  title: a.title,
  content: a.content?.slice(0, 200) ?? '',
  category: { slug: a.categorySlug, name: a.categoryName },
}))
```

- [ ] **Step 6: Add a public hybrid search server function**

In `apps/web/src/lib/server/functions/help-center.ts`:

```typescript
export const searchPublicArticlesFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(20).optional() })
  )
  .handler(async ({ data }) => {
    const { hybridSearch } =
      await import('@/lib/server/domains/help-center/help-center-search.service')
    return hybridSearch(data.query, data.limit ?? 10)
  })
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/
git commit -m "feat(help-center): add hybrid search combining tsvector and pgvector"
```

---

## Task 10: Custom Domain Verification

**Files:**

- Create: `apps/web/src/lib/server/domains/help-center/help-center-domain.service.ts`
- Modify: `apps/web/src/lib/server/functions/help-center-settings.ts`

### Steps

- [ ] **Step 1: Write test for CNAME target generation**

Create `apps/web/src/lib/server/domains/help-center/__tests__/help-center-domain.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { generateCnameTarget } from '../help-center-domain.service'

describe('generateCnameTarget', () => {
  it('generates target from base domain config', () => {
    const target = generateCnameTarget('help-proxy.quackback.app')
    expect(target).toBe('help-proxy.quackback.app')
  })
})
```

- [ ] **Step 2: Create the domain verification service**

Create `apps/web/src/lib/server/domains/help-center/help-center-domain.service.ts`:

```typescript
import dns from 'node:dns/promises'
import { db, eq } from '@/lib/server/db'
import { kbDomainVerifications } from '@quackback/db/schema'
import { generateId } from '@quackback/ids'
import { config } from '@/lib/server/config'

const CNAME_TARGET = config.helpCenterCnameTarget ?? 'help-proxy.quackback.app'

export function generateCnameTarget(target?: string): string {
  return target ?? CNAME_TARGET
}

/**
 * Create a domain verification record.
 */
export async function createDomainVerification(settingsId: string, domain: string) {
  const id = generateId('helpcenter_domain')
  const cnameTarget = generateCnameTarget()

  await db.insert(kbDomainVerifications).values({
    id,
    settingsId,
    domain: domain.toLowerCase(),
    status: 'pending',
    cnameTarget,
  })

  return { id, domain, cnameTarget, status: 'pending' as const }
}

/**
 * Check CNAME record for a domain.
 * Returns true if the CNAME points to the expected target.
 */
export async function verifyCname(domain: string, expectedTarget: string): Promise<boolean> {
  try {
    const records = await dns.resolveCname(domain)
    return records.some((record) => record.toLowerCase() === expectedTarget.toLowerCase())
  } catch {
    return false
  }
}

/**
 * Check all pending domain verifications.
 * Called by BullMQ repeatable job.
 */
export async function checkPendingVerifications(): Promise<void> {
  const pending = await db
    .select()
    .from(kbDomainVerifications)
    .where(eq(kbDomainVerifications.status, 'pending'))

  for (const record of pending) {
    const verified = await verifyCname(record.domain, record.cnameTarget)
    const now = new Date()

    if (verified) {
      await db
        .update(kbDomainVerifications)
        .set({ status: 'verified', verifiedAt: now, lastCheckedAt: now })
        .where(eq(kbDomainVerifications.id, record.id))

      // Update settings to mark domain as verified
      const { updateHelpCenterConfig } = await import('../settings/settings.service')
      await updateHelpCenterConfig({ domainVerified: true })
    } else {
      // Check if 72 hours have passed
      const hoursElapsed = (now.getTime() - record.createdAt.getTime()) / (1000 * 60 * 60)
      if (hoursElapsed > 72) {
        await db
          .update(kbDomainVerifications)
          .set({ status: 'failed', lastCheckedAt: now })
          .where(eq(kbDomainVerifications.id, record.id))
      } else {
        await db
          .update(kbDomainVerifications)
          .set({ lastCheckedAt: now })
          .where(eq(kbDomainVerifications.id, record.id))
      }
    }
  }
}
```

- [ ] **Step 3: Add server functions for domain management**

In `apps/web/src/lib/server/functions/help-center-settings.ts`, add:

```typescript
export const addCustomDomainFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ domain: z.string().min(1).max(253) }))
  .handler(async ({ data }) => {
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })
    const settings = await getOrgSettings()
    const { createDomainVerification } =
      await import('../domains/help-center/help-center-domain.service')

    const result = await createDomainVerification(settings.id, data.domain)

    // Save domain to help center config
    await updateHelpCenterConfig({
      customDomain: data.domain,
      domainVerified: false,
    })

    return result
  })

export const getDomainVerificationStatusFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })
  const helpCenterConfig = await getHelpCenterConfig()
  if (!helpCenterConfig.customDomain) return null

  const records = await db
    .select()
    .from(kbDomainVerifications)
    .where(eq(kbDomainVerifications.domain, helpCenterConfig.customDomain))
    .orderBy(desc(kbDomainVerifications.createdAt))
    .limit(1)

  return records[0] ?? null
})
```

- [ ] **Step 4: Run tests**

```bash
bun run test -- --run apps/web/src/lib/server/domains/help-center/__tests__/help-center-domain.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/
git commit -m "feat(help-center): add custom domain verification service"
```

---

## Task 11: SEO — Structured Data & Sitemap

**Files:**

- Create: `apps/web/src/routes/_helpcenter/sitemap.xml.ts`
- Modify: `apps/web/src/routes/_helpcenter/$categorySlug/$articleSlug.tsx`
- Modify: `apps/web/src/routes/_helpcenter/$categorySlug/index.tsx`

### Steps

- [ ] **Step 1: Create the sitemap route**

Create `apps/web/src/routes/_helpcenter/sitemap.xml.ts`:

```typescript
import { createAPIFileRoute } from '@tanstack/react-start/api'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { helpCenterService } from '@/lib/server/domains/help-center'

export const APIRoute = createAPIFileRoute('/_helpcenter/sitemap.xml')({
  GET: async ({ request }) => {
    if (!(await isFeatureEnabled('helpCenter'))) {
      return new Response('Not found', { status: 404 })
    }

    const baseUrl = new URL(request.url).origin
    const categories = await helpCenterService.listPublicCategories()
    const articles = await helpCenterService.listPublicArticles({})

    const urls: string[] = [
      // Landing page
      `<url><loc>${baseUrl}/</loc><priority>1.0</priority></url>`,
    ]

    // Category pages
    for (const cat of categories) {
      urls.push(`<url><loc>${baseUrl}/${cat.slug}</loc><priority>0.8</priority></url>`)
    }

    // Article pages
    for (const article of articles.items ?? articles) {
      const category = categories.find((c: any) => c.id === article.categoryId)
      if (!category) continue
      const lastmod = article.updatedAt
        ? `<lastmod>${new Date(article.updatedAt).toISOString().split('T')[0]}</lastmod>`
        : ''
      urls.push(
        `<url><loc>${baseUrl}/${category.slug}/${article.slug}</loc>${lastmod}<priority>0.6</priority></url>`
      )
    }

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`

    return new Response(sitemap, {
      headers: {
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  },
})
```

- [ ] **Step 2: Add JSON-LD structured data to article pages**

In `apps/web/src/routes/_helpcenter/$categorySlug/$articleSlug.tsx`, update the `head()` function to include JSON-LD:

```typescript
head: ({ loaderData, parentLoaderData }) => {
  const article = loaderData?.article
  const category = parentLoaderData?.['_helpcenter/$categorySlug']?.category
  const org = parentLoaderData?._helpcenter?.org
  const baseUrl = parentLoaderData?._helpcenter?.baseUrl ?? ''
  if (!article) return {}

  const title = `${article.title} - ${org?.name ?? 'Help Center'}`
  const description = article.description ?? article.content?.slice(0, 160) ?? ''
  const canonicalUrl = `${baseUrl}/${category?.slug}/${article.slug}`

  const articleJsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description,
    author: article.author ? { '@type': 'Person', name: article.author.name } : undefined,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
  })

  const breadcrumbJsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Help Center', item: baseUrl },
      { '@type': 'ListItem', position: 2, name: category?.name, item: `${baseUrl}/${category?.slug}` },
      { '@type': 'ListItem', position: 3, name: article.title, item: canonicalUrl },
    ],
  })

  return {
    meta: [
      { title },
      { name: 'description', content: description },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'article' },
      { property: 'og:url', content: canonicalUrl },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
    ],
    links: [{ rel: 'canonical', href: canonicalUrl }],
    scripts: [
      { type: 'application/ld+json', children: articleJsonLd },
      { type: 'application/ld+json', children: breadcrumbJsonLd },
    ],
  }
},
```

- [ ] **Step 3: Add JSON-LD to category pages**

In `apps/web/src/routes/_helpcenter/$categorySlug/index.tsx`, add `CollectionPage` + `BreadcrumbList` JSON-LD in the `head()` function following the same pattern.

- [ ] **Step 4: Add `noindex` for authenticated help centers**

In `apps/web/src/routes/_helpcenter.tsx` layout `head()`, conditionally add noindex:

```typescript
head: ({ loaderData }) => {
  const config = loaderData?.helpCenterConfig
  const isAuthenticated = config?.access === 'authenticated'

  return {
    meta: isAuthenticated
      ? [{ name: 'robots', content: 'noindex, nofollow' }]
      : [],
    // ...existing favicon links
  }
},
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/
git commit -m "feat(help-center): add SEO structured data and sitemap"
```

---

## Task 12: Portal Cleanup & Widget Updates

**Files:**

- Delete: `apps/web/src/routes/_portal/help.index.tsx`
- Delete: `apps/web/src/routes/_portal/help.$categorySlug.index.tsx`
- Delete: `apps/web/src/routes/_portal/help.$categorySlug.$articleSlug.tsx`
- Delete: `apps/web/src/components/portal/help-center/` (entire directory)
- Modify: `apps/web/src/components/public/portal-header.tsx`
- Modify: widget components (update "open in portal" links)

### Steps

- [ ] **Step 1: Remove portal help center routes**

```bash
rm apps/web/src/routes/_portal/help.index.tsx
rm apps/web/src/routes/_portal/help.\$categorySlug.index.tsx
rm apps/web/src/routes/_portal/help.\$categorySlug.\$articleSlug.tsx
```

- [ ] **Step 2: Remove portal help center components**

```bash
rm -rf apps/web/src/components/portal/help-center/
```

- [ ] **Step 3: Remove Help nav item from portal header**

In `apps/web/src/components/public/portal-header.tsx`, the `NAV_ITEMS` array currently has Feedback, Roadmap, Changelog. If Help was added there (check current state), remove it. The existing code at lines 47-51 does NOT include Help — confirm this is still the case after any previous changes.

- [ ] **Step 4: Update widget "open in portal" links**

Find widget components that link to `/help/...` and update them to construct the help center subdomain URL:

```typescript
// Instead of:
const articleUrl = `/help/${article.categorySlug}/${article.slug}`

// Use:
const helpCenterBaseUrl = getHelpCenterBaseUrl(settings) // helper that builds the subdomain URL
const articleUrl = `${helpCenterBaseUrl}/${article.categorySlug}/${article.slug}`
```

Create a shared helper:

```typescript
// apps/web/src/lib/shared/help-center-url.ts
export function getHelpCenterBaseUrl(
  settings: { helpCenterConfig?: any; settings?: { slug?: string } } | null
): string {
  const config = settings?.helpCenterConfig
  if (config?.customDomain && config.domainVerified) {
    return `https://${config.customDomain}`
  }
  const slug = settings?.settings?.slug
  if (slug) {
    return `https://help.${slug}.quackback.app`
  }
  return '/help' // fallback
}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(portal): remove help center routes, update widget links to subdomain"
```

---

## Task 13: Update Domain Service Schema & Category Service

**Files:**

- Modify: `apps/web/src/lib/server/domains/help-center/help-center.service.ts`
- Modify: `apps/web/src/lib/server/functions/help-center.ts`
- Modify: `apps/web/src/lib/shared/schemas/help-center.ts`

### Steps

- [ ] **Step 1: Update category CRUD to support `parentId` and `icon`**

In `help-center.service.ts`, update `createCategory()`:

```typescript
export async function createCategory(input: CreateCategoryInput) {
  const slug = input.slug || slugify(input.name)

  const [category] = await db
    .insert(helpCenterCategories)
    .values({
      id: generateId('helpcenter_category'),
      slug,
      name: input.name,
      description: input.description ?? null,
      isPublic: input.isPublic ?? true,
      position: input.position ?? 0,
      parentId: input.parentId ?? null,
      icon: input.icon ?? null,
    })
    .returning()

  return category
}
```

Update `updateCategory()` similarly to accept `parentId` and `icon` fields.

- [ ] **Step 2: Update article CRUD to support `position` and `description`**

In `help-center.service.ts`, update `createArticle()` and `updateArticle()` to pass through the new `position` and `description` fields.

- [ ] **Step 3: Update server functions to include new fields in responses**

In `apps/web/src/lib/server/functions/help-center.ts`, ensure serialized responses include `parentId`, `icon`, `position`, and `description` fields.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/
git commit -m "feat(help-center): update category and article CRUD for new fields"
```

---

## Task 14: Integration Testing & Polish

**Files:**

- Various — testing and fixing integration issues

### Steps

- [ ] **Step 1: Run the full test suite**

```bash
bun run test
bun run typecheck
bun run lint
```

Fix any type errors, lint issues, or test failures.

- [ ] **Step 2: Manual testing with dev mode**

```bash
HELP_CENTER_DEV=true bun run dev
```

Test the following flows:

1. Landing page renders with category grid and hero search
2. Clicking a category shows sidebar + article list
3. Clicking an article shows detail with TOC, feedback, prev/next
4. Search returns results (keyword at minimum)
5. Breadcrumbs navigate correctly
6. Category tabs highlight active category
7. Admin settings show new Portal and Help Center sections
8. Help Center > General toggle works
9. Feature flag gates all Help Center UI

- [ ] **Step 3: Test responsive behavior**

Verify at desktop (1024px+), tablet (768px), and mobile (375px):

- Desktop: 3-column layout (sidebar + content + TOC)
- Tablet: 2-column (sidebar + content)
- Mobile: single column, sidebar as drawer

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(help-center): integration fixes and polish"
```

---

## Task Order & Dependencies

```
Task 1  (Schema)          -> Task 2  (Settings Types)
Task 1  (Schema)          -> Task 13 (Category/Article CRUD Updates)
Task 2  (Settings Types)  -> Task 3  (Routing)
Task 13 (CRUD Updates)    -> Task 5  (Category + Sidebar, needs new fields)
Task 3  (Routing)         -> Task 4  (Layout + Landing)
Task 4  (Layout)          -> Task 5  (Category + Sidebar)
Task 5  (Category)        -> Task 6  (Article Detail)
Task 2  (Settings Types)  -> Task 7  (Admin Settings)
Task 1  (Schema)          -> Task 8  (Embedding Service)
Task 8  (Embedding)       -> Task 9  (Hybrid Search)
Task 2  (Settings Types)  -> Task 10 (Domain Verification)
Task 6  (Article Detail)  -> Task 11 (SEO)
Task 3  (Routing)         -> Task 12 (Portal Cleanup)
All                       -> Task 14 (Integration Testing)
```

**Recommended execution order:**
1, 2, 13, 3, 4, 5, 6 (sequential core path)
7, 8, 9, 10 (parallel after their deps are met)
11, 12 (after article detail is working)
14 (final integration)

Tasks 7-10 can run in parallel once their dependencies are met. Tasks 4-6 are sequential. Task 12 can run any time after Task 3.
