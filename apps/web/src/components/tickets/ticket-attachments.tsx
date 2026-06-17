import { useState } from 'react'
import { FormattedMessage } from 'react-intl'
import { Download, Eye, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Attachment {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  publicUrl: string | null
  createdAt: string
}

interface TicketAttachmentsProps {
  attachments: Attachment[]
  isLoading?: boolean
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return '🖼️'
  if (mimeType.startsWith('video/')) return '🎬'
  if (mimeType.startsWith('audio/')) return '🎵'
  if (mimeType === 'application/pdf') return '📄'
  if (
    mimeType.includes('word') ||
    mimeType.includes('document') ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return '📝'
  }
  if (
    mimeType.includes('spreadsheet') ||
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return '📊'
  }
  if (mimeType.includes('zip') || mimeType.includes('compressed')) return '📦'
  return '📎'
}

function canPreview(mimeType: string): boolean {
  return (
    mimeType.startsWith('image/') ||
    mimeType.startsWith('video/') ||
    mimeType === 'application/pdf' ||
    mimeType === 'text/plain' ||
    mimeType === 'text/csv'
  )
}

export function TicketAttachments({ attachments, isLoading }: TicketAttachmentsProps) {
  const [previewId, setPreviewId] = useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <FormattedMessage
          id="tickets.attachments.loading"
          defaultMessage="Loading attachments..."
        />
      </div>
    )
  }

  if (!attachments || attachments.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium">
        <FormattedMessage
          id="tickets.attachments.title"
          defaultMessage="Attachments ({count})"
          values={{ count: attachments.length }}
        />
      </h4>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {attachments.map((attachment) => (
          <div
            key={attachment.id}
            className="flex flex-col gap-2 rounded-lg border border-border/50 bg-muted/30 p-3 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start gap-2">
              <span className="text-2xl flex-shrink-0">{getFileIcon(attachment.mimeType)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" title={attachment.filename}>
                  {attachment.filename}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(attachment.sizeBytes)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {attachment.publicUrl && canPreview(attachment.mimeType) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => setPreviewId(previewId === attachment.id ? null : attachment.id)}
                >
                  <Eye className="h-3 w-3 mr-1" />
                  <FormattedMessage id="tickets.attachments.preview" defaultMessage="Preview" />
                </Button>
              )}
              {attachment.publicUrl && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild>
                  <a href={attachment.publicUrl} download={attachment.filename}>
                    <Download className="h-3 w-3 mr-1" />
                    <FormattedMessage id="tickets.attachments.download" defaultMessage="Download" />
                  </a>
                </Button>
              )}
            </div>

            {previewId === attachment.id && attachment.publicUrl && (
              <div className="mt-2 rounded border border-border/50 bg-background p-2 overflow-hidden">
                {attachment.mimeType.startsWith('image/') ? (
                  <img
                    src={attachment.publicUrl}
                    alt={attachment.filename}
                    className="max-h-48 w-full object-contain rounded"
                  />
                ) : attachment.mimeType.startsWith('video/') ? (
                  <video src={attachment.publicUrl} controls className="max-h-48 w-full rounded" />
                ) : attachment.mimeType === 'application/pdf' ? (
                  <iframe
                    src={`${attachment.publicUrl}#toolbar=0`}
                    className="h-48 w-full rounded"
                    title={attachment.filename}
                  />
                ) : (
                  <div className="text-xs text-muted-foreground p-2 bg-muted/50 rounded text-center">
                    <FormattedMessage
                      id="tickets.attachments.preview.unavailable"
                      defaultMessage="Preview not available"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
