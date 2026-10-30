import { cn } from '@/lib/shared/utils'

/**
 * The look of every vote box: the feed card, the post page and similar
 * posts, the widget and the embed card. Each keeps its own behaviour and
 * takes its classes from here, so there is one vote style. The voted colour
 * is `--post-card-voted-color`, which the design engine points at readable
 * accent text.
 */
export type VoteBoxSize = 'default' | 'compact' | 'pill'

export interface VoteBoxState {
  voted: boolean
  /** Can be clicked to vote: off for a static count. */
  interactive: boolean
  size?: VoteBoxSize
  pending?: boolean
  /** The viewer may not vote here; a tooltip says why. */
  denied?: boolean
  disabled?: boolean
}

export function voteBoxClasses({
  voted,
  interactive,
  size = 'default',
  pending = false,
  denied = false,
  disabled = false,
}: VoteBoxState): { root: string; chevron: string; count: string } {
  const small = size !== 'default'
  const canVote = interactive && !pending && !denied && !disabled
  return {
    root: cn(
      'group/vote relative flex shrink-0 items-center justify-center rounded-md border',
      size === 'compact'
        ? 'flex-row gap-1 py-1.5 px-2.5 text-xs'
        : size === 'pill'
          ? 'flex-col self-stretch px-3.5 py-1.5 gap-1'
          : 'flex-col w-12 py-2 gap-0.5',
      voted
        ? 'post-card__vote--voted text-post-card-voted border-post-card-voted/60 bg-post-card-voted/15 bg-clip-padding'
        : 'bg-muted/40 text-muted-foreground border-border/50',
      interactive && 'transition-colors duration-200',
      interactive &&
        !voted &&
        !denied &&
        'hover:border-border hover:bg-muted/60 hover:text-foreground/80',
      pending && 'opacity-70 cursor-wait',
      disabled && 'cursor-not-allowed opacity-50',
      !disabled && denied && 'cursor-not-allowed opacity-60'
    ),
    chevron: cn(
      small ? 'h-3.5 w-3.5' : 'h-4 w-4',
      interactive && 'transition-transform duration-200',
      voted && 'fill-post-card-voted',
      canVote && 'group-hover/vote:-translate-y-0.5'
    ),
    count: cn(
      'font-semibold tabular-nums',
      small ? 'text-xs' : 'text-sm',
      voted ? 'text-post-card-voted' : 'text-foreground'
    ),
  }
}
