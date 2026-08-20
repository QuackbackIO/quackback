import { afterEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  emails: [] as Array<{ email: string | null }>,
  pushWorkspaceMembership: vi.fn(async (..._args: unknown[]) => {}),
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  return {
    ...actual,
    db: {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: async () => hoisted.emails,
          }),
        }),
      }),
    },
  }
})

vi.mock('@/lib/server/control-plane/client', () => ({
  pushWorkspaceMembership: (...args: unknown[]) => hoisted.pushWorkspaceMembership(...args),
}))

import {
  isControlPlaneConfigured,
  listTeamSeatEmails,
  runMembershipSync,
} from '../membership-sync-queue'

const JOB = {
  id: '1',
  jobId: 'job_1',
  queue: 'membership-sync',
  dedupeKey: 'membership-sync',
  payload: {},
  workspaceKey: null,
  attempts: 1,
  maxAttempts: 10,
  leaseToken: 'tok',
  lockedUntil: new Date(),
}

describe('runMembershipSync', () => {
  const previous = process.env.QUACKBACK_CONTROL_PLANE_URL

  afterEach(() => {
    hoisted.pushWorkspaceMembership.mockClear()
    if (previous === undefined) delete process.env.QUACKBACK_CONTROL_PLANE_URL
    else process.env.QUACKBACK_CONTROL_PLANE_URL = previous
  })

  it('is a successful no-op without a control-plane URL', async () => {
    delete process.env.QUACKBACK_CONTROL_PLANE_URL
    expect(isControlPlaneConfigured()).toBe(false)
    await expect(runMembershipSync(JOB)).resolves.toBeUndefined()
    expect(hoisted.pushWorkspaceMembership).not.toHaveBeenCalled()
  })

  it('rethrows a control-plane outage so the job lease retries', async () => {
    process.env.QUACKBACK_CONTROL_PLANE_URL = 'https://control.example.com'
    hoisted.emails = [{ email: 'admin@acme.test' }]
    hoisted.pushWorkspaceMembership.mockRejectedValueOnce(new Error('unavailable'))
    await expect(runMembershipSync(JOB)).rejects.toThrow('unavailable')
  })

  it('posts the desired seat set when the control plane is configured', async () => {
    process.env.QUACKBACK_CONTROL_PLANE_URL = 'https://control.example.com'
    hoisted.emails = [
      { email: 'Admin@Acme.Test' },
      { email: 'member@acme.test' },
      { email: '  ' },
      { email: null },
    ]
    await runMembershipSync(JOB)
    expect(hoisted.pushWorkspaceMembership).toHaveBeenCalledWith([
      'admin@acme.test',
      'member@acme.test',
    ])
  })
})

describe('listTeamSeatEmails', () => {
  it('canonicalises and drops blank addresses', async () => {
    hoisted.emails = [{ email: 'Mate@Acme.Test' }, { email: null }, { email: '' }]
    await expect(listTeamSeatEmails()).resolves.toEqual(['mate@acme.test'])
  })
})
