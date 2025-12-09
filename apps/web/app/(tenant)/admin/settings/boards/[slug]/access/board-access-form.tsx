'use client'

import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { boardAccessSettingsSchema, type BoardAccessSettingsInput } from '@/lib/schemas/boards'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import type { Board, BoardSettings, PermissionLevel } from '@quackback/db/types'
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
import { Globe, Lock } from 'lucide-react'

interface BoardAccessFormProps {
  board: Board
  organizationId: string
  orgDefaults: {
    voting: PermissionLevel
    commenting: PermissionLevel
    submissions: PermissionLevel
  }
}

const permissionOptions = [
  { value: 'inherit', label: 'Inherit from org', description: 'Use organization default' },
  { value: 'anyone', label: 'Anyone', description: 'Including anonymous visitors' },
  { value: 'authenticated', label: 'Signed-in users', description: 'Requires authentication' },
  { value: 'disabled', label: 'Disabled', description: 'Not allowed on this board' },
] as const

function getPermissionLabel(level: PermissionLevel): string {
  switch (level) {
    case 'anyone':
      return 'Anyone'
    case 'authenticated':
      return 'Signed-in users'
    case 'disabled':
      return 'Disabled'
  }
}

export function BoardAccessForm({ board, organizationId, orgDefaults }: BoardAccessFormProps) {
  const mutation = useUpdateBoard(organizationId)

  const currentSettings = getBoardSettings(board)

  const form = useForm<BoardAccessSettingsInput>({
    resolver: standardSchemaResolver(boardAccessSettingsSchema),
    defaultValues: {
      isPublic: board.isPublic,
      voting: currentSettings.voting,
      commenting: currentSettings.commenting,
      submissions: currentSettings.submissions,
    },
  })

  const isPublic = form.watch('isPublic')

  async function onSubmit(data: BoardAccessSettingsInput) {
    const settings: BoardSettings = {
      voting: data.voting,
      commenting: data.commenting,
      submissions: data.submissions,
    }

    mutation.mutate({
      boardId: board.id,
      isPublic: data.isPublic,
      settings,
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
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

        {/* Board Visibility */}
        <FormField
          control={form.control}
          name="isPublic"
          render={({ field }) => (
            <FormItem className="space-y-4">
              <div>
                <FormLabel className="text-base">Board Visibility</FormLabel>
                <FormDescription>Control who can see this board on your portal</FormDescription>
              </div>
              <FormControl>
                <RadioGroup
                  onValueChange={(value) => field.onChange(value === 'public')}
                  value={field.value ? 'public' : 'private'}
                  className="grid gap-3"
                >
                  <Label
                    htmlFor="visibility-public"
                    className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer hover:bg-muted/50 [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-primary/5"
                  >
                    <RadioGroupItem value="public" id="visibility-public" className="mt-0.5" />
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4" />
                        <span className="font-medium">Public</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Anyone can view this board on your portal
                      </p>
                    </div>
                  </Label>
                  <Label
                    htmlFor="visibility-private"
                    className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer hover:bg-muted/50 [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-primary/5"
                  >
                    <RadioGroupItem value="private" id="visibility-private" className="mt-0.5" />
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <Lock className="h-4 w-4" />
                        <span className="font-medium">Private</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Only team members can view this board
                      </p>
                    </div>
                  </Label>
                </RadioGroup>
              </FormControl>
            </FormItem>
          )}
        />

        {/* Permission Settings - Only shown when public */}
        {isPublic && (
          <div className="space-y-6 rounded-lg border p-4">
            <div>
              <h3 className="font-medium">Interaction Permissions</h3>
              <p className="text-sm text-muted-foreground">
                Override organization defaults for this board. &quot;Inherit from org&quot; uses the
                settings from Portal Authentication.
              </p>
            </div>

            {/* Voting Permission */}
            <FormField
              control={form.control}
              name="voting"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <div>
                    <FormLabel>Voting</FormLabel>
                    <FormDescription>
                      Who can upvote posts (Org default: {getPermissionLabel(orgDefaults.voting)})
                    </FormDescription>
                  </div>
                  <FormControl>
                    <RadioGroup
                      onValueChange={(value) =>
                        field.onChange(value === 'inherit' ? undefined : value)
                      }
                      value={field.value ?? 'inherit'}
                      className="grid gap-2"
                    >
                      {permissionOptions.map((option) => (
                        <div
                          key={option.value}
                          className="flex items-center space-x-3 rounded-lg border border-border/50 p-3 hover:bg-muted/50"
                        >
                          <RadioGroupItem value={option.value} id={`voting-${option.value}`} />
                          <Label
                            htmlFor={`voting-${option.value}`}
                            className="flex-1 cursor-pointer font-normal"
                          >
                            <span className="font-medium">{option.label}</span>
                            <span className="ml-2 text-muted-foreground">{option.description}</span>
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </FormControl>
                </FormItem>
              )}
            />

            {/* Commenting Permission */}
            <FormField
              control={form.control}
              name="commenting"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <div>
                    <FormLabel>Commenting</FormLabel>
                    <FormDescription>
                      Who can leave comments (Org default:{' '}
                      {getPermissionLabel(orgDefaults.commenting)})
                    </FormDescription>
                  </div>
                  <FormControl>
                    <RadioGroup
                      onValueChange={(value) =>
                        field.onChange(value === 'inherit' ? undefined : value)
                      }
                      value={field.value ?? 'inherit'}
                      className="grid gap-2"
                    >
                      {permissionOptions.map((option) => (
                        <div
                          key={option.value}
                          className="flex items-center space-x-3 rounded-lg border border-border/50 p-3 hover:bg-muted/50"
                        >
                          <RadioGroupItem value={option.value} id={`commenting-${option.value}`} />
                          <Label
                            htmlFor={`commenting-${option.value}`}
                            className="flex-1 cursor-pointer font-normal"
                          >
                            <span className="font-medium">{option.label}</span>
                            <span className="ml-2 text-muted-foreground">{option.description}</span>
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </FormControl>
                </FormItem>
              )}
            />

            {/* Submissions Permission */}
            <FormField
              control={form.control}
              name="submissions"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <div>
                    <FormLabel>Submissions</FormLabel>
                    <FormDescription>
                      Who can submit new feedback (Org default:{' '}
                      {getPermissionLabel(orgDefaults.submissions)})
                    </FormDescription>
                  </div>
                  <FormControl>
                    <RadioGroup
                      onValueChange={(value) =>
                        field.onChange(value === 'inherit' ? undefined : value)
                      }
                      value={field.value ?? 'inherit'}
                      className="grid gap-2"
                    >
                      {permissionOptions.map((option) => (
                        <div
                          key={option.value}
                          className="flex items-center space-x-3 rounded-lg border border-border/50 p-3 hover:bg-muted/50"
                        >
                          <RadioGroupItem value={option.value} id={`submissions-${option.value}`} />
                          <Label
                            htmlFor={`submissions-${option.value}`}
                            className="flex-1 cursor-pointer font-normal"
                          >
                            <span className="font-medium">{option.label}</span>
                            <span className="ml-2 text-muted-foreground">{option.description}</span>
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </FormControl>
                </FormItem>
              )}
            />
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
