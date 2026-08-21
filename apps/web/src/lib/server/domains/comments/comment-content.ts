/**
 * Canonical write pipeline for comment bodies: sanitize, rehost, project.
 */
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import {
  commentMarkdownToTiptapJson,
  hasImageNode,
  projectContentJsonToMarkdown,
} from '@/lib/server/markdown-tiptap'
import { rehostExternalImages } from '@/lib/server/content/rehost-images'
import type { TiptapContent } from '@/lib/shared/db-types'

export async function prepareCommentContent(opts: {
  content: string
  contentJson?: TiptapContent | null
  authorIsTeamMember: boolean
  principalId?: string
}): Promise<{ content: string; contentJson: TiptapContent }> {
  const restrictImagesToTrustedOrigins = !opts.authorIsTeamMember
  const sanitized = opts.contentJson
    ? sanitizeTiptapContent(opts.contentJson, { restrictImagesToTrustedOrigins })
    : sanitizeTiptapContent(commentMarkdownToTiptapJson(opts.content), {
        restrictImagesToTrustedOrigins,
      })
  const contentJson = await rehostExternalImages(sanitized, {
    contentType: 'comment',
    principalId: opts.principalId,
  })
  const content = hasImageNode(contentJson)
    ? projectContentJsonToMarkdown(contentJson, opts.content)
    : opts.content
  return { content, contentJson }
}
