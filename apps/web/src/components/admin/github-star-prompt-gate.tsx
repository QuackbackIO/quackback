import { lazy, Suspense, useEffect, useState } from 'react'
import { onShipMoment } from '@/lib/client/ship-moment'

const GithubStarPromptCard = lazy(() =>
  import('./github-star-prompt').then((m) => ({ default: m.GithubStarPromptCard }))
)

/**
 * Mounted on every admin page of a self-hosted install. The star card's code
 * loads only after the first ship moment, so ordinary pages carry none of it.
 */
export function GithubStarPromptGate() {
  const [shipped, setShipped] = useState(false)
  useEffect(() => (shipped ? undefined : onShipMoment(() => setShipped(true))), [shipped])
  return shipped ? (
    <Suspense fallback={null}>
      <GithubStarPromptCard />
    </Suspense>
  ) : null
}
