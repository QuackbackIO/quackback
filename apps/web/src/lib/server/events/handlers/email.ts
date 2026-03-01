/**
 * Email hook handler.
 * Sends email notifications to subscribers when events occur.
 */

import {
  sendStatusChangeEmail,
  sendNewCommentEmail,
  sendChangelogPublishedEmail,
} from '@quackback/email'
import type { HookHandler, HookResult, EmailTarget, EmailConfig } from '../hook-types'
import type { EventData } from '../types'
import { isRetryableError } from '../hook-utils'
export const emailHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { email, unsubscribeUrl } = target as EmailTarget
    const cfg = config as EmailConfig

    console.log(`[Email] Sending ${event.type} notification to ${email}`)

    try {
      let result: { sent: boolean }

      if (event.type === 'post.status_changed') {
        result = await sendStatusChangeEmail({
          to: email,
          postTitle: cfg.postTitle,
          postUrl: cfg.postUrl,
          previousStatus: cfg.previousStatus!,
          newStatus: cfg.newStatus!,
          workspaceName: cfg.workspaceName,
          unsubscribeUrl,
        })
      } else if (event.type === 'comment.created') {
        result = await sendNewCommentEmail({
          to: email,
          postTitle: cfg.postTitle,
          postUrl: cfg.postUrl,
          commenterName: cfg.commenterName!,
          commentPreview: cfg.commentPreview!,
          isTeamMember: cfg.isTeamMember ?? false,
          workspaceName: cfg.workspaceName,
          unsubscribeUrl,
        })
      } else if (event.type === 'changelog.published') {
        const changelogCfg = config as Record<string, unknown>
        result = await sendChangelogPublishedEmail({
          to: email,
          changelogTitle: changelogCfg.changelogTitle as string,
          changelogUrl: changelogCfg.changelogUrl as string,
          contentPreview: (changelogCfg.contentPreview as string) ?? '',
          workspaceName: cfg.workspaceName,
          unsubscribeUrl,
        })
      } else {
        return { success: false, error: `Unsupported event type: ${event.type}` }
      }

      if (!result.sent) {
        console.log(`[Email] Skipped (not configured) for ${email}`)
        return { success: true }
      }

      console.log(`[Email] Sent to ${email}`)
      return { success: true }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[Email] ❌ Failed to send to ${email}: ${errorMsg}`)
      return {
        success: false,
        error: errorMsg,
        shouldRetry: isRetryableError(error),
      }
    }
  },
}
