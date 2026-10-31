import { useMemo, type ReactNode } from 'react'
import { StatusColourContext } from '@/components/ui/status-badge'
import { brandStatusColour } from '@/lib/shared/design/status-colours'

/**
 * Status markers in the logo's colours, when the design asks for them: each
 * status takes the colour nearest its own hue. Without colours, statuses show
 * as stored.
 */
export function BrandStatusColours({
  colours,
  children,
}: {
  colours: readonly string[] | null | undefined
  children: ReactNode
}) {
  const key = colours?.join(' ') ?? ''
  const shown = useMemo(() => {
    const brand = key ? key.split(' ') : []
    return (colour: string) => brandStatusColour(colour, brand)
  }, [key])
  if (!key) return <>{children}</>
  return <StatusColourContext.Provider value={shown}>{children}</StatusColourContext.Provider>
}
