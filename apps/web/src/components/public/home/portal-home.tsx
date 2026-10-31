import type { ReactNode } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { AreaMessages } from '@/components/shared/area-messages'
import { PortalBand } from '@/components/public/portal-band'
import { HomeBlockView } from './home-blocks'

type AreaStrings = Partial<Record<'helpCenter' | 'statusPage', Record<string, string>>>

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
 * Home: the band with Home's headline, then its blocks on a grid of six
 * columns at large sizes. Blocks fill rows in order and wrap when the next
 * one does not fit; there is no free positioning.
 */
export function PortalHome({ messages = {} }: { messages?: AreaStrings }) {
  const design = useRouteContext({
    from: '__root__',
    select: (context) => context.settings?.portalDesign,
  })
  if (design?.engine !== 'v2') return null
  return (
    <>
      <PortalBand page="home" />
      <div
        data-qb-section="home"
        className="mx-auto grid w-full max-w-[var(--qb-page-max,72rem)] grid-cols-1 gap-[var(--qb-feed-gap,1rem)] px-4 py-6 sm:px-6 md:grid-cols-2 lg:grid-cols-6 [[data-qb-cards=list]_&]:gap-4"
      >
        <WithAreas messages={messages}>
          {design.home.blocks.map((block, index) => (
            <HomeBlockView key={`${block.type}-${index}`} block={block} index={index} />
          ))}
        </WithAreas>
      </div>
    </>
  )
}
