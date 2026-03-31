# Rich Editor for Posts & Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring full TipTap rich editor parity (images, tables, YouTube embeds) to admin feedback posts and the widget submission form, with three project-level opt-out settings.

**Architecture:** Settings flags live inside existing `portalConfig` and `widgetConfig` JSON text columns — no DB migration needed. Two new server upload functions handle auth-gated presigned S3 URLs (admin-level for posts via the generic presigned URL flow, widget Bearer token for the widget). The widget submission form replaces its plain textarea with the existing `RichTextEditor`. Widget comments remain plain text.

**Tech Stack:** TipTap (`RichTextEditor` already exists at `components/ui/rich-text-editor.tsx`), TanStack Start server functions, S3 presigned URLs, `useImageUpload` hook, TanStack Query, React/TypeScript.

---

## File Map

**Modify (no new files needed except one test file):**

- `apps/web/src/lib/server/domains/settings/settings.types.ts` — add three new flags to types
- `apps/web/src/lib/server/domains/settings/settings.widget.ts` — expose `imageUploadsInWidget` in public config
- `apps/web/src/lib/server/functions/uploads.ts` — add `getWidgetImageUploadUrlFn`
- `apps/web/src/lib/client/hooks/use-image-upload.ts` — add `useWidgetImageUpload`
- `apps/web/src/components/admin/feedback/post-form-fields.tsx` — add `richMediaEnabled`/`videoEmbedsEnabled` props + image upload
- `apps/web/src/components/admin/feedback/create-post-dialog.tsx` — fetch portal config; enable full editor
- `apps/web/src/components/admin/feedback/edit-post-dialog.tsx` — fetch portal config; pass richMedia props
- `apps/web/src/components/widget/widget-home.tsx` — replace textarea with `RichTextEditor`; add image upload
- `apps/web/src/routes/widget/index.tsx` — thread `imageUploadsInWidget` from loader to `WidgetHome`
- `apps/web/src/routes/admin/settings.permissions.tsx` — add "Content" card
- `apps/web/src/routes/admin/settings.widget.tsx` — add image uploads toggle

**Create:**

- `apps/web/src/lib/server/functions/__tests__/uploads.test.ts`

---

## Task 1: Add settings type flags

**Files:**

- Modify: `apps/web/src/lib/server/domains/settings/settings.types.ts`

- [ ] **Step 1: Add `richMediaInPosts` and `videoEmbedsInPosts` to `PortalFeatures`**

In the `PortalFeatures` interface (around line 83, after `showPublicEditHistory`), add:

```ts
/** Whether rich media (images, tables, embeds) is enabled in the admin post editor */
richMediaInPosts?: boolean
/** Whether YouTube/video embeds are enabled in the admin post editor (only applies when richMediaInPosts is true) */
videoEmbedsInPosts?: boolean
```

- [ ] **Step 2: Add `imageUploadsInWidget` to `WidgetConfig`, `PublicWidgetConfig`, and `UpdateWidgetConfigInput`**

In `WidgetConfig` (after the `tabs` field, around line 239):

```ts
/** Whether authenticated widget users can upload images in feedback submissions */
imageUploadsInWidget?: boolean
```

Replace the `PublicWidgetConfig` type with:

```ts
export type PublicWidgetConfig = Pick<
  WidgetConfig,
  'enabled' | 'defaultBoard' | 'position' | 'tabs' | 'imageUploadsInWidget'
> & {
  hmacRequired?: boolean
}
```

In `UpdateWidgetConfigInput` (after `tabs`, around line 275):

```ts
imageUploadsInWidget?: boolean
```

- [ ] **Step 3: Run typecheck**

```bash
cd /home/james/quackback && bun run typecheck
```

