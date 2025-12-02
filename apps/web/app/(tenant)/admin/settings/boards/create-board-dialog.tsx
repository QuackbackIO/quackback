'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { createBoardSchema, type CreateBoardInput } from '@/lib/schemas/boards'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Plus } from 'lucide-react'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

interface CreateBoardDialogProps {
  organizationId: string
}

export function CreateBoardDialog({ organizationId }: CreateBoardDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')

  const form = useForm<CreateBoardInput>({
    resolver: standardSchemaResolver(createBoardSchema),
    defaultValues: {
      name: '',
      description: '',
      isPublic: true,
    },
  })

  async function onSubmit(data: CreateBoardInput) {
    setError('')

    try {
      const response = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          organizationId,
        }),
      })

      if (!response.ok) {
        const responseData = await response.json()
        throw new Error(responseData.error || 'Failed to create board')
      }

      setOpen(false)
      form.reset()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create board')
    }
  }

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen)
    if (!isOpen) {
      form.reset()
      setError('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          New board
        </Button>
      </DialogTrigger>
      <DialogContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>Create new board</DialogTitle>
              <DialogDescription>
                Create a new feedback board to collect ideas from your users.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Board name</FormLabel>
                    <FormControl>
                      <Input placeholder="Feature Requests" {...field} />
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
                      <Textarea
                        placeholder="Share your ideas and vote on features"
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isPublic"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <FormLabel>Public board</FormLabel>
                      <FormDescription>Anyone can view and submit feedback</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Creating...' : 'Create board'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
