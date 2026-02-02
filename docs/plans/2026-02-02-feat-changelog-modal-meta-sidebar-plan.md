---
title: 'feat: Changelog modal with right-aligned meta sidebar'
type: feat
date: 2026-02-02
---

# Changelog Modal with Right-Aligned Meta Sidebar

## Overview

Improve the changelog creation/edit modal to match the feedback post modal design by adding a right-aligned metadata sidebar for configuration options (status, scheduling, linked posts). This creates visual consistency across the admin UI.

## Problem Statement

The current changelog modal (`CreateChangelogDialog`) has a different, narrower layout compared to the feedback post modal:

- **Changelog modal**: `max-w-3xl` (~768px), stacked vertical sections
- **Post modal**: `lg:max-w-6xl xl:max-w-7xl` (~1152-1280px), 3-column layout with metadata sidebar

Configuration controls (publish status, scheduling, linked posts) are inline with content, making the modal feel cramped and inconsistent with the post editing experience.

## Proposed Solution

Restructure the changelog modal to use a 2-column layout:

1. **Left**: Main content area (title + rich text editor)
2. **Right**: Sidebar containing publish controls and linked posts

**Key principle (from review):** Inline the sidebar JSX directly in the dialog. No new component files needed.

### Visual Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ [X]                                   Changelog Entry           │
├─────────────────────────────────────────────────────────────────┤
│                                          │ Publish Status      │
│  What's new?                             │ ○ Draft ○ Schedule  │
│  ─────────────────────────────────────   │ ○ Publish Now       │
│                                          │ [datetime picker]   │
│  [Rich text editor with toolbar]         │                     │
│                                          │ ─────────────────── │
│  Share the details of your update...     │ Linked Posts        │
│                                          │ [Link posts...]     │
│                                          │ [badge] [badge] [x] │
│                                          │                     │
├─────────────────────────────────────────┴─────────────────────┤
│ Cmd + Enter to save              [Cancel] [Save Draft/Publish] │
└─────────────────────────────────────────────────────────────────┘
```

## Technical Approach

### Files to Modify (2 files only)

1. **`apps/web/src/components/admin/changelog/create-changelog-dialog.tsx`**
   - Increase modal width to match post modal: `lg:max-w-5xl xl:max-w-6xl h-[85vh]`
   - Add flex container with 2-column layout
   - Inline sidebar JSX directly (no new component)
   - Add mobile drawer/sheet for sidebar controls on smaller screens

2. **`apps/web/src/components/admin/changelog/changelog-form-fields.tsx`**
   - Remove publish controls and linked posts sections
   - Remove associated props (`linkedPostIds`, `onLinkedPostsChange`, `publishState`, `onPublishStateChange`)
   - Keep only: title input, content editor, error display

### No Changes Required

- **`publish-controls.tsx`** - Current horizontal layout works fine in sidebar width
- **`linked-posts-selector.tsx`** - Keep existing badge-based display (no miniature post cards)

### Mobile Responsiveness

On screens < `lg` breakpoint:

- Sidebar content moves to a bottom sheet/drawer triggered by a "Settings" button in the footer
- This ensures mobile users can still access publish controls and linked posts
- Avoids feature amputation (hiding controls entirely)

## Acceptance Criteria

- [x] Changelog modal width matches post modal width (`lg:max-w-5xl xl:max-w-6xl`)
- [x] Modal height is consistent (`h-[85vh]`)
- [x] Desktop: Right-aligned sidebar (`w-72`) contains:
  - [x] Publish status controls (Draft/Scheduled/Published)
  - [x] Schedule date picker (when scheduled)
  - [x] Linked posts selector with badge display
- [x] Mobile: Bottom sheet/drawer contains sidebar controls
- [x] Left column contains title input and rich text editor
- [x] Cmd+Enter keyboard shortcut still works
- [x] All existing functionality preserved (create, edit, draft, schedule, publish)

## References

- **Post modal layout**: `apps/web/src/components/admin/feedback/post-modal.tsx:505`
- **MetadataSidebar**: `apps/web/src/components/public/post-detail/metadata-sidebar.tsx`
- **Current changelog dialog**: `apps/web/src/components/admin/changelog/create-changelog-dialog.tsx`
- **Brainstorm**: `docs/brainstorms/2026-02-01-changelog-ui-brainstorm.md`

## MVP

### create-changelog-dialog.tsx (updated)

```tsx
'use client'

import { useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { createChangelogSchema } from '@/lib/shared/schemas/changelog'
import { useCreateChangelog } from '@/lib/client/mutations/changelog'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { PlusIcon, Cog6ToothIcon } from '@heroicons/react/24/solid'
import { richTextToPlainText } from '@/components/ui/rich-text-editor'
import { Form } from '@/components/ui/form'
import { ChangelogFormFields } from './changelog-form-fields'
import { PublishControls, type PublishState } from './publish-controls'
import { LinkedPostsSelector } from './linked-posts-selector'
import type { JSONContent } from '@tiptap/react'
import type { PostId } from '@quackback/ids'

interface CreateChangelogDialogProps {
  onChangelogCreated?: () => void
}

export function CreateChangelogDialog({ onChangelogCreated }: CreateChangelogDialogProps) {
  const [open, setOpen] = useState(false)
  const [contentJson, setContentJson] = useState<JSONContent | null>(null)
  const [linkedPostIds, setLinkedPostIds] = useState<PostId[]>([])
  const [publishState, setPublishState] = useState<PublishState>({ type: 'draft' })
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)
  const createChangelogMutation = useCreateChangelog()

  const form = useForm({
    resolver: standardSchemaResolver(createChangelogSchema),
    defaultValues: {
      title: '',
      content: '',
      linkedPostIds: [] as string[],
      publishState: { type: 'draft' as const },
    },
  })

  const handleContentChange = useCallback(
    (json: JSONContent) => {
      setContentJson(json)
      const plainText = richTextToPlainText(json)
      form.setValue('content', plainText, { shouldValidate: true })
    },
    [form]
  )

  const handleSubmit = form.handleSubmit((data) => {
    createChangelogMutation.mutate(
      {
        title: data.title,
        content: data.content,
        contentJson,
        linkedPostIds,
        publishState,
      },
      {
        onSuccess: () => {
          setOpen(false)
          form.reset()
          setContentJson(null)
          setLinkedPostIds([])
          setPublishState({ type: 'draft' })
          onChangelogCreated?.()
        },
      }
    )
  })

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen)
    if (!isOpen) {
      form.reset()
      setContentJson(null)
      setLinkedPostIds([])
      setPublishState({ type: 'draft' })
      createChangelogMutation.reset()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  const getSubmitButtonText = () => {
    if (createChangelogMutation.isPending) {
      return publishState.type === 'published' ? 'Publishing...' : 'Saving...'
    }
    switch (publishState.type) {
      case 'draft':
        return 'Save Draft'
      case 'scheduled':
        return 'Schedule'
      case 'published':
        return 'Publish Now'
    }
  }

  // Sidebar content - shared between desktop sidebar and mobile sheet
  const sidebarContent = (
    <div className="space-y-5">
      <PublishControls value={publishState} onChange={setPublishState} />
      <div className="pt-4 border-t border-border/30">
        <label className="text-xs text-muted-foreground mb-2 block">Linked Shipped Posts</label>
        <LinkedPostsSelector value={linkedPostIds} onChange={setLinkedPostIds} />
      </div>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon className="h-4 w-4 mr-1.5" />
          New Entry
        </Button>
      </DialogTrigger>
      <DialogContent
        className="w-[95vw] sm:w-[90vw] lg:max-w-5xl xl:max-w-6xl h-[85vh] p-0 gap-0 overflow-hidden flex flex-col"
        onKeyDown={handleKeyDown}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Create changelog entry</DialogTitle>

        <Form {...form}>
          <form onSubmit={handleSubmit} className="flex flex-col h-full">
            {/* Main content area - 2 column layout on desktop */}
            <div className="flex flex-1 min-h-0">
              {/* Left: Content editor */}
              <div className="flex-1 overflow-y-auto">
                <ChangelogFormFields
                  form={form}
                  contentJson={contentJson}
                  onContentChange={handleContentChange}
                  error={
                    createChangelogMutation.isError
                      ? createChangelogMutation.error.message
                      : undefined
                  }
                />
              </div>

              {/* Right: Metadata sidebar (desktop only) */}
              <aside className="hidden lg:block w-72 shrink-0 border-l border-border/30 bg-muted/5 overflow-y-auto">
                <div className="p-4">{sidebarContent}</div>
              </aside>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-t bg-muted/30 shrink-0">
              <p className="hidden sm:block text-xs text-muted-foreground">
                <kbd className="px-1.5 py-0.5 text-[10px] bg-muted rounded border">Cmd</kbd>
                <span className="mx-1">+</span>
                <kbd className="px-1.5 py-0.5 text-[10px] bg-muted rounded border">Enter</kbd>
                <span className="ml-2">to save</span>
              </p>
              <div className="flex items-center gap-2 sm:ml-0 ml-auto">
                {/* Mobile settings button */}
                <Sheet open={mobileSettingsOpen} onOpenChange={setMobileSettingsOpen}>
                  <SheetTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="lg:hidden">
                      <Cog6ToothIcon className="h-4 w-4 mr-1.5" />
                      Settings
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="bottom" className="h-[60vh]">
                    <SheetHeader>
                      <SheetTitle>Entry Settings</SheetTitle>
                    </SheetHeader>
                    <div className="py-4">{sidebarContent}</div>
                  </SheetContent>
                </Sheet>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen(false)}
                  disabled={createChangelogMutation.isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={createChangelogMutation.isPending}>
                  {getSubmitButtonText()}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
```

### changelog-form-fields.tsx (simplified)

```tsx
'use client'

import type { UseFormReturn } from 'react-hook-form'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
import type { JSONContent } from '@tiptap/react'

interface ChangelogFormFieldsProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>
  contentJson: JSONContent | null
  onContentChange: (json: JSONContent) => void
  error?: string
}

export function ChangelogFormFields({
  form,
  contentJson,
  onContentChange,
  error,
}: ChangelogFormFieldsProps) {
  const { upload: uploadImage } = useImageUpload({ prefix: 'changelog' })

  return (
    <div className="px-4 sm:px-6 py-4 space-y-4 h-full flex flex-col">
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Title */}
      <FormField
        control={form.control}
        name="title"
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <input
                type="text"
                placeholder="What's new?"
                className="w-full text-lg sm:text-xl font-semibold bg-transparent border-0 outline-none placeholder:text-muted-foreground/50 focus:ring-0"
                autoFocus
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Content - takes remaining space */}
      <FormField
        control={form.control}
        name="content"
        render={() => (
          <FormItem className="flex-1 min-h-0">
            <FormControl>
              <RichTextEditor
                value={contentJson || ''}
                onChange={onContentChange}
                placeholder="Share the details of your update..."
                minHeight="100%"
                borderless
                toolbarPosition="bottom"
                features={{
                  headings: true,
                  images: true,
                  codeBlocks: true,
                }}
                onImageUpload={uploadImage}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}
```

## Review Feedback Incorporated

Based on DHH, Kieran, and Simplicity reviews:

1. **No new component files** - Sidebar JSX inlined directly in dialog (~20 lines vs 55-line wrapper component)
2. **Keep existing components unchanged** - `PublishControls` and `LinkedPostsSelector` work as-is
3. **Proper mobile handling** - Bottom sheet for sidebar controls instead of hiding them
4. **2 files touched** instead of 5 - Reduced scope significantly
5. **~60% less new code** than original plan
