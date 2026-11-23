/**
 * The workspace export: one run at a time across the workspace, so it runs
 * with no other test starting one.
 *
 * Journeys: FBA-X-03
 */
import { test, expect } from '../../support/fixtures'
import { personApi } from '../../support/server-fns'
import { supportDb, pollFor } from '../../support/db'
import { makeBoard, makePost, uuid } from '../../product/feedback-admin'
import { fromUuid, generateId, toUuid } from '@quackback/ids'

test(
  'FBA-X-03 Export starts one workspace export, a second start is refused, and the ZIP downloads',
  { tag: '@core' },
  async ({ playwright, asPerson, people, marker }) => {
    test.setTimeout(120_000)
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    await makePost(api, { boardId: board.id, title: `${marker} exported post` })
    const sql = supportDb()
    const before = new Date()

    // While a run is pending a second start is refused (a held slot, seeded).
    const held = toUuid(generateId('export_run'))
    await sql`INSERT INTO export_runs (id, status, file_name, initiated_by_principal_id)
      VALUES (${held}, 'pending', ${`${marker}.zip`}, ${uuid(people.people.admin.principalId)})`
    try {
      const refused = await api.post('/api/export/workspace')
      expect(refused.status()).toBe(409)
      expect(await refused.json()).toMatchObject({
        error: 'An export is already running',
        runId: fromUuid('export_run', held),
      })
    } finally {
      await sql`DELETE FROM export_runs WHERE id = ${held}`
    }

    const admin = await asPerson('admin')
    await admin.goto('/admin/settings/imports')
    await expect(
      admin.getByText('Everything as one ZIP. Download links expire after 7 days.')
    ).toBeVisible({
      timeout: 15_000,
    })
    await expect(async () => {
      await admin.getByRole('button', { name: 'Export', exact: true }).click({ timeout: 3_000 })
      await expect(
        admin.getByText('Export started. It will appear below in a moment.')
      ).toBeVisible({
        timeout: 3_000,
      })
    }).toPass({ timeout: 20_000 })

    const [run] = await sql`SELECT id, status FROM export_runs WHERE created_at >= ${before}
      ORDER BY created_at DESC`
    expect(run).toBeTruthy()
    const runId = fromUuid('export_run', String(run.id))

    const done = await pollFor(
      'export run to finish',
      async () => {
        const [r] = await sql`SELECT status, size_bytes, entity_counts, expires_at, error
          FROM export_runs WHERE id = ${run.id}`
        return r && r.status !== 'pending' && r.status !== 'running' ? r : undefined
      },
      { timeoutMs: 60_000, intervalMs: 500 }
    )
    expect(done.status, String(done.error)).toBe('completed')
    expect(Number(done.size_bytes)).toBeGreaterThan(0)
    expect(done.entity_counts).toMatchObject({
      boards: expect.any(Number),
      posts: expect.any(Number),
    })
    const days = (new Date(String(done.expires_at)).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(6.9)
    expect(days).toBeLessThan(7.1)

    // History shows it completed with a download link.
    await admin.reload()
    const row = admin.getByRole('row').filter({ hasText: 'Completed' }).first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row.getByText('ZIP', { exact: true })).toBeVisible()
    await expect(row).toContainText('posts')

    // The download redirects to the stored ZIP, which holds the documented files.
    const dl = await api.get(`/api/export/runs/${runId}/download`, { maxRedirects: 0 })
    expect([200, 302]).toContain(dl.status())
    const zip =
      dl.status() === 302
        ? Buffer.from(await (await fetch(dl.headers()['location'])).arrayBuffer())
        : await dl.body()
    expect(zip.subarray(0, 2).toString()).toBe('PK')
    const names = zip.toString('latin1')
    for (const file of ['boards.csv', 'statuses.csv', 'tags.csv', 'posts.csv', 'manifest.json']) {
      expect(names, file).toContain(file)
    }

    // A teammate without the admin role cannot download it.
    const lead = await personApi(playwright, 'agentB')
    const refused = await lead.get(`/api/export/runs/${runId}/download`, { maxRedirects: 0 })
    expect(refused.status()).toBe(403)
    await lead.dispose()
    await api.dispose()
  }
)
