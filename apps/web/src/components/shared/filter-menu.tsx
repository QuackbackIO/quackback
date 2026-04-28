import { cn } from '@/lib/shared/utils'

export function CircleIcon({ className }: { className?: string }) {
  return <span className={`inline-block rounded-full bg-current ${className}`} />
}

export const MENU_BUTTON_STYLES =
  'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-muted/50 transition-colors'

interface MenuButtonProps {
  onClick: () => void
  children: React.ReactNode
  className?: string
}

export function MenuButton({ onClick, children, className }: MenuButtonProps) {
  return (
    <button type="button" onClick={onClick} className={cn(MENU_BUTTON_STYLES, className)}>
      {children}
    </button>
  )
}
