'use client'

import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { boardPublicSettingsSchema, type BoardPublicSettingsInput } from '@/lib/schemas/boards'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { Board, BoardSettings } from '@quackback/db/types'
import { getBoardSettings } from '@quackback/db/types'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form'
import { useUpdateBoard } from '@/lib/hooks/use-board-queries'

interface BoardPublicFormProps {
  board: Board
  organizationId: string
}

export function BoardPublicForm({ board, organizationId }: BoardPublicFormProps) {
  const mutation = useUpdateBoard(organizationId)

  const currentSettings = getBoardSettings(board)

  const form = useForm<BoardPublicSettingsInput>({
    resolver: standardSchemaResolver(boardPublicSettingsSchema),
    defaultValues: {
      allowUserSubmissions: currentSettings.allowUserSubmissions,
    },
  })

  async function onSubmit(data: BoardPublicSettingsInput) {
    const settings: BoardSettings = {
      allowUserSubmissions: data.allowUserSubmissions,
    }

    mutation.mutate({ boardId: board.id, settings })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {mutation.isError && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {mutation.error.message}
          </div>
        )}

        {mutation.isSuccess && (
          <div className="rounded-md bg-primary/10 p-3 text-sm text-primary">
            Settings updated successfully
          </div>
        )}

        {/* User Submissions */}
        <FormField
          control={form.control}
          name="allowUserSubmissions"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between">
              <div className="space-y-0.5">
                <FormLabel>Allow user submissions</FormLabel>
                <FormDescription>
                  Let signed-in users submit feedback directly on this board
                </FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />

        <div className="flex justify-end">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
