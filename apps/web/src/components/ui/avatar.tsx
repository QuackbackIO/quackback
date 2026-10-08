import * as React from 'react'

import { cn, getInitials } from '@/lib/shared/utils'

interface AvatarProps extends React.ComponentProps<'div'> {
  /**
   * Image URL for the avatar. Can be a regular URL or base64 data URL.
   * When provided without children, enables the simple API.
   */
  src?: string | null
  /**
   * Name used to generate initials for the fallback.
   * Also used as alt text for the image.
   */
  name?: string | null
  /**
   * Explicit fallback content (overrides auto-generated initials from name).
   */
  fallback?: React.ReactNode
  /**
   * Class name for the fallback element.
   */
  fallbackClassName?: string
  /**
   * Called once the image fails to load, including a failure that happened
   * before hydration. The fallback shows either way.
   */
  onImageError?: () => void
}

/**
 * Avatar component with two usage patterns:
 *
 * Simple API (recommended):
 * ```tsx
 * <Avatar src={avatarUrl} name="John Doe" />
 * <Avatar src={avatarUrl} fallback="JD" />
 * <Avatar name="John Doe" /> // No image, just initials
 * ```
 *
 * Advanced API (for edge cases):
 * ```tsx
 * <Avatar>
 *   <AvatarImage src={url} />
 *   <AvatarFallback>JD</AvatarFallback>
 * </Avatar>
 * ```
 */
function Avatar({
  className,
  src,
  name,
  fallback,
  fallbackClassName,
  onImageError,
  children,
  ...props
}: AvatarProps) {
  if (children) {
    return (
      <div
        data-slot="avatar"
        className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full', className)}
        {...props}
      >
        {children}
      </div>
    )
  }

  const initials = fallback ?? getInitials(name)
  const altText = name || 'Avatar'
  const fallbackEl = (
    <div
      data-slot="avatar-fallback"
      className={cn(
        'bg-muted flex size-full items-center justify-center rounded-full',
        src && 'absolute inset-0',
        fallbackClassName
      )}
    >
      {initials}
    </div>
  )

  if (!src) {
    return (
      <div
        data-slot="avatar"
        className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full', className)}
        {...props}
      >
        {fallbackEl}
      </div>
    )
  }

  return (
    <div
      data-slot="avatar"
      className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full', className)}
      {...props}
    >
      <AvatarImageWithFallback
        key={src}
        src={src}
        alt={altText}
        fallback={fallbackEl}
        onError={onImageError}
      />
    </div>
  )
}

/**
 * Eager `<img>` for the simple Avatar API. A plain `<img>` is part of the SSR
 * HTML, so the browser fetches it during the initial parse. The fallback shows
 * while loading and on error (the image stays invisible until loaded, so a failing
 * request never paints the broken-image glyph), and is removed once the image loads so transparent
 * avatars render as authored rather than showing initials through transparent
 * pixels. Caller keys this by src so a new URL resets the load state.
 */
function AvatarImageWithFallback({
  src,
  alt,
  fallback,
  onError,
}: {
  src: string
  alt: string
  fallback: React.ReactNode
  onError?: () => void
}) {
  const [status, setStatus] = React.useState<'loading' | 'loaded' | 'error'>('loading')
  const ref = React.useRef<HTMLImageElement>(null)
  const fail = () => {
    setStatus('error')
    onError?.()
  }

  React.useEffect(() => {
    const img = ref.current
    if (!img?.complete) return
    if (img.naturalWidth === 0) fail()
    else setStatus('loaded')
  }, [])

  return (
    <>
      {status !== 'loaded' && fallback}
      {status !== 'error' && (
        <img
          ref={ref}
          data-slot="avatar-image"
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={cn(
            'absolute inset-0 aspect-square size-full object-cover',
            status !== 'loaded' && 'opacity-0'
          )}
          onLoad={() => setStatus('loaded')}
          onError={fail}
        />
      )}
    </>
  )
}

function AvatarImage({ className, src, ...props }: React.ComponentProps<'img'>) {
  return (
    <img
      data-slot="avatar-image"
      src={src}
      className={cn('aspect-square size-full object-cover', className)}
      {...props}
    />
  )
}

function AvatarFallback({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="avatar-fallback"
      className={cn('bg-muted flex size-full items-center justify-center rounded-full', className)}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback }
