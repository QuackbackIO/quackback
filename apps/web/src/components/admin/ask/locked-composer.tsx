import { useId, useRef, useState, type ReactNode } from 'react'
import { useIntl } from 'react-intl'

/**
 * The composer, greyed out and inert, when Copilot cannot answer. The area
 * itself is a tab stop: hovering it, focusing it or tapping it shows the
 * offer over it, and Escape, moving away or leaving it hides the offer again.
 * At rest the offer is hidden but still describes the area, so a screen
 * reader hears why Copilot is unavailable without opening anything.
 */
export function LockedComposer({ overlay, children }: { overlay: ReactNode; children: ReactNode }) {
  const intl = useIntl()
  const overlayId = useId()
  const area = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  const focusInside = () => area.current?.contains(document.activeElement) === true
  return (
    <div
      ref={area}
      role="group"
      tabIndex={0}
      aria-label={intl.formatMessage({ id: 'ask.composer.ask', defaultMessage: 'Ask Copilot' })}
      aria-describedby={overlayId}
      className="relative rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:ring-offset-2"
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => {
        if (!focusInside()) setShown(false)
      }}
      onFocus={() => setShown(true)}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null
        if (!next || !area.current?.contains(next)) setShown(false)
      }}
      onClick={() => setShown(true)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !shown) return
        event.stopPropagation()
        setShown(false)
        area.current?.focus()
      }}
    >
      <div inert className="pointer-events-none opacity-50 grayscale">
        {children}
      </div>
      <div
        id={overlayId}
        hidden={!shown}
        className="absolute inset-0 flex items-center justify-center p-3"
      >
        {overlay}
      </div>
    </div>
  )
}
