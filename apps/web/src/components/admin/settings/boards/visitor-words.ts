import { ADMIN_WORDS, PORTAL_WORD_PLURALS, type PortalWords } from '@/lib/shared/design/view'

/**
 * The words visitors see for posts and boards where they differ from the
 * admin's, such as "Visitors see suggestions and categories"; nothing when the
 * portal says posts and boards too.
 */
export function visitorWordsHint(words: PortalWords): string | null {
  const differ = [
    words.postWord !== ADMIN_WORDS.postWord && PORTAL_WORD_PLURALS[words.postWord],
    words.boardWord !== ADMIN_WORDS.boardWord && PORTAL_WORD_PLURALS[words.boardWord],
  ].filter((word): word is string => !!word)
  return differ.length > 0 ? `Visitors see ${differ.join(' and ')}` : null
}
