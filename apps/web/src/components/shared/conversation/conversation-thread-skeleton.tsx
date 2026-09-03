import { FormattedMessage } from 'react-intl'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/shared/utils'

/**
 * Placeholder for a conversation thread while its first page loads.
 *
 * Mirrors the real message rows (`px-3 py-1.5`, `rounded-2xl px-3.5 py-2.5`
 * bubbles, one `text-sm leading-relaxed` line = 22.75px, so a 1-line bubble is
 * 42.75px and a 2-line bubble 65.5px; peer bubbles carry the 16.5px author
 * caption underneath).
 *
 *  - `greeting`: a brand-new thread has no history — only the team's welcome
 *    bubble is coming, top-anchored exactly where the real one renders.
 *  - `thread`: an existing conversation — a short run of alternating bubbles
 *    pinned to the bottom, where the newest messages land. No per-row fade:
 *    stacked with `animate-pulse`'s own dip, faded bubbles vanish on white.
 */
export function ConversationThreadSkeleton({
  variant = 'thread',
  className,
}: {
  variant?: 'thread' | 'greeting'
  className?: string
}) {
  const bubbles: { side: 'peer' | 'visitor'; width: string; lines: 1 | 2 }[] =
    variant === 'greeting'
      ? [{ side: 'peer', width: 'w-[69%]', lines: 1 }]
      : [
          { side: 'peer', width: 'w-[72%]', lines: 2 },
          { side: 'visitor', width: 'w-[48%]', lines: 1 },
          { side: 'peer', width: 'w-[64%]', lines: 2 },
          { side: 'visitor', width: 'w-[56%]', lines: 1 },
        ]
  return (
    <div
      role="status"
      aria-busy="true"
      className={cn(
        'flex h-full flex-col animate-in fade-in duration-200 motion-reduce:animate-none',
        variant === 'thread' && 'justify-end',
        className
      )}
    >
      <span className="sr-only">
        <FormattedMessage id="widget.loading" defaultMessage="Loading…" />
      </span>
      {bubbles.map((b, i) => (
        <div key={i} className="px-3 py-1.5">
          <div className={cn('flex flex-col', b.side === 'visitor' ? 'items-end' : 'items-start')}>
            {/* Static, same fills as the real bubbles (bg-muted peer / primary
                visitor) so the swap changes content, not colour. Not pulsed:
                bg-muted is already near-white, and pulse's 50% dip would make
                the bubbles vanish. The caption bars carry the motion. */}
            <div
              className={cn(
                'rounded-2xl',
                b.width,
                b.lines === 1 ? 'h-[42.75px]' : 'h-[65.5px]',
                b.side === 'visitor' ? 'bg-primary/40' : 'bg-muted'
              )}
            />
            {b.side === 'peer' && (
              <div className="mt-1 flex h-[16.5px] items-center px-1">
                <Skeleton className="h-2 w-14" />
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
