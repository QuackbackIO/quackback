# Help Center Inline in Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the help center inline inside the public portal layout so `/hc/*` pages show the portal header with a "Help" tab and a secondary category nav row — while the standalone help center subdomain keeps working.

**Architecture:** Move the existing `routes/hc/*` route files under the pathless `_portal` layout group so they inherit `PortalHeader` + portal theming. The old `HelpCenterHeader` is retired; its category-tabs row is extracted into a reusable `HelpCenterCategoryNav` component that `PortalHeader` renders below its main nav when the current path is under `/hc/*`. The subdomain redirect in `_portal.tsx` goes away; instead, when on the help center host, `PortalHeader` hides the feedback/roadmap/changelog tabs so the standalone experience stays clean.

**Tech Stack:** TanStack Start (file-based routing, flat routes, pathless `_portal` layout group), React 19, Tailwind v4, Vitest for unit tests, Playwright for e2e. Help center state is already backed by `helpCenterConfig` in workspace settings — no schema changes.

---

## File Structure

**Create:**

- `apps/web/src/components/help-center/help-center-category-nav.tsx` — extracted category tab row (pure component, takes categories + pathname prefix)
- `apps/web/src/components/help-center/__tests__/help-center-category-nav.test.tsx` — unit tests for active-state and rendering
- `apps/web/src/components/help-center/__tests__/help-center-utils.test.ts` — unit tests for the fixed `getActiveCategory` (if not already present)

**Move (git mv) — preserve URL prefix `/hc/*`:**

- `apps/web/src/routes/hc.tsx` → `apps/web/src/routes/_portal/hc.tsx`
- `apps/web/src/routes/hc/index.tsx` → `apps/web/src/routes/_portal/hc/index.tsx`
- `apps/web/src/routes/hc/$categorySlug.tsx` → `apps/web/src/routes/_portal/hc/$categorySlug.tsx`
- `apps/web/src/routes/hc/$categorySlug/index.tsx` → `apps/web/src/routes/_portal/hc/$categorySlug/index.tsx`
- `apps/web/src/routes/hc/$categorySlug/$articleSlug.tsx` → `apps/web/src/routes/_portal/hc/$categorySlug/$articleSlug.tsx`

**Leave in place (do NOT move):**

- `apps/web/src/routes/hc/sitemap[.]xml.ts` — server route; moving it under `_portal` would wrap it in the portal layout. Keeping it at `routes/hc/sitemap[.]xml.ts` preserves `GET /hc/sitemap.xml` as a layout-free handler.

**Modify:**

- `apps/web/src/routes/_portal.tsx` — drop the `helpCenterHost → /hc` redirect (Task 6)
- `apps/web/src/routes/__root.tsx` — no changes expected, but verify `helpCenterHost` context still flows through
- `apps/web/src/components/public/portal-header.tsx` — conditionally add Help tab, render subnav row when on `/hc/*`, hide feedback/roadmap/changelog on help center host
- `apps/web/src/components/help-center/help-center-header.tsx` — **delete** after move; only the compact search and category tabs are reused
- `apps/web/src/components/help-center/help-center-utils.ts` — fix `getActiveCategory` to understand the `/hc` prefix
- `apps/web/src/components/help-center/help-center-breadcrumbs.tsx` — no change expected; verify breadcrumb URLs still say `/hc`
- Internal HC links using `<a href="/hc/...">` — convert to `<Link to="...">` where helpful (low priority; out of scope unless breaking)

**Config — no new setting.** The Help tab is gated on `settings.featureFlags.helpCenter === true && settings.helpCenterConfig.enabled === true`. When both are on (admins opt in by enabling HC), the inline tab appears in the portal by default. This matches the user instruction: default toggled on.

---

## Preconditions / Setup

- [ ] **Step 0.1: Verify you're on a clean branch**

```bash
cd /home/james/quackback
git status
```

Expected: working tree clean or only the new plan file untracked. If anything else is dirty, stash or commit first.

- [ ] **Step 0.2: Install deps & confirm baseline tests pass**

```bash
bun install
bun run typecheck
bun run test -- apps/web/src/components/help-center
```

Expected: typecheck passes; existing help-center tests pass. If they don't, STOP and fix the baseline before continuing.

- [ ] **Step 0.3: Start dev server in a background terminal for manual smoke tests later**

```bash
bun run dev
```

Expected: server at `http://localhost:3000`. Log in as `demo@example.com` / `password`. In the admin → Settings → Help Center, make sure HC is enabled and at least one category with one published article exists. Create one if needed (or use `bun run db:seed` if that already seeds HC data).

