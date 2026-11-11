import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/16/solid'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { trackBuilder } from '@/lib/client/builder-events'
import type { PortalAddress } from '@/lib/shared/design/portal-address'

/**
 * What publishing ends in: a popover on Publish with the live address, Copy
 * and Open, and, on a shared address, the way to a domain of its own.
 */
export function PublishedPopover({
  address,
  onClose,
  children,
}: {
  /** Where the portal is now live; null while there is nothing to say. */
  address: PortalAddress | null
  onClose: () => void
  /** The Publish button it is anchored to. */
  children: ReactElement
}) {
  const [copied, setCopied] = useState(false)
  const close = useRef(onClose)
  close.current = onClose
  // A click on the canvas lands in its frame, which the page never hears: the
  // window losing focus to it closes the popover, as a click elsewhere does.
  useEffect(() => {
    if (!address) return
    const onBlur = () => {
      if (document.activeElement?.tagName !== 'IFRAME') return
      setCopied(false)
      close.current()
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [address])
  const copy = async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address.url)
      setCopied(true)
      trackBuilder('designer_live_link_used', { action: 'copy' })
    } catch {
      setCopied(false)
    }
  }
  return (
    <Popover
      open={!!address}
      onOpenChange={(open) => {
        if (open) return
        setCopied(false)
        onClose()
      }}
    >
      <PopoverAnchor className="flex">{children}</PopoverAnchor>
      <PopoverContent align="end" className="w-80 space-y-2.5" aria-label="Published">
        <p role="status" className="text-sm font-medium">
          Published. Visitors see it now.
        </p>
        {address && (
          <>
            {/* The whole address, wrapping, from its start: a field scrolls to its tail. */}
            <p
              data-live-address=""
              className="rounded-md border border-border px-2 py-1.5 font-mono text-xs break-all select-all"
            >
              {address.url}
            </p>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a
                  href={address.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => trackBuilder('designer_live_link_used', { action: 'open' })}
                >
                  Open
                  <ArrowTopRightOnSquareIcon className="size-3.5" aria-hidden="true" />
                </a>
              </Button>
            </div>
            {address.offerDomain && (
              <Link
                to="/admin/settings/domains"
                onClick={() => trackBuilder('designer_live_link_used', { action: 'domain' })}
                className="inline-block rounded-sm text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-ring"
              >
                Use your own domain
              </Link>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
