import { cn } from '@/lib/shared/utils'

const PALETTE = [
  { bg: 'bg-indigo-600', fg: 'text-white' },
  { bg: 'bg-sky-500', fg: 'text-white' },
  { bg: 'bg-stone-500', fg: 'text-white' },
  { bg: 'bg-emerald-600', fg: 'text-white' },
  { bg: 'bg-pink-600', fg: 'text-white' },
  { bg: 'bg-violet-600', fg: 'text-white' },
  { bg: 'bg-orange-600', fg: 'text-white' },
  { bg: 'bg-cyan-600', fg: 'text-white' },
] as const

export function connectorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
  }
  return name.trim().slice(0, 2).toUpperCase() || '?'
}

export function connectorMarkTone(name: string): { bg: string; fg: string } {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]!
}

export function ConnectorMark({
  name,
  builtin,
  size = 'md',
  className,
}: {
  name: string
  builtin?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const tone = builtin ? { bg: 'bg-amber-400', fg: 'text-amber-950' } : connectorMarkTone(name)
  const box =
    size === 'lg'
      ? 'size-10 rounded-[10px] text-[15px]'
      : size === 'sm'
        ? 'size-7 rounded-md text-[11px]'
        : 'size-8 rounded-lg text-[13px]'
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-bold',
        box,
        tone.bg,
        tone.fg,
        className
      )}
    >
      {builtin ? 'Q' : connectorInitials(name)}
    </span>
  )
}
