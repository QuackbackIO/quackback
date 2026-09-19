process.env.SECRET_KEY ||= 'test-secret-key-for-guidance-abcdefghijkl'

/**
 * The guidance migration pin.
 *
 * The claim this file has to make honest is that converting the three legacy
 * sources into canonical entries changes nothing the model sees. So it seeds a
 * real workspace's worth of legacy records, compiles the prompt material the
 * runtime would build from them, converts, compiles again from the canonical
 * tables, and compares the two byte for byte. A conversion that reordered
 * candidates, dropped a role, truncated an 8,000 character body or injected a
 * writing guideline twice fails here rather than in a customer conversation.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  agentSkills,
  assistantGuidanceRules,
  assistantGuidanceEntries,
  assistantGuidanceBindings,
} from '@/lib/server/db'
import { eq } from 'drizzle-orm'
import { DEFAULT_ASSISTANT_CONFIG, roleToAgent } from '@/lib/shared/assistant/config'
import type { AssistantConfig } from '@/lib/shared/assistant/config'
import { buildAssistantSystemMessages } from '../assistant.system-prompt'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listEnabledGuidanceCandidates } from '../guidance.service'
import { compileSkillCatalogue, countAssignedSkills, getSkillBody } from '../skills.service'
import { ensureCanonicalGuidance, projectConfigGuidance } from '../guidance-conversion'
import { listGuidanceEntries, saveGuidanceEntry } from '../guidance-entries.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: assistantGuidanceEntries.id }).from(assistantGuidanceEntries).limit(0)
    await db.select({ id: assistantGuidanceBindings.id }).from(assistantGuidanceBindings).limit(0)
  },
})

const LONG_BODY = `Refund review\n${'a'.repeat(7_000)}\n${'b'.repeat(985)}`

function configWithInstructions(): AssistantConfig {
  const config = structuredClone(DEFAULT_ASSISTANT_CONFIG)
  config.agents.agent.voice.additionalInstructions =
    'Always name the plan the customer is on before quoting a price.'
  config.agents.workspace.instructions = 'Summarize for the team, never for the customer.'
  return config
}

/**
 * The prompt material one profile's turn would carry.
 *
 * Every candidate is included rather than a selector-chosen subset: what this
 * pin compares is the candidate set, its order and its text, which is what the
 * conversion could get wrong. The selector runs a model and decides which of
 * these the turn uses, and it sees the same list either way.
 */
async function promptMaterial(
  role: 'customer_support' | 'copilot_qa' | 'workspace_assistant',
  config: AssistantConfig
): Promise<string> {
  const profile = roleToAgent(role)
  const candidates = await listEnabledGuidanceCandidates({ agent: profile })
  const skillCatalogue = await compileSkillCatalogue(profile, testDb)
  const messages = buildAssistantSystemMessages({
    role,
    config: {
      identity: { name: config.identity.name },
      voice: config.agents.agent.voice,
    },
    workspaceName: 'Acme',
    tools: [
      { name: 'search', promptGuidance: 'Search approved knowledge.', risk: 'read' },
      { name: 'use_skill', promptGuidance: 'Load a procedure.', risk: 'read' },
    ],
    skillCatalogue,
    guidance: candidates.map((candidate) => ({ instruction: candidate.instruction })),
  })
  return messages.join('\n\n---\n\n')
}

async function seedLegacy(): Promise<void> {
  const base = new Date('2026-01-01T00:00:00.000Z')
  const at = (minutes: number) => new Date(base.getTime() + minutes * 60_000)

  await testDb.insert(assistantGuidanceRules).values([
    {
      name: 'Confirm the account first',
      appliesWhen: null,
      instruction: 'Confirm which account the customer is asking about before answering.',
      agent: 'agent',
      enabled: true,
      priority: 0,
      createdAt: at(0),
      updatedAt: at(0),
    },
    // Written second but created first: two rules share a priority, so only the
    // creation instant orders them, and it is deliberately the reverse of the
    // insertion order so a conversion that stamped its own timestamps (or read
    // the rows in heap order) would reorder the prompt and fail here.
    {
      name: 'Read the account notes',
      appliesWhen: null,
      instruction: 'Read the account notes before you answer anything about billing.',
      agent: 'agent',
      enabled: true,
      priority: 0,
      createdAt: at(-5),
      updatedAt: at(-5),
    },
    {
      name: 'Missing order',
      appliesWhen: 'When a customer reports an order that never arrived',
      instruction: 'Ask for the order id, then check the shipment before promising anything.',
      agent: 'agent',
      enabled: true,
      priority: 5,
      createdAt: at(1),
      updatedAt: at(1),
    },
    {
      name: 'Teammate drafts',
      appliesWhen: null,
      instruction: 'Draft replies the teammate can send without editing.',
      agent: 'copilot',
      enabled: true,
      priority: 0,
      createdAt: at(2),
      updatedAt: at(2),
    },
    {
      name: 'Retired wording',
      appliesWhen: null,
      instruction: 'This one is switched off and must stay out of the prompt.',
      agent: 'agent',
      enabled: false,
      priority: 1,
      createdAt: at(3),
      updatedAt: at(3),
    },
  ])

  await testDb.insert(agentSkills).values([
    {
      name: 'Refund procedure',
      whenToUse: 'Customer asks for a refund on a duplicate charge',
      instructions: LONG_BODY,
      assignments: { agent: true, copilot: true },
      enabled: true,
      createdAt: at(4),
      updatedAt: at(4),
    },
    {
      name: 'Escalation ladder',
      whenToUse: 'A teammate asks who owns an outage',
      instructions: 'Page the on-call owner, then the duty manager.',
      assignments: { agent: false, copilot: true },
      enabled: true,
      createdAt: at(5),
      updatedAt: at(5),
    },
  ])
}

