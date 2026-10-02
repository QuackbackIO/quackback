import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { Link } from '@tanstack/react-router'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader, type PageCrumb } from '@/components/shared/page-header'
import { cn } from '@/lib/shared/utils'
import { SaveStatus } from './save-status'
import { moduleOfPage, type NavModule, type NavSection } from './settings-nav-sections'
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
  /** The parents of a child page. A module's own pages show the module title and tabs instead. */
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

/**
 * The settings nav as the current viewer sees it, built once by the settings
 * layout for the nav and for the module tabs on each page. Null outside the
 * layout, where a page shows no module tabs. It lives here, with the shell
 * that reads it, so it does not load as a chunk of its own.
 */
export const SettingsNavContext = createContext<NavSection[] | null>(null)

/** The module whose pages a settings page shows as tabs, if it is one of them. */
function useSettingsModule(page: string | undefined): NavModule | undefined {
  const sections = useContext(SettingsNavContext)
  return sections ? moduleOfPage(sections, page) : undefined
}

/** The form width, for a part of a wide page (a tab bar) that stays at form width. */
export const FORM_WIDTH_CLASS = WIDTH_CLASS.form

/**
 * The shell of every settings page: the header (title from the
 * page registry, breadcrumbs, save status, actions), the mobile back link, and
 * the page body at one of two widths. A page of a module (Boards in Feedback &
 * Roadmaps) is titled with the module, which is its row in the nav, and shows
 * the module's pages as tabs.
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
  const module = useSettingsModule(page)
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

  const shownCrumbs = module ? undefined : crumbs
  // A linked crumb is itself the way back.
  const hasBackCrumb = shownCrumbs?.some((crumb) => crumb.to !== undefined) ?? false
  return (
    <div data-settings-page-body="" className={cn('space-y-6', WIDTH_CLASS[width])}>
      {backLink && !hasBackCrumb && (
        <div className="lg:hidden">
          <BackLink to="/admin/settings">Settings</BackLink>
        </div>
      )}
      <PageHeader
        title={module ? module.label : resolvedTitle!}
        description={module ? undefined : description}
        badge={badge}
        crumbs={shownCrumbs}
        logo={logo}
        status={<SaveStatus />}
        actions={actions}
      />
      {module && (
        <div className="space-y-3">
          <ModuleTabs module={module} current={page!} />
          {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
        </div>
      )}
      {children}
    </div>
  )
}

/**
 * A module's pages as a tab bar. Each is a page of its own, so the tabs are
 * links. They carry the tab slots, so the admin theme draws them like every
 * other page-section tab bar. The bar scrolls sideways on a narrow screen,
 * starting with the current tab in view.
 */
function ModuleTabs({ module, current }: { module: NavModule; current: string }) {
  const barRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const bar = barRef.current
    const tab = bar?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!bar || !tab) return
    const right = tab.offsetLeft + tab.offsetWidth
    if (right > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = right - bar.clientWidth
    else if (tab.offsetLeft < bar.scrollLeft) bar.scrollLeft = tab.offsetLeft
  }, [current])

  return (
    <nav
      ref={barRef}
      aria-label={module.label}
      data-slot="tabs-list"
      data-variant="line"
      className="scrollbar-none relative flex items-center overflow-x-auto"
    >
      {module.pages.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          data-slot="tabs-trigger"
          data-variant="line"
          data-active={tab.to === current ? '' : undefined}
          aria-current={tab.to === current ? 'page' : undefined}
          className="inline-flex shrink-0 items-center text-sm whitespace-nowrap transition-colors"
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
