# Help Center Article Editor: Full-Page Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the help center article editor from a modal (`HelpCenterArticleModal`) into a dedicated full-page route at `/admin/help-center/articles/:articleId` so long-form writing gets proper vertical space and slash/bubble/table menus don't fight a dialog container.

**Architecture:** Add a new TanStack Start leaf route `admin/help-center.articles.$articleId.tsx` that renders a full-page editor component inside the existing admin shell (admin sidebar stays; no help-center filters sidebar on this route). The editor reuses the existing `HelpCenterFormFields` (TipTap editor) and `HelpCenterMetadataSidebar` (category/status/author) components — they're already decoupled from the modal shell. The finder's `handleEdit` swaps from `navigate({ search: { article: id } })` to `navigate({ to: '/admin/help-center/articles/$articleId' })`. The create flow keeps its dialog but navigates to the new edit page on success so users land straight in long-form mode after picking a category. The old modal component is deleted.

**Tech Stack:** TanStack Start flat file routes, TanStack Query, react-hook-form, TipTap rich text editor, existing admin shell layout at `routes/admin.tsx`.

---

## File Structure

**Create:**

- `apps/web/src/routes/admin/help-center.articles.$articleId.tsx` — leaf route at `/admin/help-center/articles/:articleId`. Loads the article via `helpCenterQueries.articleDetail(id)`, renders the full-page editor.
- `apps/web/src/components/admin/help-center/help-center-article-editor.tsx` — the editor layout: back button + breadcrumbs + title + rich text editor + metadata sidebar on the right. Reuses `HelpCenterFormFields` and `HelpCenterMetadataSidebar` as-is.

**Modify:**

- `apps/web/src/routes/admin/help-center.tsx` — remove `article: z.string().optional()` from the search schema. Stop rendering `<HelpCenterArticleModal>` (it will be deleted).
- `apps/web/src/components/admin/help-center/help-center-list.tsx` — `handleEdit` navigates to the new route instead of setting `?article=`.
- `apps/web/src/components/admin/help-center/create-article-dialog.tsx` — on successful create, navigate to `/admin/help-center/articles/$newId` instead of just closing the dialog.

**Delete:**

- `apps/web/src/components/admin/help-center/help-center-article-modal.tsx` — superseded by the new route.

**Not touched:**

- `apps/web/src/components/admin/help-center/help-center-form-fields.tsx` — already flexible, reused as-is
- `apps/web/src/components/admin/help-center/help-center-metadata-sidebar.tsx` — already exports `HelpCenterMetadataSidebar` + `HelpCenterMetadataSidebarContent`; reused as-is
- `apps/web/src/lib/client/queries/help-center.ts` — `articleDetail(id)` already exists
- `apps/web/src/lib/client/mutations/help-center.ts` — `useUpdateArticle`, `usePublishArticle`, `useUnpublishArticle` already exist
- Service layer, API routes, MCP tools — nothing changes

---

## Preconditions

- [ ] **Step 0.1: Clean baseline**

```bash
cd /home/james/quackback
git status
git log --oneline -3
```

