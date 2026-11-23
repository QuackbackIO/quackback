/**
 * The REST API for merge suggestions (/api/v1/suggestions/:id/accept,
 * dismiss, restore). Journeys API-R-086, 088, 089.
 *
 * Suggestions come from the AI merge check, so each test seeds its own
 * post_merge_suggestions rows between posts it made over REST.
 *
 * Not covered here:
 * - API-R-087: owner question (should accepting also need post.merge?).
 * - API-R-090: the list route arrives with #1017; this build has no
 *   GET /api/v1/suggestions.
 */
import { fromUuid, generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { expectJson } from '../../support/api-client'
import { deliveriesOf } from '../../support/webhooks'
import {
  customRoleApi,
  expectError,
  keyApi,
  postRow,
  restBoard,
  restPost,
  uuid,
  withHook,
} from '../../product/api-rest-feedback'

test.describe.configure({ timeout: 60_000 })

/** A pending suggestion that `source` duplicates `target`; returns its TypeID. */
async function seedSuggestion(source: string, target: string): Promise<string> {
  const id = generateId('post_merge_sug')
  await supportDb()`
    INSERT INTO post_merge_suggestions
      (id, source_post_id, target_post_id, status, vector_score, fts_score, hybrid_score,
       llm_confidence, llm_reasoning)
    VALUES (${uuid(id)}, ${uuid(source)}, ${uuid(target)}, 'pending', 0.9, 0.8, 0.85, 0.9,
            'e2e seeded')`
  return id
}

async function suggestionRow(id: string): Promise<Record<string, unknown>> {
  const [row] = await supportDb()`SELECT * FROM post_merge_suggestions WHERE id = ${uuid(id)}`
  return row
}

test.describe('REST merge suggestions', () => {
  test(
    'API-R-086 accepting a suggestion merges the posts, resolves it, dismisses its siblings and fires post.merged',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const key = await keyApi(playwright, baseURL, people)
      const { api } = key
      const board = await restBoard(api, `${marker} board`)
      const p = await restPost(api, board.id, `${marker} P`)
      const q = await restPost(api, board.id, `${marker} Q`)
      const r = await restPost(api, board.id, `${marker} R`)
      const s1 = await seedSuggestion(p.id, q.id)
      const s2 = await seedSuggestion(p.id, r.id)

      await withHook(api, marker, ['post.merged'], async () => {
        const res = await api.post(`/api/v1/suggestions/${s1}/accept`)
        expect((await expectJson(res, 200)).data).toEqual({ accepted: true, id: s1 })
        expect((await postRow(p.id)).canonical_post_id).toBe(uuid(q.id))
        expect((await postRow(q.id)).canonical_post_id).toBeNull()

        const accepted = await suggestionRow(s1)
        expect(accepted.status).toBe('accepted')
        expect(fromUuid('principal', accepted.resolved_by_principal_id as string)).toBe(
          key.principalId
        )
        expect((await suggestionRow(s2)).status).toBe('dismissed')
        await deliveriesOf(marker, 'post.merged', p.id)
      })

      await expectError(
        await api.post(`/api/v1/suggestions/${s1}/accept`),
        404,
        'NOT_FOUND',
        'Merge suggestion not found or already resolved'
      )

      // swapDirection merges the target into the source instead.
      const x = await restPost(api, board.id, `${marker} X`)
      const y = await restPost(api, board.id, `${marker} Y`)
      const s3 = await seedSuggestion(x.id, y.id)
      await expectJson(
        await api.post(`/api/v1/suggestions/${s3}/accept`, { data: { swapDirection: true } }),
        200
      )
      expect((await postRow(y.id)).canonical_post_id).toBe(uuid(x.id))
      expect((await postRow(x.id)).canonical_post_id).toBeNull()
    }
  )

  test(
    'API-R-088 dismiss and restore answer 200 even as no-ops and change the row only on a real transition',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const key = await keyApi(playwright, baseURL, people)
      const { api } = key
      const board = await restBoard(api, `${marker} board`)
      const a = await restPost(api, board.id, `${marker} A`)
      const b = await restPost(api, board.id, `${marker} B`)
      const c = await restPost(api, board.id, `${marker} C`)
      const d = await restPost(api, board.id, `${marker} D`)
      const sug = await seedSuggestion(a.id, b.id)
      const toAccept = await seedSuggestion(c.id, d.id)
      const missing = generateId('post_merge_sug')

      const dismiss = async (id: string) =>
        (await expectJson(await api.post(`/api/v1/suggestions/${id}/dismiss`), 200)).data
      const restore = async (id: string) =>
        (await expectJson(await api.post(`/api/v1/suggestions/${id}/restore`), 200)).data

      expect(await dismiss(sug)).toEqual({ dismissed: true, id: sug })
      const first = await suggestionRow(sug)
      expect(first.status).toBe('dismissed')
      expect(fromUuid('principal', first.resolved_by_principal_id as string)).toBe(key.principalId)
      expect(await dismiss(sug)).toEqual({ dismissed: true, id: sug })
      expect((await suggestionRow(sug)).updated_at).toEqual(first.updated_at)
      expect(await dismiss(missing)).toEqual({ dismissed: true, id: missing })

      expect(await restore(sug)).toEqual({ restored: true, id: sug })
      const restored = await suggestionRow(sug)
      expect(restored).toMatchObject({
        status: 'pending',
        resolved_at: null,
        resolved_by_principal_id: null,
      })
      expect(await restore(sug)).toEqual({ restored: true, id: sug })
      expect((await suggestionRow(sug)).updated_at).toEqual(restored.updated_at)

      await expectJson(await api.post(`/api/v1/suggestions/${toAccept}/accept`), 200)
      expect(await restore(toAccept)).toEqual({ restored: true, id: toAccept })
      expect((await suggestionRow(toAccept)).status).toBe('accepted')

      // Accept, by contrast, refuses an unknown suggestion.
      await expectError(
        await api.post(`/api/v1/suggestions/${missing}/accept`),
        404,
        'NOT_FOUND',
        'Merge suggestion not found or already resolved'
      )
    }
  )

  test(
    'API-R-089 a malformed suggestion id is 400 BAD_REQUEST; a missing permission or scope is 403',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, people)
      const readOnly = await keyApi(playwright, baseURL, people, { scopes: ['read:feedback'] })
      const noPerm = await customRoleApi(playwright, baseURL, people, `No sug ${marker}`, [
        'post.view_private',
      ])
      for (const action of ['accept', 'dismiss', 'restore']) {
        await expectError(
          await admin.api.post(`/api/v1/suggestions/post_123/${action}`),
          400,
          'BAD_REQUEST',
          'Invalid suggestion ID format. Expected post_merge_sug_xxx'
        )
      }
      const id = generateId('post_merge_sug')
      await expectError(
        await noPerm.api.post(`/api/v1/suggestions/${id}/dismiss`),
        403,
        'FORBIDDEN',
        "Requires the 'suggestion.manage' permission"
      )
      await expectError(
        await readOnly.api.post(`/api/v1/suggestions/${id}/dismiss`),
        403,
        'FORBIDDEN',
        "This API key is missing the 'write:feedback' scope required by 'suggestion.manage'"
      )
      // Positive control: the admin key's dismiss of the same id answers 200.
      await expectJson(await admin.api.post(`/api/v1/suggestions/${id}/dismiss`), 200)
    }
  )
})
