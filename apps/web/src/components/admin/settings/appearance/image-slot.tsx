import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { useImageUpload } from './use-image-upload'

/**
 * A design's image, such as its wordmark or hero image: a preview, a file
 * picker and a remove button. The file goes straight to storage; the design
 * keeps its key.
 */
export function ImageSlot({
  label,
  url,
  accept,
  presign,
  onUploaded,
  onRemove,
  removable = true,
}: {
  label: string
  /** Where the current file is shown from, or null when there is none. */
  url: string | null
  accept: string
  /** An address to put the file at, and the key it will have. */
  presign: (file: File) => Promise<{ uploadUrl: string; key: string }>
  onUploaded: (key: string, file: File) => void
  onRemove: () => void
  /** Whether the file shown can be removed here; one shown from elsewhere cannot. */
  removable?: boolean
}) {
  const id = useId()
  const { busy, problem, upload } = useImageUpload(presign, onUploaded)

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <label htmlFor={id} className="w-32 shrink-0 text-[13px]">
          {label}
        </label>
        {url ? (
          <img
            src={url}
            alt=""
            className="h-8 max-w-[6rem] rounded-md border border-border bg-background object-contain p-0.5"
          />
        ) : (
          <span className="text-[13px] text-muted-foreground">None</span>
        )}
        <span className="ms-auto flex gap-1">
          {url && removable && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              disabled={busy}
              aria-label={`Remove ${label.toLowerCase()}`}
            >
              Remove
            </Button>
          )}
          <Button variant="outline" size="sm" asChild disabled={busy}>
            <label className="cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2">
              {busy ? 'Uploading…' : url ? 'Replace' : 'Upload'}
              <input
                id={id}
                type="file"
                accept={accept}
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void upload(file)
                }}
              />
            </label>
          </Button>
        </span>
      </div>
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  )
}
