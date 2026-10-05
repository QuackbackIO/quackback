import { useId, useRef, useState, type ReactNode } from 'react'
import { useIntl } from 'react-intl'

/**
 * The composer, greyed out and inert, when Copilot cannot answer. Hovering
 * it, tapping it or tabbing onto the offer's link shows the offer over it;
 * leaving, moving focus away or Escape hides it again. The area is no tab
 * stop of its own: at rest the offer is only out of sight, so its link is the
 * one stop and a screen reader still hears why Copilot is unavailable.
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
      aria-label={intl.formatMessage({ id: 'ask.composer.ask', defaultMessage: 'Ask Copilot' })}
      aria-describedby={overlayId}
      className="relative rounded-2xl"
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
        if (event.key !== 'Escape' || !shown || focusInside()) return
        event.stopPropagation()
        setShown(false)
      }}
    >
      <div inert className="pointer-events-none opacity-50 grayscale">
        {children}
      </div>
      <div
        id={overlayId}
        className="absolute inset-0 flex items-center justify-center p-3 transition-opacity duration-150"
        style={{ opacity: shown ? 1 : 0, pointerEvents: shown ? 'auto' : 'none' }}
      >
        {overlay}
      </div>
    </div>
  )
}
