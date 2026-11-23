import { useId, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { FormattedMessage, useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { importDeepLinkSite } from '@/components/admin/settings/portal-customise/import-deep-link'
import { cn } from '@/lib/shared/utils'

const EDITOR = '/admin/settings/portal/customise'

/** Where a finished brand step is edited, named the same on Home and the plan page. */
export function EditInCustomiseLabel() {
  return <FormattedMessage id="onboarding.branding.edit" defaultMessage="Edit in Customise" />
}

/** A finished brand step's line: the website it was imported from, or that it was done by hand. */
export function BrandSourceLine({ importedFrom }: { importedFrom?: string | null }) {
  return importedFrom ? (
    <FormattedMessage
      id="onboarding.branding.importedFrom"
      defaultMessage="Imported from {domain}"
      values={{ domain: importedFrom }}
    />
  ) : (
    <FormattedMessage id="onboarding.branding.customised" defaultMessage="Customised" />
  )
}

/**
 * The launch plan's brand step. With the company website known (from the
 * signup email), one button imports from it; without one, a field asks for
 * it. Either opens the Customise editor with the import already reading: it
 * fills a draft there and publishes nothing. The quiet link opens the same
 * editor with no import.
 */
export function BrandingStepAction({
  domain,
  variant,
  className,
}: {
  /** The company website to offer, when one is known. */
  domain: string | null | undefined
  variant: 'default' | 'outline'
  className?: string
}) {
  const intl = useIntl()
  const navigate = useNavigate()
  const fieldId = useId()
  const errorId = useId()
  const [site, setSite] = useState('')
  const [notWebsite, setNotWebsite] = useState(false)
  const typed = site.trim()
  const line = cn('flex flex-wrap items-center gap-2', className)

  const own = (
    <Link
      to={EDITOR}
      className="ms-2 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
    >
      <FormattedMessage id="onboarding.branding.own" defaultMessage="or customise it yourself" />
    </Link>
  )

  if (domain) {
    return (
      <div className={line}>
        <Button asChild size="sm" variant={variant}>
          <Link to={EDITOR} search={{ import: domain }}>
            <FormattedMessage
              id="onboarding.branding.importFrom"
              defaultMessage="Import from {domain}"
              values={{ domain }}
            />
          </Link>
        </Button>
        {own}
      </div>
    )
  }

  return (
    <form
      className={line}
      onSubmit={(event) => {
        event.preventDefault()
        if (!typed) return
        // The editor's deep link would drop anything else without a word.
        const website = importDeepLinkSite(typed)
        if (website) void navigate({ to: EDITOR, search: { import: website } })
        else setNotWebsite(true)
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
        maxLength={2048}
        placeholder={intl.formatMessage({
          id: 'onboarding.branding.websitePlaceholder',
          defaultMessage: 'yourcompany.com',
        })}
        value={site}
        onChange={(event) => {
          setSite(event.target.value)
          setNotWebsite(false)
        }}
        aria-invalid={notWebsite || undefined}
        aria-describedby={notWebsite ? errorId : undefined}
        className="h-8 w-56 max-w-full text-sm"
      />
      <Button size="sm" variant={variant} type="submit" disabled={!typed}>
        <FormattedMessage id="onboarding.branding.import" defaultMessage="Import" />
      </Button>
      {own}
      {notWebsite ? (
        <p id={errorId} role="alert" className="basis-full text-xs text-destructive">
          <FormattedMessage
            id="onboarding.branding.notWebsite"
            defaultMessage="That doesn't look like a website"
          />
        </p>
      ) : null}
    </form>
  )
}
