import { useEffect, useRef } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { portalDesignQueries } from '@/lib/client/queries/portal-design'
import { websiteIn } from '@/lib/shared/design/match-brand'

export type ArrivalAction = { kind: 'match'; site: string } | { kind: 'brand-kit' }

/**
 * What the builder does on arrival from a link such as onboarding's
 * `/design?match=acme.com&from=onboarding`: match the brand from the website
 * named, or open the Brand kit when AI is not set up or no website is named.
 */
export function arrivalAction(input: {
  match?: string
  from?: string
  aiAvailable: boolean
}): ArrivalAction | null {
  const site = input.match ? websiteIn(input.match) : null
  if (site && input.aiAvailable) return { kind: 'match', site }
  if (input.match || input.from === 'onboarding') return { kind: 'brand-kit' }
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
}: {
  /** Starts the brand match from a website. */
  start: (website: string) => unknown
  /** Shows Ask AI's pane, where the match reports as it runs. */
  showAi: () => void
  openBrandKit: () => void
}) {
  const search = useSearch({ from: '/design' })
  const navigate = useNavigate({ from: '/design' })
  const { available } = useSuspenseQuery(portalDesignQueries.aiStatus()).data
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current) return
    const action = arrivalAction({ match: search.match, from: search.from, aiAvailable: available })
    if (!action) return
    ran.current = true
    void navigate({
      search: (prev) => ({ ...prev, match: undefined, from: undefined }),
      replace: true,
    })
    if (action.kind === 'match') {
      showAi()
      void start(action.site)
    } else openBrandKit()
  }, [])
}
