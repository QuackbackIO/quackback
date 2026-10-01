import { badgeLabel, type FileFamily } from '@/lib/shared/files/file-types'
import { cn } from '@/lib/shared/utils/cn'

/** One colour per family, so a format reads the same on every surface. */
const FAMILY_COLOR: Record<FileFamily, string> = {
  image: 'bg-cyan-700',
  video: 'bg-purple-700',
  audio: 'bg-pink-700',
  pdf: 'bg-red-600',
  document: 'bg-blue-600',
  spreadsheet: 'bg-green-700',
  presentation: 'bg-orange-700',
  csv: 'bg-teal-700',
  text: 'bg-zinc-600',
  code: 'bg-violet-700',
  archive: 'bg-amber-700',
  other: 'bg-zinc-500',
}

const SIZE = {
  sm: 'size-6 rounded-md text-[7.5px]',
  md: 'size-8 rounded-lg text-[9px]',
  lg: 'size-10 rounded-[10px] text-[10.5px]',
} as const

/** The type badge on every file card, row, tray tile and viewer header. */
export function FileBadge({
  name,
  family,
  size = 'md',
  className,
}: {
  name: string
  family: FileFamily
  size?: keyof typeof SIZE
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-grid shrink-0 place-items-center font-bold leading-none tracking-wide text-white',
        FAMILY_COLOR[family],
        SIZE[size],
        className
      )}
    >
      {badgeLabel(name, family)}
    </span>
  )
}
