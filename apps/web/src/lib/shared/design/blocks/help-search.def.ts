/** The help_search block, as the builder and Quackback AI know it (see index.ts). */
import { linkField, type HomeBlockDef } from './fields'
import { helpSearch } from './help-search'

export const helpSearchDef: HomeBlockDef<'help_search'> = {
  name: 'Help search',
  purpose: 'Search your help center',
  job: 'answers',
  own: [
    {
      kind: 'count',
      key: 'popular',
      label: 'Popular articles',
      options: helpSearch.counts.popular,
      names: { 0: 'None' },
      default: 5,
      about: 'How many popular articles it lists under the search; 0 lists none',
    },
    linkField,
  ],
  repeat: 'once',
  ai: ['heading', 'popular', 'link'],
  aliases: ['help search', 'search'],
  examples: [
    {
      request: 'Put help search under the welcome',
      ops: [{ op: 'move', target: 'help_search', value: 'below:welcome' }],
    },
  ],
}
