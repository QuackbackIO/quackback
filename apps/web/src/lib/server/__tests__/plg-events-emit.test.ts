import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getCloudConfig, info } = vi.hoisted(() => ({
  getCloudConfig: vi.fn(),
  info: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/cloud/cloud.service', () => ({
  getCloudConfig,
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ info, error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}))

import { emitPlgEvent } from '../plg-events'

describe('emitPlgEvent', () => {
  beforeEach(() => {
    getCloudConfig.mockReset()
    info.mockReset()
  })

  it('does not log on self-host when cloud is off', async () => {
    getCloudConfig.mockResolvedValue({ enabled: false })
    await emitPlgEvent(
      { name: 'first_win_reached', outcome: 'product_feedback' },
      { workspaceId: 'ws_1', principalId: 'prin_1' }
    )
    expect(info).not.toHaveBeenCalled()
  })

  it('logs only the bounded vocabulary when cloud is on', async () => {
    getCloudConfig.mockResolvedValue({ enabled: true })
    await emitPlgEvent(
      {
        name: 'first_win_reached',
        outcome: 'help_center',
        surface: 'launch_plan',
        actionId: 'first-win',
        artifactType: 'article',
      },
      { workspaceId: 'ws_1', principalId: 'prin_1' }
    )
    expect(info).toHaveBeenCalledTimes(1)
    const payload = info.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toMatchObject({
      event: 'first_win_reached',
      outcome: 'help_center',
      surface: 'launch_plan',
      action_id: 'first-win',
      artifact_type: 'article',
    })
    expect(payload).not.toHaveProperty('email')
    expect(payload).not.toHaveProperty('url')
    expect(payload).not.toHaveProperty('content')
    expect(payload).not.toHaveProperty('token')
  })

  it('drops unknown fields before logging', async () => {
    getCloudConfig.mockResolvedValue({ enabled: true })
    await emitPlgEvent({ name: 'first_win_reached', email: 'a@b.c' } as never, {
      workspaceId: 'ws_1',
      principalId: 'prin_1',
    })
    expect(info).not.toHaveBeenCalled()
  })
})
