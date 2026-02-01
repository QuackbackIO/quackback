'use client'

import type { UseFormReturn } from 'react-hook-form'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { LinkedPostsSelector } from './linked-posts-selector'
import { PublishControls, type PublishState } from './publish-controls'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
import type { JSONContent } from '@tiptap/react'
import type { PostId } from '@quackback/ids'

interface ChangelogFormFieldsProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>
  contentJson: JSONContent | null
  onContentChange: (json: JSONContent) => void
  linkedPostIds: PostId[]
  onLinkedPostsChange: (postIds: PostId[]) => void
  publishState: PublishState
  onPublishStateChange: (state: PublishState) => void
  error?: string
}

export function ChangelogFormFields({
  form,
  contentJson,
  onContentChange,
  linkedPostIds,
  onLinkedPostsChange,
  publishState,
  onPublishStateChange,
  error,
}: ChangelogFormFieldsProps) {
  const { upload: uploadImage } = useImageUpload({ prefix: 'changelog' })

  return (
    <>
      <div className="px-4 sm:px-6 py-4 space-y-4">
        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Title - large, borderless input */}
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

        {/* Content - rich text editor with images and code blocks */}
        <FormField
          control={form.control}
          name="content"
          render={() => (
            <FormItem>
              <FormControl>
                <RichTextEditor
                  value={contentJson || ''}
                  onChange={onContentChange}
                  placeholder="Share the details of your update..."
                  minHeight="250px"
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

        {/* Linked Posts */}
        <div className="pt-2 border-t">
          <label className="text-xs text-muted-foreground mb-2 block">Linked Shipped Posts</label>
          <LinkedPostsSelector value={linkedPostIds} onChange={onLinkedPostsChange} />
        </div>

        {/* Publish Controls */}
        <div className="pt-2 border-t">
          <PublishControls value={publishState} onChange={onPublishStateChange} />
        </div>
      </div>
    </>
  )
}