---

## Task 1: Fix `getActiveCategory` to handle the `/hc` URL prefix

**Context:** `getActiveCategory` currently takes `segments[0]` from a pathname. Under `/hc/*` that segment is always `'hc'`, so the "All" tab never lights up correctly when rendered inline. We need it to strip a leading `/hc` before picking the category slug.

**Files:**

- Modify: `apps/web/src/components/help-center/help-center-utils.ts`
- Test: `apps/web/src/components/help-center/__tests__/help-center-utils.test.ts` (create if missing)

- [ ] **Step 1.1: Write failing tests**

Create (or append to) `apps/web/src/components/help-center/__tests__/help-center-utils.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getActiveCategory } from '../help-center-utils'

describe('getActiveCategory', () => {
  it('returns null for the help center root', () => {
    expect(getActiveCategory('/hc')).toBeNull()
    expect(getActiveCategory('/hc/')).toBeNull()
  })

  it('returns the slug for a category path', () => {
    expect(getActiveCategory('/hc/getting-started')).toBe('getting-started')
  })

  it('returns the category slug for a nested article path', () => {
    expect(getActiveCategory('/hc/getting-started/first-steps')).toBe('getting-started')
  })

  it('returns null for non-hc portal paths', () => {
    expect(getActiveCategory('/')).toBeNull()
    expect(getActiveCategory('/roadmap')).toBeNull()
  })
})
```

- [ ] **Step 1.2: Run the test and watch it fail**

```bash
bun run test -- apps/web/src/components/help-center/__tests__/help-center-utils.test.ts
```

Expected: the `/hc/...` cases fail because `segments[0]` is `'hc'`.

- [ ] **Step 1.3: Implement the fix**

Edit `apps/web/src/components/help-center/help-center-utils.ts` — replace the existing `getActiveCategory`:

```ts
/**
 * Extracts the active category slug from the current pathname.
 * Understands both the `/hc/*` inline mount and the help center landing.
 * Returns null when not on a specific category.
 */
export function getActiveCategory(pathname: string): string | null {
  if (!pathname) return null
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] !== 'hc') return null
  return segments[1] ?? null
}
```

- [ ] **Step 1.4: Re-run tests**

```bash
bun run test -- apps/web/src/components/help-center/__tests__/help-center-utils.test.ts
```

Expected: all pass.

- [ ] **Step 1.5: Commit**

```bash
git add apps/web/src/components/help-center/help-center-utils.ts \
        apps/web/src/components/help-center/__tests__/help-center-utils.test.ts
git commit -m "fix: make getActiveCategory understand /hc prefix"
```

---

## Task 2: Extract `HelpCenterCategoryNav` component

**Context:** The category tab row currently lives inside `HelpCenterHeader`. We need it as a standalone component so `PortalHeader` can render it as a secondary nav row without pulling in the HC logo/search duplication.

**Files:**

- Create: `apps/web/src/components/help-center/help-center-category-nav.tsx`
- Create: `apps/web/src/components/help-center/__tests__/help-center-category-nav.test.tsx`

- [ ] **Step 2.1: Write failing test**

Create `apps/web/src/components/help-center/__tests__/help-center-category-nav.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
} from '@tanstack/react-router'
import { HelpCenterCategoryNav } from '../help-center-category-nav'

const categories = [
  {
    id: 'c1',
    parentId: null,
    slug: 'getting-started',
    name: 'Getting Started',
    icon: '🚀',
    description: null,
    articleCount: 3,
  },
  {
    id: 'c2',
    parentId: null,
    slug: 'billing',
    name: 'Billing',
    icon: '💳',
    description: null,
    articleCount: 1,
  },
  {
    id: 'c3',
    parentId: 'c1',
    slug: 'first-steps',
    name: 'First Steps',
    icon: null,
    description: null,
    articleCount: 2,
  },
]

function renderAt(path: string) {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <HelpCenterCategoryNav categories={categories} />
        <Outlet />
      </>
    ),
  })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => null,
  })
  const hcRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/hc',
    component: () => null,
  })
  const catRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/hc/$categorySlug',
    component: () => null,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, hcRoute, catRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  return render(<RouterProvider router={router} />)
}

