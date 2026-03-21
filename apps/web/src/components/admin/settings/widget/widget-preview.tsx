import { useState } from 'react'
import { ChevronUpIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'

interface WidgetPreviewProps {
  position: 'bottom-right' | 'bottom-left'
}

export function WidgetPreview({ position }: WidgetPreviewProps) {
  const [isOpen, setIsOpen] = useState(true)

  return (
    <div className="relative rounded-lg border border-border bg-muted/30 overflow-hidden h-[520px]">
      {/* Simulated page background */}
      <PageBackdrop />

      {/* Widget panel (when open) */}
      {isOpen && (
        <div
          className={cn(
            'absolute bottom-14 w-[260px] rounded-xl border border-border bg-background shadow-xl overflow-hidden flex flex-col',
            position === 'bottom-left' ? 'left-3' : 'right-3'
          )}
          style={{ height: '380px' }}
        >
          {/* Search + close */}
          <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 shrink-0">
            <div className="relative flex-1 min-w-0">
              <MagnifyingGlassIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
              <div className="w-full pl-6 pr-2 py-1.5 text-[10px] rounded-lg border border-border bg-muted/30 text-muted-foreground/60">
                What's on your mind?
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="w-5 h-5 flex items-center justify-center rounded-md hover:bg-muted transition-colors shrink-0"
            >
              <XMarkIcon className="w-3 h-3 text-muted-foreground" />
            </button>
          </div>

          {/* Post list */}
          <div className="flex-1 overflow-hidden px-2.5 pb-1.5">
            <p className="text-[8px] font-medium text-muted-foreground/60 uppercase tracking-wide px-0.5 py-1">
              Popular ideas
            </p>
            <div className="space-y-0.5">
              <MockPost title="Add dark mode support" votes={42} voted />
              <MockPost title="Mobile app improvements" votes={28} />
              <MockPost title="Export data to CSV" votes={19} />
              <MockPost title="Keyboard shortcuts" votes={14} voted />
              <MockPost title="Custom notification rules" votes={11} />
            </div>
          </div>

          {/* Footer */}
          <div className="px-2.5 py-1 border-t border-border text-center shrink-0">
            <span className="inline-flex items-center gap-0.5 text-[8px] text-muted-foreground/60">
              <img src="/logo.png" alt="" width={10} height={10} className="opacity-60" />
              Powered by Quackback
            </span>
          </div>
        </div>
      )}

      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'absolute bottom-3 flex items-center justify-center w-8 h-8 rounded-full',
          'bg-primary text-primary-foreground shadow-md',
          'transition-all hover:shadow-lg hover:-translate-y-0.5',
          position === 'bottom-left' ? 'left-3' : 'right-3'
        )}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4.913 2.658c2.075-.27 4.19-.408 6.337-.408 2.147 0 4.262.139 6.337.408 1.922.25 3.291 1.861 3.405 3.727a4.403 4.403 0 0 0-1.032-.211 50.89 50.89 0 0 0-8.42 0c-2.358.196-4.04 2.19-4.04 4.434v4.286a4.47 4.47 0 0 0 2.433 3.984L7.28 21.53A.75.75 0 0 1 6 21v-4.03a48.527 48.527 0 0 1-1.087-.128C2.905 16.58 1.5 14.833 1.5 12.862V6.638c0-1.97 1.405-3.718 3.413-3.979Z" />
          <path d="M15.75 7.5c-1.376 0-2.739.057-4.086.169C10.124 7.797 9 9.103 9 10.609v4.285c0 1.507 1.128 2.814 2.67 2.94 1.243.102 2.5.157 3.768.165l2.782 2.781a.75.75 0 0 0 1.28-.53v-2.39l.33-.026c1.542-.125 2.67-1.433 2.67-2.94v-4.286c0-1.505-1.125-2.811-2.664-2.94A49.392 49.392 0 0 0 15.75 7.5Z" />
        </svg>
      </button>
    </div>
  )
}

function MockPost({
  title,
  votes,
  voted = false,
}: {
  title: string
  votes: number
  voted?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg hover:bg-muted/30 transition-colors px-1 py-1">
      <div
        className={cn(
          'flex flex-col items-center justify-center shrink-0 w-7 h-7 rounded-md border text-center',
          voted
            ? 'text-primary border-primary/60 bg-primary/15'
            : 'bg-muted/30 text-muted-foreground border-border/50'
        )}
      >
        <ChevronUpIcon className={cn('h-2.5 w-2.5', voted && 'text-primary')} />
        <span
          className={cn(
            'text-[8px] font-semibold leading-none',
            voted ? 'text-primary' : 'text-foreground'
          )}
        >
          {votes}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-medium text-foreground line-clamp-1">{title}</p>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="size-1 rounded-full bg-chart-4 shrink-0" />
          <span className="text-[7px] text-muted-foreground">In Progress</span>
        </div>
      </div>
    </div>
  )
}

function PageBackdrop() {
  return (
    <div className="absolute inset-0 p-4 pointer-events-none select-none opacity-40">
      {/* Nav bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-muted-foreground/20" />
          <div className="w-16 h-2.5 rounded-full bg-muted-foreground/15" />
        </div>
        <div className="flex items-center gap-3">
          <div className="w-12 h-2 rounded-full bg-muted-foreground/10" />
          <div className="w-12 h-2 rounded-full bg-muted-foreground/10" />
          <div className="w-12 h-2 rounded-full bg-muted-foreground/10" />
        </div>
      </div>
      {/* Hero */}
      <div className="mt-8 mb-6 space-y-2 max-w-[60%]">
        <div className="w-48 h-3 rounded-full bg-muted-foreground/15" />
        <div className="w-36 h-3 rounded-full bg-muted-foreground/10" />
        <div className="w-full h-2 rounded-full bg-muted-foreground/8 mt-3" />
        <div className="w-4/5 h-2 rounded-full bg-muted-foreground/8" />
      </div>
      {/* Content blocks */}
      <div className="grid grid-cols-3 gap-3 mt-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-muted-foreground/10 p-3 space-y-2">
            <div className="w-8 h-8 rounded bg-muted-foreground/10" />
            <div className="w-full h-2 rounded-full bg-muted-foreground/10" />
            <div className="w-3/4 h-2 rounded-full bg-muted-foreground/8" />
          </div>
        ))}
      </div>
    </div>
  )
}
