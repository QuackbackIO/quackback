import { Suspense, type ReactNode } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { AreaMessages } from '@/components/shared/area-messages'
import { PortalBand } from '@/components/public/portal-band'
import { usePreviewHome, usePreviewSamples } from '@/components/public/preview-draft-context'
import { withGridPlaces } from '@/lib/shared/design/home-legacy'
import { drawnMainAction } from '@/lib/shared/design/main-action'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import {
  blockShown,
  HOME_GRID_CLASS,
  HOME_GRID_STYLE,
  HomeAreas,
  HomeBlockView,
  HomeComposer,
  homeLayout,
} from './home-blocks'
import type { HomeAreaMessages } from './home-prefetch'
import { emptyBlocks, WithHomeData } from './home-empty'
import { HeroButtons, HeroSearch } from './hero-action'

export { loadHome } from './home-prefetch'

type AreaStrings = HomeAreaMessages

/** The help and status blocks' strings, loaded with the page. */
function WithAreas({ messages, children }: { messages: AreaStrings; children: ReactNode }) {
  let content = children
  if (messages.helpCenter)
    content = (
      <AreaMessages area="helpCenter" messages={messages.helpCenter}>
        {content}
      </AreaMessages>
    )
  if (messages.statusPage)
    content = (
      <AreaMessages area="statusPage" messages={messages.statusPage}>
        {content}
      </AreaMessages>
    )
  return content
}

/**
 * Home: the band with Home's headline, then its blocks on a grid of twelve
 * columns at large sizes, each in its own place, as a dashboard's panels.
 * Tablets lay them out on two columns; phones stack them in reading order.
 */
export function PortalHome({
  messages = {},
  gates,
}: {
  messages?: AreaStrings
  /** Which pages exist, from the loader. */
  gates: PortalPageGates
}) {
  const design = useRouteContext({
    from: '__root__',
    select: (context) => context.settings?.portalDesign,
  })
  const draftHome = usePreviewHome()
  // In the builder a block with nothing to show draws samples, so none is left out.
  const samples = usePreviewSamples()
  if (design?.engine !== 'v2') return null
  // A Home stored before the grid, at widths, takes its places as it is drawn.
  const home = withGridPlaces(draftHome ?? design.home) as typeof design.home
  // The hero's main action: the composer moves into the band, the grid keeping every other
  // block's place; the help search or a call to action sit there with the composer on the grid.
  const action = drawnMainAction(home, gates)
  const inBand =
    action === 'composer'
      ? home.blocks.findIndex((block) => block.type === 'composer' && blockShown(block, gates))
      : -1
  // The blocks laid out, without those that draw nothing once their data is in.
  const blocks = (leaveOut: ReadonlySet<number>) => {
    const layout = homeLayout(home, gates, leaveOut)
    return (
      <HomeAreas areas={layout.areas}>
        {layout.order.map((index) => {
          const block = home.blocks[index]!
          return (
            <HomeBlockView
              key={block.id ?? `${block.type}-${index}`}
              block={block}
              index={index}
              gates={gates}
            />
          )
        })}
      </HomeAreas>
    )
  }
  return (
    <>
      {action === 'search' ? (
        <PortalBand page="home" action="search">
          <WithAreas messages={messages}>
            <HeroSearch />
          </WithAreas>
        </PortalBand>
      ) : action === 'button' ? (
        <PortalBand page="home" action="button">
          <HeroButtons home={home} gates={gates} />
        </PortalBand>
      ) : (
        <PortalBand page="home">{inBand >= 0 ? <HomeComposer inBand /> : null}</PortalBand>
      )}
      <div
        data-qb-section="home"
        data-qb-grid=""
        style={HOME_GRID_STYLE}
        className={`mx-auto w-full max-w-[var(--qb-page-max,72rem)] gap-[var(--qb-feed-gap,1rem)] px-4 py-6 sm:px-6 [[data-qb-cards=list]_&]:gap-4 ${HOME_GRID_CLASS}`}
      >
        <WithAreas messages={messages}>
          <Suspense fallback={blocks(emptyBlocks(home.blocks, {}, { samples }))}>
            <WithHomeData blocks={home.blocks} gates={gates}>
              {(data) => blocks(emptyBlocks(home.blocks, data, { samples }))}
            </WithHomeData>
          </Suspense>
        </WithAreas>
      </div>
    </>
  )
}
