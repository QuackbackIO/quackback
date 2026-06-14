import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'

import { cn, getInitials } from '@/lib/shared/utils'

interface AvatarProps extends React.ComponentProps<typeof AvatarPrimitive.Root> {
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
  children,
  ...props
}: AvatarProps) {
  // If children are provided, use advanced API (passthrough)
  if (children) {
    return (
      <AvatarPrimitive.Root
        data-slot="avatar"
        className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full', className)}
        {...props}
      >
        {children}
      </AvatarPrimitive.Root>
    )
  }

  // Simple API: auto-render image and fallback
  const initials = fallback ?? getInitials(name)
  const altText = name || 'Avatar'
  // Shared fallback (initials). `absolute inset-0` only when an image layers over
  // it (the `src` case below); standalone otherwise.
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

  // If no src provided, render fallback directly (no Radix image loading state)
  if (!src) {
    return (
      <AvatarPrimitive.Root
        data-slot="avatar"
        className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full', className)}
        {...props}
      >
        {fallbackEl}
      </AvatarPrimitive.Root>
    )
  }

  // Render an eager <img> over the initials — see AvatarImageWithFallback. Keyed
  // by src so a new URL resets its load state.
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full', className)}
      {...props}
    >
      <AvatarImageWithFallback key={src} src={src} alt={altText} fallback={fallbackEl} />
    </AvatarPrimitive.Root>
  )
}

/**
 * Eager `<img>` for the simple Avatar API. A plain `<img>` is part of the SSR
 * HTML, so the browser fetches it during the initial parse — unlike Radix
 * Avatar.Image, which loads via a post-hydration effect (why avatars lagged
 * behind the SSR'd org logo). The fallback shows while loading and on error, and
 * is removed once the image loads so transparent avatars render as authored
 * rather than showing initials through transparent pixels. Caller keys this by
 * src so a new URL resets the load state.
 */
function AvatarImageWithFallback({
  src,
  alt,
  fallback,
}: {
  src: string
  alt: string
  fallback: React.ReactNode
}) {
  const [status, setStatus] = React.useState<'loading' | 'loaded' | 'error'>('loading')
  const ref = React.useRef<HTMLImageElement>(null)

  // The <img> is server-rendered, so the browser may finish/fail loading before
  // React attaches onLoad/onError at hydration — those events are then missed.
  // Reconcile from the DOM on mount.
  React.useEffect(() => {
    const img = ref.current
    if (img?.complete) setStatus(img.naturalWidth === 0 ? 'error' : 'loaded')
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
          fetchPriority="high"
          className="absolute inset-0 aspect-square size-full object-cover"
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
        />
      )}
    </>
  )
}

function AvatarImage({
  className,
  src,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  // For base64 data URLs, render a plain img to avoid async loading flicker
  if (typeof src === 'string' && src.startsWith('data:')) {
    return (
      <img
        data-slot="avatar-image"
        src={src}
        className={cn('aspect-square size-full object-cover', className)}
        {...props}
      />
    )
  }

  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      src={src}
      className={cn('aspect-square size-full', className)}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  // Default to 0 for instant SSR rendering (no delay waiting for image)
  delayMs = 0,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      delayMs={delayMs}
      className={cn('bg-muted flex size-full items-center justify-center rounded-full', className)}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback }
