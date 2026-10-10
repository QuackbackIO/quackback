import type { ChannelAdapter } from './types'

/**
 * GitHub issue channel: the customer's issue is the thread. Agent replies
 * become issue comments. Close/reopen PATCHes issue state. CSAT stays in-app.
 */
export const githubAdapter: ChannelAdapter = {
  id: 'github',

  async deliverAgentMessage(ctx) {
    const { deliverGitHubAgentMessage } = await import('./github-deliver')
    await deliverGitHubAgentMessage(ctx)
  },

  async deliverLifecycleEvent(kind, ctx) {
    const { deliverGitHubLifecycleComment } = await import('./github-deliver')
    await deliverGitHubLifecycleComment(kind, ctx)
  },

  async deliverCsatRequest() {
    // In-inbox CSAT is enough. Commenting a rating link onto a public issue
    // would leak the survey onto the customer's GitHub thread.
  },
}
