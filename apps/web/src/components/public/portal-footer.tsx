import { useEffect, useRef } from 'react'
import { FormattedMessage } from 'react-intl'
import { NewTabHint } from '@/components/ui/button'

/**
 * The footer under every portal page: the "Powered by Quackback" credit,
 * centred, on the page's background in its secondary text, which the design
 * solves to 4.5:1 there. Its height is published as --portal-footer-height,
 * so pages sized to the viewport leave room for it.
 */
export function PortalFooter({
  showPoweredBy,
  workspaceSlug,
}: {
  showPoweredBy: boolean
  workspaceSlug?: string
}) {
  const ref = useFooterHeight(showPoweredBy)
  if (!showPoweredBy) return null
  return (
    <footer ref={ref} data-qb-section="footer" className="bg-background">
      <div className="flex justify-center px-4 py-5">
        <a
          href={`https://quackback.io?utm_campaign=${encodeURIComponent(workspaceSlug || 'unknown')}&utm_content=portal-footer&utm_medium=referral&utm_source=powered-by`}
          target="_blank"
          rel="noopener"
          className="group inline-flex items-center gap-1.5 rounded-full border border-transparent bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-border/50 hover:bg-muted hover:text-foreground"
        >
          <img
            src="/logo.png"
            alt=""
            width={14}
            height={14}
            className="-mt-px opacity-70 transition-opacity group-hover:opacity-100"
          />
          <span>
            <FormattedMessage
              id="portal.footer.poweredBy"
              defaultMessage="Powered by {brand}"
              values={{ brand: <span className="font-semibold">Quackback</span> }}
            />
          </span>
          <NewTabHint />
        </a>
      </div>
    </footer>
  )
}

/** Publishes the footer's height while it shows, as the header does its own. */
function useFooterHeight(shown: boolean) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const footer = ref.current
    if (!footer) return
    const root = document.documentElement
    const publish = () =>
      root.style.setProperty('--portal-footer-height', `${footer.offsetHeight}px`)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(footer)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--portal-footer-height')
    }
  }, [shown])
  return ref
}
