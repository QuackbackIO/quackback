import { useCallback, useRef } from 'react'
import {
  readWordsField,
  wordsChangeLabel,
  wordsDocOf,
  wordsKindOf,
} from '@/lib/shared/design/headline-words'
import { fitDoc, oneLine, plainDoc, sameWords, type WordsDoc } from '@/lib/shared/design/rich-words'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { NO_STRUCTURE } from './designer-canvas'
import { dispatcher } from './dispatcher'

/**
 * What the canvas needs beyond the draft's design: no structural draft, as
 * the welcome message travels with the design like every other part; and
 * words typed on the page, saved where they belong.
 */
export function useCanvasInput(
  design: PortalDesign,
  update: (change: (draft: PortalDesign) => void, label?: string) => void,
  locale: string
) {
  const latest = useRef(design)
  latest.current = design
  const onWords = useCallback(
    (mark: string, value: WordsDoc | string) => {
      const field = readWordsField(mark)
      if (!field) return
      const doc = typeof value === 'string' ? plainDoc(oneLine(value)) : value
      const before = wordsDocOf(latest.current, field, locale)
      const kind = wordsKindOf(field)
      if (sameWords(fitDoc(before, kind), fitDoc(doc, kind))) return
      dispatcher(latest.current, update)(
        { op: 'words.set', field, locale, doc },
        wordsChangeLabel(field, before, doc)
      )
    },
    [update, locale]
  )
  return { structural: NO_STRUCTURE, onWords }
}
