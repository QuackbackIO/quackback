/**
 * Canny normalizer (§I3): pulls boards/posts/votes via the Canny API and
 * converts them into the wizard's canonical CSV, closing the REST-import
 * attribution gap for Canny the same way the UserVoice adapter does.
 *
 * Canny has no export FILE to detect — the "upload" step for this source is
 * an API key instead, so there's no `detectCannyExport`; the wizard's
 * source selector calls this directly. Comments/notes/changelog entries
 * aren't part of the wizard's canonical row shape (posts + real votes only)
 * and are left to the CLI's richer conversion for now.
 */
import Papa from 'papaparse'
import { CannyClient } from './client'
import type { CannyBoard, CannyPost, CannyVote } from './types'
import { normalizeStatus, embedImages } from './field-map'
import { CANONICAL_CSV_COLUMNS, type ImportVoterRecord, type NormalizedImport } from '../types'

export interface CannyAdapterOptions {
  apiKey: string
  delayMs?: number
}

export async function normalizeCannyExport(options: CannyAdapterOptions): Promise<NormalizedImport> {
  const client = new CannyClient({ apiKey: options.apiKey, delayMs: options.delayMs })

  const { boards } = await client.post<{ boards: CannyBoard[] }>('/v1/boards/list')

  const allPosts: CannyPost[] = []
  for (const board of boards ?? []) {
    const boardPosts = await client.listAll<CannyPost>('/v1/posts/list', 'posts', {
      boardID: board.id,
    })
    allPosts.push(...boardPosts)
  }

  const allVotes = await client.listAll<CannyVote>('/v1/votes/list', 'votes')

  const canonicalRows = allPosts.map((post) => {
    const tagNames = [
      ...(post.tags?.map((t) => t.name) ?? []),
      ...(post.category ? [post.category.name] : []),
    ]
    return {
      title: post.title,
      content: embedImages(post.details || '', post.imageURLs),
      status: post.status ? normalizeStatus(post.status) : 'Open',
      tags: tagNames.join(','),
      board: post.board?.name ?? '',
      author_name: post.author?.name ?? '',
      author_email: post.author?.email ?? '',
      vote_count: String(post.score ?? 0),
      created_at: post.created,
      source_id: post.id,
    }
  })

  const votersByPost = new Map<string, Map<string, ImportVoterRecord>>()
  for (const vote of allVotes) {
    if (!vote.voter?.email) continue
    const postId = vote.post.id
    if (!votersByPost.has(postId)) votersByPost.set(postId, new Map())
    const byEmail = votersByPost.get(postId)!
    const email = vote.voter.email.toLowerCase()
    if (!byEmail.has(email)) {
      byEmail.set(email, { email, name: vote.voter.name, createdAt: vote.created })
    }
  }

  const voters: Record<string, ImportVoterRecord[]> = {}
  for (const [postId, byEmail] of votersByPost) {
    voters[postId] = Array.from(byEmail.values())
  }

  return {
    csv: Papa.unparse(canonicalRows, { columns: [...CANONICAL_CSV_COLUMNS] }),
    voters,
    caveats: [],
  }
}
