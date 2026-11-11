import { useEffect, useState } from 'react'
import { LinkPreview } from '@/components/designer/link-preview'
import type { PortalDesign } from '@/lib/shared/design/schema'
import {
  getShareCardSampleFn,
  getSignInEmailSampleFn,
  type EmailSampleResult,
} from '@/lib/server/functions/portal-design-email'

/**
 * What else visitors get from the brand once it is published, read only:
 * the sign-in email, rendered by the server in the draft's colours, and a
 * link to the portal as a chat or social post shows it.
 */
export function VisitorsAlsoSee({ design }: { design?: PortalDesign }) {
  return (
    <section aria-label="Visitors also see" className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">Visitors also see</h3>
      <div className="flex flex-wrap gap-4">
        <SignInEmailSample />
        {design && (
          <div className="flex w-full max-w-xs flex-col gap-1.5">
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
    <figure className="m-0 flex w-full max-w-sm flex-col gap-1.5">
      <figcaption className="text-xs text-muted-foreground">Sign-in email</figcaption>
      {sample?.ok ? (
        // A picture of the email, not a page: no scripts, no focus.
        <iframe
          title="Sign-in email"
          srcDoc={sample.html}
          sandbox=""
          tabIndex={-1}
          className="h-72 w-full rounded-md border bg-white"
        />
      ) : sample ? (
        <p className="text-ui text-muted-foreground">{sample.message}</p>
      ) : (
        <div className="h-72 w-full animate-pulse rounded-md bg-muted" />
      )}
    </figure>
  )
}