describe('HelpCenterCategoryNav', () => {
  it('renders an "All" link plus top-level categories', () => {
    renderAt('/hc')
    expect(screen.getByRole('link', { name: /^all$/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /getting started/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /billing/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /first steps/i })).not.toBeInTheDocument()
  })

  it('marks "All" active on /hc', () => {
    renderAt('/hc')
    const all = screen.getByRole('link', { name: /^all$/i })
    expect(all.getAttribute('data-active')).toBe('true')
  })

  it('marks the category active on /hc/:slug', () => {
    renderAt('/hc/billing')
    expect(screen.getByRole('link', { name: /billing/i }).getAttribute('data-active')).toBe('true')
    expect(screen.getByRole('link', { name: /^all$/i }).getAttribute('data-active')).toBe('false')
  })
})
```

- [ ] **Step 2.2: Run tests and confirm failure**

```bash
bun run test -- apps/web/src/components/help-center/__tests__/help-center-category-nav.test.tsx
```

Expected: FAIL with "cannot find module" for `../help-center-category-nav`.

- [ ] **Step 2.3: Create the component**

Create `apps/web/src/components/help-center/help-center-category-nav.tsx`:

```tsx
import { Link, useRouterState } from '@tanstack/react-router'
import { cn } from '@/lib/shared/utils'
import { getTopLevelCategories, getActiveCategory } from './help-center-utils'

export interface HelpCenterCategory {
  id: string
  parentId?: string | null
  slug: string
  name: string
  icon: string | null
  description: string | null
  articleCount: number
}

interface HelpCenterCategoryNavProps {
  categories: HelpCenterCategory[]
}

