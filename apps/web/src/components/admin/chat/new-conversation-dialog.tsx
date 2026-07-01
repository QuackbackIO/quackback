import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ArrowLeftIcon, PaperAirplaneIcon } from '@heroicons/react/24/solid'
import type { PrincipalId } from '@quackback/ids'
import { startAgentConversationFn } from '@/lib/server/functions/conversation'
import { adminQueries } from '@/lib/client/queries/admin'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
import { realEmail } from '@/lib/shared/anonymous-email'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Avatar } from '@/components/ui/avatar'

export interface NewConversationTarget {
  principalId: string
  name: string | null
  email: string | null
  image?: string | null
}

interface NewConversationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-selected recipient (e.g. from the user profile); skips the picker. */
  initialTarget?: NewConversationTarget | null
}

/**
 * Outbound compose: start a conversation with a portal user. Without an
 * initial target it opens on a user picker (directory search); the message is
 * delivered in-app and always emailed, so targets need a deliverable address.
 * On success, navigates to the new thread in the inbox.
 */
export function NewConversationDialog({
  open,
  onOpenChange,
  initialTarget,
}: NewConversationDialogProps) {
  const navigate = useNavigate()
  const [target, setTarget] = useState<NewConversationTarget | null>(initialTarget ?? null)
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  const debounced = useDebouncedValue(search.trim(), 350)

  // A fresh open starts clean, honoring the (possibly changed) initial target.
  useEffect(() => {
    if (open) {
      setTarget(initialTarget ?? null)
      setSearch('')
      setMessage('')
    }
  }, [open, initialTarget])

  const usersQuery = useQuery({
    ...adminQueries.portalUsers({ search: debounced || undefined, page: 1, limit: 8 }),
    enabled: open && !target,
  })

  const send = useMutation({
    mutationFn: (vars: { targetPrincipalId: PrincipalId; content: string }) =>
      startAgentConversationFn({ data: vars }),
    onSuccess: (result) => {
      toast.success('Message sent')
      onOpenChange(false)
      void navigate({ to: '/admin/inbox', search: { c: result.conversation.id } })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to send message')
    },
  })

  const canSend = !!target && message.trim().length > 0 && !send.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
          <DialogDescription>
            {target
              ? 'The message opens a conversation and is also emailed to them.'
              : 'Pick who to message. Users without an email address can’t be reached.'}
          </DialogDescription>
        </DialogHeader>

        {!target ? (
          <div className="space-y-2">
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users by name or email…"
            />
            <div className="max-h-64 overflow-y-auto rounded-md border border-border/60 divide-y divide-border/40">
              {usersQuery.isLoading ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">Searching…</p>
              ) : (usersQuery.data?.items.length ?? 0) === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">No users found.</p>
              ) : (
                usersQuery.data!.items.map((u) => {
                  const deliverable = !!realEmail(u.email)
                  return (
                    <button
                      key={u.principalId}
                      type="button"
                      disabled={!deliverable}
                      title={deliverable ? undefined : 'This user has no email address'}
                      onClick={() =>
                        setTarget({
                          principalId: u.principalId,
                          name: u.name,
                          email: u.email,
                          image: u.image,
                        })
                      }
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-start transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Avatar src={u.image} name={u.name ?? 'User'} className="size-7 text-xs" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">
                          {u.name || 'Unnamed user'}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {realEmail(u.email) ?? 'No email'}
                        </span>
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2.5 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
              {/* Re-picking is only offered when the picker opened this dialog. */}
              {!initialTarget && (
                <button
                  type="button"
                  onClick={() => setTarget(null)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Choose a different user"
                >
                  <ArrowLeftIcon className="size-4" />
                </button>
              )}
              <Avatar src={target.image} name={target.name ?? 'User'} className="size-7 text-xs" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">
                  {target.name || 'Unnamed user'}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {realEmail(target.email) ?? 'No email'}
                </span>
              </span>
            </div>
            <Textarea
              autoFocus
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Write your message…"
            />
            <div className="flex justify-end">
              <Button
                onClick={() =>
                  send.mutate({
                    targetPrincipalId: target.principalId as PrincipalId,
                    content: message.trim(),
                  })
                }
                disabled={!canSend}
              >
                <PaperAirplaneIcon className="me-1.5 size-4" />
                {send.isPending ? 'Sending…' : 'Send message'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
