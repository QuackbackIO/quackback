import { nameInitial } from '@/lib/shared/utils/initial'
import { memo, useEffect, useRef, useState } from 'react'
import { Link, useRouter, useRouterState, useRouteContext } from '@tanstack/react-router'
import { useTheme } from 'next-themes'
import { isHelpPath, isTabActive, type PortalNavItem } from './portal-header-nav'
import { usePortalNavItems } from './use-portal-nav-items'
import { NavScroller } from './nav-scroller'
import { useMenuFold } from './use-menu-fold'
import { isPortalSupportSurfaceEnabled } from '@/lib/shared/support-surfaces'
import { useIntl, FormattedMessage } from 'react-intl'
import { cn } from '@/lib/shared/utils'
import { isTeamMember, Role } from '@/lib/shared/roles'
import { Button } from '@/components/ui/button'
import { signOut } from '@/lib/client/auth-client'
import { startOidcSignIn } from '@/lib/client/start-oidc-sign-in'
import { stashSsoAttempt } from '@/lib/client/sso-attempt-stash'
import { signinErrorLanding } from '@/lib/shared/auth-prompt'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar } from '@/components/ui/avatar'
import { UserStatsBar } from '@/components/shared/user-stats'
import {
  ArrowRightStartOnRectangleIcon,
  Cog6ToothIcon,
  ComputerDesktopIcon,
  MoonIcon,
  ShieldCheckIcon,
  SunIcon,
} from '@heroicons/react/24/solid'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
import {
  hasAnyPortalAuthMethod,
  hasDistinctSignup,
  resolveSoleOidcProvider,
} from '@/components/auth/oauth-buttons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMyConversationsFn } from '@/lib/server/functions/conversation'
import { PORTAL_MY_CONVERSATIONS_QUERY_KEY } from '@/lib/client/queries/portal-support'
import { removeViewerScopedPortalQueries } from '@/lib/client/queries/portal'
import { useAuthBroadcast } from '@/lib/client/hooks/use-auth-broadcast'
import { NotificationBell } from '@/components/notifications'
import { useSessionContext, useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import { usePreviewDesignAttributes, usePreviewLogo } from './preview-draft-context'
import { CustomiseButton } from './customise-button'
import { LogoFilters } from './logo-filters'
import { PORTAL_LANDING } from '@/lib/shared/design/paths'

/**
 * A logo image where the design says its ink would vanish into the header:
 * drawn through one of the header's logo filters (LogoFilters).
 */
const ICON_TILE = '[border-radius:calc(var(--radius)*0.6)] [filter:var(--qb-logo-filter,none)]'
/** The title, in the theme's heading font and weight, in the header's text colour. */
const TITLE =
  'portal-header__name max-w-[18ch] truncate leading-none text-[var(--header-foreground)] [font-family:var(--qb-font-heading)] [font-weight:var(--qb-heading-weight)] [letter-spacing:var(--qb-headline-tracking,normal)]'

/** On the band, the header's button takes the colour the design picks to read there. */
const ON_BAND_ACTION =
  '[[data-qb-header-band=on]_&]:bg-[var(--qb-header-action-bg)] [[data-qb-header-band=on]_&]:text-[var(--qb-header-action-ink)] [[data-qb-header-band=on]_&]:hover:opacity-90'
const ON_BAND_GHOST =
  '[[data-qb-header-band=on]_&]:text-[var(--header-foreground)] [[data-qb-header-band=on]_&]:hover:bg-[var(--nav-active-background)]'

interface PortalHeaderProps {
  orgName: string
  orgLogo?: string | null
  /** User's role in the organization (passed from server) */
  userRole?: Role | null
  /** Initial user data for SSR (store values override these after hydration) */
  initialUserData?: {
    name: string | null
    email: string | null
    avatarUrl: string | null
  }
  /** Whether to show the theme toggle (hidden when admin forces a specific theme) */
  showThemeToggle?: boolean
}

export function PortalHeader({
  orgName,
  orgLogo,
  userRole,
  initialUserData,
  showThemeToggle = true,
}: PortalHeaderProps) {
  const intl = useIntl()
  const router = useRouter()
  const headerRef = useStickyHeaderHeight()
  const inlineRow = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  // Each part is selected: the route context is a new object after every
  // navigation, while these stay the same until the viewer or workspace
  // changes. The location is read by the tabs that highlight it.
  const session = useSessionContext()
  const settings = useWorkspaceSettings()
  const registeredAuthProviders = useRouteContext({
    from: '__root__',
    select: (context) => context.registeredAuthProviders,
  })

  const navItems = usePortalNavItems()
  const supportEnabled = isPortalSupportSurfaceEnabled(
    settings?.featureFlags,
    settings?.portalConfig
  )

  // Hide Log in / Sign up when no portal sign-in surface is usable.
  // Team members can still reach /admin/login directly. Counts any registered
  // OIDC provider — including a routed-only one with no public button, which a
  // domain user reaches by entering their email — not just the legacy `sso` id.
  const portalAuthEnabled = hasAnyPortalAuthMethod(settings?.publicAuthConfig?.oauth ?? {}, {
    registeredAuthProviders,
    oidcProviders: settings?.publicPortalConfig?.oidcProviders,
  })

  // A separate "Sign up" button only earns its place when sign-up mode actually
  // differs from login — i.e. password auth is on and self-service signup is
  // open. Otherwise magic-link / SSO create the account implicitly and the two
  // buttons do the same thing, so collapse to a single "Log in".
  const showSignup = hasDistinctSignup({
    oauth: settings?.publicAuthConfig?.oauth,
    openSignup: settings?.publicPortalConfig?.openSignup,
  })

  // When the ONLY sign-in method is a single OIDC provider, every sign-in goes
  // through it — so "Log in" / "Sign up" redirect straight to the IdP and skip
  // the email-entry dialog entirely.
  const soleOidcProviderId = resolveSoleOidcProvider(
    registeredAuthProviders,
    settings?.publicAuthConfig?.oauth ?? {}
  )

  const authPopover = useAuthPopoverSafe()
  const openAuthPopover = authPopover?.openAuthPopover

  // Listen for auth success to refetch session and role via router invalidation
  useAuthBroadcast({
    onSuccess: () => {
      // Refresh vote highlights and drop viewer-scoped data (post detail,
      // feed, tag catalog) so a team sign-in gains internal tags.
      queryClient.invalidateQueries({ queryKey: ['votedPosts'] })
      removeViewerScopedPortalQueries(queryClient)
      // Refetch loaders (includes session and userRole) for the new session.
      void router.invalidate()
    },
  })

  // Get user info from session (anonymous sessions don't count as logged in)
  const user = session?.user
  const isLoggedIn = !!user && user.principalType !== 'anonymous'

  // Unread count for the Support tab badge — one light query, shared with the
  // Support pages via the query key. Skipped entirely when signed out.
  const myConversationsQuery = useQuery({
    queryKey: PORTAL_MY_CONVERSATIONS_QUERY_KEY,
    queryFn: () => getMyConversationsFn(),
    enabled: supportEnabled && isLoggedIn,
    staleTime: 30_000,
  })
  const supportUnreadTotal = (myConversationsQuery.data?.conversations ?? []).reduce(
    (sum, c) => sum + (c.unreadCount ?? 0),
    0
  )

  // Use initialUserData (which includes properly fetched avatar from blob storage)
  // falling back to session data
  const name = initialUserData?.name ?? user?.name ?? null
  const email = initialUserData?.email ?? user?.email ?? null
  const avatarUrl = initialUserData?.avatarUrl ?? user?.image ?? null

  // Team members (admin, member) can access admin dashboard
  const canAccessAdmin = isLoggedIn && isTeamMember(userRole)

  // Skip the sign-in dialog for a single-IdP workspace: go straight to the
  // OIDC provider (same redirect the dialog's "Continue" path uses), returning
  // to the current page afterwards. Stash + errorCallbackURL route callback
  // failures back into the sign-in dialog (with link-conflict recovery for
  // account_not_linked) instead of Better-Auth's bare error page.
  const redirectToSoleProvider = () => {
    if (!soleOidcProviderId) return
    const pathname = router.state.location.pathname
    stashSsoAttempt({
      providerId: soleOidcProviderId,
      providerType: 'oidc',
      callbackUrl: pathname,
    })
    void startOidcSignIn({
      providerId: soleOidcProviderId,
      callbackURL: pathname,
      errorCallbackURL: signinErrorLanding(pathname),
    })
  }

  const handleSignOut = async () => {
    await signOut()
    // Clear user-scoped caches: vote highlights, and every viewer-scoped
    // payload (a team member's internal tags must not outlive their session).
    queryClient.invalidateQueries({ queryKey: ['votedPosts'] })
    removeViewerScopedPortalQueries(queryClient)
    router.invalidate() // Refetch session
    router.navigate({ to: PORTAL_LANDING })
  }

  // Auth/admin buttons. Plain elements rather than a component declared in
  // here: a component declared in render is a new type each time, so every
  // render of the header would tear these menus down and build them again.
  // Each is its own element, so a centred header can lay them on both sides.
  const themeToggle = showThemeToggle && <ThemeToggle />
  const customise = canAccessAdmin && <CustomiseButton />
  // Admin Button (visible for team members)
  const adminButton = canAccessAdmin && (
    <Button variant="outline" size="sm" asChild className="ms-1 me-2">
      <Link to="/admin" search={{}}>
        <ShieldCheckIcon className="me-2 h-4 w-4" />
        <FormattedMessage id="portal.header.auth.admin" defaultMessage="Admin" />
      </Link>
    </Button>
  )
  // Notification Bell (logged in users only)
  const bell = isLoggedIn && <NotificationBell popoverSide="bottom" className="me-1" />
  // Logged-in user - show user dropdown
  const accountMenu = isLoggedIn ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="relative h-9 w-9 rounded-full"
          aria-label={intl.formatMessage({
            id: 'portal.header.auth.accountMenu',
            defaultMessage: 'Open account menu',
          })}
        >
          <Avatar className="h-9 w-9" src={avatarUrl} name={name} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">{email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="px-2 py-2">
          <UserStatsBar />
        </div>
        <DropdownMenuSeparator />
        {canAccessAdmin && (
          <DropdownMenuItem asChild>
            <Link to="/admin" search={{}}>
              <ShieldCheckIcon className="me-2 h-4 w-4" />
              <FormattedMessage id="portal.header.auth.admin" defaultMessage="Admin" />
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <Cog6ToothIcon className="me-2 h-4 w-4" />
            <FormattedMessage id="portal.header.auth.settings" defaultMessage="Settings" />
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSignOut}>
          <ArrowRightStartOnRectangleIcon className="me-2 h-4 w-4" />
          <FormattedMessage id="portal.header.auth.signOut" defaultMessage="Sign out" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null
  // Anonymous user with auth popover available. Show "Sign up" only when it
  // leads somewhere different from "Log in" (see hasDistinctSignup);
  // otherwise the sole "Log in" button becomes the primary CTA.
  const signInOffered = !isLoggedIn && Boolean(openAuthPopover) && portalAuthEnabled
  const logIn = (
    <Button
      variant={showSignup ? 'ghost' : 'default'}
      size="sm"
      data-qb-label=""
      data-qb-menu="sign-in"
      className={showSignup ? ON_BAND_GHOST : ON_BAND_ACTION}
      onClick={() =>
        soleOidcProviderId ? redirectToSoleProvider() : openAuthPopover?.({ mode: 'login' })
      }
    >
      <FormattedMessage id="portal.header.auth.logIn" defaultMessage="Log in" />
    </Button>
  )
  const signUp = (
    <Button
      size="sm"
      data-qb-label=""
      className={ON_BAND_ACTION}
      onClick={() =>
        soleOidcProviderId ? redirectToSoleProvider() : openAuthPopover?.({ mode: 'signup' })
      }
    >
      <FormattedMessage id="portal.header.auth.signUp" defaultMessage="Sign up" />
    </Button>
  )
  const authButtons = (
    <div className="flex items-center">
      {/* Theme Toggle (when admin allows user choice) */}
      {themeToggle}

      {customise}

      {adminButton}

      {bell}

      {/* Auth Buttons */}
      {isLoggedIn ? (
        accountMenu
      ) : signInOffered ? (
        <div className="flex items-center gap-2">
          {logIn}
          {showSignup && signUp}
        </div>
      ) : null}
    </div>
  )

  // The design's header layout; in the admin preview, the draft's.
  const previewAttributes = usePreviewDesignAttributes()
  const savedDesign = settings?.portalDesign
  const headerLayout =
    previewAttributes?.['data-qb-header'] ??
    (savedDesign?.engine === 'v2' ? savedDesign.attributes['data-qb-header'] : undefined) ??
    'stacked'

  // How the design shows the brand; in the admin preview, the draft's.
  const previewLogo = usePreviewLogo()
  const designLogo = previewLogo ?? (savedDesign?.engine === 'v2' ? savedDesign.logo : undefined)
  const brandName = designLogo?.name || orgName
  const wordmark = designLogo?.wordmark
  // A wordmark without a file shows the mark and name, as before one is uploaded.
  const display =
    designLogo?.display === 'wordmark' && !wordmark?.light && !wordmark?.dark
      ? 'mark_and_name'
      : (designLogo?.display ?? 'mark_and_name')

  // Beside the name, the mark is decoration; alone, it names the portal. The
  // design's own logo comes first, its dark one in dark mode, then the workspace's.
  const own = designLogo?.mark
  const ownMark = own?.light ?? own?.dark
  const mark = ownMark ? (
    <>
      <img
        src={ownMark}
        alt={display === 'mark' ? orgName : ''}
        className={`size-[var(--qb-logo-height,2rem)] object-contain ${ICON_TILE} ${own?.dark && own.light ? 'dark:hidden' : ''}`}
      />
      {own?.dark && own.light ? (
        <img
          src={own.dark}
          alt={display === 'mark' ? orgName : ''}
          className={`hidden size-[var(--qb-logo-height,2rem)] object-contain dark:block ${ICON_TILE}`}
        />
      ) : null}
    </>
  ) : orgLogo ? (
    <img
      src={orgLogo}
      alt={display === 'mark' ? orgName : ''}
      className="size-[var(--qb-logo-height,2rem)] [border-radius:calc(var(--radius)*0.6)]"
    />
  ) : (
    <div className="size-[var(--qb-logo-height,2rem)] [border-radius:calc(var(--radius)*0.6)] bg-primary flex items-center justify-center text-primary-foreground font-semibold">
      {nameInitial(orgName)}
    </div>
  )
  const logo = (
    <Link
      to={PORTAL_LANDING}
      // Named for what it shows, so a wordmark or a mark alone still says whose portal it is.
      aria-label={display === 'wordmark' || display === 'mark' ? brandName : undefined}
      // Never shrunk under the menu (it folds to its own row instead); on a phone it gives
      // way to the buttons, the wordmark scaled down within it, never below a readable size.
      className="portal-header__logo flex min-h-6 min-w-[min(calc(var(--qb-logo-height,2rem)*2.5),30vw)] items-center gap-2 md:shrink-0"
      data-qb-part="logo"
      data-qb-menu="logo"
      data-qb-logo={display}
    >
      <LogoFilters />
      {display === 'wordmark' ? (
        <>
          {/* The light file shows in dark mode too when there is no dark one. */}
          <img
            src={(wordmark?.light ?? wordmark?.dark)!}
            alt={brandName}
            className={`h-[var(--qb-logo-height,2rem)] w-auto max-w-[min(calc(var(--qb-logo-height,2rem)*6),45vw)] max-md:max-w-[min(calc(var(--qb-logo-height,2rem)*6),45vw,100%)] object-contain ${ICON_TILE} ${wordmark?.dark && wordmark.light ? 'dark:hidden' : ''}`}
          />
          {wordmark?.dark && wordmark.light ? (
            <img
              src={wordmark.dark}
              alt={brandName}
              className={`hidden h-[var(--qb-logo-height,2rem)] w-auto max-w-[min(calc(var(--qb-logo-height,2rem)*6),45vw)] max-md:max-w-[min(calc(var(--qb-logo-height,2rem)*6),45vw,100%)] object-contain dark:block ${ICON_TILE}`}
            />
          ) : null}
        </>
      ) : display === 'name' ? (
        // A stored design's title alone: shown on phones too.
        <span title={brandName} className={`${TITLE} text-xl`}>
          {brandName}
        </span>
      ) : (
        <>
          {mark}
          {display === 'mark_and_name' ? (
            <span title={brandName} className={`${TITLE} text-lg sr-only sm:not-sr-only sm:block`}>
              {brandName}
            </span>
          ) : null}
        </>
      )}
    </Link>
  )
  const navigation = (
    <Navigation
      navItems={navItems}
      helpHeaderLinks={settings?.helpCenterConfig?.headerLinks}
      supportUnreadTotal={supportUnreadTotal}
    />
  )
  const menuFolded = useMenuFold(inlineRow, headerLayout === 'inline')
  const headerClassName =
    'portal-header sticky top-0 z-40 w-full py-2 border-b border-[var(--header-border)] bg-[var(--header-background)] shadow-sm [[data-qb-header-band=on]_&]:shadow-none ' +
    // On a gradient band, the band's own background runs up behind the header: one surface, the header its top.
    '[[data-qb-header-span=on]_&]:[background:var(--qb-header-surface-narrow,var(--qb-header-surface))] sm:[[data-qb-header-span=on]_&]:[background:var(--qb-header-surface)] [[data-qb-header-span=on]_&]:![background-size:100%_calc(100%+var(--portal-band-height,0px))] [[data-qb-header-span=on]_&]:![background-position:top] ' +
    // On a page with no band, such as a post's, the header is its own colour alone: the shared
    // surface squeezed into the header would end on a hard edge.
    '[[data-qb-header-span=on]:not(:has([data-qb-part=band]))_&]:![background:var(--qb-header-bg)] ' +
    // On the hero's photo, the top of the band's picture under a veil deepest at the top, easing into
    // the band's at its foot (the band measures where the picture sits, portal-band). The veil is
    // laid from the border's edge: from the padding's, it repeats into the transparent bottom
    // border, its deepest top row drawn there as a faint line over the picture.
    '[[data-qb-header-span=photo]_&]:border-transparent [[data-qb-header-span=photo]_&]:shadow-none [[data-qb-header-span=photo]_&]:[background:linear-gradient(var(--qb-header-veil),var(--qb-band-scrim))_border-box,var(--portal-band-image,none)_var(--portal-band-image-at,center_top)/var(--portal-band-image-size,cover)_no-repeat,var(--qb-header-bg)]'

  // A design can put the menu beside the logo or centre both. Below md an
  // inline header folds back to two rows, so the menu always has room; wider,
  // it folds too when the menu is wider than the room beside the logo.
  if (headerLayout === 'inline') {
    return (
      <header
        ref={headerRef}
        className={headerClassName}
        data-qb-section="header"
        data-qb-part="header"
      >
        <div className="max-w-[var(--qb-page-max,72rem)] mx-auto w-full px-4 sm:px-6">
          <div ref={inlineRow} className="flex h-12 items-center gap-4" data-qb-header-row="">
            {logo}
            {menuFolded ? null : (
              <NavScroller className="hidden min-w-0 flex-1 md:block">{navigation}</NavScroller>
            )}
            <div className="ms-auto shrink-0" data-qb-header-actions="">
              {authButtons}
            </div>
          </div>
        </div>
        <NavScroller className={menuFolded ? 'mt-2' : 'mt-2 md:hidden'}>
          <div className="max-w-[var(--qb-page-max,72rem)] mx-auto w-full px-4 sm:px-6">
            {navigation}
          </div>
        </NavScroller>
      </header>
    )
  }
  if (headerLayout === 'centered') {
    return (
      <header
        ref={headerRef}
        className={headerClassName}
        data-qb-section="header"
        data-qb-part="header"
      >
        <div className="max-w-[var(--qb-page-max,72rem)] mx-auto w-full px-4 sm:px-6">
          {/* From md, three columns: the theme toggle and Log in at the start, the logo
              between, Sign up or the account at the end, each edge on the content
              column's. On a phone the logo leads, every button together at the end. */}
          <div
            className="flex h-12 items-center gap-2 md:grid md:grid-cols-[1fr_auto_1fr]"
            data-qb-header-row=""
          >
            <div
              className="order-1 ms-auto flex items-center md:order-none md:ms-0 md:justify-self-start"
              data-qb-header-lead=""
            >
              {themeToggle}
              {customise}
              {adminButton}
              {signInOffered && showSignup ? logIn : null}
            </div>
            {logo}
            <div
              className="order-2 flex items-center md:order-none md:justify-self-end"
              data-qb-header-actions=""
            >
              {bell}
              {accountMenu}
              {signInOffered ? (showSignup ? signUp : logIn) : null}
            </div>
          </div>
        </div>
        {/* Centred while it fits; wider than the screen, it scrolls from its start. */}
        <NavScroller className="mt-2">
          <div className="max-w-[var(--qb-page-max,72rem)] mx-auto flex w-max min-w-full justify-center px-4 sm:px-6">
            {navigation}
          </div>
        </NavScroller>
      </header>
    )
  }

  // Two-row layout: Logo + Auth on top, Navigation below
  return (
    // A banner landmark, so the logo and account controls sit in one.
    <header
      ref={headerRef}
      className={headerClassName}
      data-qb-section="header"
      data-qb-part="header"
    >
      {/* Row 1: Logo + Name + Auth */}
      <div>
        <div className="max-w-[var(--qb-page-max,72rem)] mx-auto w-full px-4 sm:px-6">
          <div className="flex h-12 items-center justify-between">
            {logo}
            {authButtons}
          </div>
        </div>
      </div>

      {/* Row 2: Navigation */}
      <NavScroller className="mt-2">
        <div className="max-w-[var(--qb-page-max,72rem)] mx-auto w-full px-4 sm:px-6">
          {navigation}
        </div>
      </NavScroller>
    </header>
  )
}

const navItemClass = (isActive: boolean) =>
  cn(
    'portal-nav__item px-3 py-2 text-sm font-medium transition-colors [border-radius:var(--qb-nav-radius,calc(var(--radius)*0.8))]',
    isActive
      ? 'portal-nav__item--active bg-[var(--nav-active-background)] text-[var(--nav-active-foreground)] [[data-qb-nav=underline]_&]:rounded-none [[data-qb-nav=underline]_&]:shadow-[inset_0_-2px_0_var(--qb-accent)] [[data-qb-nav=plain]_&]:font-bold'
      : 'text-[var(--nav-inactive-color)] hover:text-[var(--nav-active-foreground)] hover:bg-[var(--nav-active-background)]/50'
  )

function Navigation({
  navItems,
  helpHeaderLinks,
  supportUnreadTotal,
}: {
  navItems: PortalNavItem[]
  helpHeaderLinks: { label: string; url: string }[] | undefined
  supportUnreadTotal: number
}) {
  // Admin-configured help center links render beside the built-in nav on help
  // pages only. External URLs open in a new tab; root-relative paths stay
  // in-tab. Legacy configs predate the field, hence the `?? []`.
  const onHelpPages = useRouterState({ select: (s) => isHelpPath(s.location.pathname) })
  const helpLinks = onHelpPages ? (helpHeaderLinks ?? []).slice(0, 3) : []

  return (
    <nav className="portal-nav flex items-center gap-1 whitespace-nowrap" data-qb-menu-row="">
      {navItems.map((item) => {
        if (item.kind === 'link') {
          return (
            <a
              key={item.id}
              href={item.href}
              target={item.newTab ? '_blank' : undefined}
              rel="noopener noreferrer"
              className={navItemClass(false)}
              data-qb-part="nav-item"
              data-qb-menu={`link:${item.id}`}
            >
              {item.label}
            </a>
          )
        }
        return (
          <NavTab
            key={item.id}
            item={item}
            unread={item.type === 'support' ? supportUnreadTotal : 0}
          />
        )
      })}
      {helpLinks.map((link) => {
        const external = !link.url.startsWith('/')
        return (
          <a
            key={link.url}
            href={link.url}
            target={external ? '_blank' : undefined}
            rel={external ? 'noopener noreferrer' : undefined}
            className={navItemClass(false)}
            data-qb-part="nav-item"
          >
            {link.label}
          </a>
        )
      })}
    </nav>
  )
}

type BuiltInNavItem = Extract<PortalNavItem, { kind: 'builtin' }>

/**
 * A tab. It follows the location on its own, so a navigation renders only the
 * tabs it highlights, and is memoized on what it shows, so the header
 * rendering again (a navigation draft in the branding preview, a new unread
 * count) renders only the tabs that changed.
 */
const NavTab = memo(
  function NavTab({ item, unread }: { item: BuiltInNavItem; unread: number }) {
    const intl = useIntl()
    const isActive = useRouterState({ select: (s) => isTabActive(item, s.location.pathname) })
    return (
      <Link
        to={item.to}
        className={navItemClass(isActive)}
        data-qb-part="nav-item"
        data-qb-menu={item.type}
        data-state={isActive ? 'active' : undefined}
      >
        {item.label ??
          intl.formatMessage({ id: item.messageId, defaultMessage: item.defaultMessage })}
        {unread > 0 && (
          <span
            className="ms-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold leading-[18px] text-primary-foreground"
            aria-label={intl.formatMessage(
              {
                id: 'portal.support.unreadBadge',
                defaultMessage: '{count} unread',
              },
              { count: unread }
            )}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Link>
    )
  },
  (prev, next) =>
    prev.unread === next.unread &&
    prev.item.to === next.item.to &&
    prev.item.label === next.item.label &&
    prev.item.messageId === next.item.messageId &&
    prev.item.defaultMessage === next.item.defaultMessage
)

/**
 * The header sticks to the top of the page. Its height (the logo, the tabs and
 * any custom CSS set it) is published as --portal-header-height, so what else
 * sticks sits below it and anchor jumps land clear of it.
 */
function useStickyHeaderHeight() {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const header = ref.current
    if (!header) return
    const root = document.documentElement
    const publish = () =>
      root.style.setProperty('--portal-header-height', `${header.offsetHeight}px`)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(header)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--portal-header-height')
    }
  }, [])
  return ref
}

/** Compact theme toggle dropdown for the header. */
function ThemeToggle() {
  const intl = useIntl()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // The saved choice is only known in the browser. Until then the button
  // shows System, the default, so the header is complete on first paint and
  // nothing shifts when the stored theme is read.
  useEffect(() => {
    setMounted(true)
  }, [])

  const themeOptions = [
    {
      value: 'system',
      label: intl.formatMessage({ id: 'portal.header.theme.system', defaultMessage: 'System' }),
      icon: ComputerDesktopIcon,
    },
    {
      value: 'light',
      label: intl.formatMessage({ id: 'portal.header.theme.light', defaultMessage: 'Light' }),
      icon: SunIcon,
    },
    {
      value: 'dark',
      label: intl.formatMessage({ id: 'portal.header.theme.dark', defaultMessage: 'Dark' }),
      icon: MoonIcon,
    },
  ] as const

  const currentTheme = (mounted && themeOptions.find((t) => t.value === theme)) || themeOptions[0]
  const CurrentIcon = currentTheme.icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9">
          <CurrentIcon className="h-4 w-4" />
          <span className="sr-only">
            {intl.formatMessage({
              id: 'portal.header.theme.toggleLabel',
              defaultMessage: 'Toggle theme',
            })}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {themeOptions.map((t) => (
          <DropdownMenuItem
            key={t.value}
            onClick={() => setTheme(t.value)}
            className={cn(mounted && theme === t.value && 'bg-accent')}
          >
            <t.icon className="me-2 h-4 w-4" />
            {t.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