describe.skipIf(!fixture.available)('guidance migration (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    process.env.ASSISTANT_GUIDANCE_SOURCE = 'legacy'
  })
  afterEach(async () => {
    delete process.env.ASSISTANT_GUIDANCE_SOURCE
    await fixture.rollback()
  })
  afterAll(fixture.close)

  it('compiles byte-identical prompt material for every profile after conversion', async () => {
    const config = configWithInstructions()
    await seedLegacy()

    const beforeOrder = (await listEnabledGuidanceCandidates({ agent: 'agent' })).map(
      (candidate) => candidate.name
    )
    expect(beforeOrder).toEqual([
      'Read the account notes',
      'Confirm the account first',
      'Missing order',
    ])
    const before = {
      customer: await promptMaterial('customer_support', config),
      copilot: await promptMaterial('copilot_qa', config),
    }
    const beforeBody = await getSkillBody('Refund procedure', 'agent', testDb)
    const beforeCount = await countAssignedSkills('agent', testDb)

    await projectConfigGuidance(config, testDb)
    await ensureCanonicalGuidance(testDb)
    process.env.ASSISTANT_GUIDANCE_SOURCE = 'canonical'

    expect((await listEnabledGuidanceCandidates({ agent: 'agent' })).map((c) => c.name)).toEqual(
      beforeOrder
    )
    expect(await promptMaterial('customer_support', config)).toBe(before.customer)
    expect(await promptMaterial('copilot_qa', config)).toBe(before.copilot)
    expect(await getSkillBody('Refund procedure', 'agent', testDb)).toBe(beforeBody)
    expect(await countAssignedSkills('agent', testDb)).toBe(beforeCount)
  })

  it('keeps an 8,000 character procedure body whole and shared across two bindings', async () => {
    await seedLegacy()
    await ensureCanonicalGuidance(testDb)

    const entries = await listGuidanceEntries(testDb)
    const procedure = entries.find((entry) => entry.title === 'Refund procedure')
    expect(procedure).toBeDefined()
    expect(procedure?.body).toBe(LONG_BODY)
    expect(procedure?.body.length).toBe(8_000)
    expect(procedure?.kind).toBe('procedure')
    expect(procedure?.uses).toEqual(['agent', 'copilot'])

    const bindings = await testDb
      .select()
      .from(assistantGuidanceBindings)
      .where(eq(assistantGuidanceBindings.entryId, procedure!.id))
    expect(bindings.map((binding) => binding.profile).sort()).toEqual(['agent', 'copilot'])
  })

  it('keeps a single-role rule single-role', async () => {
    await seedLegacy()
    await ensureCanonicalGuidance(testDb)

    const entries = await listGuidanceEntries(testDb)
    expect(entries.find((entry) => entry.title === 'Missing order')?.uses).toEqual(['agent'])
    expect(entries.find((entry) => entry.title === 'Teammate drafts')?.uses).toEqual(['copilot'])
  })

  it('converts the writing guidelines without injecting them twice', async () => {
    const config = configWithInstructions()
    await seedLegacy()
    await projectConfigGuidance(config, testDb)
    await ensureCanonicalGuidance(testDb)
    process.env.ASSISTANT_GUIDANCE_SOURCE = 'canonical'

    const entries = await listGuidanceEntries(testDb)
    const writing = entries.find((entry) => entry.legacySource === 'voice')
    expect(writing?.body).toBe(config.agents.agent.voice.additionalInstructions)
    expect(writing?.owner).toBe('config')
    expect(writing?.uses).toEqual(['agent'])
    const managed = entries.find((entry) => entry.legacySource === 'managed')
    expect(managed?.body).toBe(config.agents.workspace.instructions)
    expect(managed?.uses).toEqual(['workspace'])

    const material = await promptMaterial('customer_support', config)
    const occurrences = material.split(config.agents.agent.voice.additionalInstructions).length - 1
    expect(occurrences).toBe(1)

    // A converted procedure is loaded on demand, so its body must never reach
    // the guidance block the always-on instructions share.
    const candidates = await listEnabledGuidanceCandidates({ agent: 'agent' })
    expect(candidates.map((candidate) => candidate.instruction)).not.toContain(LONG_BODY)
  })

  it('converts once, however many times it runs', async () => {
    const config = configWithInstructions()
    await seedLegacy()
    await projectConfigGuidance(config, testDb)
    await ensureCanonicalGuidance(testDb)
    const first = await listGuidanceEntries(testDb)

    await projectConfigGuidance(config, testDb)
    await ensureCanonicalGuidance(testDb)
    await ensureCanonicalGuidance(testDb)
    const second = await listGuidanceEntries(testDb)

    expect(second.map((entry) => entry.id).sort()).toEqual(first.map((entry) => entry.id).sort())
    const bindings = await testDb.select().from(assistantGuidanceBindings)
    expect(bindings.length).toBe(first.reduce((total, entry) => total + entry.uses.length, 0))
  })

  it('leaves neither the entry nor a binding behind when the binding write fails', async () => {
    const before = await listGuidanceEntries(testDb)

    // Fault injection at the write boundary: the entry insert really happens,
    // inside the real transaction, and the bindings insert then fails.
    const failing = new Proxy(testDb, {
      get(target, property) {
        const value = Reflect.get(target, property) as unknown
        if (property !== 'transaction') {
          return typeof value === 'function' ? (value as () => unknown).bind(target) : value
        }
        return (callback: (tx: unknown) => Promise<unknown>) =>
          (target.transaction as (cb: (tx: unknown) => Promise<unknown>) => Promise<unknown>)(
            (tx) => {
              const guarded = new Proxy(tx as object, {
                get(txTarget, txProperty) {
                  const txValue = Reflect.get(txTarget, txProperty) as unknown
                  if (txProperty !== 'insert') {
                    return typeof txValue === 'function'
                      ? (txValue as () => unknown).bind(txTarget)
                      : txValue
                  }
                  return (table: unknown) => {
                    if (table === assistantGuidanceBindings) {
                      throw new Error('binding write failed')
                    }
                    return (txValue as (t: unknown) => unknown).call(txTarget, table)
                  }
                },
              })
              return callback(guarded)
            }
          )
      },
    })

    await expect(
      saveGuidanceEntry(
        {
          entry: {
            kind: 'always',
            title: 'Never written',
            body: 'This entry must not survive its failed binding.',
            appliesWhen: null,
            enabled: true,
            priority: 0,
            uses: ['agent'],
          },
        },
        failing as typeof testDb
      )
    ).rejects.toThrow('binding write failed')

    const after = await listGuidanceEntries(testDb)
    expect(after.map((entry) => entry.id)).toEqual(before.map((entry) => entry.id))
    expect(
      await testDb
        .select()
        .from(assistantGuidanceEntries)
        .where(eq(assistantGuidanceEntries.title, 'Never written'))
    ).toEqual([])
  })

  it('refuses a save made against a version somebody else has moved', async () => {
    const created = await saveGuidanceEntry(
      {
        entry: {
          kind: 'situational',
          title: 'Refund wording',
          body: 'Explain the refund window before offering one.',
          appliesWhen: 'When a refund is requested',
          enabled: true,
          priority: 0,
          uses: ['agent'],
        },
      },
      testDb
    )

    await saveGuidanceEntry(
      {
        id: created.id,
        expectedVersion: created.version,
        entry: {
          kind: 'situational',
          title: 'Refund wording',
          body: 'Explain the refund window, then offer one.',
          appliesWhen: 'When a refund is requested',
          enabled: true,
          priority: 0,
          uses: ['agent', 'copilot'],
        },
      },
      testDb
    )

    await expect(
      saveGuidanceEntry(
        {
          id: created.id,
          expectedVersion: created.version,
          entry: {
            kind: 'situational',
            title: 'Refund wording',
            body: 'A second editor writing over the first.',
            appliesWhen: 'When a refund is requested',
            enabled: true,
            priority: 0,
            uses: ['agent'],
          },
        },
        testDb
      )
    ).rejects.toMatchObject({ code: 'GUIDANCE_ENTRY_CONFLICT' })

    const [row] = await testDb
      .select()
      .from(assistantGuidanceEntries)
      .where(eq(assistantGuidanceEntries.id, created.id))
    expect(row.body).toBe('Explain the refund window, then offer one.')
    expect(row.version).toBe(created.version + 1)
  })
})
