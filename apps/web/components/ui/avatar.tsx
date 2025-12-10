'use client'

import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'

import { cn } from '@/lib/utils'
import { getInitials } from '@quackback/domain/utils'

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

  // If no src provided, render fallback directly (no Radix image loading state)
  if (!src) {
    return (
      <AvatarPrimitive.Root
        data-slot="avatar"
        className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full', className)}
        {...props}
      >
        <div
          data-slot="avatar-fallback"
          className={cn(
            'bg-muted flex size-full items-center justify-center rounded-full',
            fallbackClassName
          )}
        >
          {initials}
        </div>
      </AvatarPrimitive.Root>
    )
  }

  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full', className)}
      {...props}
    >
      <AvatarImage src={src} alt={altText} />
      <AvatarFallback className={fallbackClassName}>{initials}</AvatarFallback>
    </AvatarPrimitive.Root>
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
