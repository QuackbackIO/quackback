import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ArrowLeftIcon, PaperAirplaneIcon } from '@heroicons/react/24/solid'
import type { JSONContent } from '@tiptap/react'
import type { PrincipalId } from '@quackback/ids'
import type { TiptapContent } from '@/lib/shared/db-types'
import { MAX_CONVERSATION_MESSAGE_LENGTH } from '@/lib/shared/conversation/types'
import { startAgentConversationFn } from '@/lib/server/functions/conversation'
import { realEmail } from '@/lib/shared/anonymous-email'
import { PortalUserPicker } from '@/components/shared/portal-user-picker'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { CONVERSATION_EDITOR_FEATURES } from '@/components/conversation/conversation-editor-features'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
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
  const [messageJson, setMessageJson] = useState<JSONContent | undefined>(undefined)
  const [messageMarkdown, setMessageMarkdown] = useState('')
  // Dialogs submit via the button, not Enter — RichTextEditor gets no
  // onSubmit, so Enter just inserts a paragraph. The composer key is bumped
  // on every open so a reopened dialog gets a clean editor instance (an
  // empty controlled value leaves a stale `<p></p>` that traps the cursor;
  // remounting is the clean reset — same pattern as the ticket thread composer).
  const [composerKey, setComposerKey] = useState(0)

  // A fresh open starts clean, honoring the (possibly changed) initial target.
  useEffect(() => {
    if (open) {
      setTarget(initialTarget ?? null)
      setMessageJson(undefined)
      setMessageMarkdown('')
      setComposerKey((k) => k + 1)
    }
  }, [open, initialTarget])

  const { upload: uploadImage } = useImageUpload({ prefix: 'chat-images' })

  const send = useMutation({
    mutationFn: (vars: {
      targetPrincipalId: PrincipalId
      content: string
      contentJson?: TiptapContent | null
    }) => startAgentConversationFn({ data: vars }),
    onSuccess: (result) => {
      toast.success('Message sent')
      onOpenChange(false)
      void navigate({ to: '/admin/inbox', search: { c: result.conversation.id } })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to send message')
    },
  })

  const isEmpty = isEmptyTiptapDoc(messageJson as TiptapContent | undefined)
  const canSend = !!target && !isEmpty && !send.isPending

  const submit = () => {
    if (!canSend || !target) return
    const content = messageMarkdown.trim()
    // Native `<textarea maxLength>` used to silently cap this field; a rich
    // doc can't be truncated mid-node without corrupting it, so the cap is
    // enforced pre-submit instead.
    if (content.length > MAX_CONVERSATION_MESSAGE_LENGTH) {
      toast.error(
        `Message must be ${MAX_CONVERSATION_MESSAGE_LENGTH.toLocaleString()} characters or less`
      )
      return
    }
    send.mutate({
      targetPrincipalId: target.principalId as PrincipalId,
      content,
      contentJson: isEmpty ? null : (messageJson as TiptapContent),
    })
  }

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
          <PortalUserPicker
            onSelect={(u) => setTarget(u)}
            enabled={open && !target}
            limit={8}
            requireEmail
            autoFocus
          />
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
            <RichTextEditor
              key={composerKey}
              value={messageJson ?? ''}
              onChange={(json, _html, markdown) => {
                setMessageJson(json)
                setMessageMarkdown(markdown)
              }}
              features={CONVERSATION_EDITOR_FEATURES}
              onImageUpload={uploadImage}
              autofocus
              minHeight="100px"
              placeholder="Write your message…"
            />
            <div className="flex justify-end">
              <Button onClick={submit} disabled={!canSend}>
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