Expected: passes — all new fields are optional, no existing callsites break.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/server/domains/settings/settings.types.ts
git commit -m "feat(settings): add richMediaInPosts, videoEmbedsInPosts, imageUploadsInWidget type flags"
```

---

## Task 2: Expose `imageUploadsInWidget` in public widget config

**Files:**

- Modify: `apps/web/src/lib/server/domains/settings/settings.widget.ts`

- [ ] **Step 1: Add `imageUploadsInWidget` to the `getPublicWidgetConfig()` return value**

In `settings.widget.ts`, update the return object inside `getPublicWidgetConfig()`:

```ts
return {
  enabled: config.enabled,
  defaultBoard: config.defaultBoard,
  position: config.position,
  tabs: config.tabs,
  hmacRequired: config.identifyVerification ?? false,
  imageUploadsInWidget: config.imageUploadsInWidget ?? true,
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /home/james/quackback && bun run typecheck
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/server/domains/settings/settings.widget.ts
git commit -m "feat(settings): expose imageUploadsInWidget in public widget config"
```

---

## Task 3: Add `getWidgetImageUploadUrlFn` (TDD)

**Files:**

- Modify: `apps/web/src/lib/server/functions/uploads.ts`
- Create: `apps/web/src/lib/server/functions/__tests__/uploads.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/server/functions/__tests__/uploads.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../storage/s3', () => ({
  isS3Configured: vi.fn(() => true),
  generatePresignedUploadUrl: vi.fn(async (key: string, _contentType: string) => ({
    uploadUrl: `https://s3.example.com/${key}?presigned`,
    publicUrl: `https://cdn.example.com/${key}`,
    key,
  })),
  generateStorageKey: vi.fn((prefix: string, filename: string) => `${prefix}/${filename}`),
  isAllowedImageType: vi.fn((type: string) =>
    ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(type)
  ),
  MAX_FILE_SIZE: 10 * 1024 * 1024,
}))

vi.mock('../widget-auth', () => ({
  getWidgetSession: vi.fn(),
}))

import { getWidgetSession } from '../widget-auth'
import { getWidgetImageUploadUrlFn } from '../uploads'

const mockSession = {
  settings: { id: 'ws_1' as any, slug: 'test', name: 'Test' },
  user: { id: 'usr_1' as any, email: 'a@b.com', name: 'A', image: null },
  principal: { id: 'pri_1' as any, role: 'user' as const, type: 'user' },
}

describe('getWidgetImageUploadUrlFn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects when no widget session exists', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(null)
    await expect(
      getWidgetImageUploadUrlFn({
        data: { filename: 'test.jpg', contentType: 'image/jpeg', fileSize: 1000 },
      })
    ).rejects.toThrow('Authentication required')
  })

  it('rejects non-image content types', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(mockSession)
    await expect(
      getWidgetImageUploadUrlFn({
        data: { filename: 'video.mp4', contentType: 'video/mp4', fileSize: 1000 },
      })
    ).rejects.toThrow('Invalid image type')
  })

  it('returns presigned URL with widget-images prefix for authenticated user', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(mockSession)
    const result = await getWidgetImageUploadUrlFn({
      data: { filename: 'screenshot.png', contentType: 'image/png', fileSize: 5000 },
    })
    expect(result.uploadUrl).toContain('widget-images/screenshot.png')
    expect(result.publicUrl).toContain('widget-images/screenshot.png')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/james/quackback && bun run test apps/web/src/lib/server/functions/__tests__/uploads.test.ts
```

Expected: FAIL — `getWidgetImageUploadUrlFn` not yet exported.

- [ ] **Step 3: Add `getWidgetImageUploadUrlFn` to `uploads.ts`**

Add this import at the top of `uploads.ts` (alongside the existing `requireAuth` import):

```ts
import { getWidgetSession } from './widget-auth'
```

Add the function after `getChangelogImageUploadUrlFn`:

```ts
/**
 * Get a presigned URL for widget feedback submission images.
 * Requires an active widget Bearer token session — anonymous users are blocked server-side.
 */
export const getWidgetImageUploadUrlFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      filename: z.string().min(1).max(255),
      contentType: z.string().min(1).max(100),
      fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
    })
  )
  .handler(async ({ data }) => {
    console.log(
      `[fn:uploads] getWidgetImageUploadUrlFn: contentType=${data.contentType}, fileSize=${data.fileSize}`
    )
    try {
      const session = await getWidgetSession()
      if (!session) {
        throw new Error('Authentication required to upload images.')
      }

      if (!isS3Configured()) {
        throw new Error('File storage is not configured. Contact your administrator.')
      }

      if (!isAllowedImageType(data.contentType)) {
        throw new Error(
          `Invalid image type: ${data.contentType}. Allowed types: JPEG, PNG, GIF, WebP.`
        )
      }

      const key = generateStorageKey('widget-images', data.filename)
      return await generatePresignedUploadUrl(key, data.contentType)
    } catch (error) {
      console.error(`[fn:uploads] getWidgetImageUploadUrlFn failed:`, error)
      throw error
    }
  })
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /home/james/quackback && bun run test apps/web/src/lib/server/functions/__tests__/uploads.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Run typecheck**

