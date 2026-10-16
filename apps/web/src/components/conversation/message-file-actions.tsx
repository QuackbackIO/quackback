/**
 * The overflow-menu items that change a sent message's files: "Add files…"
 * (the bubble owns the hidden file input, since the menu unmounts on close)
 * and a "Remove a file" submenu listing the message's files. Shown for the
 * same messages "Edit message" is; the server repeats the authorship check.
 * `useMessageFileChanges` uploads picked files and applies either change.
 */
import { useCallback } from 'react'
import { useIntl } from 'react-intl'
import { PaperClipIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import type { ConversationMessageId } from '@quackback/ids'
import type { AgentConversationMessageDTO, UploadedFile } from '@/lib/shared/conversation/types'
import {
  addMessageAttachmentsFn,
  removeMessageAttachmentFn,
} from '@/lib/server/functions/conversation'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'

export function MessageFileMenuItems({
  attachments,
  onAddFiles,
  onRemoveFile,
}: {
  attachments: ReadonlyArray<{ name: string }>
  onAddFiles: () => void
  onRemoveFile: (index: number, name: string) => void
}) {
  const intl = useIntl()
  return (
    <>
      <DropdownMenuItem onClick={onAddFiles}>
        <PaperClipIcon className="h-4 w-4" />
        {intl.formatMessage({ id: 'admin.messageFiles.add', defaultMessage: 'Add files…' })}
      </DropdownMenuItem>
      {attachments.length > 0 && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <XMarkIcon className="h-4 w-4" />
            {intl.formatMessage({
              id: 'admin.messageFiles.remove',
              defaultMessage: 'Remove a file',
            })}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {attachments.map((a, index) => (
              <DropdownMenuItem
                key={`${index}:${a.name}`}
                variant="destructive"
                onClick={() => onRemoveFile(index, a.name)}
              >
                <span className="max-w-56 truncate">{a.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
    </>
  )
}

/**
 * Upload picked files and add them to a sent message, or remove one of its
 * files. `onUpdated` receives the message as the server returns it (the
 * thread patches its cache with it; other viewers follow over realtime).
 */
export function useMessageFileChanges({
  upload,
  onUpdated,
}: {
  upload: (file: File) => Promise<UploadedFile>
  onUpdated: (message: AgentConversationMessageDTO) => void
}) {
  const intl = useIntl()

  const addFiles = useCallback(
    async (messageId: ConversationMessageId, files: File[]) => {
      try {
        const uploaded = await Promise.all(files.map((file) => upload(file)))
        const message = await addMessageAttachmentsFn({
          data: {
            messageId,
            attachments: uploaded.map((u) => ({
              url: u.url,
              name: u.name,
              contentType: u.contentType,
              size: u.size,
              fileId: u.fileId,
            })),
          },
        })
        onUpdated(message)
      } catch {
        toast.error(
          intl.formatMessage({
            id: 'admin.messageFiles.addFailed',
            defaultMessage: 'Could not add the files',
          })
        )
      }
    },
    [intl, onUpdated, upload]
  )

  const removeFile = useCallback(
    async (messageId: ConversationMessageId, index: number, name: string) => {
      try {
        const message = await removeMessageAttachmentFn({ data: { messageId, index, name } })
        onUpdated(message)
      } catch {
        toast.error(
          intl.formatMessage({
            id: 'admin.messageFiles.removeFailed',
            defaultMessage: 'Could not remove the file',
          })
        )
      }
    },
    [intl, onUpdated]
  )

  return { addFiles, removeFile }
}
