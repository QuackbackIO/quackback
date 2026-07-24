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
    <div className="flex flex-1 min-h-32 items-center justify-center">
      <ArrowPathIcon
        className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none"
        aria-hidden="true"
      />
    </div>
  )
}
