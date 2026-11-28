import { ENGLISH_NOTICE_WORDS, type ErrorNoticeWords } from '@/lib/shared/describe-error'

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
