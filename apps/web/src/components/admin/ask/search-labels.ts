import { useMemo } from 'react'
import { useIntl } from 'react-intl'
import type { SearchKind, SearchResult } from '@/lib/shared/assistant/ask-search'

/** What each kind is called on one result, and on its filter. */
export function useSearchKindLabels(): {
  one: Record<SearchKind, string>
  many: Record<SearchKind, string>
  title: (result: SearchResult) => string
} {
  const intl = useIntl()
  return useMemo(() => {
    const f = (id: string, defaultMessage: string) => intl.formatMessage({ id, defaultMessage })
    const one: Record<SearchKind, string> = {
      post: f('ask.results.kind.post', 'Post'),
      conversation: f('ask.results.kind.conversation', 'Conversation'),
      ticket: f('ask.results.kind.ticket', 'Ticket'),
      article: f('ask.results.kind.article', 'Article'),
      changelog: f('ask.results.kind.changelog', 'Changelog'),
      person: f('ask.results.kind.person', 'Person'),
      teammate: f('ask.results.kind.teammate', 'Teammate'),
      company: f('ask.results.kind.company', 'Company'),
    }
    const many: Record<SearchKind, string> = {
      post: f('ask.results.filter.post', 'Posts'),
      conversation: f('ask.results.filter.conversation', 'Conversations'),
      ticket: f('ask.results.filter.ticket', 'Tickets'),
      article: f('ask.results.filter.article', 'Articles'),
      changelog: f('ask.results.filter.changelog', 'Changelog'),
      person: f('ask.results.filter.person', 'People'),
      teammate: f('ask.results.filter.teammate', 'Teammates'),
      company: f('ask.results.filter.company', 'Companies'),
    }
    const untitled = f('ask.results.untitled', 'Untitled')
    return { one, many, title: (result) => result.title || untitled }
  }, [intl])
}
