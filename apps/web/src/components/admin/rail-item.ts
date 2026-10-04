import { cn } from '@/lib/shared/utils'

/** A rail row: 32px, 13.5px, on the chrome ground; the active row is pressed in with a yellow icon. */
export function railControlClass(isActive = false) {
  return cn(
    'relative box-border flex min-h-8 w-full items-center gap-2.5 rounded-field border border-transparent px-2.5',
    'text-[13.5px]/[1.42857] font-normal text-chrome-rail-text transition-all duration-200 hover:bg-chrome-hover',
    'outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-chrome-focus',
    '[&>svg]:size-[17px] [&>svg]:text-chrome-icon',
    isActive &&
      'bg-chrome-active font-medium text-chrome-active-text shadow-chrome-active [&>svg]:text-chrome-active-icon'
  )
}
