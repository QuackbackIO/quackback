/**
 * A failed call as one line, for an inline error under a form. Worded through
 * `describeError`, so a raw technical message never reaches the screen.
 */
import { describeError, noticeText, type ErrorAudience } from '@/lib/shared/describe-error'

const TEAM_AREAS = ['/admin', '/onboarding']

export function errorAudience(): ErrorAudience {
  if (typeof window === 'undefined') return { team: false, online: true }
  const path = window.location.pathname
  return {
    team: TEAM_AREAS.some((area) => path === area || path.startsWith(`${area}/`)),
    online: navigator.onLine !== false,
  }
}

export function errorText(error: unknown, fallback: string): string {
  return noticeText(describeError(error, fallback, errorAudience()))
}
