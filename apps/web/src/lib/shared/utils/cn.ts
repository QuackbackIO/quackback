import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Teach the merger the custom font sizes from globals.css @theme, or it reads
// `text-ui` as a colour and drops it next to `text-muted-foreground`.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ['ui', '2xs'] } },
})

/**
 * Merge Tailwind CSS classes with clsx
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
