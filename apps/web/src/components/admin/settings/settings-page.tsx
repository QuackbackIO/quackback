import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader, type PageCrumb } from '@/components/shared/page-header'
import { cn } from '@/lib/shared/utils'
import { SaveStatus } from './save-status'
import {
  AUTOMATION_PAGES,
  SETTINGS_PAGES,
  type AutomationPagePath,
  type SettingsPagePath,
} from './settings-pages'

type PageTitle =
  { page: SettingsPagePath | AutomationPagePath; title?: never } | { title: string; page?: never }

type SettingsPageProps = PageTitle & {
  description?: string
  badge?: ReactNode
  crumbs?: PageCrumb[]
  logo?: ReactNode
  actions?: ReactNode
  /** `form` is a single column of settings; `wide` is for tables, card grids and live previews. */
  width?: 'form' | 'wide'
  /** False on the mobile index page, which is the back link's own target. */
  backLink?: boolean
  children?: ReactNode
}

const WIDTH_CLASS = { form: 'max-w-3xl', wide: 'max-w-5xl' } as const

/** The form width, for a part of a wide page (a tab bar) that stays at form width. */
export const FORM_WIDTH_CLASS = WIDTH_CLASS.form

/**
 * The shell of every settings page: the header (title from the
 * page registry, breadcrumbs, save status, actions), the mobile back link, and
 * the page body at one of two widths.
 */
export function SettingsPage({
  page,
  title,
  description,
  badge,
  crumbs,
  logo,
  actions,
  width = 'form',
  backLink = true,
  children,
}: SettingsPageProps) {
  const intl = useIntl()
  if ((page === undefined) === (title === undefined)) {
    throw new Error('SettingsPage takes exactly one of `page` or `title`')
  }

  let resolvedTitle = title
  if (page !== undefined) {
    if (page in AUTOMATION_PAGES) {
      resolvedTitle = intl.formatMessage(AUTOMATION_PAGES[page as AutomationPagePath])
    } else {
      resolvedTitle = SETTINGS_PAGES[page as SettingsPagePath].label
    }
  }

  // A linked crumb is itself the way back; module-only crumbs have no page to go to.
  const hasBackCrumb = crumbs?.some((crumb) => crumb.to !== undefined) ?? false
  return (
    <div data-settings-page-body="" className={cn('space-y-6', WIDTH_CLASS[width])}>
      {backLink && !hasBackCrumb && (
        <div className="lg:hidden">
          <BackLink to="/admin/settings">Settings</BackLink>
        </div>
      )}
      <PageHeader
        title={resolvedTitle!}
        description={description}
        badge={badge}
        crumbs={crumbs}
        logo={logo}
        status={<SaveStatus />}
        actions={actions}
      />
      {children}
    </div>
  )
}
