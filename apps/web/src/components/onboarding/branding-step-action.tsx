import { useId, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { FormattedMessage, useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAutomaticWebsiteBranding } from '@/components/admin/branding/use-automatic-website-branding'
import type { LaunchTask } from '@/lib/shared/launch-checklist'

/**
 * The launch plan's branding step. With the portal in the builder, it hands
 * off to the builder's brand match on the website it names, with Use another
 * site opening the match row to change it (or opens the Brand kit when no
 * website is known); while a matched brand waits in the draft, it opens
 * publish. Otherwise nothing is set for the
 * workspace until someone chooses here: a logo the lookup found on their website is offered
 * with "Use it", and otherwise (a personal email has no company website, or
 * the lookup found nothing) they can name their website to look it up, or
 * upload a logo in Settings.
 */
export function BrandingStepAction({
  task,
  variant,
}: {
  task: LaunchTask
  variant: 'default' | 'outline'
}) {
  const intl = useIntl()
  const fieldId = useId()
  const branding = useAutomaticWebsiteBranding({ enabled: true })
  const [site, setSite] = useState('')
  const status = branding.status
  const offered = status?.status === 'offered' && status.canUse
  const searching = branding.looking || status?.status === 'pending'

  if (task.href === '/design') {
    // A matched brand waits in the draft: visitors see it once it is published.
    if (task.search?.publish) {
      return (
        <>
          <span className="text-sm text-muted-foreground">
            <FormattedMessage
              id="onboarding.branding.notPublished"
              defaultMessage="Matched, not published"
            />
          </span>
          <Button asChild size="sm" variant={variant}>
            <Link to="/design" search={{ publish: 'open', from: 'onboarding' }}>
              <FormattedMessage id="onboarding.branding.publish" defaultMessage="Publish" />
            </Link>
          </Button>
        </>
      )
    }
    const match = task.search?.match ?? status?.domain
    if (!match) {
      return (
        <Button asChild size="sm" variant={variant}>
          <Link to="/design" search={{ from: 'onboarding' }}>
            <FormattedMessage id="onboarding.branding.match" defaultMessage="Match your brand" />
          </Link>
        </Button>
      )
    }
    // The website is a guess from the email address, so it is named, and another is a click away.
    return (
      <>
        <Button asChild size="sm" variant={variant}>
          <Link to="/design" search={{ match, from: 'onboarding' }}>
            <FormattedMessage
              id="onboarding.branding.matchFrom"
              defaultMessage="Match from {domain}"
              values={{ domain: match }}
            />
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
          <Link to="/design" search={{ brand: 'match', from: 'onboarding' }}>
            <FormattedMessage
              id="onboarding.branding.otherSite"
              defaultMessage="Use another site"
            />
          </Link>
        </Button>
      </>
    )
  }

  const upload = task.href ? (
    <Button asChild size="sm" variant="outline">
      <Link to={task.href} search={task.search as never}>
        <FormattedMessage id="onboarding.branding.upload" defaultMessage="Upload a logo" />
      </Link>
    </Button>
  ) : null

  // On its own line under the step, so the row's Skip stays beside the title.
  const line = 'order-last flex basis-full flex-wrap items-center gap-2 ps-8'

  if (offered) {
    return (
      <div className={line}>
        {status.logoUrl ? (
          <img
            src={status.logoUrl}
            alt=""
            className="size-8 shrink-0 rounded-md border border-border bg-background object-contain p-0.5"
          />
        ) : null}
        <span className="text-sm text-muted-foreground">
          <FormattedMessage
            id="onboarding.branding.offer"
            defaultMessage="Use the logo from {domain}?"
            values={{ domain: status.domain }}
          />
        </span>
        <Button size="sm" variant={variant} disabled={branding.pending} onClick={branding.accept}>
          <FormattedMessage id="onboarding.branding.use" defaultMessage="Use it" />
        </Button>
        {upload}
        {branding.error ? (
          <p role="alert" className="basis-full text-xs text-destructive">
            {branding.error}
          </p>
        ) : null}
      </div>
    )
  }

  const notFound =
    !searching && status?.status === 'failed' ? (
      <FormattedMessage
        id="onboarding.branding.notFound"
        defaultMessage="No logo found on {domain}. Try another website or upload one."
        values={{ domain: status.domain }}
      />
    ) : null

  return (
    <form
      className={line}
      onSubmit={(event) => {
        event.preventDefault()
        if (site.trim()) branding.lookup(site.trim())
      }}
    >
      <label htmlFor={fieldId} className="sr-only">
        <FormattedMessage id="onboarding.branding.website" defaultMessage="Your website" />
      </label>
      <Input
        id={fieldId}
        type="text"
        inputMode="url"
        autoComplete="url"
        placeholder={intl.formatMessage({
          id: 'onboarding.branding.websitePlaceholder',
          defaultMessage: 'Your website, like acme.com',
        })}
        value={site}
        disabled={searching}
        onChange={(event) => setSite(event.target.value)}
        className="h-8 w-56 max-w-full text-sm"
      />
      <Button size="sm" variant={variant} type="submit" disabled={searching || !site.trim()}>
        {searching ? (
          <FormattedMessage id="onboarding.branding.finding" defaultMessage="Finding…" />
        ) : (
          <FormattedMessage id="onboarding.branding.find" defaultMessage="Find logo" />
        )}
      </Button>
      {upload}
      <p role="status" className="basis-full text-xs text-muted-foreground empty:hidden">
        {searching && status?.status === 'pending' ? (
          <FormattedMessage
            id="onboarding.branding.looking"
            defaultMessage="Looking for a logo on {domain}…"
            values={{ domain: status.domain }}
          />
        ) : (
          notFound
        )}
      </p>
      {branding.error ? (
        <p role="alert" className="basis-full text-xs text-destructive">
          {branding.error}
        </p>
      ) : null}
    </form>
  )
}
