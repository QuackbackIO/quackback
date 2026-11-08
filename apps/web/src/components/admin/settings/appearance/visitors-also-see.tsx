import { useEffect, useState } from 'react'
import {
  getSignInEmailSampleFn,
  type EmailSampleResult,
} from '@/lib/server/functions/portal-design-email'

/**
 * What else visitors get from the brand once it is published, read only:
 * the sign-in email, rendered by the server in the draft's colours.
 */
export function VisitorsAlsoSee() {
  return (
    <section aria-label="Visitors also see" className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">Visitors also see</h3>
      <div className="flex flex-wrap gap-4">
        <SignInEmailSample />
      </div>
    </section>
  )
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
        <p className="text-[13px] text-muted-foreground">{sample.message}</p>
      ) : (
        <div className="h-72 w-full animate-pulse rounded-md bg-muted" />
      )}
    </figure>
  )
}
