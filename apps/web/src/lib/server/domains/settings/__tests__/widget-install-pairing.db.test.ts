import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cleanupWorkspaces,
  closeHarness,
  ensureKvSchema,
  testSql,
  uniqueKey,
  withRealWorkspace,
  workspacePair,
} from '@/lib/server/kv/__tests__/harness'
import { kvGet, kvSet } from '@/lib/server/kv/pg-kv'
import {
  consumeWidgetInstallCode,
  hashWidgetInstallCode,
  widgetInstallPairingKey,
} from '../widget-install-pairing'

const [T] = workspacePair()

beforeAll(async () => {
  await ensureKvSchema()
})

afterAll(async () => {
  await cleanupWorkspaces(T)
  await closeHarness()
})

async function expire(key: string): Promise<void> {
  await testSql()`
    UPDATE kv_store SET expires_at = now() - interval '1 second'
    WHERE workspace_key = ${T} AND key = ${key}
  `
}

describe('consumeWidgetInstallCode against kv_store', () => {
  it('allows two uses then refuses a third', async () => {
    const code = `qbi_${uniqueKey('code').replace(/-/g, '').slice(0, 16)}`
    const key = widgetInstallPairingKey(hashWidgetInstallCode(code))
    await withRealWorkspace(T, () => kvSet(key, { remaining: 2 }, 60))

    await expect(withRealWorkspace(T, () => consumeWidgetInstallCode(code))).resolves.toBe(true)
    await expect(withRealWorkspace(T, () => kvGet<{ remaining: number }>(key))).resolves.toEqual({
      remaining: 1,
    })
    await expect(withRealWorkspace(T, () => consumeWidgetInstallCode(code))).resolves.toBe(true)
    await expect(withRealWorkspace(T, () => consumeWidgetInstallCode(code))).resolves.toBe(false)
  })

  it('refuses an expired code even if the row is still present', async () => {
    const code = `qbi_${uniqueKey('exp').replace(/-/g, '').slice(0, 16)}`
    const key = widgetInstallPairingKey(hashWidgetInstallCode(code))
    await withRealWorkspace(T, () => kvSet(key, { remaining: 2 }, 60))
    await expire(key)
    await expect(withRealWorkspace(T, () => consumeWidgetInstallCode(code))).resolves.toBe(false)
  })
})
