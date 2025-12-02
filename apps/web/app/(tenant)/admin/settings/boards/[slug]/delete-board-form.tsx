'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { deleteBoardSchema, type DeleteBoardInput } from '@/lib/schemas/boards'
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

interface Board {
  id: string
  name: string
  slug: string
}

interface DeleteBoardFormProps {
  board: Board
}

export function DeleteBoardForm({ board }: DeleteBoardFormProps) {
  const router = useRouter()
  const [error, setError] = useState('')

  const form = useForm<DeleteBoardInput>({
    resolver: standardSchemaResolver(deleteBoardSchema),
    defaultValues: {
      confirmName: '',
    },
  })

  const confirmName = form.watch('confirmName')
  const canDelete = confirmName === board.name

  async function onSubmit() {
    if (!canDelete) return

    setError('')

    try {
      const response = await fetch(`/api/boards/${board.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete board')
      }

      router.push('/admin/settings/boards')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete board')
    }
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

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
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

          <Button
            type="submit"
            variant="destructive"
            disabled={!canDelete || form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? 'Deleting...' : 'Delete board'}
          </Button>
        </form>
      </Form>
    </div>
  )
}
