/**
 * A picture read from a test sign-in claim, drawn by the app's own `Avatar`
 * so it loads exactly as the person's avatar will. Without a URL, or once the
 * URL fails to load, it shows an empty-picture placeholder, or nothing at all
 * where a placeholder would only add noise.
 */
import { PhotoIcon } from '@heroicons/react/24/outline'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/shared/utils'

export function ClaimPicture({
  src,
  alt,
  className,
  iconClassName,
  placeholder = true,
  onError,
}: {
  src?: string
  /** Names the picture. Omitted when it sits beside its URL, which hides it
   *  from assistive technology. */
  alt?: string
  className?: string
  iconClassName?: string
  /** False shows nothing in place of a missing or failed picture. */
  placeholder?: boolean
  onError?: () => void
}) {
  return (
    <Avatar
      src={src}
      name={alt}
      aria-hidden={alt ? undefined : true}
      className={className}
      fallback={placeholder ? <PhotoIcon className={cn('size-3.5', iconClassName)} /> : <></>}
      fallbackClassName={
        placeholder ? 'border border-dashed border-border text-muted-foreground' : 'bg-transparent'
      }
      onImageError={onError}
    />
  )
}

/** A picture beside its URL, or the placeholder and `missingText` without one. */
export function PictureWithUrl({
  url,
  missingText,
  className,
  iconClassName,
}: {
  url?: string
  missingText?: string
  /** The picture's size. */
  className?: string
  iconClassName?: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <ClaimPicture src={url} className={className} iconClassName={iconClassName} />
      <span className="min-w-0 truncate text-muted-foreground" title={url}>
        {url ?? missingText}
      </span>
    </div>
  )
}
