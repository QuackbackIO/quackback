process.env.SECRET_KEY ||= 'test-secret-key-for-skills-abcdefghijklmnop'

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { agentSkills } from '@/lib/server/db'

import {
  compileSkillCatalogue,
  createSkill,
  deleteSkill,
  getSkillBody,
  listSkills,
} from '../skills.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: agentSkills.id }).from(agentSkills).limit(0)
  },
})

describe.skipIf(!fixture.available)('skills.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('compiles assigned enabled skills under the catalogue budget', async () => {
    await createSkill(
      {
        name: 'Refund policy',
        whenToUse: 'Customer asks for a refund',
        instructions: 'Confirm the invoice, then propose issue_refund.',
        assignments: { agent: true, copilot: true },
        enabled: true,
      },
      testDb
    )
    await createSkill(
      {
        name: 'Copilot only',
        whenToUse: 'Internal billing question',
        instructions: 'Look up the subscription first.',
        assignments: { agent: false, copilot: true },
        enabled: true,
      },
      testDb
    )
    await createSkill(
      {
        name: 'Disabled',
        whenToUse: 'Never',
        instructions: 'Should not appear.',
        assignments: { agent: true, copilot: true },
        enabled: false,
      },
      testDb
    )

    const agentLines = await compileSkillCatalogue('agent', testDb)
    expect(agentLines.map((line) => line.name)).toEqual(['Refund policy'])
    const copilotLines = await compileSkillCatalogue('copilot', testDb)
    expect(copilotLines.map((line) => line.name)).toEqual(['Refund policy', 'Copilot only'])
  })

  it('returns a body only for the assigned agent and never leaks across agents', async () => {
    await createSkill(
      {
        name: 'Refund policy',
        whenToUse: 'Customer asks for a refund',
        instructions: 'Confirm then refund.',
        assignments: { agent: false, copilot: true },
        enabled: true,
      },
      testDb
    )
    expect(await getSkillBody('Refund policy', 'copilot', testDb)).toBe('Confirm then refund.')
    expect(await getSkillBody('Refund policy', 'agent', testDb)).toBeNull()
    expect(await getSkillBody('missing', 'copilot', testDb)).toBeNull()
  })

  it('deletes a skill', async () => {
    const row = await createSkill(
      {
        name: 'Temp',
        whenToUse: 'Temp',
        instructions: 'Temp body',
        assignments: { agent: true, copilot: false },
        enabled: true,
      },
      testDb
    )
    await deleteSkill(row.id, testDb)
    expect(await listSkills(testDb)).toEqual([])
  })
})
