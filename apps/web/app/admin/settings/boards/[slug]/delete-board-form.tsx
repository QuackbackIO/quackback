'use client'

import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { deleteBoardSchema, type DeleteBoardInput } from '@/lib/schemas/boards'
import { useDeleteBoard } from '@/lib/hooks/use-board-actions'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import type { BoardId } from '@quackback/ids'

interface Board {
  id: BoardId
  name: string
  slug: string
}

interface DeleteBoardFormProps {
  board: Board
}

export function DeleteBoardForm({ board }: DeleteBoardFormProps) {
  const router = useRouter()
  const mutation = useDeleteBoard({
    onSuccess: () => {
      router.push(`/admin/settings/boards`)
      router.refresh()
    },
  })

  const form = useForm<DeleteBoardInput>({
    resolver: standardSchemaResolver(deleteBoardSchema),
    defaultValues: {
      confirmName: '',
    },
  })

  const confirmName = form.watch('confirmName')
  const canDelete = confirmName === board.name

  function onSubmit() {
    if (!canDelete) return

    mutation.mutate({ id: board.id })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-md bg-destructive/10 p-4">
        <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-medium text-destructive">Delete this board</p>
          <p className="text-sm text-muted-foreground">
            Once you delete a board, there is no going back. All feedback, votes, and comments
            associated with this board will be permanently deleted.
          </p>
        </div>
      </div>

      {mutation.isError && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {mutation.error.message}
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="confirmName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Type <span className="font-mono font-bold">{board.name}</span> to confirm
                </FormLabel>
                <FormControl>
                  <Input placeholder={board.name} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" variant="destructive" disabled={!canDelete || mutation.isPending}>
            {mutation.isPending ? 'Deleting...' : 'Delete board'}
          </Button>
        </form>
      </Form>
    </div>
  )
}
