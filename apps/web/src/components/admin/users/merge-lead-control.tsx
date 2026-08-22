/**
 * Admin "merge lead into user" control on a lead's profile.
 *
 * The lead is folded into a chosen identified portal user: every piece of the
 * lead's activity is re-homed on the user (user wins attribute conflicts, the
 * lead fills gaps) and the anonymous identity disappears. The server enforces
 * the direction — this dialog only ever offers identified users as targets.
 */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowPathIcon, ArrowsRightLeftIcon, MagnifyingGlassIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/shared/utils'
import { listPortalUsersFn } from '@/lib/server/functions/admin'
import { useMergeLeadIntoUser } from '@/lib/client/mutations'
import type { PrincipalId } from '@quackback/ids'

interface MergeLeadControlProps {
  /** The lead being viewed (the merge source). */
  principalId: PrincipalId
  leadName: string | null
  /** Called after a successful merge so the parent can leave the deleted lead. */
  onMerged: () => void
  className?: string
  /** `dialog` hides the trigger so a parent menu can own it. */
  mode?: 'button' | 'menu-item' | 'dialog'
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function MergeLeadControl({
  principalId,
  leadName,
  onMerged,
  className,
  mode = 'button',
  open: openProp,
  onOpenChange,
}: MergeLeadControlProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = openProp ?? uncontrolledOpen
  const setOpen = onOpenChange ?? setUncontrolledOpen
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [targetId, setTargetId] = useState<PrincipalId | null>(null)
  const mergeLead = useMergeLeadIntoUser()

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])

  const candidates = useQuery({
    queryKey: ['admin', 'users', 'merge-candidates', debouncedSearch],
    queryFn: () =>
      listPortalUsersFn({
        data: { search: debouncedSearch || undefined, lifecycle: 'users', limit: 8 },
      }),
    enabled: open,
  })

  const reset = () => {
    setSearch('')
    setDebouncedSearch('')
    setTargetId(null)
  }

  const confirm = () => {
    if (!targetId) return
    mergeLead.mutate(
      { principalId, targetPrincipalId: targetId },
      {
        onSuccess: () => {
          toast.success('Lead merged into user')
          setOpen(false)
          reset()
          onMerged()
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : 'Failed to merge lead')
        },
      }
    )
  }

  const items = candidates.data?.items ?? []

  return (
    <>
      {mode === 'menu-item' ? (
        <DropdownMenuItem onSelect={() => setOpen(true)}>
          <ArrowsRightLeftIcon className="h-4 w-4" />
          Merge
        </DropdownMenuItem>
      ) : mode === 'button' ? (
        <Button
          variant="outline"
          size="sm"
          className={className}
          onClick={() => setOpen(true)}
          title="Fold this lead's activity into an identified user"
        >
          <ArrowsRightLeftIcon className="h-4 w-4 mr-2" />
          Merge into user…
        </Button>
      ) : null}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) reset()
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Merge {leadName || 'this lead'} into a user</DialogTitle>
            <DialogDescription>
              The lead&rsquo;s conversations, posts, comments and votes move to the chosen user, and
              the lead disappears from the directory. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users by name or email…"
              className="pl-8 text-sm"
            />
          </div>
          <div className="max-h-64 overflow-y-auto -mx-1 px-1">
            {candidates.isPending ? (
              <div className="flex justify-center py-6">
                <ArrowPathIcon className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : items.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No users found</p>
            ) : (
              <div className="divide-y divide-border/50 rounded-lg border border-border/50 overflow-hidden">
                {items.map((item) => (
                  <button
                    key={item.principalId}
                    type="button"
                    onClick={() => setTargetId(item.principalId as PrincipalId)}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/40',
                      targetId === item.principalId && 'bg-primary/10 hover:bg-primary/10'
                    )}
                  >
                    <Avatar src={item.image} name={item.name} className="h-7 w-7" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">
                        {item.name || 'Unnamed User'}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.email ?? 'No email'}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={confirm} disabled={!targetId || mergeLead.isPending}>
              {mergeLead.isPending ? (
                <ArrowPathIcon className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : null}
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