```bash
cd /home/james/quackback && bun run typecheck
```

Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/functions/uploads.ts apps/web/src/lib/server/functions/__tests__/uploads.test.ts
git commit -m "feat(uploads): add getWidgetImageUploadUrlFn with widget Bearer token auth"
```

---

## Task 4: Add `useWidgetImageUpload` hook

**Files:**

- Modify: `apps/web/src/lib/client/hooks/use-image-upload.ts`

- [ ] **Step 1: Add the import and hook**

At the top of `use-image-upload.ts`, update the imports to include `getWidgetImageUploadUrlFn`:

```ts
import { getPresignedUploadUrlFn, getWidgetImageUploadUrlFn } from '@/lib/server/functions/uploads'
```

Add this import after the existing imports (it's a client-side module, safe to import here):

```ts
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
```

Add at the bottom of the file, after `useChangelogImageUpload`:

```ts
/**
 * Hook for uploading images from within the widget iframe.
 * Passes widget Bearer token auth headers so the server can authenticate the upload.
 * Only works for identified (signed-in) widget users — pass this hook's `upload` function
 * to RichTextEditor only when `isIdentified` is true.
 */
export function useWidgetImageUpload(options: Omit<UseImageUploadOptions, 'prefix'> = {}) {
  const { onStart, onSuccess, onError } = options

  const upload = async (file: File): Promise<string> => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      const error = new Error(
        `Invalid file type: ${file.type}. Allowed types: JPEG, PNG, GIF, WebP.`
      )
      onError?.(error)
      throw error
    }

    if (file.size > MAX_FILE_SIZE) {
      const error = new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`)
      onError?.(error)
      throw error
    }

    onStart?.()

    try {
      const { uploadUrl, publicUrl } = await getWidgetImageUploadUrlFn({
        data: {
          filename: file.name,
          contentType: file.type,
          fileSize: file.size,
        },
        headers: getWidgetAuthHeaders(),
      })

      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      })

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.statusText}`)
      }

      onSuccess?.(publicUrl)
      return publicUrl
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Upload failed')
      onError?.(error)
      throw error
    }
  }

  return { upload }
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /home/james/quackback && bun run typecheck
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/client/hooks/use-image-upload.ts
git commit -m "feat(widget): add useWidgetImageUpload hook with Bearer token auth"
```

---

## Task 5: Update `PostFormFields` to support rich media

**Files:**

- Modify: `apps/web/src/components/admin/feedback/post-form-fields.tsx`

- [ ] **Step 1: Add `richMediaEnabled`/`videoEmbedsEnabled` props and wire image upload**

Replace the contents of `post-form-fields.tsx` with:

```tsx
import { Controller, type UseFormReturn } from 'react-hook-form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { FormError } from '@/components/shared/form-error'
import { TitleInput } from '@/components/shared/title-input'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
import type { JSONContent } from '@tiptap/react'
import type { Board, Tag, PostStatusEntity } from '@/lib/shared/db-types'

interface PostFormFieldsProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>
  boards: Board[]
  statuses: PostStatusEntity[]
  tags: Tag[]
  contentJson: JSONContent | null
  onContentChange: (json: JSONContent, html: string, markdown: string) => void
  error?: string
  richMediaEnabled?: boolean
  videoEmbedsEnabled?: boolean
}