Expected: on `feat/help-center-category-hierarchy` (or a new branch cut from it — user's call). Working tree clean. Recent commit history shows `887b1f65` or later. If the branch is dirty, stash or commit first.

- [ ] **Step 0.2: Baseline tests + typecheck**

```bash
bun run typecheck
bun run test
```

Expected: clean, 1709+ tests pass. If anything fails, STOP and fix before proceeding.

---

## Task 1: Create the `HelpCenterArticleEditor` component

**Context:** The existing modal (`help-center-article-modal.tsx`) has ~200 lines of component logic mixed with dialog chrome. Extract the content of `ArticleModalContent` (the form + TipTap editor + metadata sidebar + save handler) into a standalone component that a page route can render directly without the dialog wrapper. This is mostly a copy-paste-and-rework — the data fetching and form wiring stay identical.

**Files:**

- Create: `apps/web/src/components/admin/help-center/help-center-article-editor.tsx`

- [ ] **Step 1.1: Write the new editor component**

Create `apps/web/src/components/admin/help-center/help-center-article-editor.tsx`:

```tsx
import { useState, useCallback, useEffect } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Loader2 } from 'lucide-react'
import { ArrowLeftIcon, Cog6ToothIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useKeyboardSubmit } from '@/lib/client/hooks/use-keyboard-submit'
import { updateArticleSchema } from '@/lib/shared/schemas/help-center'
import type { TiptapContent } from '@/lib/shared/schemas/posts'
import {
  useUpdateArticle,
  usePublishArticle,
  useUnpublishArticle,
} from '@/lib/client/mutations/help-center'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import { getInitialContentJson } from '@/components/admin/feedback/detail/post-utils'
import { HelpCenterFormFields } from './help-center-form-fields'
import {
  HelpCenterMetadataSidebar,
  HelpCenterMetadataSidebarContent,
} from './help-center-metadata-sidebar'
import type { HelpCenterArticleId } from '@quackback/ids'
import type { JSONContent } from '@tiptap/react'

interface HelpCenterArticleEditorProps {
  articleId: HelpCenterArticleId
}

/**
 * Full-page editor for a help center article.
 *
 * This is the page-mode counterpart to the old `HelpCenterArticleModal`.
 * The TipTap editor gets the full viewport width, which gives bubble menus,
 * slash menus, and table editing enough room to render without clipping.
 */
export function HelpCenterArticleEditor({ articleId }: HelpCenterArticleEditorProps) {
  const navigate = useNavigate()
  const [contentJson, setContentJson] = useState<JSONContent | null>(null)
  const [categoryId, setCategoryId] = useState('')
  const [isPublished, setIsPublished] = useState(false)
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)
  const [hasInitialized, setHasInitialized] = useState(false)

  const updateArticleMutation = useUpdateArticle()
  const publishArticleMutation = usePublishArticle()
  const unpublishArticleMutation = useUnpublishArticle()

  const { data: article, isLoading } = useQuery({
    ...helpCenterQueries.articleDetail(articleId),
  })

  const form = useForm({
    resolver: standardSchemaResolver(updateArticleSchema),
    defaultValues: {
      id: articleId as string,
      title: '',
      content: '',
    },
  })

  useEffect(() => {
    if (article && !hasInitialized) {
      form.setValue('title', article.title)
      form.setValue('content', article.content)
      setContentJson(getInitialContentJson(article))
      setCategoryId(article.categoryId)
      setIsPublished(!!article.publishedAt)
      setHasInitialized(true)
    }
  }, [article, form, hasInitialized])

  const handleContentChange = useCallback(
    (json: JSONContent, _html: string, markdown: string) => {
      setContentJson(json)
      form.setValue('content', markdown, { shouldValidate: true })
    },
    [form]
  )

  const handleCategoryChange = useCallback(
    (id: string) => {
      setCategoryId(id)
      form.setValue('categoryId', id)
    },
    [form]
  )

  const handlePublishToggle = useCallback(() => {
    if (isPublished) {
      unpublishArticleMutation.mutate(articleId, {
        onSuccess: () => setIsPublished(false),
      })
    } else {
      publishArticleMutation.mutate(articleId, {
        onSuccess: () => setIsPublished(true),
      })
    }
  }, [isPublished, articleId, publishArticleMutation, unpublishArticleMutation])

  const handleSubmit = form.handleSubmit((data) => {
    updateArticleMutation.mutate({
      id: articleId,
      title: data.title,
      content: data.content,
      contentJson: contentJson as TiptapContent | null,
      categoryId,
    })
  })

  const handleBack = useCallback(() => {
    // Return to the category the article lives in so the user lands where
    // they came from. If we don't have the article yet (still loading),
    // fall back to the help center root.
    if (article?.categoryId) {
      void navigate({
        to: '/admin/help-center',
        search: { category: article.categoryId },
      })
    } else {
      void navigate({ to: '/admin/help-center' })
    }
  }, [article?.categoryId, navigate])

  const handleKeyDown = useKeyboardSubmit(handleSubmit)

  if (isLoading || !article) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="flex flex-col h-full">
        {/* Top bar: back button + title crumbs + save controls */}
        <div className="border-b border-border/50 px-4 py-3 flex items-center gap-3 shrink-0">
          <Button type="button" variant="ghost" size="sm" onClick={handleBack}>
            <ArrowLeftIcon className="h-4 w-4 mr-1" />
            Back
          </Button>
          <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
            <Link
              to="/admin/help-center"
              className="hover:text-foreground transition-colors truncate"
            >
              Help Center
            </Link>
            <span className="shrink-0">/</span>
            {article.category && (
              <>
                <Link
                  to="/admin/help-center"
                  search={{ category: article.categoryId }}
                  className="hover:text-foreground transition-colors truncate"
                >
                  {article.category.name}
                </Link>
                <span className="shrink-0">/</span>
              </>
            )}
            <span className="text-foreground truncate">{article.title || 'Untitled'}</span>
          </div>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <Sheet open={mobileSettingsOpen} onOpenChange={setMobileSettingsOpen}>
              <SheetTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="lg:hidden">
                  <Cog6ToothIcon className="h-4 w-4 mr-1.5" />
                  Settings
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="h-[70vh]">
                <SheetHeader>
                  <SheetTitle>Article Settings</SheetTitle>
                </SheetHeader>
                <div className="py-4 overflow-y-auto">
                  <HelpCenterMetadataSidebarContent
                    categoryId={categoryId}
                    onCategoryChange={handleCategoryChange}
                    isPublished={isPublished}
                    onPublishToggle={handlePublishToggle}
                    authorName={article.author?.name}
                  />
                </div>
              </SheetContent>
            </Sheet>
            <Button type="submit" size="sm" disabled={updateArticleMutation.isPending}>
              {updateArticleMutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>

        {/* Content + metadata sidebar */}
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto">
            <HelpCenterFormFields
              form={form}
              contentJson={contentJson}
              onContentChange={handleContentChange}
              error={
                updateArticleMutation.isError ? updateArticleMutation.error.message : undefined
              }
            />
          </div>

          <HelpCenterMetadataSidebar
            categoryId={categoryId}
            onCategoryChange={handleCategoryChange}
            isPublished={isPublished}
            onPublishToggle={handlePublishToggle}
            authorName={article.author?.name}
          />
        </div>
      </form>
    </Form>
  )
}
```

- [ ] **Step 1.2: Typecheck**

```bash
bun run typecheck
```

Expected: clean. If it fails because of a type mismatch on `categoryId` in the `search` param of `<Link to="/admin/help-center">`, that's because the existing `help-center.tsx` search schema defines `category: z.string().optional()` — the key is `category`, not `categoryId`. Fix: `search={{ category: article.categoryId }}` is already right (it's the search param name in the route). If TanStack Router type-narrows the search shape and rejects it, cast as `unknown as { category?: string }` or use `search: (prev) => ({ ...prev, category: article.categoryId })`.

