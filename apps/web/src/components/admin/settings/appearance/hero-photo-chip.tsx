import { useId } from 'react'
import { MATCH_BRAND } from '@/lib/shared/design/match-brand'
import { cn } from '@/lib/shared/utils'
import { presignBandImage } from './design-update'
import { useImageUpload } from './use-image-upload'

/**
 * "Add a hero photo" as a chip: picking a file uploads it where hero images
 * go and hands back its key. Offered after a brand match on a site that leads
 * with a photo, and in the hero's panel while the hero has none.
 */
export function HeroPhotoChip({
  onUploaded,
  disabled = false,
  className,
}: {
  onUploaded: (key: string) => void
  disabled?: boolean
  className?: string
}) {
  const id = useId()
  const { busy, problem, upload } = useImageUpload(presignBandImage, (key) => onUploaded(key))
  return (
    <span className="inline-flex flex-col gap-1">
      <label
        htmlFor={id}
        aria-disabled={disabled || busy}
        className={cn(
          'cursor-pointer rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-muted-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50',
          className
        )}
      >
        {busy ? 'Uploading…' : MATCH_BRAND.addHeroPhoto}
        <input
          id={id}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          disabled={disabled || busy}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void upload(file)
          }}
        />
      </label>
      {problem && (
        <span role="alert" className="text-xs text-destructive">
          {problem}
        </span>
      )}
    </span>
  )
}