export function HelpCenterCategoryNav({ categories }: HelpCenterCategoryNavProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const activeSlug = getActiveCategory(pathname)
  const topLevel = getTopLevelCategories(categories)

  const tabClass = (active: boolean) =>
    cn(
      'px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap [border-radius:calc(var(--radius)*0.8)]',
      active
        ? 'bg-[var(--nav-active-background)] text-[var(--nav-active-foreground)]'
        : 'text-[var(--nav-inactive-color)] hover:text-[var(--nav-active-foreground)] hover:bg-[var(--nav-active-background)]/50'
    )

  return (
    <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Help center categories">
      <Link to="/hc" data-active={activeSlug === null} className={tabClass(activeSlug === null)}>
        All
      </Link>
      {topLevel.map((cat) => {
        const isActive = activeSlug === cat.slug
        return (
          <Link
            key={cat.id}
            to="/hc/$categorySlug"
            params={{ categorySlug: cat.slug }}
            data-active={isActive}
            className={tabClass(isActive)}
          >
            {cat.icon && <span className="mr-1">{cat.icon}</span>}
            {cat.name}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 2.4: Re-run tests**

```bash
bun run test -- apps/web/src/components/help-center/__tests__/help-center-category-nav.test.tsx
```

Expected: all pass. If the router test infra is flaky in this repo, drop the active-state tests to simple snapshot/render assertions; the important invariant is that the component mounts and uses `getActiveCategory`.

- [ ] **Step 2.5: Commit**

```bash
git add apps/web/src/components/help-center/help-center-category-nav.tsx \
        apps/web/src/components/help-center/__tests__/help-center-category-nav.test.tsx
git commit -m "feat: extract HelpCenterCategoryNav component"
```

---

## Task 3: Move `/hc/*` route files under `_portal`

**Context:** By moving the route files under the pathless `_portal` folder, they inherit the portal layout (header, auth dialog, theming) without URL changes. The sitemap file stays in place because it should not be layout-wrapped.

**Files:**

- Move: five `.tsx` files listed under "File Structure > Move"
- Keep: `apps/web/src/routes/hc/sitemap[.]xml.ts`

- [ ] **Step 3.1: Create the target directory and move files with git**

```bash
cd /home/james/quackback
mkdir -p apps/web/src/routes/_portal/hc/\$categorySlug
git mv apps/web/src/routes/hc.tsx apps/web/src/routes/_portal/hc.tsx
git mv apps/web/src/routes/hc/index.tsx apps/web/src/routes/_portal/hc/index.tsx
git mv apps/web/src/routes/hc/\$categorySlug.tsx apps/web/src/routes/_portal/hc/\$categorySlug.tsx
git mv apps/web/src/routes/hc/\$categorySlug/index.tsx apps/web/src/routes/_portal/hc/\$categorySlug/index.tsx
git mv apps/web/src/routes/hc/\$categorySlug/\$articleSlug.tsx apps/web/src/routes/_portal/hc/\$categorySlug/\$articleSlug.tsx
```

Expected: the old `routes/hc/` directory still contains only `sitemap[.]xml.ts`. Verify with:

```bash
ls apps/web/src/routes/hc/
ls apps/web/src/routes/_portal/hc/
```

- [ ] **Step 3.2: Regenerate the TanStack route tree**

TanStack Router generates `routeTree.gen.ts`. The dev server regenerates it on restart, but you can force it:

```bash
bun run dev
```

Wait for the route-tree generator to run (usually within a couple seconds), then stop the server (`Ctrl+C`) or leave it running in the background terminal.

```bash
git status apps/web/src/routeTree.gen.ts
```

Expected: `routeTree.gen.ts` is modified. Don't hand-edit it.

- [ ] **Step 3.3: Typecheck to verify the moves compile**

```bash
bun run typecheck
```

Expected: may surface errors in the moved files because `getRouteApi('/hc')` and `getRouteApi('/hc/$categorySlug')` calls still work (pathless `_portal` doesn't alter the URL-derived route IDs). If typecheck surfaces any errors tied to imports or relative paths, fix them before committing. No other consumers should care about the new on-disk path.

- [ ] **Step 3.4: Commit the move**

```bash
git add apps/web/src/routes apps/web/src/routeTree.gen.ts
git commit -m "refactor: move /hc route files under _portal layout group"
```

---

## Task 4: Slim down `_portal/hc.tsx` — drop its own header

**Context:** The moved `_portal/hc.tsx` still renders `HelpCenterHeader`. Because it now inherits `PortalHeader` from `_portal.tsx`, we end up with two headers. Strip the inner header and rely on the portal shell. We also no longer need to load branding/theme/locale here — the portal loader already returns that.

**Files:**

- Modify: `apps/web/src/routes/_portal/hc.tsx`

- [ ] **Step 4.1: Replace the file contents**

Open `apps/web/src/routes/_portal/hc.tsx` and replace with:

```tsx
import { createFileRoute, notFound, redirect, Outlet } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { listPublicCategoriesFn } from '@/lib/server/functions/help-center'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'
import type { HelpCenterConfig } from '@/lib/server/domains/settings'

/** Check if the current request has a valid session. */
const checkHasSession = createServerFn({ method: 'GET' }).handler(async () => {
  const { hasSessionCookie } = await import('@/lib/server/functions/auth-helpers')
  if (!hasSessionCookie()) return false
  const { auth } = await import('@/lib/server/auth')
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  return !!session
})

export const Route = createFileRoute('/_portal/hc')({
  beforeLoad: async ({ context }) => {
    const { settings } = context

    const flags = settings?.featureFlags as FeatureFlags | undefined
    if (!flags?.helpCenter) throw notFound()

    const helpCenterConfig = settings?.helpCenterConfig as HelpCenterConfig | undefined
    if (!helpCenterConfig?.enabled) throw notFound()

    if (helpCenterConfig.access === 'authenticated') {
      const hasSession = await checkHasSession()
      if (!hasSession) {
        throw redirect({ to: '/auth/login', replace: true })
      }
    }
  },
  loader: async ({ context }) => {
    const { settings } = context
    const helpCenterConfig = settings?.helpCenterConfig ?? null
    const categories = await listPublicCategoriesFn({ data: {} })
    return { categories, helpCenterConfig }
  },
  head: ({ loaderData }) => {
    const meta: Array<Record<string, string>> = []
    if (loaderData?.helpCenterConfig?.access === 'authenticated') {
      meta.push({ name: 'robots', content: 'noindex, nofollow' })
    }
    return { meta }
  },
  component: HelpCenterLayoutRoute,
})

function HelpCenterLayoutRoute() {
  return <Outlet />
}
```

Notes:

- The route **id** is `/_portal/hc` because TanStack keeps the folder-path id for pathless groups. Child routes use `createFileRoute('/_portal/hc/')`, etc. The `getRouteApi('/hc')` calls in `$articleSlug.tsx` must update to `getRouteApi('/_portal/hc')`. See Task 4.2.
- Branding, theme, locale, custom CSS are no longer loaded here — they're already provided by `_portal.tsx`.
- Categories are still loaded here so the portal header's subnav can read them from this match's loader data.

- [ ] **Step 4.2: Update child-route `getRouteApi` ids and file route ids**

Edit each moved child file:

`apps/web/src/routes/_portal/hc/index.tsx` — change:

```ts
export const Route = createFileRoute('/hc/')({
```

to:

```ts
export const Route = createFileRoute('/_portal/hc/')({
```

Same pattern for:

- `apps/web/src/routes/_portal/hc/$categorySlug.tsx`: `createFileRoute('/_portal/hc/$categorySlug')`
- `apps/web/src/routes/_portal/hc/$categorySlug/index.tsx`: `createFileRoute('/_portal/hc/$categorySlug/')`
- `apps/web/src/routes/_portal/hc/$categorySlug/$articleSlug.tsx`: `createFileRoute('/_portal/hc/$categorySlug/$articleSlug')`

And update the `getRouteApi` calls:

- In `$categorySlug/index.tsx`: `getRouteApi('/hc')` → `getRouteApi('/_portal/hc')`, `getRouteApi('/hc/$categorySlug')` → `getRouteApi('/_portal/hc/$categorySlug')`
- In `$categorySlug/$articleSlug.tsx`: same substitutions. Also update this check:
  ```ts
  const helpCenterMatch = matches.find((m) => (m.routeId as string) === '/hc')
  ```
  to:
  ```ts
  const helpCenterMatch = matches.find((m) => (m.routeId as string) === '/_portal/hc')
  ```

The loader data contract for `_portal/hc.tsx` no longer exposes `org` — adjust the `head` builder in `$articleSlug.tsx` to pull `workspaceName` from the `_portal` match's loader data instead:

```ts
const portalMatch = matches.find((m) => (m.routeId as string) === '/_portal')
const parentLoaderData = portalMatch?.loaderData as Record<string, any> | undefined
const workspaceName =
  (parentLoaderData?.org as Record<string, string> | undefined)?.name ?? 'Help Center'
```

Same for `baseUrl`:

```ts
const baseUrl = ((portalMatch?.context as Record<string, any> | undefined)?.baseUrl as string) ?? ''
```

- [ ] **Step 4.3: Typecheck**

```bash
bun run typecheck
```

Expected: clean. Fix any remaining `Route.useLoaderData()` mismatches in the child files (e.g. they now can only read `{ categories, helpCenterConfig }` from the `_portal/hc` match, not `org` or `brandingData`).

- [ ] **Step 4.4: Commit**

```bash
git add apps/web/src/routes/_portal/hc apps/web/src/routeTree.gen.ts
git commit -m "refactor: slim help center layout to rely on portal shell"
```

---

## Task 5: Add Help tab and category subnav to `PortalHeader`

**Context:** Portal header gains a new top-level nav entry and a conditional second nav row that renders `HelpCenterCategoryNav`. Categories are read from the `/_portal/hc` match's loader data so they only load when the user is actually on a help center page.

**Files:**

- Modify: `apps/web/src/components/public/portal-header.tsx`

- [ ] **Step 5.1: Add route-context flags and match lookup**

At the top of the `PortalHeader` component, add (after the `const pathname = ...` line):

```tsx
const { settings, helpCenterHost } = useRouteContext({ from: '__root__' })
const helpCenterEnabled =
  !!settings?.featureFlags?.helpCenter && !!settings?.helpCenterConfig?.enabled
const onHelpPages = pathname === '/hc' || pathname.startsWith('/hc/')
```

`useRouteContext` is already imported. `helpCenterHost` is exposed on the root context (verified in `__root.tsx:47-73`); if TypeScript complains, cast: `const ctx = useRouteContext({ from: '__root__' }) as any`.

- [ ] **Step 5.2: Make `NAV_ITEMS` dynamic**

Replace the constant array with a builder:

```tsx
const NAV_ITEMS_BASE = [
  { to: '/', messageId: 'portal.header.nav.feedback', defaultMessage: 'Feedback' },
  { to: '/roadmap', messageId: 'portal.header.nav.roadmap', defaultMessage: 'Roadmap' },
  { to: '/changelog', messageId: 'portal.header.nav.changelog', defaultMessage: 'Changelog' },
] as const

const NAV_ITEM_HELP = {
  to: '/hc',
  messageId: 'portal.header.nav.help',
  defaultMessage: 'Help',
} as const

type NavItem = (typeof NAV_ITEMS_BASE)[number] | typeof NAV_ITEM_HELP

function buildNavItems({
  helpCenterEnabled,
  helpCenterHost,
}: {
  helpCenterEnabled: boolean
  helpCenterHost: boolean
}): readonly NavItem[] {
  // On the help center subdomain, hide the feedback/roadmap/changelog tabs so
  // the standalone experience stays focused. Help tab still shows.
  if (helpCenterHost) {
    return helpCenterEnabled ? [NAV_ITEM_HELP] : []
  }
  if (helpCenterEnabled) {
    return [...NAV_ITEMS_BASE, NAV_ITEM_HELP]
  }
  return NAV_ITEMS_BASE
}
```

Inside the component body, compute:

```tsx
const navItems = buildNavItems({ helpCenterEnabled, helpCenterHost: !!helpCenterHost })
```

In the `Navigation` inner component, replace `NAV_ITEMS.map((item) => {` with `navItems.map((item) => {`. Update the active-state check so `/hc` stays active for any `/hc/*` subpath:

```tsx
const isActive =
  item.to === '/'
    ? pathname === '/' || /^\/[^/]+\/posts\//.test(pathname)
    : item.to === '/hc'
      ? onHelpPages
      : pathname.startsWith(item.to)
```

- [ ] **Step 5.3: Render `HelpCenterCategoryNav` on help pages**

Add an import at the top of `portal-header.tsx`:

```tsx
import { useMatches } from '@tanstack/react-router'
import { HelpCenterCategoryNav } from '@/components/help-center/help-center-category-nav'
```

Inside the component, add a helper that reads categories from the `_portal/hc` match:

```tsx
const matches = useMatches()
const hcMatch = matches.find((m) => (m.routeId as string) === '/_portal/hc')
const hcLoaderData = hcMatch?.loaderData as { categories?: unknown } | undefined
const hcCategories = Array.isArray(hcLoaderData?.categories)
  ? (hcLoaderData!.categories as React.ComponentProps<typeof HelpCenterCategoryNav>['categories'])
  : []
```

In the Row 2 render block (the one that currently only contains `<Navigation />`), append a conditional subnav row:

```tsx
{
  /* Row 2: Navigation */
}
;<div className="mt-2">
  <div className="max-w-6xl mx-auto w-full px-4 sm:px-6">
    <div className="flex items-center">
      <Navigation />
    </div>
    {onHelpPages && hcCategories.length > 0 && (
      <div className="mt-2">
        <HelpCenterCategoryNav categories={hcCategories} />
      </div>
    )}
  </div>
</div>
```

- [ ] **Step 5.4: Typecheck**

```bash
bun run typecheck
```

Expected: clean. If `useRouteContext({ from: '__root__' })` doesn't expose `settings` or `helpCenterHost` in the type, cast narrowly.

- [ ] **Step 5.5: Run existing portal-header tests (if any)**

```bash
bun run test -- apps/web/src/components/public/portal-header
```

Expected: pass. If there's no test file, that's fine for now — we'll cover the new behavior in Task 7.

- [ ] **Step 5.6: Commit**

```bash
git add apps/web/src/components/public/portal-header.tsx
git commit -m "feat: render help tab and category subnav in portal header"
```

---

## Task 6: Update subdomain handling in `_portal.tsx`

**Context:** With `/hc/*` now living under `_portal`, the old `redirect({ to: '/hc' })` no longer makes sense for request routing. Instead, on the help-center subdomain we want root `/` to land on `/hc` so the standalone UX stays the same — and `PortalHeader` (Task 5) already hides the feedback/roadmap/changelog tabs on that host.

**Files:**

- Modify: `apps/web/src/routes/_portal.tsx`

- [ ] **Step 6.1: Rewrite the `beforeLoad`**

Replace the existing `beforeLoad`:

```ts
beforeLoad: ({ context, location }) => {
  // On the dedicated help-center host, the portal's landing page
  // should be the help center itself.
  if (context.helpCenterHost && location.pathname === '/') {
    throw redirect({ to: '/hc' })
  }
},
```

- [ ] **Step 6.2: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 6.3: Commit**

```bash
git add apps/web/src/routes/_portal.tsx
git commit -m "refactor: help center subdomain renders portal layout inline"
```

---

## Task 7: Portal header behavior tests

**Context:** Lock in the new conditional nav logic so regressions don't sneak back.

**Files:**

- Create: `apps/web/src/components/public/__tests__/portal-header-nav.test.tsx`

- [ ] **Step 7.1: Write the failing tests**

Create `apps/web/src/components/public/__tests__/portal-header-nav.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'

// Import the pure builder via a named export so we don't need to spin up the
// full PortalHeader + router harness.
import { buildNavItems } from '../portal-header'

describe('buildNavItems', () => {
  it('returns feedback/roadmap/changelog when help center is disabled', () => {
    const items = buildNavItems({ helpCenterEnabled: false, helpCenterHost: false })
    expect(items.map((i) => i.to)).toEqual(['/', '/roadmap', '/changelog'])
  })

  it('adds Help tab when help center is enabled', () => {
    const items = buildNavItems({ helpCenterEnabled: true, helpCenterHost: false })
    expect(items.map((i) => i.to)).toEqual(['/', '/roadmap', '/changelog', '/hc'])
  })

  it('only shows Help tab on the help center subdomain', () => {
    const items = buildNavItems({ helpCenterEnabled: true, helpCenterHost: true })
    expect(items.map((i) => i.to)).toEqual(['/hc'])
  })

  it('shows no tabs on help center subdomain when help center is disabled', () => {
    const items = buildNavItems({ helpCenterEnabled: false, helpCenterHost: true })
    expect(items).toHaveLength(0)
  })
})
```

- [ ] **Step 7.2: Export `buildNavItems` from `portal-header.tsx`**

Change the declaration in `portal-header.tsx`:

```tsx
export function buildNavItems(...)
```

- [ ] **Step 7.3: Run the test**

```bash
bun run test -- apps/web/src/components/public/__tests__/portal-header-nav.test.tsx
```

Expected: all pass. If any fail, the likely cause is a typo in the `/hc` tab ordering — fix the builder, not the test.

- [ ] **Step 7.4: Commit**

```bash
git add apps/web/src/components/public/__tests__/portal-header-nav.test.tsx \
        apps/web/src/components/public/portal-header.tsx
git commit -m "test: cover portal nav item builder for help tab"
```

---

## Task 8: Delete the old `HelpCenterHeader`

**Context:** Nothing renders `HelpCenterHeader` anymore. Delete the file and any now-unused imports so the codebase doesn't grow two headers.

**Files:**

- Delete: `apps/web/src/components/help-center/help-center-header.tsx`

- [ ] **Step 8.1: Search for lingering references**

```bash

```

Use Grep for pattern `HelpCenterHeader` across `apps/web/src`. Any hit other than the file itself needs to be cleaned up (tests, stories, etc.).

- [ ] **Step 8.2: Delete the file**

```bash
git rm apps/web/src/components/help-center/help-center-header.tsx
```

If there's a corresponding test file at `apps/web/src/components/help-center/__tests__/help-center-header.test.tsx`, delete that too (the search results from Step 8.1 will tell you).

- [ ] **Step 8.3: Typecheck + run the help-center tests**

```bash
bun run typecheck
bun run test -- apps/web/src/components/help-center
```

Expected: clean.

- [ ] **Step 8.4: Commit**

```bash
git add -A apps/web/src/components/help-center
git commit -m "chore: remove unused HelpCenterHeader component"
```

---

## Task 9: Manual smoke test + e2e coverage

**Context:** Even with unit tests green, the real test is rendering in a browser. Walk the happy path on main domain and verify the subdomain-like behavior via a bootstrap override or an e2e host spoof.

**Files:**

- No file changes expected unless a manual run surfaces bugs.

- [ ] **Step 9.1: Start the dev server (if not already running)**

```bash
bun run dev
```

Log in as `demo@example.com` / `password`. In admin settings, confirm the help center is enabled and that at least one category with a published article exists.

- [ ] **Step 9.2: Walk the portal → help flow**

Go through every screen in Chrome:

1. Open `http://localhost:3000/` — confirm the top nav shows Feedback, Roadmap, Changelog, **Help**. The "Help" tab should be inactive.
2. Click "Help" — URL becomes `/hc`, landing page renders, subnav row appears below the top nav with "All" active, portal header (logo + auth avatar) still visible on top.
3. Click a category tab — URL becomes `/hc/:slug`, subnav updates active state, category page renders.
4. Click an article — URL becomes `/hc/:slug/:article`, article page renders with breadcrumbs and TOC.
5. Use the browser back button through the whole flow — no layout jumps; portal header stays mounted.
6. Go to `/roadmap` — Help tab deactivates, subnav row disappears.
7. Disable the help center in admin settings. Refresh the portal — Help tab disappears, `/hc` returns 404.
8. Re-enable the help center.

- [ ] **Step 9.3: Spoof the help center subdomain locally**

The host-detection logic reads from the request host. Either (a) add `127.0.0.1 help.demo.localhost` to `/etc/hosts` and visit `http://help.demo.localhost:3000/` (slug-based), or (b) temporarily set `helpCenterConfig.customDomain` to `localhost` in the DB. Verify:

- Root `/` redirects to `/hc`
- Top nav shows only the Help tab (no Feedback/Roadmap/Changelog)
- Subnav row still renders with categories
- Article pages work end-to-end

Revert any DB/host file changes.

- [ ] **Step 9.4: Run the existing e2e suite**

```bash
bun run test:e2e
```

Expected: suite passes. Any failing tests that reference `HelpCenterHeader`, `/hc` redirect behavior from `_portal`, or portal nav items should be updated minimally to match the new behavior — **don't weaken assertions**; update the expected structure.

- [ ] **Step 9.5: Commit any e2e fixes**

```bash
git add -A
git commit -m "test(e2e): update assertions for inline help center"
```

(Skip if nothing changed.)

---

## Task 10: Verify sitemap still works

**Context:** `apps/web/src/routes/hc/sitemap[.]xml.ts` is the only file left under the old `routes/hc/` path. TanStack Router treats it as a standalone leaf route. We need to confirm it still serves XML and isn't accidentally wrapped in a layout.

**Files:**

- Inspect (no modifications expected): `apps/web/src/routes/hc/sitemap[.]xml.ts`

- [ ] **Step 10.1: Hit the sitemap endpoint**

With the dev server running:

```bash
curl -s -D - http://localhost:3000/hc/sitemap.xml | head -20
```

Expected: HTTP 200, `Content-Type: application/xml`, body starts with `<?xml ...`.

- [ ] **Step 10.2: If the sitemap 404s or returns HTML instead of XML**

The most likely cause is that TanStack Router no longer sees the file because there's no longer a `routes/hc.tsx` layout alongside it. Fix by either:

- Giving it a pathless parent: rename `routes/hc/sitemap[.]xml.ts` → `routes/_hc-sitemap/hc/sitemap[.]xml.ts` (unlikely to be necessary)
- Or move the handler into an API route: `routes/api/hc/sitemap[.]xml.ts` and add a rewrite rule so `/hc/sitemap.xml` proxies to `/api/hc/sitemap.xml`

In practice flat-route resolution handles orphaned server routes fine — only reach for one of the above if the curl check fails.

- [ ] **Step 10.3: Commit any fixes**

```bash
git add -A apps/web/src/routes
git commit -m "fix: restore /hc/sitemap.xml routing after layout move"
```

(Skip if the curl check passed.)

---

## Task 11: Final verification

- [ ] **Step 11.1: Full test + lint + typecheck**

```bash
bun run lint
bun run typecheck
bun run test
```

Expected: clean across all three. Address failures before declaring done.

- [ ] **Step 11.2: Build check**

```bash
bun run build
```

Expected: production build succeeds. TanStack Start SSR for `/hc/*` routes should render without runtime warnings.

- [ ] **Step 11.3: Review the diff**

```bash
git log --oneline main..HEAD
git diff --stat main..HEAD
```

Sanity check: the diff should be confined to `apps/web/src/routes/_portal`, `apps/web/src/routes/hc/sitemap[.]xml.ts` (unchanged), `apps/web/src/components/public/portal-header.tsx`, `apps/web/src/components/help-center/*`, and the generated `routeTree.gen.ts`.

- [ ] **Step 11.4: Done**

The help center now renders inline inside the portal by default whenever `featureFlags.helpCenter` and `helpCenterConfig.enabled` are both on. The standalone help-center subdomain continues to work, rendering the same `/hc/*` routes under a stripped-down portal header.

---

## Risks & open items

1. **TanStack Router ids for moved routes.** This plan assumes TanStack derives route ids from the folder path (`/_portal/hc/$categorySlug`). If the tooling strips `_portal` from route ids (treating it as pathless), then `getRouteApi('/_portal/hc')` won't match — you'd use `getRouteApi('/hc')` instead. Confirm in `routeTree.gen.ts` after Task 3 and adjust Task 4.2 accordingly. This is a one-word fix; don't rewrite anything else.

2. **Sitemap routing.** Task 10 is a guard. If flat-route resolution doesn't keep `routes/hc/sitemap[.]xml.ts` reachable, fall back to the API-route workaround listed there.

3. **Breadcrumb URLs.** `buildCategoryBreadcrumbs` hardcodes `/hc` — that stays valid under the inline mount. If someone renames the URL prefix later, thread the prefix through as a parameter.

4. **Canonical URLs on subdomain.** The article page's `canonical` link is built from `baseUrl` in the `_portal` route context. On the help-center host, `baseUrl` should already be the subdomain host — verify during Task 9.3. If it's the main portal host instead, fix the root context builder so `baseUrl` reflects the incoming host.

5. **No new toggle.** By design, the Help tab follows the existing HC feature flag + config.enabled. If the user later wants a separate "hide inline tab" switch, add `helpCenterConfig.inlineInPortal: boolean` (default true) and gate Task 5's `helpCenterEnabled` on that value.
