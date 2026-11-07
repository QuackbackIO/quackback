import { useCallback, useMemo, useRef } from 'react'
import type { TiptapContent } from '@/lib/shared/db-types'
import {
  readWordsField,
  setWordsDoc,
  wordsChangeLabel,
  wordsDocOf,
  wordsKindOf,
} from '@/lib/shared/design/headline-words'
import { fitDoc, oneLine, plainDoc, sameWords, type WordsDoc } from '@/lib/shared/design/rich-words'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'

const EMPTY = { type: 'doc', content: [] } as TiptapContent

/**
 * What the canvas needs beyond the draft's styles: the welcome message on its
 * structural channel, built again only when its words change; and words typed
 * on the page, saved where they belong.
 */
export function useCanvasInput(
  design: PortalDesign,
  update: (change: (draft: PortalDesign) => void, label?: string) => void,
  locale: string
) {
  const latest = useRef(design)
  latest.current = design
  const welcome = design.pages.feedback.welcome
  const welcomeKey = welcome.show ? JSON.stringify(welcome.body) : ''
  const structural = useMemo(() => {
    const body = welcomeKey ? (JSON.parse(welcomeKey) as TiptapContent) : null
    return { welcomeCard: { body: body && !isEmptyTiptapDoc(body) ? body : EMPTY } }
  }, [welcomeKey])
  const onWords = useCallback(
    (mark: string, value: WordsDoc | string) => {
      const field = readWordsField(mark)
      if (!field) return
      const doc = typeof value === 'string' ? plainDoc(oneLine(value)) : value
      const before = wordsDocOf(latest.current, field, locale)
      const kind = wordsKindOf(field)
      if (sameWords(fitDoc(before, kind), fitDoc(doc, kind))) return
      update((next) => setWordsDoc(next, field, locale, doc), wordsChangeLabel(field, before, doc))
    },
    [update, locale]
  )
  return { structural, onWords }
}
