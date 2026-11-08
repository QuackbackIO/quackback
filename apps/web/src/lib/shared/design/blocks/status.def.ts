/** The status block, as the builder and Quackback AI know it (see index.ts). */
import { emptyFields, linkField, type HomeBlockDef } from './fields'

export const statusDef: HomeBlockDef<'status'> = {
  name: 'Status',
  purpose: 'Whether everything is working',
  job: 'answers',
  own: [
    {
      kind: 'switch',
      key: 'showIncidents',
      label: 'Show incidents',
      default: true,
      about: 'Whether it lists the incidents under way',
    },
    ...emptyFields('hide', 'No status to show yet.'),
    linkField,
  ],
  repeat: 'once',
  ai: ['heading', 'showIncidents', 'whenEmpty', 'emptyText', 'link'],
  aliases: ['status'],
  examples: [
    {
      request: 'Put status next to the post box',
      ops: [{ op: 'move', target: 'status', value: 'beside:composer' }],
    },
  ],
}
