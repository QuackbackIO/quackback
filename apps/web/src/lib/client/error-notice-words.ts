import { useEffect } from 'react'
import { useIntl } from 'react-intl'
import {
  ENGLISH_NOTICE_WORDS,
  ERROR_CODE_MESSAGES,
  ERROR_NOTICE_MESSAGES,
  type ErrorCode,
  type ErrorNoticeWord,
  type ErrorNoticeWords,
} from '@/lib/shared/describe-error'

/**
 * The error notices' words in the page's language. Notices are raised from
 * mutation callbacks and other code with no React context around it, so they
 * read the words `ErrorNoticeLanguage` sets here; English until it does.
 */
let words: ErrorNoticeWords = ENGLISH_NOTICE_WORDS

export function errorNoticeWords(): ErrorNoticeWords {
  return words
}

/** Words the notices in a language; returns the call that puts the English back. */
export function setErrorNoticeWords(next: ErrorNoticeWords): () => void {
  words = next
  return () => {
    if (words === next) words = ENGLISH_NOTICE_WORDS
  }
}

/**
 * Words the error notices (`toastError`, `errorText`) in the surrounding
 * IntlProvider's language while mounted. Those notices are raised from
 * mutation callbacks and other code with no React context around it, so they
 * read the words this sets rather than calling `useIntl` themselves. It lives
 * beside the words, in a module the admin and onboarding layouts both load
 * already, so mounting it in both adds no chunk of its own.
 */
export function ErrorNoticeLanguage() {
  const intl = useIntl()
  useEffect(() => {
    const words = {} as ErrorNoticeWords
    for (const [word, message] of Object.entries(ERROR_NOTICE_MESSAGES)) {
      // The reference keeps its placeholder; `referenceLabel` fills it in.
      words[word as ErrorNoticeWord] = intl.formatMessage(message, { reference: '{reference}' })
    }
    const codes: Partial<Record<ErrorCode, string>> = {}
    for (const [code, message] of Object.entries(ERROR_CODE_MESSAGES)) {
      codes[code as ErrorCode] = intl.formatMessage(message)
    }
    return setErrorNoticeWords({ ...words, codes })
  }, [intl])
  return null
}
