import { useId } from 'react'
import { PlusIcon } from '@heroicons/react/16/solid'
import { useImageUpload } from '@/components/admin/settings/appearance/use-image-upload'
import { cn } from '@/lib/shared/utils'
import { THEME } from './properties/words'

/**
 * One image of the brand kit, as a row's value: a small thumbnail, and what
 * shows while there is none of its own, greyed, with where it comes from
 * ("Workspace logo", "From icon"). Choosing a file uploads it; the design
 * keeps its key, in the draft. Removing one is the row's Reset.
 */
export function KitImageTile({
  label,
  url,
  fallbackUrl = null,
  fallbackCaption,
  accept,
  presign,
  onUploaded,
  backdrop,
  wide = false,
}: {
  label: string
  /** The design's own image; none while it falls back. */
  url: string | null
  /** What shows in its place while there is none, drawn greyed. */
  fallbackUrl?: string | null
  /** Where the fallback comes from, in a word or two. */
  fallbackCaption?: string
  accept: string
  presign: (file: File) => Promise<{ uploadUrl: string; key: string }>
  onUploaded: (key: string, file: File) => void
  /** The colour it is shown on, such as the design's page. */
  backdrop?: string
  /** A share image's shape, wider than tall. */
  wide?: boolean
}) {
  const id = useId()
  const { busy, problem, upload } = useImageUpload(presign, onUploaded)
  const shown = url ?? fallbackUrl
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <label
        htmlFor={id}
        className="group/tile flex min-h-7 cursor-pointer items-center gap-2 rounded-md px-1.5 py-0.5 text-xs hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-muted-foreground"
      >
        <span
          // An empty tile takes the builder's colours; the design's backdrop is for an image on it.
          style={backdrop && shown ? { background: backdrop } : undefined}
          className={cn(
            'flex h-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background p-0.5',
            wide ? 'w-[61px]' : 'w-8',
            !shown && 'border-dashed text-muted-foreground'
          )}
        >
          {shown ? (
            <img
              src={shown}
              alt=""
              className={cn('max-h-full max-w-full object-contain', !url && 'opacity-50 grayscale')}
            />
          ) : (
            <PlusIcon className="size-3.5" aria-hidden="true" />
          )}
        </span>
        <span className="truncate text-muted-foreground">
          {busy ? THEME.uploading : url ? THEME.replace : (fallbackCaption ?? THEME.upload)}
        </span>
        <input
          id={id}
          type="file"
          accept={accept}
          aria-label={`${url || fallbackUrl ? 'Replace' : 'Upload'} ${label.toLowerCase()}`}
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void upload(file)
          }}
        />
      </label>
      {problem && (
        <p role="alert" className="px-1.5 text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  )
}