- [ ] **Step 1.3: Commit**

```bash
git add apps/web/src/components/admin/help-center/help-center-article-editor.tsx
git commit -m "feat(help-center): add full-page article editor component"
```

---

## Task 2: Create the route file

**Context:** Add a new leaf route that renders `HelpCenterArticleEditor`. TanStack Start flat routes use dots as path separators (see existing `admin/feedback.incoming.tsx` → `/admin/feedback/incoming`), so the file `admin/help-center.articles.$articleId.tsx` maps to `/admin/help-center/articles/:articleId`. No layout route needed — the outer `admin.tsx` already wraps everything in the admin shell.

**Files:**

- Create: `apps/web/src/routes/admin/help-center.articles.$articleId.tsx`

- [ ] **Step 2.1: Write the route file**

Create `apps/web/src/routes/admin/help-center.articles.$articleId.tsx`:

```tsx
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { HelpCenterArticleEditor } from '@/components/admin/help-center/help-center-article-editor'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'
import type { HelpCenterArticleId } from '@quackback/ids'

export const Route = createFileRoute('/admin/help-center/articles/$articleId')({
  component: HelpCenterArticleEditorPage,
})

function HelpCenterArticleEditorPage() {
  const { articleId } = Route.useParams()
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined

  if (!flags?.helpCenter) {
    return <Navigate to="/admin/feedback" />
  }

  return <HelpCenterArticleEditor articleId={articleId as HelpCenterArticleId} />
}
```

- [ ] **Step 2.2: Regenerate the route tree**

```bash
bun run dev > /tmp/dev-article-route.log 2>&1 &
DEV_PID=$!
sleep 10
kill $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null
```

Then verify `apps/web/src/routeTree.gen.ts` mentions the new route:

```bash

```

