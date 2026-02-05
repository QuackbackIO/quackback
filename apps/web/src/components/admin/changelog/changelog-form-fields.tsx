'use client'

import type { UseFormReturn } from 'react-hook-form'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { TitleInput } from '@/components/shared/title-input'
import { FormError } from '@/components/shared/form-error'
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
      {error && <FormError message={error} className="px-3 py-2" />}

      <TitleInput control={form.control} placeholder="What's new?" autoFocus />

      {/* Content - rich text editor with images and code blocks */}
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
                features={{
                  headings: true,
                  images: true,
                  codeBlocks: true,
                  taskLists: true,
                  blockquotes: true,
                  tables: true,
                  dividers: true,
                  bubbleMenu: true,
                  slashMenu: true,
                  embeds: true,
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
