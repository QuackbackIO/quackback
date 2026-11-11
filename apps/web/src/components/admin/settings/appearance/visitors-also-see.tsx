import { useEffect, useRef, useState } from 'react'
import { LinkPreview } from '@/components/designer/link-preview'
import type { PortalDesign } from '@/lib/shared/design/schema'
import {
  getShareCardSampleFn,
  getSignInEmailSampleFn,
  type EmailSampleResult,
} from '@/lib/server/functions/portal-design-email'

/** The width the email is laid out at, as a mail app shows it, before it is scaled to fit. */
export const EMAIL_WIDTH = 600

/**
 * What else visitors get from the brand once it is published, read only:
 * the sign-in email, rendered by the server from the saved draft, and a link
 * to the portal as a chat or social post shows it. The review saves the
 * draft before it opens, so both are drawn from the draft as it is now.
 */
export function VisitorsAlsoSee({ design }: { design?: PortalDesign }) {
  return (
    <section aria-labelledby="visitors-also-see" className="space-y-2">
      <h3 id="visitors-also-see" className="text-sm font-semibold">
        Visitors also get, after you publish
      </h3>
      <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
        <SignInEmailSample />
        {design && (
          <div className="flex min-w-0 flex-col gap-1.5">
            <span aria-hidden="true" className="text-xs text-muted-foreground">
              Link preview
            </span>
            <LinkPreviewSample design={design} />
          </div>
        )}
      </div>
    </section>
  )
}

/** The link preview with the image the server draws, so it never promises another card. */
function LinkPreviewSample({ design }: { design: PortalDesign }) {
  const [image, setImage] = useState<string>()
  useEffect(() => {
    let live = true
    getShareCardSampleFn()
      .then((result) => live && result.ok && setImage(result.src))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return <LinkPreview design={design} image={image} />
}

function SignInEmailSample() {
  const [sample, setSample] = useState<EmailSampleResult | null>(null)
  useEffect(() => {
    let live = true
    getSignInEmailSampleFn()
      .then((result) => live && setSample(result))
      .catch(
        () => live && setSample({ ok: false, message: 'The email sample could not be drawn.' })
      )
    return () => {
      live = false
    }
  }, [])

  return (
    <figure className="m-0 flex min-w-0 flex-col gap-1.5">
      <figcaption className="text-xs text-muted-foreground">Sign-in email</figcaption>
      {sample?.ok ? (
        <EmailPicture html={sample.html} />
      ) : sample ? (
        <p className="text-ui text-muted-foreground">{sample.message}</p>
      ) : (
        <div className="aspect-[4/3] w-full animate-pulse rounded-md bg-muted" />
      )}
    </figure>
  )
}

/**
 * The email whole, as a picture: laid out at a mail app's width, as tall as
 * it is, and scaled to fit, so it never scrolls inside and starts at its top.
 */
function EmailPicture({ html }: { html: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState<number | null>(null)
  useEffect(() => {
    const element = box.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const scale = width > 0 ? Math.min(1, width / EMAIL_WIDTH) : 1
  const tall = height ?? EMAIL_WIDTH
  return (
    <div
      ref={box}
      inert
      className="w-full overflow-hidden rounded-md border border-border bg-white"
      style={{ height: tall * scale }}
    >
      <iframe
        title="Sign-in email"
        srcDoc={html}
        // Same origin only so its height can be read: no scripts, forms or navigation run.
        sandbox="allow-same-origin"
        tabIndex={-1}
        scrolling="no"
        onLoad={(event) => {
          const doc = event.currentTarget.contentDocument
          if (doc)
            setHeight(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0))
        }}
        className="border-0 bg-white"
        style={{
          width: EMAIL_WIDTH,
          height: tall,
          transform: scale < 1 ? `scale(${scale})` : undefined,
          transformOrigin: 'top left',
        }}
      />
    </div>
  )
}
