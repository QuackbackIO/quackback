import { useCallback, useRef } from 'react'
import { useDesignAi } from '@/components/admin/settings/appearance/use-design-ai'
import {
  designPreview,
  type useDesignDraft,
} from '@/components/admin/settings/appearance/use-design-draft'
import { openCheckFrame } from '@/lib/client/check-frame'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { canvasSrc } from './designer-canvas'
import type { DesignerPage } from '@/lib/shared/design/outline'
import type { SupportedLocale } from '@/lib/shared/i18n'

/** The designer's own canvas, which the brand match's check reads the drawn preview from. */
const canvasFrame = () => document.querySelector<HTMLIFrameElement>('iframe[data-designer-canvas]')

/**
 * The check's own frame: Home (the page a brand match changes), signed out
 * as visitors see it, in the design's own theme and the language shown.
 */
const openHome = (locale: SupportedLocale) => (design: PortalDesign) =>
  openCheckFrame({
    src: canvasSrc({
      page: 'home',
      theme: design.mode === 'dark' ? 'dark' : 'light',
      locale,
      sort: 'trending',
      visitor: 'out',
    }),
    design,
    preview: designPreview,
  })

/**
 * Quackback AI's conversation for the designer, told the page and language
 * shown. Each step the AI applies is reported with the draft before and
 * after it, so the canvas can outline what changed.
 */
export function useDesignerAi(
  draft: Pick<
    ReturnType<typeof useDesignDraft>,
    'flush' | 'adopt' | 'update' | 'replace' | 'begin' | 'end' | 'design'
  >,
  view: { page: DesignerPage; locale: SupportedLocale },
  workspaceName: string,
  onApplied?: (before: PortalDesign, after: PortalDesign) => void
) {
  // The draft as it is when a request starts, read without re-rendering on every change.
  const latest = useRef(draft.design)
  latest.current = draft.design
  const applied = useRef(onApplied)
  applied.current = onApplied
  const { adopt } = draft
  const adoptAndShow = useCallback(
    (...args: Parameters<typeof adopt>) => {
      const before = latest.current
      adopt(...args)
      applied.current?.(before, args[0])
    },
    [adopt]
  )
  return {
    ai: useDesignAi({
      flush: draft.flush,
      adopt: adoptAndShow,
      update: draft.update,
      workspaceName,
      view,
      check: {
        // The AI's own group, so a change made by hand while it works is a step of its own.
        begin: (label) => draft.begin(label, 'ai'),
        end: () => draft.end('ai'),
        replace: (design, label) => draft.replace(design, label, 'ai'),
        frame: canvasFrame,
        open: openHome(view.locale),
        current: () => latest.current,
      },
    }),
  }
}
