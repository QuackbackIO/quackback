import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * A design's image, such as its wordmark or band image: a preview, a file
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
}: {
  label: string
  /** Where the current file is shown from, or null when there is none. */
  url: string | null
  accept: string
  /** An address to put the file at, and the key it will have. */
  presign: (file: File) => Promise<{ uploadUrl: string; key: string }>
  onUploaded: (key: string) => void
  onRemove: () => void
}) {
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function upload(file: File) {
    setBusy(true)
    setProblem(null)
    try {
      const { uploadUrl, key } = await presign(file)
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      })
      if (!put.ok) throw new Error(`${file.name} could not be uploaded.`)
      onUploaded(key)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That file could not be uploaded.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3">
        <label htmlFor={id} className="w-32 shrink-0 text-[13px]">
          {label}
        </label>
        {url ? (
          <img
            src={url}
            alt=""
            className="h-8 max-w-[9rem] rounded-md border border-border bg-background object-contain p-0.5"
          />
        ) : (
          <span className="text-[13px] text-muted-foreground">None</span>
        )}
        <span className="ms-auto flex gap-1">
          {url && (
            <Button variant="ghost" size="sm" onClick={onRemove} disabled={busy}>
              Remove
            </Button>
          )}
          <Button variant="outline" size="sm" asChild disabled={busy}>
            <label className="cursor-pointer">
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
