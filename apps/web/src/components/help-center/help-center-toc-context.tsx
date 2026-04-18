import { createContext, useContext } from 'react'
import type { TocHeading } from './help-center-article-utils'

interface TocContextValue {
  setHeadings: (headings: TocHeading[]) => void
}

export const TocContext = createContext<TocContextValue | null>(null)

export function useTocContext() {
  return useContext(TocContext)
}
