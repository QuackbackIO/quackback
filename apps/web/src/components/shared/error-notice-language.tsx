import { useEffect } from 'react'
import { useIntl } from 'react-intl'
import {
  ERROR_NOTICE_MESSAGES,
  setErrorNoticeWords,
  type ErrorNoticeWord,
  type ErrorNoticeWords,
} from '@/lib/shared/describe-error'

/**
 * Words the error notices (`toastError`, `errorText`) in the surrounding
 * IntlProvider's language while mounted. Those notices are raised from
 * mutation callbacks and other code with no React context around it, so they
 * read the words this sets rather than calling `useIntl` themselves.
 */
export function ErrorNoticeLanguage() {
  const intl = useIntl()
  useEffect(() => {
    const words = {} as ErrorNoticeWords
    for (const [word, message] of Object.entries(ERROR_NOTICE_MESSAGES)) {
      // The reference keeps its placeholder; `referenceLabel` fills it in.
      words[word as ErrorNoticeWord] = intl.formatMessage(message, { reference: '{reference}' })
    }
    return setErrorNoticeWords(words)
  }, [intl])
  return null
}
