/**
 * Guard: the portal's words. A visitor-facing message that names what visitors
 * post, or what groups it, selects on `postWord` or `boardWord`, and every
 * catalogue words every choice: each formats without error, the post choices
 * read differently from one another, so do the board choices, and a word a
 * message has no branch for reads as the default. The default words, idea and
 * board, are each select's `other` branch.
 */
import { describe, expect, it } from 'vitest'
import { createIntl } from 'react-intl'
import { loadMessages, SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/shared/i18n'
import en from '../en.json'

const CATALOG = en as Record<string, string>

/** Where visitors read the words: the portal, the widget and the unsubscribe page. */
const VISITOR = /^(portal|widget|unsubscribe)\./

/**
 * The thing posted or its group as the English catalogue names them. (A
 * category elsewhere, such as the help center's, is not the board word.)
 */
const NOUN = /\b(ideas?|posts?|boards?)\b/i

/**
 * Visitor strings that say one of the words but not as the thing posted or its
 * group: posting as a verb, the comment form's Post button, Feedback as a label
 * that suits every word, and an incident being posted.
 */
const NOT_THE_WORD = new Set([
  'portal.commentForm.errorPost',
  'portal.commentForm.postingAnonymously',
  'portal.commentForm.postingAs',
  'portal.commentForm.submitting',
  'portal.feedback.filter.date.postedWithin',
  'portal.feedback.header.postingAnonymously',
  'portal.feedback.header.postingAs',
  'portal.feedback.header.postingTo',
  'portal.feedback.header.postingToBoard',
  'portal.profile.activity.posted',
  'portal.status.subscribeDialog.description',
  'portal.settings.notifications.type.statusIncident.description',
  'widget.commentForm.errorPost',
  'widget.commentForm.post',
  'widget.commentForm.postingAnonymously',
  'widget.commentForm.postingAs',
  'widget.commentList.post',
  'widget.home.posting.postingAnonymously',
  'widget.home.posting.postingAs',
  'widget.home.posting.postingTo',
])

const POST_WORDS = ['idea', 'post', 'feature_request', 'suggestion'] as const
const BOARD_WORDS = ['board', 'category'] as const

/** Values for every other placeholder the word messages carry. */
const SAMPLE = { count: 2, name: 'Ada', title: 'Dark mode', query: 'dark', orgName: 'Acme' }

const WORD_KEYS = Object.keys(CATALOG).filter((key) =>
  /\{\s*(postWord|boardWord)\s*,/.test(CATALOG[key])
)

describe('the portal’s words in English', () => {
  it('select on the word wherever a visitor string names the thing posted or its group', () => {
    const unworded = Object.entries(CATALOG).filter(
      ([key, message]) =>
        VISITOR.test(key) &&
        !NOT_THE_WORD.has(key) &&
        NOUN.test(message) &&
        !/\{\s*(postWord|boardWord)\s*,/.test(message)
    )
    expect(unworded.map(([key]) => key)).toEqual([])
  })

  it('keep the word to visitor strings', () => {
    expect(WORD_KEYS.filter((key) => !VISITOR.test(key))).toEqual([])
    expect(WORD_KEYS.length).toBeGreaterThan(100)
  })
})

describe.each(SUPPORTED_LOCALES)('the portal’s words in %s', (locale: SupportedLocale) => {
  it('write out every choice of every word message', async () => {
    const messages = locale === 'en' ? CATALOG : await loadMessages(locale)
    const errors: string[] = []
    const intl = createIntl({
      locale,
      messages,
      onError: (error) => errors.push(`${error.message}`),
    })
    const problems: string[] = []
    for (const id of WORD_KEYS) {
      const format = (postWord: string, boardWord: string) =>
        intl.formatMessage({ id }, { ...SAMPLE, postWord, boardWord }) as string
      const usesPost = /\{\s*postWord\s*,/.test(CATALOG[id])
      const usesBoard = /\{\s*boardWord\s*,/.test(CATALOG[id])
      if (usesPost) {
        const read = POST_WORDS.map((word) => format(word, 'board'))
        if (new Set(read).size !== POST_WORDS.length) problems.push(`${id}: post choices alike`)
        if (format('something', 'board') !== read[0]) problems.push(`${id}: unknown post word`)
      }
      if (usesBoard) {
        const read = BOARD_WORDS.map((word) => format('idea', word))
        if (new Set(read).size !== BOARD_WORDS.length) problems.push(`${id}: board choices alike`)
        if (format('idea', 'something') !== read[0]) problems.push(`${id}: unknown board word`)
      }
    }
    expect(errors).toEqual([])
    expect(problems).toEqual([])
  })
})
