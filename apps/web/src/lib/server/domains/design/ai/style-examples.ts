/**
 * Worked answers for element styles, for every Ask AI prompt: a state on the
 * whole portal (op theme, a style token) and one Home block's own look (op
 * set on the block). Kept valid by the design-ai tests with the rest.
 */
import type { FlatOp } from '@/lib/shared/design/design-ops'

const op = (fields: Partial<FlatOp> & Pick<FlatOp, 'op'>, says: string) => ({
  target: '',
  key: '',
  value: '',
  ...fields,
  says,
})

export const STYLE_OPS_EXAMPLES = [
  {
    request: 'Buttons should go a deep navy on hover and rise a little',
    answer: {
      reply: 'Main buttons now turn deep navy and rise a little on hover.',
      outOfScope: false,
      ops: [
        op(
          { op: 'theme', key: 'style.button.hover.background', value: '#1e1b4b' },
          'main buttons to deep navy on hover'
        ),
        op(
          { op: 'theme', key: 'style.button.hover.lift', value: '2' },
          'main buttons to rise 2px on hover'
        ),
      ],
    },
  },
  {
    request: 'Give this block a pale yellow background and square cards',
    picked: 'Top posts (ideas) picked',
    answer: {
      reply: 'Top posts now sits on pale yellow, with square cards inside it.',
      outOfScope: false,
      ops: [
        op(
          { op: 'set', target: 'ideas', key: 'style.block.base.background', value: '#fef9c3' },
          'top posts to a pale yellow background'
        ),
        op(
          { op: 'set', target: 'ideas', key: 'style.postCard.base.radius', value: '0' },
          'its cards to square corners'
        ),
      ],
    },
  },
]