Use Grep for `help-center/articles/$articleId` inside `apps/web/src/routeTree.gen.ts` and confirm there's a matching entry. If the route tree didn't regenerate (gitignored file, no change detected), restart the dev server and wait longer.

- [ ] **Step 2.3: Typecheck**

```bash
bun run typecheck
```

Expected: clean. If `Route.useRouteContext()` doesn't have `settings`, check how `admin/help-center.tsx` (the existing sibling route) accesses feature flags and copy its pattern.

- [ ] **Step 2.4: Commit**

```bash
git add apps/web/src/routes/admin/help-center.articles.$articleId.tsx
git commit -m "feat(help-center): add full-page article editor route"
```

---

## Task 3: Update the finder's `handleEdit` to navigate to the new route

**Context:** Today the finder's edit action writes `?article=<id>` to the URL and the modal opens. After this task, the edit action navigates to `/admin/help-center/articles/<id>`.

**Files:**

- Modify: `apps/web/src/components/admin/help-center/help-center-list.tsx`

- [ ] **Step 3.1: Read the current `handleEdit`**

Read `apps/web/src/components/admin/help-center/help-center-list.tsx` around the `handleEdit` function (currently near line 45). Current shape:

```ts
const handleEdit = useCallback(
  (id: HelpCenterArticleId) => {
    startTransition(() => {
      void navigate({
        to: '/admin/help-center',
        search: { ...search, article: id },
      })
    })
  },
  [navigate, search]
)
```

- [ ] **Step 3.2: Rewrite `handleEdit`**

Replace the body of `handleEdit` with:

```ts
const handleEdit = useCallback(
  (id: HelpCenterArticleId) => {
    startTransition(() => {
      void navigate({
        to: '/admin/help-center/articles/$articleId',
        params: { articleId: id },
      })
    })
  },
  [navigate]
)
```

Note the dependency array shrinks — `search` is no longer used here. If TypeScript complains that the `to` literal doesn't match the registered route types, check the regenerated `routeTree.gen.ts` for the exact path string (should be `/admin/help-center/articles/$articleId`).

- [ ] **Step 3.3: Typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 3.4: Commit**

```bash
git add apps/web/src/components/admin/help-center/help-center-list.tsx
git commit -m "feat(help-center): navigate to full-page editor on article edit"
```

---

## Task 4: Navigate from `CreateArticleDialog` to the new editor on success

**Context:** The current dialog closes itself on successful create. After this task, it redirects to the new article's edit page so the user can immediately continue writing in the full-page editor.

**Files:**

- Modify: `apps/web/src/components/admin/help-center/create-article-dialog.tsx`

- [ ] **Step 4.1: Add `useNavigate` import**

At the top of `create-article-dialog.tsx`, add:

```ts
import { useNavigate } from '@tanstack/react-router'
```

- [ ] **Step 4.2: Wire navigation into the mutation `onSuccess`**

Find the `handleSubmit` definition inside `CreateArticleDialog` (around line 64). Replace its `onSuccess` handler:

```ts
const navigate = useNavigate()

const handleSubmit = form.handleSubmit((data) => {
  createArticleMutation.mutate(
    {
      categoryId: data.categoryId,
      title: data.title,
      content: data.content,
      contentJson: contentJson as TiptapContent | null,
    },
    {
      onSuccess: (newArticle) => {
        handleOpenChange(false)
        form.reset()
        setContentJson(null)
        setCategoryId('')
        void navigate({
          to: '/admin/help-center/articles/$articleId',
          params: { articleId: newArticle.id },
        })
      },
    }
  )
})
```

Add `const navigate = useNavigate()` near the top of the component body (after the other `useState` calls and `useCreateArticle` hook).

- [ ] **Step 4.3: Verify the mutation returns the new article**

The `useCreateArticle` mutation is defined in `apps/web/src/lib/client/mutations/help-center.ts`. Confirm its `mutationFn` returns an object with an `id` field. Look at the `createArticleFn` server function it wraps — it returns `HelpCenterArticleWithCategory` which has `id`. No changes needed there.

- [ ] **Step 4.4: Typecheck**

```bash
bun run typecheck
```

Expected: clean. If `newArticle.id` is typed as `HelpCenterArticleId` (branded) and the `params.articleId` expects `string`, cast: `{ articleId: newArticle.id as string }`.

- [ ] **Step 4.5: Commit**

