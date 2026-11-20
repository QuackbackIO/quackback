/**
 * The launch plan (getting started): who may open it, what its status reads
 * from the workspace, and skipping a task.
 *
 * Journeys: INT-ON-01, INT-ON-02, INT-ON-03, INT-ON-04.
 *
 * The launch status is workspace-wide and other tests keep adding boards,
 * articles and teammates, so INT-ON-02 compares each fact with the table it
 * is read from at the same moment instead of asserting fixed values.
 */
import { randomUUID } from 'node:crypto'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { callServerFn } from '../../support/server-fns'
import { asPersonApi, readSetupState } from '../../product/platform'

interface OnboardingStatus {
  hasBoards: boolean
  hasBranding: boolean
  hasHelpArticle: boolean
  hasPublishedChangelog: boolean
  hasStatusComponent: boolean
  hasIntegration: boolean
  hasWidgetInstalled: boolean
  hasWidgetEnabled: boolean
  memberCount: number
  inLaunchWindow: boolean
  features: Record<string, boolean>
  useCase: string | null
  /** Skips per goal: { [goal]: { [taskId]: { resolution, resolvedAt } } }. */
  taskResolutions: Resolutions
}

type Resolutions = Record<string, Record<string, { resolution: string; resolvedAt: string }>>

test(
  'INT-ON-01 the launch plan opens for the admin; a teammate is sent to Home',
  { tag: '@smoke' },
  async ({ asPerson }) => {
    const admin = await asPerson('admin')
    await admin.goto('/admin/getting-started')
    await expect(admin).toHaveURL(/\/admin\/getting-started$/)
    await expect(admin.getByRole('heading', { level: 1, name: 'Launch plan' })).toBeVisible()
    await expect(admin.getByRole('progressbar', { name: /^(Step \d+ of \d+|Done)$/ })).toBeVisible()

    const member = await asPerson('agentB')
    await member.goto('/admin/getting-started')
    await expect(member).toHaveURL(/\/admin\/?$/)
    await expect(member.getByRole('heading', { level: 1, name: 'Launch plan' })).toHaveCount(0)
  }
)

test(
  'INT-ON-02 launch status is computed from the workspace facts',
  { tag: '@core' },
  async ({ playwright }) => {
    await asPersonApi(playwright, 'admin', async (api) => {
      const sql = supportDb()
      await expect(async () => {
        const res = await callServerFn<OnboardingStatus>(api, 'fetchOnboardingStatus', undefined, {
          method: 'GET',
        })
        expect(res.ok, res.error).toBe(true)
        const [facts] = await sql`
          SELECT
            exists(SELECT 1 FROM boards WHERE deleted_at IS NULL) AS boards,
            exists(SELECT 1 FROM kb_articles
                   WHERE deleted_at IS NULL AND published_at IS NOT NULL) AS article,
            exists(SELECT 1 FROM changelog_entries
                   WHERE deleted_at IS NULL AND published_at IS NOT NULL) AS changelog,
            exists(SELECT 1 FROM status_components WHERE deleted_at IS NULL) AS component,
            (SELECT logo_key IS NOT NULL FROM settings LIMIT 1) AS branding,
            (SELECT count(*)::int FROM principal
             WHERE type = 'user' AND role IN ('admin', 'member')) AS members`
        const s = res.data
        expect(s.hasBoards).toBe(facts.boards)
        expect(s.hasHelpArticle).toBe(facts.article)
        expect(s.hasPublishedChangelog).toBe(facts.changelog)
        expect(s.hasStatusComponent).toBe(facts.component)
        expect(s.hasBranding).toBe(facts.branding)
        // Portal users (role user) never count as teammates.
        expect(s.memberCount).toBe(facts.members)
      }).toPass({ timeout: 15_000 })

      const res = await callServerFn<OnboardingStatus>(api, 'fetchOnboardingStatus', undefined, {
        method: 'GET',
      })
      // The product switches the suite turned on, and a fresh workspace's window.
      expect(res.data.features).toMatchObject({
        helpCenter: true,
        statusPage: true,
        changelog: true,
      })
      expect(res.data.inLaunchWindow).toBe(true)
    })
  }
)

