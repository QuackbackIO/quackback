'use client'

import { useEffect } from 'react'
import { useRouterState } from '@tanstack/react-router'
import type { PostHog } from 'posthog-js'
import { isSyntheticAnonEmail } from '@/lib/shared/anonymous-email'
import { analyticsDistinctId } from '@/lib/shared/analytics-identity'
import { scrubEventUrls, setAnalyticsClient } from '@/lib/client/analytics'
import {
  useProductAnalyticsConfig,
  useSessionContext,
  useUserRole,
  useWorkspaceSettings,
} from '@/lib/client/hooks/use-root-context'

/**
 * The team's own path through the product: signing up, onboarding and the
 * admin app. Portal, widget, help center and status visitors are the
 * workspace's customers and are never tracked, and neither is the shared
 * sign-in page they use. Neither are pages whose URL is a credential (the
 * sign-in handoff, an invitation link): identity by email joins the funnel
 * without them.
 */
const TRACKED_ROUTE_PREFIXES = ['/admin', '/onboarding']

/** The same paths as URLs, matched on a segment boundary. */
function isTrackedPath(pathname: string): boolean {
  return TRACKED_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

/** The SDK once loaded in this tab, so leaving a tracked route can pause it. */
let loaded: PostHog | null = null

/**
 * Product analytics for the team, loaded only when the operator set
 * `POSTHOG_KEY`. The SDK is its own chunk, fetched only on a tracked route,
 * so customer-facing pages never ship it. Pointing `POSTHOG_HOST` at a
 * reverse proxy on a neutral domain keeps content blockers from dropping it.
 *
 * Admin screens show the workspace's own customers, so a replay masks every
 * input and every text node, and autocapture records no element text or
 * attributes. What remains is navigation, clicks and timing: enough to see
 * where people get stuck, never what they were reading or typing.
 *
 * The person is their email (analytics-identity.ts), and the device id lives
 * in a cookie on the parent domain, so someone who signed up on a sibling
 * subdomain reporting to the same project arrives here as the same visitor
 * and stays one person.
 */
export function ProductAnalytics() {
  const config = useProductAnalyticsConfig()
  const session = useSessionContext()
  const role = useUserRole()
  const settings = useWorkspaceSettings()
  const onTrackedRoute = useRouterState({
    select: (s) =>
      s.matches.some((m) => TRACKED_ROUTE_PREFIXES.some((prefix) => m.routeId.startsWith(prefix))),
  })

  const email = session?.user?.email
  const name = session?.user?.name
  const distinctId =
    session?.session.scope === 'dashboard' &&
    session.user.principalType === 'user' &&
    email &&
    !isSyntheticAnonEmail(email)
      ? analyticsDistinctId(email)
      : null
  const workspaceName = settings?.name
  const enabled = Boolean(config && onTrackedRoute)

  useEffect(() => {
    if (!config) return
    if (!enabled) {
      // Left the tracked routes within this tab: the SDK stays loaded, so
      // pause replay and explicit events. `before_send` already drops
      // anything captured from these URLs.
      setAnalyticsClient(null)
      loaded?.stopSessionRecording()
      return
    }
    let cancelled = false
    void import('posthog-js').then(({ default: posthog }) => {
      if (cancelled) return
      if (!posthog.__loaded) {
        posthog.init(config.key, {
          // Pinned so an SDK upgrade cannot change what is captured. A later
          // snapshot records network request bodies, which on these screens
          // carry the workspace's customer data.
          defaults: '2026-05-30',
          api_host: config.apiHost,
          ...(config.uiHost ? { ui_host: config.uiHost } : {}),
          cross_subdomain_cookie: true,
          capture_pageview: 'history_change',
          capture_pageleave: true,
          person_profiles: 'identified_only',
          respect_dnt: true,
          mask_all_text: true,
          mask_all_element_attributes: true,
          disable_session_recording: !config.sessionRecording,
          session_recording: { maskAllInputs: true, maskTextSelector: '*' },
          // The SDK records a client-side navigation before React re-renders,
          // so the URL itself decides, not this component's state.
          before_send: (event) =>
            event && isTrackedPath(window.location.pathname) ? scrubEventUrls(event) : null,
        })
      } else if (config.sessionRecording) {
        posthog.startSessionRecording()
      }
      loaded = posthog
      // Who this is is settled before explicit events can be sent, so none is
      // filed under whoever this browser identified before.
      const identified = posthog.get_property('$user_state') === 'identified'
      if (!distinctId) {
        // Signed out on a tracked page: whoever this browser last identified
        // is not who is here now.
        if (identified) posthog.reset()
      } else {
        // One browser, a different person: their events must not join the
        // previous person's profile.
        if (identified && posthog.get_distinct_id() !== distinctId) {
          posthog.reset()
        }
        posthog.identify(distinctId, { email: distinctId, name, role })
        if (config.workspaceId) {
          posthog.group('workspace', config.workspaceId, { name: workspaceName })
        }
      }
      setAnalyticsClient(posthog)
    })
    return () => {
      cancelled = true
    }
  }, [enabled, config, distinctId, name, role, workspaceName])

  return null
}
