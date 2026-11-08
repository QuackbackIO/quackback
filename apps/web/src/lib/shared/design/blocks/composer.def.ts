/** The composer block, as the builder and Quackback AI know it (see index.ts). */
import type { HomeBlockDef } from './fields'

export const composerDef: HomeBlockDef<'composer'> = {
  name: 'Write a post',
  purpose: 'A box visitors post from',
  job: 'hear',
  own: [],
  repeat: 'once',
  ai: ['heading'],
  aliases: ['composer', 'post box', 'write a post', 'new post'],
  examples: [
    {
      request: 'Put the post box at the top',
      ops: [{ op: 'move', target: 'composer', value: 'top' }],
    },
  ],
}
