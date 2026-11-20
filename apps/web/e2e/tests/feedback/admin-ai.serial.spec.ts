/**
 * The summary sweep, alone: it walks every stale post in the workspace, so it
 * runs with no other test creating posts meanwhile.
 *
 * Journeys: FBA-AI-09
 */
import { test, expect } from '../../support/fixtures'
import { personApi } from '../../support/server-fns'
import { supportDb, pollFor } from '../../support/db'
import { fakeAi } from '../../support/fake-ai-client'
import { runSweep } from '../../support/sweeps'
import { makeBoard, makePost, uuid } from '../../product/feedback-admin'

const SUMMARY_PROMPT = 'writing post briefs'

/** Wait until the app asked for this post's summary once (the create-time run). */
async function waitForSummaryRequest(text: string) {
  return pollFor(`summary request for ${text}`, async () => {
    const reqs = await fakeAi.requests({ contains: text, endpoint: 'chat' })
    return reqs.find((r) => r.text.includes(SUMMARY_PROMPT))
  })
}

test(
  'FBA-AI-09 the summary sweep fills missing summaries and refreshes stale ones',
  { tag: '@nightly' },
  async ({ playwright, request, marker }) => {
    test.setTimeout(120_000)
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const missing = await makePost(api, {
      boardId: board.id,
      title: `${marker} missing summary`,
      content: `${marker}-m details`,
    })
    const stale = await makePost(api, {
      boardId: board.id,
      title: `${marker} stale summary`,
      content: `${marker}-s details`,
    })
    await api.dispose()
    // The create-time runs got the fake's default answer and stored nothing.
    await waitForSummaryRequest(`${marker}-m`)
    await waitForSummaryRequest(`${marker}-s`)
    const sql = supportDb()
    // A summary that covered 5 comments, while the post has none: stale.
    await sql`UPDATE posts SET summary_json = ${sql.json({ summary: 'old', keyQuotes: [], nextSteps: [] })},
      summary_comment_count = 5 WHERE id = ${uuid(stale.id)}`

    for (const [m, text] of [
      [`${marker}-m`, `Missing filled ${marker}`],
      [`${marker}-s`, `Stale refreshed ${marker}`],
    ]) {
      await fakeAi.script({ marker: m, json: { summary: text, keyQuotes: [], nextSteps: [] } })
    }
    // A pass is skipped while another one (the app's own, e.g. at boot) holds
    // the re-entrancy guard, so ask again until the missing summary is filled.
    await expect
      .poll(
        async () => {
          await runSweep(request, 'summary-sweep')
          const [r] = await sql`SELECT summary_json FROM posts WHERE id = ${uuid(missing.id)}`
          return r?.summary_json != null
        },
        { timeout: 90_000, intervals: [1_000, 3_000, 5_000] }
      )
      .toBe(true)

    const rows = await sql`SELECT id, summary_json, summary_comment_count FROM posts
      WHERE id IN (${uuid(missing.id)}, ${uuid(stale.id)})`
    const byId = new Map(rows.map((r) => [String(r.id), r]))
    expect(byId.get(uuid(missing.id))?.summary_json).toMatchObject({
      summary: `Missing filled ${marker}`,
    })
    expect(byId.get(uuid(stale.id))).toMatchObject({
      summary_json: expect.objectContaining({ summary: `Stale refreshed ${marker}` }),
      summary_comment_count: 0,
    })
    // The refresh fed the previous summary back to the model.
    const reqs = await fakeAi.requests({ contains: `${marker}-s`, endpoint: 'chat' })
    expect(reqs.some((r) => r.text.includes('## Previous Summary'))).toBe(true)
    await fakeAi.clear(`${marker}-m`)
    await fakeAi.clear(`${marker}-s`)
  }
)