```bash
git add apps/web/src/components/admin/help-center/create-article-dialog.tsx
git commit -m "feat(help-center): redirect to full-page editor after creating an article"
```

---

## Task 5: Delete the modal and its URL wiring

**Context:** With the new route live and the create flow navigating to it, the old `HelpCenterArticleModal` component and the `?article=` URL param are dead code. Delete them.

**Files:**

- Delete: `apps/web/src/components/admin/help-center/help-center-article-modal.tsx`
- Modify: `apps/web/src/routes/admin/help-center.tsx` — remove the `article` search param and the modal rendering
- Modify: `apps/web/src/components/admin/help-center/help-center-list.tsx` — the `useDebouncedSearch` already doesn't touch `?article=`, but double-check nothing else references it

- [ ] **Step 5.1: Update the route's search schema**

Open `apps/web/src/routes/admin/help-center.tsx`. Find the `searchSchema`:

```ts
const searchSchema = z.object({
  status: z.enum(['draft', 'published']).optional(),
  category: z.string().optional(),
  article: z.string().optional(), // Article ID for modal view
  search: z.string().optional(),
  deleted: z.boolean().optional(),
})
```

Remove the `article` field:

```ts
const searchSchema = z.object({
  status: z.enum(['draft', 'published']).optional(),
  category: z.string().optional(),
  search: z.string().optional(),
  deleted: z.boolean().optional(),
})
```

- [ ] **Step 5.2: Remove the modal render from `HelpCenterPage`**

In the same file, find the `HelpCenterPage` component and remove the `<HelpCenterArticleModal>` render + its import:

Before:

```tsx
import { HelpCenterList } from '@/components/admin/help-center/help-center-list'
import { HelpCenterArticleModal } from '@/components/admin/help-center/help-center-article-modal'

// ...

function HelpCenterPage() {
  const search = Route.useSearch()
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.helpCenter) {
    return <Navigate to="/admin/feedback" />
  }

  return (
    <main className="h-full">
      <HelpCenterList />
      <HelpCenterArticleModal articleId={search.article} />
    </main>
  )
}
```

After:

```tsx
import { HelpCenterList } from '@/components/admin/help-center/help-center-list'

// ...

function HelpCenterPage() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.helpCenter) {
    return <Navigate to="/admin/feedback" />
  }

  return (
    <main className="h-full">
      <HelpCenterList />
    </main>
  )
}
```

Note the `const search = Route.useSearch()` line is removed since nothing else in this component used it.

- [ ] **Step 5.3: Delete the modal file**

```bash
git rm apps/web/src/components/admin/help-center/help-center-article-modal.tsx
```

- [ ] **Step 5.4: Grep for lingering imports**

```bash

```

Use Grep for `HelpCenterArticleModal` across `apps/web/src`. Only the now-deleted file and the just-edited `help-center.tsx` should have referenced it. If anything else still imports it, fix that file.

- [ ] **Step 5.5: Grep for `?article=` / `search.article` references**

```bash

```

Use Grep for `search.article` and `search: { ...search, article:` inside `apps/web/src`. Expected: no matches after this task. If the finder's `help-center-list.tsx` still reads `search` for the `handleEdit`, that should have been cleaned up in Task 3 — fix if not.

Also check `apps/web/src/routeTree.gen.ts` — it'll regenerate on next dev server start, but confirm the old route schema didn't leave stray references that break typecheck.

- [ ] **Step 5.6: Regenerate the route tree**

```bash
bun run dev > /tmp/dev-cleanup.log 2>&1 &
DEV_PID=$!
sleep 10
kill $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null
```

- [ ] **Step 5.7: Typecheck**

```bash
bun run typecheck
```

Expected: clean. The most likely breakage is a lingering reference in `help-center-list.tsx` where `handleEdit` used `{ ...search, article: id }` — should have been replaced in Task 3. If TypeScript complains about `search.article` anywhere, follow the error and delete the dead branch.

- [ ] **Step 5.8: Run tests**

```bash
bun run test
```

Expected: pass. No existing test references `HelpCenterArticleModal` (no React DOM tests for it).

- [ ] **Step 5.9: Commit**

```bash
git add apps/web/src/routes/admin/help-center.tsx apps/web/src/components/admin/help-center/help-center-list.tsx
git commit -m "refactor(help-center): remove old article modal and ?article URL param"
```

