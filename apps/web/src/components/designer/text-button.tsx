import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/shared/utils'

/**
 * A quiet text button's classes, for a plain `<button type="button">` in a
 * row drawn many times, such as a block's words rows, where a component of
 * its own would be one more to draw each time.
 */
export function textButton({
  underlined = false,
  className,
}: { underlined?: boolean; className?: string } = {}): string {
  return cn(
    'inline-flex min-h-6 items-center rounded text-2xs text-muted-foreground underline-offset-2 hover:text-foreground focus-ring',
    underlined ? 'underline' : 'hover:underline',
    className
  )
}

/**
 * A quiet text button: "Reset", "Show me", "Use its colours". Small grey words
 * that darken and underline on hover, with a 24px tall target.
 * `underlined` keeps the underline drawn, for links that sit among plain words.
 */
export function TextButton({
  underlined = false,
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { underlined?: boolean }) {
  return <button type={type} className={textButton({ underlined, className })} {...props} />
}
