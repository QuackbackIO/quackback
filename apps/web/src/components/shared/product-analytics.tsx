'use client'

import { useEffect } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { isSyntheticAnonEmail } from '@/lib/shared/anonymous-email'
import { analyticsDistinctId } from '@/lib/shared/analytics-identity'
import { setAnalyticsClient } from '@/lib/client/analytics'
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
 * sign-in page they use.
 */
const TRACKED_ROUTE_PREFIXES = ['/admin', '/onboarding', '/auth/open-handoff', '/complete-signup']

/**
 * Product analytics for the team, loaded only when the operator set
 * `POSTHOG_KEY`. The SDK is its own chunk, fetched only on a tracked route,
 * so customer-facing pages never ship it, and it talks to this origin's
 * relay rather than a third-party host content blockers drop.
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
    if (!enabled || !config) return
    let cancelled = false
    void import('posthog-js').then(({ default: posthog }) => {
      if (cancelled) return
      if (!posthog.__loaded) {
        posthog.init(config.key, {
          api_host: config.apiHost,
          ui_host: config.uiHost,
          cross_subdomain_cookie: true,
          capture_pageview: 'history_change',
          capture_pageleave: true,
          person_profiles: 'identified_only',
          respect_dnt: true,
          mask_all_text: true,
          mask_all_element_attributes: true,
          disable_session_recording: !config.sessionRecording,
          session_recording: { maskAllInputs: true, maskTextSelector: '*' },
        })
      }
      setAnalyticsClient(posthog)
      if (!distinctId) return
      // One browser, a different person: their events must not join the
      // previous person's profile.
      if (
        posthog.get_property('$user_state') === 'identified' &&
        posthog.get_distinct_id() !== distinctId
      ) {
        posthog.reset()
      }
      posthog.identify(distinctId, { email: distinctId, name, role })
      if (config.workspaceId) {
        posthog.group('workspace', config.workspaceId, { name: workspaceName })
      }
    })
    return () => {
      cancelled = true
    }
  }, [enabled, config, distinctId, name, role, workspaceName])

  return null
}
