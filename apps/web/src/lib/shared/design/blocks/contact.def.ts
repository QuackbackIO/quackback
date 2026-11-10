/** The contact block, as the builder and Quackback AI know it (see index.ts). */
import { linkField, type HomeBlockDef } from './fields'

export const contactDef: HomeBlockDef<'contact'> = {
  name: 'Contact',
  purpose: 'A way to reach your team',
  job: 'hear',
  own: [
    {
      kind: 'text',
      key: 'text',
      label: 'Words',
      max: 160,
      inPlace: true,
      aiUntold: true,
      about:
        'Its line of words under the heading, in place of "Ask a question or tell us about a problem, and we will get back to you."',
    },
    {
      ...linkField,
      aiUntold: true,
      about: 'The words of its button, in place of "Start a conversation"',
    },
  ],
  repeat: 'once',
  ai: ['heading', 'text', 'link'],
  aliases: ['contact', 'contact us'],
  examples: [
    {
      request: 'Move contact to the bottom',
      ops: [{ op: 'move', target: 'contact', value: 'bottom' }],
    },
  ],
}
