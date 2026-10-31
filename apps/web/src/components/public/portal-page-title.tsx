import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { useRouteContext } from '@tanstack/react-router'
import { PortalBand, accented, textForLocale, type TitledPage } from './portal-band'
import { usePreviewDesignAttributes, usePreviewTitles } from './preview-draft-context'

/** Whether the page's title comes from the design, as it does on the design engine. */
export function useDesignTitles(): boolean {
  return useRouteContext({
    from: '__root__',
    select: (context) => context.settings?.portalDesign?.engine === 'v2',
  })
}

/**
 * A page's title in the design's headline type: on the band, as Home's
 * headline is, or plain on the page. The design can word it; otherwise it
 * says what the page usually does. Only the design engine draws it.
 */
export function PortalPageTitle({
  page,
  title,
  subtitle,
  action,
  children,
}: {
  page: TitledPage
  title: string
  subtitle?: string
  /** Beside the title, such as a page's own button. */
  action?: ReactNode
  /** Under the title, such as a search. */
  children?: ReactNode
}) {
  const intl = useIntl()
  const design = useRouteContext({
    from: '__root__',
    select: (context) => context.settings?.portalDesign,
  })
  const draftAttributes = usePreviewDesignAttributes()
  const draftTitles = usePreviewTitles()
  if (design?.engine !== 'v2') return null
  const onBand = (draftAttributes ?? design.attributes)['data-qb-page-titles'] === 'band'
  if (onBand)
    return (
      <PortalBand page={page} words={{ title, subtitle }}>
        {children || action ? (
          <div className="space-y-4">
            {/* The page's own buttons take the band's colours, so they read on it. */}
            {action && (
              <div className="flex flex-wrap gap-2 text-[var(--qb-band-ink)] [[data-qb-band-align=centre]_&]:justify-center [--foreground:var(--qb-band-ink)] [--muted-foreground:var(--qb-band-muted)] [--border:color-mix(in_oklch,var(--qb-band-ink)_35%,transparent)] [--background:transparent] [--accent:color-mix(in_oklch,var(--qb-band-ink)_12%,transparent)] [--accent-foreground:var(--qb-band-ink)]">
                {action}
              </div>
            )}
            {children}
          </div>
        ) : null}
      </PortalBand>
    )
  const headline = (draftTitles ?? design.titles)[page]
  const shown = textForLocale(headline?.title, intl.locale) || title
  const line = textForLocale(headline?.subtitle, intl.locale) || subtitle
  const phrase = textForLocale(headline?.accent?.text, intl.locale)
  return (
    <div
      data-qb-section="title"
      className="mx-auto w-full max-w-[var(--qb-page-max,72rem)] px-4 pt-8 sm:px-6 [--qb-band-accent:var(--qb-page-accent)] [--qb-band-highlight:var(--qb-page-highlight)]"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1
            data-qb-part="headline"
            className="font-semibold text-foreground [[data-qb-headline=accent]_&]:text-[var(--qb-page-accent)] [font-size:var(--qb-page-title-size,1.875rem)] [line-height:var(--qb-headline-leading,1.2)]"
          >
            {accented(shown, phrase, headline?.accent?.style)}
          </h1>
          {line && <p className="mt-2 max-w-2xl text-muted-foreground">{line}</p>}
        </div>
        {action}
      </div>
      {children && <div className="mt-6">{children}</div>}
    </div>
  )
}