---

## Task 6: Final verification

- [ ] **Step 6.1: Full lint + typecheck + tests + build**

```bash
bun run lint 2>&1 | tail -15
bun run typecheck
bun run test
bun run build
```

Expected: everything passes. Pre-existing lint warnings are acceptable; no new errors.

- [ ] **Step 6.2: Manual smoke test**

This step can't be automated — rely on user confirmation. Start `bun run dev`, log in, and verify:

1. `/admin/help-center` — list + finder load as before
2. Click an article's edit action in the finder → URL becomes `/admin/help-center/articles/<id>`, full-page editor renders inside the admin shell (admin sidebar visible, no help center filter sidebar, title + TipTap editor take full width)
3. Edit the title and content, click "Save changes" → mutation fires, stays on the page (no close-and-redirect)
4. Click "Back" → returns to `/admin/help-center?category=<article's categoryId>` and the finder highlights/shows that category
5. Click "Publish" in the metadata sidebar → article flips to Published
6. From the finder, click "+ New article" → dialog opens → fill in category + title + a line of content → Save → dialog closes, URL becomes `/admin/help-center/articles/<newId>`, editor loads the new draft
7. `/admin/help-center?article=someid` (old URL format) — should no longer open a modal (search schema doesn't accept it). TanStack Router either drops the unknown param or redirects to the cleaned-up URL; either behavior is acceptable

- [ ] **Step 6.3: Review the branch diff**

```bash
git log --oneline main..HEAD | head -10
git diff --stat main..HEAD
```

Sanity check — the diff from main should include only:

- New: `routes/admin/help-center.articles.$articleId.tsx`, `components/admin/help-center/help-center-article-editor.tsx`, this plan doc
- Modified: `routes/admin/help-center.tsx`, `components/admin/help-center/help-center-list.tsx`, `components/admin/help-center/create-article-dialog.tsx`
- Deleted: `components/admin/help-center/help-center-article-modal.tsx`
- Regenerated: `routeTree.gen.ts` (gitignored — not in the diff)

No changes to the service layer, API routes, MCP tools, or unrelated admin pages.

- [ ] **Step 6.4: Done**

The article editor is now a full-page route. Long-form writing in TipTap gets the full viewport width, slash/bubble/table menus have room to render, the edit URL is shareable/bookmarkable, and the browser back button preserves the list context. The old modal is gone.

---

## Risks & open items

1. **TanStack Router `params` type narrowing.** The generated route tree types may require a specific string literal for `to: '/admin/help-center/articles/$articleId'`. If the literal doesn't match the generated name (e.g. TanStack uses `/articles/:articleId` instead of `$articleId` in the type), read `routeTree.gen.ts` to find the exact registered path and substitute in Tasks 3 and 4. This is a trivial fix and only shows up as a TypeScript error.

2. **Old `?article=` bookmarks.** Users who bookmarked the modal URL will see the param dropped. Acceptable — no migration needed, but note it in the release announcement if one goes out.

3. **Mutation cache invalidation on save.** `useUpdateArticle` already invalidates `helpCenterKeys.articles()` via its existing `onSuccess`. The finder's article list will refetch automatically when the user navigates back. No extra invalidation needed.

4. **Draft autosave.** Not in scope. The current flow is "explicit Save button". If the user wants real-time autosave later, add a debounced mutation trigger inside `HelpCenterArticleEditor` — but don't do it now.

5. **Breadcrumb click navigation.** The top bar uses `<Link>` for the Help Center + category crumbs. If TanStack Router complains about the `search: { category: article.categoryId }` shape (e.g. because `category` isn't a defined key in the type), read the `help-center.tsx` search schema and confirm `category` is a `z.string().optional()` — it is — then cast as needed.

6. **Mobile layout.** The metadata sidebar hides at narrow widths and becomes a bottom sheet (existing `<Sheet>` pattern). The top bar's breadcrumbs may get cramped on small screens — the `min-w-0 truncate` classes should handle the overflow, but verify on a narrow viewport in the smoke test.

7. **No tests.** This plan intentionally adds no new unit tests. There are no React DOM tests for admin components in this repo (the pattern is "rely on typecheck + manual verification"). If you decide to add Playwright e2e coverage for the editor, that's a separate follow-up.
