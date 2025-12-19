'use client'

import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { updateBoardSchema, type UpdateBoardInput } from '@/lib/schemas/boards'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { useUpdateBoard } from '@/lib/hooks/use-board-queries'

interface Board {
  id: string
  name: string
  slug: string
  description: string | null
}

interface BoardGeneralFormProps {
  board: Board
  workspaceId: string
}

export function BoardGeneralForm({ board, workspaceId }: BoardGeneralFormProps) {
  const mutation = useUpdateBoard(workspaceId)

  const form = useForm<UpdateBoardInput>({
    resolver: standardSchemaResolver(updateBoardSchema),
    defaultValues: {
      name: board.name,
      description: board.description || '',
    },
  })

  function onSubmit(data: UpdateBoardInput) {
    mutation.mutate({
      boardId: board.id,
      name: data.name,
      description: data.description,
    })
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
            Board updated successfully
          </div>
        )}

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Board name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea rows={3} {...field} />
              </FormControl>
              <FormMessage />
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
