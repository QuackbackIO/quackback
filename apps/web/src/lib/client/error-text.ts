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

/**
 * The same, for a failure where nothing the error says was written for a
 * person: a dropped stream, a request that never got an answer. The cases with
 * wording of their own (offline, unreachable, updated, signed out) keep it;
 * any other message is the browser's or a library's, so the fallback is shown.
 */
export function unplannedErrorText(error: unknown, fallback: string): string {
  const notice = describeError(error, fallback, errorAudience())
  return notice.description || notice.action ? noticeText(notice) : fallback
}
