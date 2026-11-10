/** The welcome block, as the portal draws it: a few words of your own, in rich text. */
import type { HomeBlockView } from './view'

export const welcome = {
  type: 'welcome',
  size: [12, 1],
  min: [3, 1],
  page: null,
  made: {
    body: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Welcome! Share feedback, see what is coming next and find help.',
            },
          ],
        },
      ],
    },
  },
} as const satisfies HomeBlockView
