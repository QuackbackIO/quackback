'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { boardPublicSettingsSchema, type BoardPublicSettingsInput } from '@/lib/schemas/boards'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import type { Board, BoardSettings, PostStatus } from '@quackback/db'
import { getBoardSettings } from '@quackback/db/types'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form'

const ALL_STATUSES: { value: PostStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'complete', label: 'Complete' },
  { value: 'closed', label: 'Closed' },
]

interface BoardPublicFormProps {
  board: Board
}

export function BoardPublicForm({ board }: BoardPublicFormProps) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const currentSettings = getBoardSettings(board)

  const form = useForm<BoardPublicSettingsInput>({
    resolver: zodResolver(boardPublicSettingsSchema),
    defaultValues: {
      publicVoting: currentSettings.publicVoting,
      publicCommenting: currentSettings.publicCommenting,
      roadmapStatuses: currentSettings.roadmapStatuses,
    },
  })

  async function onSubmit(data: BoardPublicSettingsInput) {
    setError('')
    setSuccess(false)

    const settings: BoardSettings = {
      publicVoting: data.publicVoting,
      publicCommenting: data.publicCommenting,
      roadmapStatuses: data.roadmapStatuses,
    }

    try {
      const response = await fetch(`/api/boards/${board.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })

      if (!response.ok) {
        const responseData = await response.json()
        throw new Error(responseData.error || 'Failed to update settings')
      }

      setSuccess(true)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update settings')
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-md bg-primary/10 p-3 text-sm text-primary">
            Settings updated successfully
          </div>
        )}

        {/* Public Voting */}
        <FormField
          control={form.control}
          name="publicVoting"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between">
              <div className="space-y-0.5">
                <FormLabel>Allow public voting</FormLabel>
                <FormDescription>
                  Let visitors upvote posts without signing in
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />

        {/* Public Commenting */}
        <FormField
          control={form.control}
          name="publicCommenting"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between">
              <div className="space-y-0.5">
                <FormLabel>Allow public comments</FormLabel>
                <FormDescription>
                  Let visitors add comments without signing in
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />

        {/* Roadmap Statuses */}
        <FormField
          control={form.control}
          name="roadmapStatuses"
          render={({ field }) => (
            <FormItem>
              <div>
                <FormLabel>Roadmap statuses</FormLabel>
                <FormDescription>
                  Select which statuses should appear on the public roadmap
                </FormDescription>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 mt-3">
                {ALL_STATUSES.map((status) => (
                  <div key={status.value} className="flex items-center space-x-2">
                    <Checkbox
                      id={`status-${status.value}`}
                      checked={field.value.includes(status.value)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          field.onChange([...field.value, status.value])
                        } else {
                          field.onChange(field.value.filter((s) => s !== status.value))
                        }
                      }}
                    />
                    <label
                      htmlFor={`status-${status.value}`}
                      className="text-sm font-normal cursor-pointer"
                    >
                      {status.label}
                    </label>
                  </div>
                ))}
              </div>
            </FormItem>
          )}
        />

        <div className="flex justify-end">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
