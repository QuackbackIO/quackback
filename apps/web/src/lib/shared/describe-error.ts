/**
 * Turns whatever a failed call threw into words fit to show a person.
 *
 * A message someone wrote for people ("A board with this slug already
 * exists") is shown as written. Everything else, a failure the server hid, a
 * dropped connection, a bug in the browser, is worded here, and the caller's
 * `fallback` names the action that did not happen ("Couldn't create roadmap").
 *
 * Team members get the fuller wording and the reference code. Visitors on the
 * portal and widget get the caller's own line, which is already in their
 * language, and nothing more.
 */
import {
  UNEXPECTED_ERROR_MESSAGE,
  errorReferenceOf,
  splitErrorReference,
} from '@/lib/shared/error-reference'
import { STALE_BUILD_MESSAGE } from '@/lib/shared/stale-build'

export interface ErrorNotice {
  title: string
  description?: string
  /** The code that finds the real error in the server logs. */
  reference?: string
  action?: 'reload' | 'sign-in'
}

export interface ErrorAudience {
  /** A member of the workspace team, as opposed to a portal or widget visitor. */
  team: boolean
  /** Whether the browser believes it has a connection. */
  online: boolean
}

/**
 * The words this module adds. Callers pass them in the page's language (the
 * browser keeps the current set in `lib/client/error-notice-words.ts`); they
 * default to the English. Visitors only ever see the caller's fallback, which
 * is already theirs.
 */
export const ERROR_NOTICE_MESSAGES = {
  unexpected: { id: 'common.errorNotice.unexpected', defaultMessage: UNEXPECTED_ERROR_MESSAGE },
  updatedTitle: { id: 'common.errorNotice.updatedTitle', defaultMessage: 'Quackback was updated' },
  updatedDescription: {
    id: 'common.errorNotice.updatedDescription',
    defaultMessage: 'Reload to keep working.',
  },
  unreachable: {
    id: 'common.errorNotice.unreachable',
    defaultMessage: "Couldn't reach the server",
  },
  offline: { id: 'common.errorNotice.offline', defaultMessage: "You're offline" },
  connectionDescription: {
    id: 'common.errorNotice.connectionDescription',
    defaultMessage: 'Check your connection and try again.',
  },
  signedOutTitle: {
    id: 'common.errorNotice.signedOutTitle',
    defaultMessage: "You've been signed out",
  },
  signedOutDescription: {
    id: 'common.errorNotice.signedOutDescription',
    defaultMessage: 'Sign in again to continue.',
  },
  denied: {
    id: 'common.errorNotice.denied',
    defaultMessage: "You don't have permission to do that",
  },
  invalidDetails: {
    id: 'common.errorNotice.invalidDetails',
    defaultMessage: "Some details aren't valid. Check the form and try again.",
  },
  reference: { id: 'common.errorNotice.reference', defaultMessage: 'Ref {reference}' },
  reload: { id: 'common.errorNotice.reload', defaultMessage: 'Reload' },
  signIn: { id: 'common.errorNotice.signIn', defaultMessage: 'Sign in' },
  copy: { id: 'common.errorNotice.copy', defaultMessage: 'Copy' },
} as const

export type ErrorNoticeWord = keyof typeof ERROR_NOTICE_MESSAGES
export type ErrorNoticeWords = Record<ErrorNoticeWord, string>

export const ENGLISH_NOTICE_WORDS = Object.fromEntries(
  Object.entries(ERROR_NOTICE_MESSAGES).map(([word, message]) => [word, message.defaultMessage])
) as ErrorNoticeWords

/** "Ref ABC123" in the given words. */
export function referenceLabel(
  reference: string,
  words: ErrorNoticeWords = ENGLISH_NOTICE_WORDS
): string {
  return words.reference.replace('{reference}', reference)
}

const RUNTIME_ERROR_NAMES = new Set(['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError'])

// How browsers word a request that never got an answer.
const NO_ANSWER = /failed to fetch|networkerror|load failed|fetch failed|network request failed/i

// How browsers word a page asking for a file an update has since replaced.
const REPLACED_BY_UPDATE =
  /dynamically imported module|importing a module script failed|unable to preload css/i

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error
  if (error !== null && typeof error === 'object' && 'message' in error) {
    return typeof error.message === 'string' ? error.message : ''
  }
  return ''
}

function nameOf(error: unknown): string {
  return error instanceof Error ? error.name : ''
}

/**
 * A rejected form payload: the framework throws the validator's issue list as
 * JSON text in the message.
 */
function isIssueList(message: string): boolean {
  const text = message.trimStart()
  if (!text.startsWith('[')) return false
  try {
    const parsed: unknown = JSON.parse(text)
    return (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every(
        (issue) =>
          !!issue &&
          typeof issue === 'object' &&
          typeof (issue as { message?: unknown }).message === 'string'
      )
    )
  } catch {
    return false
  }
}

export function describeError(
  error: unknown,
  fallback: string,
  audience: ErrorAudience,
  words: ErrorNoticeWords = ENGLISH_NOTICE_WORDS
): ErrorNotice {
  const reference = errorReferenceOf(error)
  const message = splitErrorReference(messageOf(error)).message.trim()
  const quiet: ErrorNotice = { title: fallback }

  if (reference || message === UNEXPECTED_ERROR_MESSAGE) {
    if (!audience.team) return quiet
    return {
      title: fallback,
      description: words.unexpected,
      ...(reference ? { reference } : {}),
    }
  }

  // The server, or the browser, saying this page was built before an update.
  if (REPLACED_BY_UPDATE.test(message) || message === STALE_BUILD_MESSAGE) {
    if (!audience.team) return quiet
    return {
      title: words.updatedTitle,
      description: words.updatedDescription,
      action: 'reload',
    }
  }

  if (NO_ANSWER.test(message)) {
    if (!audience.team) return quiet
    return {
      title: audience.online ? words.unreachable : words.offline,
      description: words.connectionDescription,
    }
  }

  if (message.startsWith('Authentication required')) {
    if (!audience.team) return quiet
    return {
      title: words.signedOutTitle,
      description: words.signedOutDescription,
      action: 'sign-in',
    }
  }

  if (message.startsWith('Access denied')) {
    return audience.team ? { title: words.denied } : quiet
  }

  if (isIssueList(message)) {
    if (!audience.team) return quiet
    return {
      title: fallback,
      description: words.invalidDetails,
    }
  }

  // A bug in the browser's own code: its message was not written for anyone.
  if (RUNTIME_ERROR_NAMES.has(nameOf(error))) return quiet

  return message ? { title: message } : quiet
}

/** The notice as one line, for an inline error under a form. */
export function noticeText(
  notice: ErrorNotice,
  words: ErrorNoticeWords = ENGLISH_NOTICE_WORDS
): string {
  if (!notice.description) return notice.title
  const title = /[.!?]$/.test(notice.title) ? notice.title : `${notice.title}.`
  const reference = notice.reference ? ` (${referenceLabel(notice.reference, words)})` : ''
  return `${title} ${notice.description}${reference}`
}
