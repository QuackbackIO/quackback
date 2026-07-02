import { useState, useMemo, useRef } from 'react'
import type { JSONContent } from '@tiptap/react'
import { FormattedMessage, useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { useReplyToMyTicket } from '@/lib/client/queries/portal-tickets'
import type { TicketId, TicketThreadId } from '@quackback/ids'
import { X, Upload } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { portalTicketQueries } from '@/lib/client/queries/portal-tickets'
import { ticketQueries } from '@/lib/client/queries/tickets'
import { usePortalImageUpload } from '@/lib/client/hooks/use-image-upload'

export interface PortalTicketReplyComposerProps {
  ticketId: TicketId
  /** When true, the composer is rendered in a disabled "ticket closed" state. */
  isClosed: boolean
}

function plainTextFromJson(json: JSONContent | null): string {
  if (!json) return ''
  let out = ''
  const walk = (node: JSONContent) => {
    if (node.type === 'text' && typeof node.text === 'string') out += node.text
    if (node.content) node.content.forEach(walk)
    if (node.type === 'paragraph' || node.type === 'heading') out += '\n'
  }
  walk(json)
  return out.trim()
}

export function PortalTicketReplyComposer({ ticketId, isClosed }: PortalTicketReplyComposerProps) {
  const intl = useIntl()
  const qc = useQueryClient()
  const { upload: uploadImage } = usePortalImageUpload()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [body, setBody] = useState<JSONContent | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const reply = useReplyToMyTicket(ticketId)

  const placeholder = intl.formatMessage({
    id: 'portal.tickets.composer.placeholder',
    defaultMessage: 'Type your reply…',
  })

  const text = useMemo(() => plainTextFromJson(body), [body])
  const isEmpty = text.length === 0

  const handleReply = async () => {
    try {
      // Post the reply
      await reply.mutateAsync({ bodyJson: body, bodyText: text })

      // Upload files if any and we have a thread
      // For portal, we need to get the new threadId from the API
      // Since the mutation doesn't return it, we'll fetch the latest thread
      if (selectedFiles.length > 0) {
        // Refetch threads to get the newly created one
        await qc.invalidateQueries({ queryKey: portalTicketQueries.detail(ticketId).queryKey })
        const updatedData = await qc.ensureQueryData(portalTicketQueries.detail(ticketId))
        const newThread = updatedData.threads?.[updatedData.threads.length - 1]

        if (newThread?.id) {
          const threadId = newThread.id as TicketThreadId
          for (const file of selectedFiles) {
            try {
              const formData = new FormData()
              formData.append('file', file)
              const res = await fetch(
                `/api/v1/tickets/${ticketId}/threads/${threadId}/attachments`,
                {
                  method: 'POST',
                  body: formData,
                }
              )
              if (!res.ok) {
                await res.text()
              } else {
                // Invalidate attachments query
                qc.invalidateQueries({
                  queryKey: ticketQueries.attachments(ticketId, threadId).queryKey,
                })
              }
            } catch {
              // Best-effort upload: reply is already created.
            }
          }
        }
      }

      setBody(null)
      setSelectedFiles([])
    } catch {
      // Error handling is done by the mutation
    }
  }

  if (isClosed) {
    return (
      <div className="rounded-md border border-dashed border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
        <FormattedMessage
          id="portal.tickets.composer.closed"
          defaultMessage="This ticket is closed. Open a new one to follow up."
        />
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-background p-3">
      <RichTextEditor
        value={body ?? undefined}
        onChange={(json) => setBody(json)}
        placeholder={placeholder}
        minHeight="100px"
        features={{
          headings: false,
          codeBlocks: true,
          blockquotes: true,
          dividers: false,
          images: true,
          taskLists: false,
          tables: false,
          embeds: false,
          slashMenu: false,
        }}
        onImageUpload={uploadImage}
      />

      {/* File picker and list */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) {
            setSelectedFiles(Array.from(e.target.files))
          }
        }}
      />

      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Attachments ({selectedFiles.length})
          </div>
          <div className="space-y-1">
            {selectedFiles.map((file) => (
              <div
                key={file.name}
                className="flex items-center justify-between rounded bg-muted/50 px-2 py-1 text-xs"
              >
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedFiles((prev) => prev.filter((f) => f.name !== file.name))
                  }
                  className="ml-2 hover:text-red-500"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-4 w-4 mr-1" />
          Attach files
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={isEmpty || reply.isPending}
          onClick={handleReply}
          aria-busy={reply.isPending}
        >
          {reply.isPending ? (
            <FormattedMessage id="portal.tickets.composer.sending" defaultMessage="Sending…" />
          ) : (
            <FormattedMessage id="portal.tickets.composer.send" defaultMessage="Send reply" />
          )}
        </Button>
      </div>
    </div>
  )
}
