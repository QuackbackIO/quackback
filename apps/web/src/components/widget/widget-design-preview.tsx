/**
 * The widget drawn in a design that is not published yet: the builder's
 * Widget sample and its publish review frame the widget with `?preview=true`
 * and post the draft, resolved, as they post it to the portal. Only that
 * frame loads this module, so no visitor's widget downloads it. Nothing in
 * the frame can be used: it is a picture of the widget, not the widget.
 */
import { useEffect, useState } from 'react'
import {
  applyDesignAttributes,
  readDesignPreview,
  type DesignPreview,
} from '@/components/public/portal-preview-design'
import { loadBrandingFont } from '@/lib/shared/theme/font-loader'

const HELD = ['click', 'submit', 'keydown'] as const

export function WidgetDesignPreview() {
  const [design, setDesign] = useState<DesignPreview | null>(null)

  useEffect(() => {
    // Only a framed widget, from the page that frames it, takes a design.
    if (window.parent === window) return
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== window.parent) return
      const message = event.data as { type?: string; design?: unknown } | null
      if (message?.type === 'quackback:preview-design') setDesign(readDesignPreview(message.design))
    }
    window.addEventListener('message', onMessage)
    window.parent.postMessage(
      { type: 'quackback:preview-ready', path: window.location.pathname },
      window.location.origin
    )
    const hold = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    for (const type of HELD) document.addEventListener(type, hold, true)
    return () => {
      window.removeEventListener('message', onMessage)
      for (const type of HELD) document.removeEventListener(type, hold, true)
    }
  }, [])

  useEffect(() => (design ? applyDesignAttributes(design.attributes) : undefined), [design])
  const fontIds = design?.fontIds.join(' ') ?? ''
  useEffect(() => {
    for (const id of fontIds.split(' ').filter(Boolean)) loadBrandingFont(id).catch(() => {})
  }, [fontIds])

  return design?.css ? <style data-preview-design="">{design.css}</style> : null
}
