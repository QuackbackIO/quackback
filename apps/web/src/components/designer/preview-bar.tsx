import { useEffect, useRef } from 'react'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { PAGE_NAMES, type DesignerPage } from '@/lib/shared/design/outline'
import type { CanvasSize } from './designer-canvas'
import { DeviceToggle } from './designer-header'
import { Tag } from './tag'
import type { useDesignerPage } from './use-designer-page'

/**
 * The bar over Preview: the draft full width, links working as a visitor's.
 * Done, the back arrow or an Escape the portal does not take leaves it.
 */
export function PreviewBar({
  page,
  view,
  size,
  onSize,
  onDone,
}: {
  page: DesignerPage
  /** Who the page is drawn for, and whether it is a sample. */
  view: Pick<ReturnType<typeof useDesignerPage>, 'visitor' | 'sample'>
  size: CanvasSize
  onSize: (size: CanvasSize) => void
  onDone: () => void
}) {
  // Focus starts on the way back, outside the page, so it is never lost in it.
  const back = useRef<HTMLButtonElement>(null)
  useEffect(() => back.current?.focus(), [])
  return (
    <header
      data-designer-region=""
      tabIndex={-1}
      aria-label="Preview"
      className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b border-border bg-background px-3 py-2 outline-none"
    >
      <Button
        ref={back}
        variant="ghost"
        size="icon-sm"
        aria-label="Back to editing"
        onClick={onDone}
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
      </Button>
      <p className="text-sm font-semibold">Preview</p>
      {view.sample && <Tag>Sample</Tag>}
      <p className="text-xs text-muted-foreground">
        Your draft of {PAGE_NAMES[page]}
        {view.sample
          ? ', with made-up content'
          : view.visitor === 'out'
            ? ', signed out'
            : ', signed in as you'}
        . Every link works; nothing is sent.
      </p>
      <div className="ms-auto flex items-center gap-2">
        <DeviceToggle size={size} onSize={onSize} labelled />
        <Button variant="outline" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </header>
  )
}
