import { useState } from 'react'
import { useRouter, useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import {
  createBoardSchema,
  type BoardPreset,
  type CreateBoardOutput,
} from '@/lib/shared/schemas/boards'
import { useCreateBoard } from '@/lib/client/mutations'
import { FormError } from '@/components/shared/form-error'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { GlobeAltIcon, LockClosedIcon, PlusIcon } from '@heroicons/react/24/solid'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { cn } from '@/lib/shared/utils/cn'

interface CreateBoardDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactNode
}

export function CreateBoardDialog({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  trigger,
}: CreateBoardDialogProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = controlledOpen ?? internalOpen
  const setIsOpen = controlledOnOpenChange ?? setInternalOpen
  const router = useRouter()
  const navigate = useNavigate()
  const mutation = useCreateBoard()
  // "Customize after create" is a UX-only toggle — not part of the
  // submitted payload. Lives outside the form so it doesn't show up in
  // the validation schema (or in mutation input).
  const [customize, setCustomize] = useState(false)

  const form = useForm({
    resolver: standardSchemaResolver(createBoardSchema),
    defaultValues: {
      name: '',
      description: '',
      preset: 'public' as BoardPreset,
    },
  })

  function onSubmit(data: CreateBoardOutput) {
    mutation.mutate(data, {
      onSuccess: (board) => {
        setIsOpen(false)
        form.reset()
        // When the admin opted in, deep-link straight to the Access tab
        // for the new board so they can fine-tune the matrix without
        // hunting through the boards list.
        void navigate({
          to: '/admin/settings/boards',
          search: customize ? { board: board.slug, tab: 'access' } : { board: board.slug },
        })
        setCustomize(false)
        router.invalidate()
      },
    })
  }

  function handleOpenChange(nextOpen: boolean) {
    setIsOpen(nextOpen)
    if (!nextOpen) {
      form.reset()
      setCustomize(false)
      mutation.reset()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <PlusIcon className="h-4 w-4" />
            New board
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>Create new board</DialogTitle>
              <DialogDescription>
                Create a new feedback board to collect ideas from your users.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {mutation.isError && (
                <FormError message={mutation.error?.message ?? 'An error occurred'} />
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
                name="preset"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Access</FormLabel>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <PresetTile
                        active={field.value === 'public'}
                        label="Public"
                        description="Anyone can view. Sign-in for vote, comment, submit."
                        icon={<GlobeAltIcon className="h-3.5 w-3.5" />}
                        onClick={() => field.onChange('public')}
                      />
                      <PresetTile
                        active={field.value === 'private'}
                        label="Private"
                        description="Workspace members only. Hidden from the portal."
                        icon={<LockClosedIcon className="h-3.5 w-3.5" />}
                        onClick={() => field.onChange('private')}
                      />
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Label className="flex items-center gap-2 text-xs font-normal text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={customize}
                  onCheckedChange={(v) => setCustomize(v === true)}
                  aria-label="Customize access after create"
                />
                <span>
                  Customize access after create
                  <span className="ml-1">open the Access tab to fine-tune.</span>
                </span>
              </Label>
            </div>

            <DialogFooter>
              <Button type="button" size="sm" variant="ghost" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={mutation.isPending}>
                {mutation.isPending ? 'Creating...' : 'Create board'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

interface PresetTileProps {
  active: boolean
  label: string
  description: string
  icon: React.ReactNode
  onClick: () => void
}

/**
 * Preset selector tile — matches the visual vocabulary of the Access
 * tab's preset row (board-access-form.tsx → PresetCard) so the two
 * surfaces feel like the same decision in different contexts.
 */
function PresetTile({ active, label, description, icon, onClick }: PresetTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'flex flex-col items-stretch gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors',
        active
          ? 'border-primary bg-primary/10'
          : 'border-border bg-muted/30 hover:bg-muted/60 cursor-pointer'
      )}
    >
      <div className="flex items-center gap-2">
        <span className={active ? 'text-primary' : 'text-muted-foreground'}>{icon}</span>
        <span className={cn('text-sm font-semibold', active && 'text-primary')}>{label}</span>
      </div>
      <span className="text-xs text-muted-foreground leading-snug">{description}</span>
    </button>
  )
}
