/** What visitors call what they post, as the portal's design chooses it. */
export type PostWord = 'idea' | 'post' | 'feature_request' | 'suggestion'

const NOUNS: Record<PostWord, string> = {
  idea: 'idea',
  post: 'post',
  feature_request: 'feature request',
  suggestion: 'suggestion',
}

/** The word's English noun: idea when none was chosen. */
export function postNoun(word: PostWord | undefined): string {
  return NOUNS[word ?? 'idea'] ?? NOUNS.idea
}

/** The noun with a or an before it. */
export function aPostNoun(word: PostWord | undefined): string {
  const noun = postNoun(word)
  return `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}`
}

/** The noun with a capital, as a label above the title reads. */
export function capitalPostNoun(word: PostWord | undefined): string {
  const noun = postNoun(word)
  return noun[0]!.toUpperCase() + noun.slice(1)
}
