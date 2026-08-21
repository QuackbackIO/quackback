/**
 * Single source for "who replies first" copy. Rendered on the Agents pages
 * and the Workflows page so the rule is stated once.
 */
export const WHO_REPLIES_FIRST = {
  titleId: 'automation.whoRepliesFirst.title',
  title: 'Who replies first',
  steps: [
    {
      id: 'automation.whoRepliesFirst.step1',
      defaultMessage: "<b>Quinn answers instantly</b> whenever it's enabled, around the clock.",
    },
    {
      id: 'automation.whoRepliesFirst.step2',
      defaultMessage:
        '<b>Customer-facing workflows</b> run on the same message; the first match wins, {order}.',
    },
    {
      id: 'automation.whoRepliesFirst.step3',
      defaultMessage:
        'When Quinn <b>hands off</b> and a routing workflow is live, <b>the workflow decides the assignment</b>.',
    },
  ],
  orderBelowId: 'automation.whoRepliesFirst.orderBelow',
  orderBelow: 'in the order below',
  orderOnWorkflowsId: 'automation.whoRepliesFirst.orderOnWorkflows',
  orderOnWorkflows: 'in the order on Workflows',
} as const
