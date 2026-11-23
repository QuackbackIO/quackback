import { cn } from '@/lib/shared/utils'

interface WideLogoProps {
  src: string
  /** The logo's dark mode version, when the workspace has one. */
  darkSrc?: string | null
  alt: string
  className?: string
}

/**
 * The wide logo, and its dark mode version where the portal is drawn dark.
 * With a dark version both images are in the page and the `.dark` class
 * (forced dark, or the visitor's preference) picks one in the stylesheet, so
 * the right logo is there on the first paint with no script. The logo is
 * never recoloured: without a dark version it shows as it is in both.
 */
export function WideLogo({ src, darkSrc, alt, className }: WideLogoProps) {
  if (!darkSrc) return <img src={src} alt={alt} className={className} />
  return (
    <>
      <img src={src} alt={alt} className={cn(className, 'dark:hidden')} />
      <img src={darkSrc} alt={alt} className={cn(className, 'hidden dark:block')} />
    </>
  )
}
