import type { UseFormReturn } from 'react-hook-form'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { TitleInput } from '@/components/shared/title-input'
import { FormError } from '@/components/shared/form-error'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
import type { JSONContent } from '@tiptap/react'

interface HelpCenterFormFieldsProps {
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>
  contentJson: JSONContent | null
  onContentChange: (json: JSONContent, html: string, markdown: string) => void
  error?: string
  showDescription?: boolean
}

export function HelpCenterFormFields({
  form,
  contentJson,
  onContentChange,
  error,
  showDescription,
}: HelpCenterFormFieldsProps) {
  const { upload: uploadImage } = useImageUpload({ prefix: 'help-center' })

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-4 py-4 sm:px-6">
      {error && <FormError message={error} className="px-3 py-2" />}

      <TitleInput control={form.control} placeholder="Article title" autoFocus />

      {showDescription ? (
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <input
                  type="text"
                  aria-label="Page description"
                  placeholder="Page description (optional)"
                  className="w-full bg-transparent border-0 outline-none text-sm text-muted-foreground placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring/50"
                  {...field}
                  value={field.value ?? ''}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}

      <FormField
        control={form.control}
        name="content"
        render={() => (
          <FormItem className="!flex min-h-0 flex-1 flex-col">
            <FormControl>
              <RichTextEditor
                value={contentJson || ''}
                onChange={onContentChange}
                placeholder="Write your help article..."
                minHeight="100%"
                fill
                className="min-h-0 flex-1"
                borderless
                toolbarPosition="bottom"
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
                  quackbackEmbeds: true,
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
