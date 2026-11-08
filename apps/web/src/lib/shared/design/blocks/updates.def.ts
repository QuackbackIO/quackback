/** The updates block, as the builder and Quackback AI know it (see index.ts). */
import { emptyFields, linkField, plural, type HomeBlockDef } from './fields'
import { updates } from './updates'

export const updatesDef: HomeBlockDef<'updates'> = {
  name: 'Latest updates',
  purpose: 'Your latest changelog entries',
  job: 'progress',
  own: [
    {
      kind: 'count',
      key: 'count',
      label: 'How many',
      options: updates.counts.count,
      about: 'How many changelog entries it lists',
    },
    {
      kind: 'switch',
      key: 'showDate',
      label: 'Date',
      group: 'Each update shows',
      default: true,
      about: 'Whether each entry shows its date',
    },
    {
      kind: 'switch',
      key: 'showSummary',
      label: 'Summary',
      group: 'Each update shows',
      default: false,
      about: 'Whether each entry shows the start of its words, in two lines',
    },
    ...emptyFields('hide', 'No updates yet.'),
    linkField,
  ],
  repeat: 'once',
  ai: ['heading', 'count', 'showDate', 'showSummary', 'whenEmpty', 'emptyText', 'link'],
  summary: (block) => [plural(block.count, 'latest entry', 'latest entries')],
  aliases: ['updates', 'changelog updates', 'latest entries'],
  examples: [
    {
      request: 'Show just 2 updates',
      ops: [{ op: 'set', target: 'updates', key: 'count', value: '2' }],
    },
  ],
}
