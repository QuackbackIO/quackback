import { useEffect, useRef } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { portalDesignQueries } from '@/lib/client/queries/portal-design'
import { websiteIn } from '@/lib/shared/design/match-brand'

export type ArrivalAction =
  { kind: 'match'; site: string } | { kind: 'brand-kit' } | { kind: 'publish' }

/**
 * What the builder does on arrival from a link such as onboarding's
 * `/design?match=acme.com&from=onboarding`: match the brand from the website
 * named, or open the Brand kit when AI is not set up or no website is named.
 * `publish=open` opens publish, for a matched brand waiting in the draft.
 */
export function arrivalAction(input: {
  match?: string
  from?: string
  /** `match`: Settings > Portal's Match your brand, which opens the Brand kit at its match row. */
  brand?: string
  publish?: string
  aiAvailable: boolean
}): ArrivalAction | null {
  if (input.publish === 'open') return { kind: 'publish' }
  const site = input.match ? websiteIn(input.match) : null
  if (site && input.aiAvailable) return { kind: 'match', site }
  if (input.match || input.from === 'onboarding' || input.brand === 'match')
    return { kind: 'brand-kit' }
  return null
}

/**
 * Runs the arrival action once, then clears the address so a reload does not
 * run it again. `start` is the builder's own brand match (Ask AI's, so it
 * lands in the draft as one step with its Undo); this hook only decides.
 */
export function useMatchOnArrival({
  start,
  showAi,
  openBrandKit,
  openPublish,
}: {
  /** Starts the brand match from a website. */
  start: (website: string) => unknown
  /** Shows Ask AI's pane, where the match reports as it runs. */
  showAi: () => void
  openBrandKit: () => void
  /** Opens publish, its summary or full review as Publish would. */
  openPublish: () => void
}) {
  const search = useSearch({ from: '/design' })
  const navigate = useNavigate({ from: '/design' })
  const { available } = useSuspenseQuery(portalDesignQueries.aiStatus()).data
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current) return
    const action = arrivalAction({
      match: search.match,
      from: search.from,
      brand: search.brand,
      publish: search.publish,
      aiAvailable: available,
    })
    if (!action) return
    ran.current = true
    void navigate({
      search: (prev) => ({
        ...prev,
        match: undefined,
        from: undefined,
        brand: undefined,
        publish: undefined,
      }),
      replace: true,
    })
    if (action.kind === 'match') {
      showAi()
      void start(action.site)
    } else if (action.kind === 'publish') openPublish()
    else openBrandKit()
  }, [])
}
