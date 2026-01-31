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
import type { JSONContent } from '@tiptap/react'
import type { Board, Tag, PostStatusEntity } from '@/lib/db-types'

interface PostFormFieldsProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>
  boards: Board[]
  statuses: PostStatusEntity[]
  tags: Tag[]
  contentJson: JSONContent | null
  onContentChange: (json: JSONContent) => void
  error?: string
}

export function PostFormFields({
  form,
  boards,
  statuses,
  tags,
  contentJson,
  onContentChange,
  error,
}: PostFormFieldsProps) {
  const selectedBoard = boards.find((b) => b.id === form.watch('boardId'))
  const selectedStatus = statuses.find((s) => s.id === form.watch('statusId'))

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
        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive mb-4">
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
                  placeholder="What's the feedback about?"
                  className="w-full text-lg sm:text-xl font-semibold bg-transparent border-0 outline-none placeholder:text-muted-foreground/50 focus:ring-0"
                  autoFocus
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Content - seamless rich text editor */}
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
                  toolbarPosition="bottom"
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
