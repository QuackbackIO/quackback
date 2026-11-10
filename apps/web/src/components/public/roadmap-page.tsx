import { useIntl } from 'react-intl'
import { RoadmapBoard } from '@/components/public/roadmap-board'
import { PortalPageTitle, useDesignTitles } from '@/components/public/portal-page-title'
import { usePageChoices } from '@/components/public/preview-draft-context'
import type { RoadmapView } from '@/lib/client/hooks/use-roadmaps-query'
import { cn } from '@/lib/shared/utils'

/**
 * The public roadmap page: its title and the board, laid out as the design
 * chooses. It draws the roadmaps it is given, so the designer's sample draws
 * it too.
 */
export function RoadmapPageView({
  roadmaps,
  selectedId,
  isTeamMember,
}: {
  roadmaps: RoadmapView[]
  selectedId: string | null
  isTeamMember: boolean
}) {
  const intl = useIntl()
  const designTitles = useDesignTitles()
  const choices = usePageChoices().roadmap
  // A list grows with the page; columns keep to the window and scroll inside.
  const listed = choices.board === 'list'
  const title = intl.formatMessage({ id: 'portal.roadmap.title', defaultMessage: 'Roadmap' })
  const description = intl.formatMessage({
    id: 'portal.roadmap.description',
    defaultMessage: "See what we're working on and what's coming next.",
  })

  return (
    <>
      {designTitles && <PortalPageTitle page="roadmap" title={title} subtitle={description} />}
      {/* From sm up, cap at viewport height so a column with many cards scrolls
          internally instead of pushing the body taller. 7rem ≈ PortalHeader, and
          the footer publishes its own height. On a phone the title and toolbar
          leave too little of that height, so the page grows and the columns keep
          a usable height instead of clipping. */}
      <div
        className={cn(
          'mx-auto max-w-[var(--qb-page-max,72rem)] w-full px-4 sm:px-6',
          !listed &&
            'min-h-[calc(100dvh-7rem-var(--portal-footer-height,0px))] sm:h-[calc(100dvh-7rem-var(--portal-footer-height,0px))] flex flex-col sm:min-h-0',
          designTitles ? 'pt-6 pb-8' : 'py-8'
        )}
      >
        {!designTitles && (
          <div className="mb-6 animate-in fade-in duration-200 fill-mode-backwards">
            <h1 className="text-3xl font-bold mb-2">{title}</h1>
            <p className="text-muted-foreground">{description}</p>
          </div>
        )}

        <div
          className="flex-1 min-h-0 flex flex-col animate-in fade-in duration-300 fill-mode-backwards"
          style={{ animationDelay: '100ms' }}
        >
          <RoadmapBoard
            initialRoadmaps={roadmaps}
            initialSelectedRoadmapId={selectedId}
            isTeamMember={isTeamMember}
            layout={choices.board}
          />
        </div>
      </div>
    </>
  )
}
