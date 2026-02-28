'use client'

import { useState } from 'react'
import { SparklesIcon, ChevronDownIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { TimeAgo } from '@/components/ui/time-ago'

interface PostSummaryJson {
  summary: string
  suggestions: string[]
}

interface AiSummaryCardProps {
  summaryJson: PostSummaryJson | null
  summaryUpdatedAt: Date | string | null
  summaryCommentCount: number | null
  currentCommentCount: number
}

export function AiSummaryCard({
  summaryJson,
  summaryUpdatedAt,
  summaryCommentCount,
  currentCommentCount,
}: AiSummaryCardProps) {
  const [isOpen, setIsOpen] = useState(true)

  const isStale = summaryCommentCount != null && currentCommentCount > summaryCommentCount

  // Generating state: no summary yet
  if (!summaryJson) {
    return (
      <div className="border border-border/30 rounded-lg bg-muted/5 mb-4">
        <div className="flex items-center gap-2 px-4 py-3">
          <SparklesIcon className="size-4 text-amber-500/80" />
          <span className="text-sm font-medium text-muted-foreground">AI Summary</span>
        </div>
        <div className="px-4 pb-4">
          <p className="text-sm text-muted-foreground italic">Summary is being generated...</p>
        </div>
      </div>
    )
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="border border-border/30 rounded-lg bg-muted/5 mb-4">
        {/* Header */}
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/10 transition-colors rounded-t-lg"
          >
            <SparklesIcon className="size-4 text-amber-500/80 shrink-0" />
            <span className="text-sm font-medium">AI Summary</span>
            <div className="flex-1" />
            {summaryUpdatedAt && (
              <span className="text-xs text-muted-foreground">
                Updated <TimeAgo date={summaryUpdatedAt} />
              </span>
            )}
            {isStale && (
              <span className="text-xs text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded font-medium">
                Stale
              </span>
            )}
            <ChevronDownIcon
              className={cn(
                'size-3.5 text-muted-foreground transition-transform duration-200',
                isOpen && 'rotate-180'
              )}
            />
          </button>
        </CollapsibleTrigger>

        {/* Body */}
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <div className="px-4 pb-4 space-y-3">
            {/* Summary prose */}
            <p className="text-sm text-foreground/90 leading-relaxed">{summaryJson.summary}</p>

            {/* Suggestions */}
            {summaryJson.suggestions.length > 0 && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Suggestions:</span>
                <ul className="mt-1 space-y-0.5">
                  {summaryJson.suggestions.map((suggestion, i) => (
                    <li key={i} className="text-xs text-foreground/70 flex gap-1.5">
                      <span className="text-muted-foreground/60 shrink-0">-</span>
                      {suggestion}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
