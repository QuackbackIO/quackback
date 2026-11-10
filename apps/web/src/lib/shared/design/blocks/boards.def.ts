/** The boards block, as the builder and Quackback AI know it (see index.ts). */
import { linkField, type HomeBlockDef } from './fields'

export const boardsDef: HomeBlockDef<'boards'> = {
  name: 'Boards',
  purpose: 'Your boards, with their posts',
  job: 'hear',
  own: [
    {
      kind: 'switch',
      key: 'showCounts',
      label: 'Post counts',
      default: true,
      about: 'Whether each board shows how many posts it has',
    },
    linkField,
  ],
  repeat: 'once',
  ai: ['heading', 'showCounts', 'link'],
  aliases: ['boards', 'board list', 'our boards'],
  examples: [
    {
      request: 'List our boards beside the top posts',
      ops: [{ op: 'add', key: 'boards', target: 'beside:ideas', value: '' }],
    },
  ],
}
