/**
 * Worked answers for overrides, for every Ask AI prompt: one part picked
 * ("just this button"), one page ("only on the help center"), phones, and
 * rich words that keep their alignment and colours. Kept valid by the
 * design-ai tests with the rest.
 */
import type { FlatOp } from '@/lib/shared/design/design-ops'

const op = (fields: Partial<FlatOp> & Pick<FlatOp, 'op'>, says: string) => ({
  target: '',
  key: '',
  value: '',
  ...fields,
  says,
})

export const OVERRIDE_OPS_EXAMPLES = [
  {
    request: 'Turn only this button dark green, #14532d',
    picked: 'the Submit button on the feedback page picked (part feed.submit)',
    answer: {
      reply: 'The Submit button is now dark green; the other buttons keep their colour.',
      outOfScope: false,
      ops: [
        op(
          {
            op: 'override',
            target: 'part:feed.submit',
            key: 'button.base.background',
            value: '#14532d',
          },
          'the Submit button to dark green'
        ),
      ],
    },
  },
  {
    request: 'Square corners on the cards, but just on the help center',
    answer: {
      reply: 'Cards on the help center now have square corners; the other pages keep theirs.',
      outOfScope: false,
      ops: [
        op(
          { op: 'override', target: 'page:help', key: 'panel.base.radius', value: '0' },
          'cards on the help center to square corners'
        ),
      ],
    },
  },
  {
    request: 'The subtitle is too big on mobile, take it down to 15px',
    answer: {
      reply: 'Subtitles are now 15px on phones; wider screens keep their size.',
      outOfScope: false,
      ops: [
        op(
          { op: 'override', target: 'everywhere', key: 'phone.subtitle.base.size', value: '15' },
          'subtitles to 15px on phones'
        ),
      ],
    },
  },
  {
    request: 'Centre the welcome text and colour “every idea” in our second colour',
    picked:
      'the Welcome block whose body now reads "Thanks for [stopping by]{accent}. We read every idea."',
    answer: {
      reply:
        'The welcome is centred, with “every idea” in the second colour; “stopping by” keeps the brand colour.',
      outOfScope: false,
      ops: [
        op(
          {
            op: 'set',
            target: 'welcome',
            key: 'body',
            value: 'Thanks for [stopping by]{accent}. We read [every idea]{support}. {center}',
          },
          'the welcome centred, with every idea in the second colour'
        ),
      ],
    },
  },
]
