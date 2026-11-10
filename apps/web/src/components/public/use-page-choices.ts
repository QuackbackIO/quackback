import { useMemo } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { readPageChoices, type PageChoices } from '@/lib/shared/design/page-choices'
import { usePreviewDesignAttributes } from './preview-draft-context'

/**
 * The Changelog, Help Center and Roadmap pages' choices: the draft's while
 * the designer previews one, else the published design's. Without a design,
 * or without a choice, each page is drawn as it always was.
 */
export function usePageChoices(): PageChoices {
  const saved = useRouteContext({
    from: '__root__',
    select: (context) => {
      const design = context.settings?.portalDesign
      return design?.engine === 'v2' ? design.attributes : undefined
    },
  })
  const draft = usePreviewDesignAttributes()
  const attributes = draft ?? saved
  return useMemo(() => readPageChoices(attributes), [attributes])
}