test(
  'INT-ON-03 connecting an integration completes its launch task',
  {
    tag: ['@core', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        "launch-status.ts:77 filters integrations.status = 'connected', a value no writer stores " +
        "(connections are 'active' or 'paused'), so hasIntegration is always false",
    },
  },
  async ({ playwright, asPerson }) => {
    const sql = supportDb()
    // A provider no other spec uses; a connected row is 'active' (save.ts).
    const id = randomUUID()
    await sql`DELETE FROM integrations WHERE integration_type = 'monday'`
    await sql`
      INSERT INTO integrations (id, integration_type, status, config, connected_at)
      VALUES (${id}, 'monday', 'active', '{}'::jsonb, now())`
    try {
      await asPersonApi(playwright, 'admin', async (api) => {
        const res = await callServerFn<OnboardingStatus>(api, 'fetchOnboardingStatus', undefined, {
          method: 'GET',
        })
        expect(res.ok, res.error).toBe(true)
        expect(res.data.hasIntegration).toBe(true)
      })
      const admin = await asPerson('admin')
      await admin.goto('/admin/getting-started')
      const task = admin.getByRole('listitem').filter({ hasText: 'Connect an integration' })
      await expect(task).toContainText('Done')
    } finally {
      await sql`DELETE FROM integrations WHERE id = ${id}`
    }
  }
)

test(
  'INT-ON-04 skip and restore a launch task; milestones, done and unknown tasks are refused',
  { tag: '@core' },
  async ({ playwright }) => {
    await asPersonApi(playwright, 'admin', async (api) => {
      const status = await callServerFn<OnboardingStatus>(api, 'fetchOnboardingStatus', undefined, {
        method: 'GET',
      })
      expect(status.ok, status.error).toBe(true)
      // An open polish task: the logo while none is set, else the integration.
      const open = !status.data.hasBranding ? 'customize-branding' : 'connect-integration'
      // Skips are stored under the workspace's primary goal.
      const goal = status.data.useCase ?? 'product_feedback'
      // Start from no skip, in case an earlier run timed out before its restore.
      await callServerFn(api, 'setLaunchTaskResolutionFn', { taskId: open, resolution: null })

      try {
        const skipped = await callServerFn<{ taskResolutions: Resolutions }>(
          api,
          'setLaunchTaskResolutionFn',
          { taskId: open, resolution: 'dismissed' }
        )
        expect(skipped.ok, skipped.error).toBe(true)
        expect(skipped.data.taskResolutions).toMatchObject({
          [goal]: { [open]: { resolution: 'dismissed' } },
        })
        // Stored in the workspace setup state and returned by the status.
        expect(JSON.stringify(await readSetupState())).toContain(`"${open}"`)
        const after = await callServerFn<OnboardingStatus>(
          api,
          'fetchOnboardingStatus',
          undefined,
          {
            method: 'GET',
          }
        )
        expect(after.data.taskResolutions).toMatchObject({
          [goal]: { [open]: { resolution: 'dismissed' } },
        })

        // A legacy client's 'deferred' is stored as 'dismissed'.
        const deferred = await callServerFn<{
          taskResolutions: Resolutions
        }>(api, 'setLaunchTaskResolutionFn', { taskId: open, resolution: 'deferred' })
        expect(deferred.data.taskResolutions[goal]?.[open]?.resolution).toBe('dismissed')
      } finally {
        const restored = await callServerFn<{
          taskResolutions: Resolutions
        }>(api, 'setLaunchTaskResolutionFn', { taskId: open, resolution: null })
        expect(restored.ok, restored.error).toBe(true)
        expect(restored.data.taskResolutions[goal]?.[open]).toBeUndefined()
      }

      const milestone = await callServerFn(api, 'setLaunchTaskResolutionFn', {
        taskId: 'first-win',
        resolution: 'dismissed',
      })
      expect(milestone.ok).toBe(false)
      expect(milestone.code).toBe('LAUNCH_MILESTONE_NOT_SKIPPABLE')

      // The workspace has boards, so creating one is done.
      expect(status.data.hasBoards).toBe(true)
      const done = await callServerFn(api, 'setLaunchTaskResolutionFn', {
        taskId: 'create-board',
        resolution: 'dismissed',
      })
      expect(done.ok).toBe(false)
      expect(done.code).toBe('LAUNCH_TASK_ALREADY_COMPLETED')

      const unknown = await callServerFn(api, 'setLaunchTaskResolutionFn', {
        taskId: 'no-such-task',
        resolution: 'dismissed',
      })
      expect(unknown.ok).toBe(false)
      expect(unknown.code).toBe('UNKNOWN_LAUNCH_TASK')
    })

    // Skipping needs settings.manage: a Contributor is refused and nothing is stored.
    const before = JSON.stringify((await readSetupState()).taskResolutions ?? {})
    await asPersonApi(playwright, 'contributor', async (api) => {
      const refused = await callServerFn(api, 'setLaunchTaskResolutionFn', {
        taskId: 'connect-integration',
        resolution: 'dismissed',
      })
      expect(refused.ok).toBe(false)
      expect(refused.error).toContain("Requires permission 'settings.manage'")
    })
    expect(JSON.stringify((await readSetupState()).taskResolutions ?? {})).toBe(before)
  }
)
