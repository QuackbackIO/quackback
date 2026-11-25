import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/shared/utils'

export interface TeamFace {
  name: string
  avatarUrl: string | null
}

/**
 * Overlapping teammate avatars. The overlap stays shallow (2px, plus the 2px ring) and earlier
 * faces stack on top, so two-letter initials are never cut by a neighbour.
 * `ringClassName` matches the surface behind the pile (e.g. `ring-card`).
 */
export function TeamFacepile({
  faces,
  ringClassName,
  className,
}: {
  faces: TeamFace[]
  ringClassName: string
  className?: string
}) {
  return (
    <span className={cn('flex shrink-0 items-center -space-x-0.5', className)} aria-hidden>
      {faces.map((face, i) => (
        <Avatar
          key={`${face.name}-${i}`}
          src={face.avatarUrl}
          name={face.name}
          className={cn('size-7 text-[10px] ring-2', ringClassName)}
          style={{ zIndex: faces.length - i }}
        />
      ))}
    </span>
  )
}
