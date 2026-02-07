/**
 * Jira issue formatting utilities.
 * Produces Atlassian Document Format (ADF) for issue descriptions.
 */

import type { EventData } from '../../events/types'
import { stripHtml, truncate } from '../../events/hook-utils'

/**
 * ADF node types used for Jira issue descriptions.
 */
interface AdfTextNode {
  type: 'text'
  text: string
  marks?: Array<{ type: string; attrs?: Record<string, string> }>
}

interface AdfParagraphNode {
  type: 'paragraph'
  content: AdfTextNode[]
}

interface AdfRuleNode {
  type: 'rule'
}

interface AdfDoc {
  version: 1
  type: 'doc'
  content: Array<AdfParagraphNode | AdfRuleNode>
}

/**
 * Build a Jira issue title and ADF description from a post.created event.
 */
export function buildJiraIssueBody(
  event: EventData,
  rootUrl: string
): { title: string; description: AdfDoc } {
  if (event.type !== 'post.created') {
    return {
      title: 'Feedback',
      description: {
        version: 1,
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }],
      },
    }
  }

  const { post } = event.data
  const postUrl = `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`
  const content = truncate(stripHtml(post.content), 2000)
  const author = post.authorName || post.authorEmail || 'Anonymous'

  const description: AdfDoc = {
    version: 1,
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: content }],
      },
      { type: 'rule' },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: `Submitted by: ${author}` }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: `Board: ${post.boardSlug}` }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: `Votes: ${post.voteCount}` }],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'View in Quackback',
            marks: [{ type: 'link', attrs: { href: postUrl } }],
          },
        ],
      },
    ],
  }

  return { title: post.title, description }
}
