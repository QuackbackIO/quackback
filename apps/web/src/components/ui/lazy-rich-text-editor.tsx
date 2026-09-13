import { lazy } from 'react'

/** Shared TipTap boundary so compose dialogs do not each declare their own chunk. */
export const LazyRichTextEditor = lazy(() =>
  import('@/components/ui/rich-text-editor').then((m) => ({ default: m.RichTextEditor }))
)
