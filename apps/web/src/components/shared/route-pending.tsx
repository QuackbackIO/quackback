import { ArrowPathIcon } from '@heroicons/react/24/solid'

/**
 * Router-wide `defaultPendingComponent`. Replaces the navigating-to route's
 * outlet content once a navigation is pending for longer than
 * `defaultPendingMs` (see src/router.tsx). Intentionally layout-neutral — no
 * text, no branding — so it drops into both the admin outlet and the portal
 * `<main>` without fighting either shell's chrome.
 */
export function RoutePendingComponent() {
  return (
    // In the portal it holds the screen below the header, so the footer waits
    // just under the screen's edge: a page arriving taller moves it unseen,
    // and one arriving shorter brings it up by its own height. Left in view,
    // the footer jumped down the page as most pages arrived.
    <div className="flex flex-1 min-h-32 items-center justify-center [[data-portal]_&]:min-h-[calc(100svh-var(--portal-header-height,0px))]">
      <ArrowPathIcon
        className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none"
        aria-hidden="true"
      />
    </div>
  )
}