export function PostFormFields({
  form,
  boards,
  statuses,
  tags,
  contentJson,
  onContentChange,
  error,
  richMediaEnabled = true,
  videoEmbedsEnabled = true,
}: PostFormFieldsProps) {
  const selectedBoard = boards.find((b) => b.id === form.watch('boardId'))
  const selectedStatus = statuses.find((s) => s.id === form.watch('statusId'))
  const { upload: uploadImage } = useImageUpload({ prefix: 'post-images' })

  return (
    <>
      {/* Header row with board and status selectors */}
      <div className="flex items-center gap-4 pt-3 px-4 sm:px-6">
        <FormField
          control={form.control}
          name="boardId"
          render={({ field }) => (
            <FormItem className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Board:</span>
              <Select onValueChange={field.onChange} value={field.value as string}>
                <FormControl>
                  <SelectTrigger
                    size="xs"
                    className="border-0 bg-transparent shadow-none font-medium text-foreground hover:text-foreground/80 focus-visible:ring-0"
                  >
                    <SelectValue placeholder="Select board">
                      {selectedBoard?.name || 'Select board'}
                    </SelectValue>
                  </SelectTrigger>
                </FormControl>
                <SelectContent align="start">
                  {boards.map((board) => (
                    <SelectItem key={board.id} value={board.id} className="text-xs py-1">
                      {board.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="statusId"
          render={({ field }) => (
            <FormItem className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Status:</span>
              <Select onValueChange={field.onChange} value={field.value as string | undefined}>
                <FormControl>
                  <SelectTrigger
                    size="xs"
                    className="border-0 bg-transparent shadow-none font-medium text-foreground hover:text-foreground/80 focus-visible:ring-0"
                  >
                    <SelectValue>
                      {selectedStatus && (
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: selectedStatus.color }}
                          />
                          {selectedStatus.name}
                        </div>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                </FormControl>
                <SelectContent align="start">
                  {statuses.map((status) => (
                    <SelectItem key={status.id} value={status.id} className="text-xs py-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: status.color }}
                        />
                        {status.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="px-4 sm:px-6 py-4 space-y-2">
        {error && <FormError message={error} className="px-3 py-2 mb-4" />}

        <TitleInput control={form.control} placeholder="What's the feedback about?" autoFocus />

        <FormField
          control={form.control}
          name="content"
          render={() => (
            <FormItem>
              <FormControl>
                <RichTextEditor
                  value={contentJson || ''}
                  onChange={onContentChange}
                  placeholder="Add more details..."
                  minHeight="200px"
                  borderless
                  features={{
                    headings: true,
                    codeBlocks: true,
                    taskLists: true,
                    blockquotes: true,
                    dividers: true,
                    images: richMediaEnabled,
                    tables: richMediaEnabled,
                    embeds: richMediaEnabled && videoEmbedsEnabled,
                    bubbleMenu: true,
                    slashMenu: true,
                  }}
                  onImageUpload={richMediaEnabled ? uploadImage : undefined}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Tags */}
        {tags.length > 0 && (
          <Controller
            control={form.control}
            name="tagIds"
            render={({ field }) => {
              const selectedIds = (field.value ?? []) as string[]
              return (
                <div className="flex flex-wrap gap-2 pt-2">
                  {tags.map((tag) => {
                    const isSelected = selectedIds.includes(tag.id)
                    return (
                      <Badge
                        key={tag.id}
                        variant="secondary"
                        className={`cursor-pointer text-xs font-normal transition-colors ${
                          isSelected
                            ? 'bg-foreground text-background hover:bg-foreground/90'
                            : 'hover:bg-muted/80'
                        }`}
                        onClick={() => {
                          if (isSelected) {
                            field.onChange(selectedIds.filter((id) => id !== tag.id))
                          } else {
                            field.onChange([...selectedIds, tag.id])
                          }
                        }}
                      >
                        {tag.name}
                      </Badge>
                    )
                  })}
                </div>
              )
            }}
          />
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /home/james/quackback && bun run typecheck
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/admin/feedback/post-form-fields.tsx
git commit -m "feat(posts): enable rich media in PostFormFields — images, tables, embeds via settings flags"
```

---

## Task 6: Update `EditPostDialog` to pass richMedia props

**Files:**

- Modify: `apps/web/src/components/admin/feedback/edit-post-dialog.tsx`

- [ ] **Step 1: Add portal config query and pass props to `PostFormFields`**

Add these imports to `edit-post-dialog.tsx`:

```ts
import { useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/client/queries/settings'
```

Inside `EditPostDialog`, add the query before the form setup:

```ts
const portalConfigQuery = useSuspenseQuery(settingsQueries.portalConfig())
const richMediaEnabled = portalConfigQuery.data.features?.richMediaInPosts ?? true
const videoEmbedsEnabled = portalConfigQuery.data.features?.videoEmbedsInPosts ?? true
```

Find the `<PostFormFields ... />` call and add the two props:

```tsx
<PostFormFields
  form={form}
  boards={boards}
  statuses={statuses}
  tags={tags}
  contentJson={contentJson}
  onContentChange={handleContentChange}
  error={error}
  richMediaEnabled={richMediaEnabled}
  videoEmbedsEnabled={videoEmbedsEnabled}
/>
```

- [ ] **Step 2: Run typecheck**

```bash
cd /home/james/quackback && bun run typecheck
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/admin/feedback/edit-post-dialog.tsx
git commit -m "feat(posts): thread richMedia settings flags into EditPostDialog"
```

---

## Task 7: Update `CreatePostDialog` to enable full rich editor

**Files:**

- Modify: `apps/web/src/components/admin/feedback/create-post-dialog.tsx`

- [ ] **Step 1: Add portal config query and enable full editor features**

Add these imports:

```ts
import { useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/client/queries/settings'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
```

Inside `CreatePostDialog`, add before the form setup:

```ts
const portalConfigQuery = useSuspenseQuery(settingsQueries.portalConfig())
const richMediaEnabled = portalConfigQuery.data.features?.richMediaInPosts ?? true
const videoEmbedsEnabled = portalConfigQuery.data.features?.videoEmbedsInPosts ?? true
const { upload: uploadImage } = useImageUpload({ prefix: 'post-images' })
```

Find the `<RichTextEditor ... />` block (around line 189) and replace the `features` prop:

```tsx
<RichTextEditor
  value={contentJson || ''}
  onChange={handleContentChange}
  placeholder="Add more details..."
  minHeight="200px"
  borderless
  features={{
    headings: true,
    codeBlocks: true,
    taskLists: true,
    blockquotes: true,
    dividers: true,
    images: richMediaEnabled,
    tables: richMediaEnabled,
    embeds: richMediaEnabled && videoEmbedsEnabled,
    bubbleMenu: true,
    slashMenu: true,
  }}
  onImageUpload={richMediaEnabled ? uploadImage : undefined}
/>
```

- [ ] **Step 2: Run typecheck**

```bash
cd /home/james/quackback && bun run typecheck
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/admin/feedback/create-post-dialog.tsx
git commit -m "feat(posts): enable full rich editor in CreatePostDialog"
```

---

## Task 8: Replace widget submission textarea with `RichTextEditor`

**Files:**

- Modify: `apps/web/src/components/widget/widget-home.tsx`

- [ ] **Step 1: Add imports**

Add to the imports in `widget-home.tsx`:

```ts
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { useWidgetImageUpload } from '@/lib/client/hooks/use-image-upload'
import type { JSONContent } from '@tiptap/react'
```

- [ ] **Step 2: Add `imageUploadsInWidget` to `WidgetHomeProps`**

In the `WidgetHomeProps` interface, add:

```ts
imageUploadsInWidget?: boolean
```

And in the function signature default parameters:

```ts
export function WidgetHome({
  ...existing props...,
  imageUploadsInWidget = true,
}: WidgetHomeProps) {
```

- [ ] **Step 3: Replace `content` state with `contentJson` + `contentHtml`**

Replace the existing:

```ts
const [content, setContent] = useState('')
```

With:

```ts
const [contentJson, setContentJson] = useState<JSONContent | null>(null)
const [contentHtml, setContentHtml] = useState('')
```

- [ ] **Step 4: Update `collapseForm` to reset the new state**

In `collapseForm()`, replace `setContent('')` with:

```ts
setContentJson(null)
setContentHtml('')
```

- [ ] **Step 5: Update `handleSubmit` to use new state and pass `contentJson`**

In `handleSubmit`, replace `content: content.trim()` with:

```ts
content: contentHtml.trim(),
contentJson: contentJson ?? undefined,
```

- [ ] **Step 6: Add image upload hook**

Inside `WidgetHome`, add the upload hook after the `useWidgetAuth` destructure:

```ts
const { upload: uploadImage } = useWidgetImageUpload()
const canUploadImages = isIdentified && imageUploadsInWidget
```

- [ ] **Step 7: Replace the `<textarea>` with `RichTextEditor`**

Find the `<textarea>` element (around line 546):

```tsx
<textarea
  placeholder="Add more details..."
  value={content}
  onChange={(e) => setContent(e.target.value)}
  maxLength={10000}
  rows={3}
  className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 border-0 outline-none caret-primary resize-none leading-relaxed"
/>
```

Replace with:

```tsx
<RichTextEditor
  value={contentJson || ''}
  onChange={(json, html) => {
    setContentJson(json)
    setContentHtml(html)
  }}
  placeholder="Add more details..."
  minHeight="80px"
  borderless
  features={{
    headings: true,
    codeBlocks: true,
    taskLists: true,
    blockquotes: true,
    dividers: true,
    tables: true,
    images: canUploadImages,
    embeds: true,
    bubbleMenu: true,
    slashMenu: true,
  }}
  onImageUpload={canUploadImages ? uploadImage : undefined}
  className="text-sm"
/>
```

- [ ] **Step 8: Run typecheck**

```bash
cd /home/james/quackback && bun run typecheck
```

Expected: passes.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/widget/widget-home.tsx
git commit -m "feat(widget): replace feedback textarea with full RichTextEditor"
```

---

## Task 9: Thread `imageUploadsInWidget` from widget route loader

**Files:**

- Modify: `apps/web/src/routes/widget/index.tsx`

- [ ] **Step 1: Add `imageUploadsInWidget` to loader return value**

In the loader function (around line 65, alongside the `features` and `tabs` blocks), add a new field:

```ts
imageUploadsInWidget: settings?.publicWidgetConfig?.imageUploadsInWidget ?? true,
```

The full loader return object should include this alongside `features`, `tabs`, `boards`, etc.

- [ ] **Step 2: Destructure in `WidgetPage` and pass to `WidgetHome`**

In the `WidgetPage` component, update the destructure:

```ts
const { posts, postsHasMore, statuses, boards, orgSlug, features, tabs, imageUploadsInWidget } =
  Route.useLoaderData()
```

Then pass it to `WidgetHome` (around line 231):

```tsx
<WidgetHome
  initialPosts={allPosts}
  initialHasMore={postsHasMore}
  statuses={statuses}
  boards={boards}
  onPostSelect={handlePostSelect}
  onPostCreated={handlePostCreated}
  anonymousVotingEnabled={features.anonymousVoting}
  anonymousPostingEnabled={features.anonymousPosting}
  imageUploadsInWidget={imageUploadsInWidget}
/>
```

- [ ] **Step 3: Run typecheck**

```bash
cd /home/james/quackback && bun run typecheck
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/widget/index.tsx
git commit -m "feat(widget): thread imageUploadsInWidget from loader into WidgetHome"
```

---

## Task 10: Add "Content" settings card to permissions page

**Files:**

- Modify: `apps/web/src/routes/admin/settings.permissions.tsx`

- [ ] **Step 1: Add state and update handler for the two new toggles**

In `PermissionsPage`, add state for the new flags after the existing state declarations:

```ts
const [richMediaInPosts, setRichMediaInPosts] = useState(features?.richMediaInPosts ?? true)
const [videoEmbedsInPosts, setVideoEmbedsInPosts] = useState(features?.videoEmbedsInPosts ?? true)
```

- [ ] **Step 2: Add a new "Content" `SettingsCard` after the existing "Anonymous Access" card**

```tsx
<SettingsCard
  title="Content"
  description="Control what rich content types are available when creating and editing posts."
>
  <div className="divide-y divide-border/50">
    <PermissionToggle
      id="rich-media-in-posts"
      label="Rich Media in Posts"
      description="Allow images, tables, and embedded videos when writing feedback posts."
      checked={richMediaInPosts}
      onCheckedChange={(checked) => {
        setRichMediaInPosts(checked)
        updateFeature('richMediaInPosts', checked, () => setRichMediaInPosts(!checked))
      }}
      disabled={isPending}
    />
    <PermissionToggle
      id="video-embeds-in-posts"
      label="Video Embeds in Posts"
      description="Allow YouTube and other video embeds inside post content. Only applies when rich media is enabled."
      checked={videoEmbedsInPosts}
      onCheckedChange={(checked) => {
        setVideoEmbedsInPosts(checked)
        updateFeature('videoEmbedsInPosts', checked, () => setVideoEmbedsInPosts(!checked))
      }}
      disabled={isPending || !richMediaInPosts}
    />
  </div>
</SettingsCard>
```

- [ ] **Step 3: Run typecheck**

```bash
cd /home/james/quackback && bun run typecheck
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/admin/settings.permissions.tsx
git commit -m "feat(settings): add Content card to permissions page for rich media toggles"
```

---

## Task 11: Add image uploads toggle to widget settings

**Files:**

- Modify: `apps/web/src/routes/admin/settings.widget.tsx`

The widget settings page renders sub-components. `WidgetAppearanceControls` (which accepts `config`) is the right place for content-related toggles. Add a new self-contained sub-component `WidgetContentSettings` following the same pattern as the existing HMAC toggle component.

- [ ] **Step 1: Add `WidgetContentSettings` component**

Add this new component inside `settings.widget.tsx` before the `WidgetSettingsPage` function:

```tsx
function WidgetContentSettings({ config }: { config: { imageUploadsInWidget?: boolean } }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [imageUploads, setImageUploads] = useState(config.imageUploadsInWidget ?? true)
  const [, startTransition] = useTransition()

  async function handleImageUploadsToggle(checked: boolean) {
    setImageUploads(checked)
    setSaving(true)
    try {
      await updateWidgetConfigFn({ data: { imageUploadsInWidget: checked } })
      startTransition(() => router.invalidate())
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCard
      title="Content"
      description="Control what rich content types users can include in their feedback submissions."
    >
      <div className="flex items-center justify-between py-2">
        <div className="pr-4">
          <Label htmlFor="image-uploads-in-widget" className="text-sm font-medium cursor-pointer">
            Image Uploads
          </Label>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Allow signed-in users to attach images when submitting feedback through the widget.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <InlineSpinner visible={saving} />
          <Switch
            id="image-uploads-in-widget"
            checked={imageUploads}
            onCheckedChange={handleImageUploadsToggle}
            disabled={saving}
          />
        </div>
      </div>
    </SettingsCard>
  )
}
```

- [ ] **Step 2: Render `WidgetContentSettings` in `WidgetSettingsPage`**

In `WidgetSettingsPage`, after the `BrandingLayout` closing tag (after the appearance + preview section), add:

```tsx
<WidgetContentSettings config={config} />
```

- [ ] **Step 3: Run typecheck**

```bash
cd /home/james/quackback && bun run typecheck
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/admin/settings.widget.tsx
git commit -m "feat(settings): add image uploads toggle to widget settings"
```

---

## Task 12: Full test run and smoke test

- [ ] **Step 1: Run all tests**

```bash
cd /home/james/quackback && bun run test
```

Expected: all tests pass including the new uploads tests.

- [ ] **Step 2: Run typecheck**

```bash
cd /home/james/quackback && bun run typecheck
```

Expected: passes.

- [ ] **Step 3: Run lint**

```bash
cd /home/james/quackback && bun run lint
```

Expected: passes.

- [ ] **Step 4: Start dev server and smoke test**

```bash
cd /home/james/quackback && bun run dev
```

Manually verify:

1. Admin → create/edit a feedback post → editor shows images, tables, YouTube embed options
2. Toggle "Rich Media in Posts" off in Settings → Permissions → verify editor reverts to plain
3. Widget → sign in as a user → open feedback form → verify RichTextEditor appears with image upload button
4. Widget → submit a post with an image → verify post is created and image shows up
5. Settings → Widget → toggle "Image Uploads in Widget" off → verify image button disappears in widget
