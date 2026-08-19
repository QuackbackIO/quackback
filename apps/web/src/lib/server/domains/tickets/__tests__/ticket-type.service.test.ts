/**
 * Real-DB coverage for the ticket-type registry (convergence Phase 4,
 * scratchpad/convergence-design.md): default-per-category atomicity, the
 * in-use category lock, archive/restore semantics, write-time derivation
 * (resolveTicketTypeForCreate + createTicketCore), intake resolution
 * (resolveIntakeCreate), and the listTickets registry-type filter. Runs
 * inside the db-test-fixture rollback transaction (see
 * server/__tests__/README.md).
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type TicketTypeId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { tickets, ticketTypes, ticketStatuses, settings, eq, and, isNull } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// Neutralize createTicketCore's fire-and-forget side channels (they resolve
// hook targets / Redis mid-rollback) — mirrors ticket.service.test.ts.
const webhooks = vi.hoisted(() => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
  emitTicketReplied: vi.fn().mockResolvedValue(undefined),
  emitTicketNoteAdded: vi.fn().mockResolvedValue(undefined),
  emitTicketExternalStatusChanged: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../ticket.webhooks', () => webhooks)

const realtime = vi.hoisted(() => ({ publishTicketEvent: vi.fn() }))
vi.mock('@/lib/server/realtime/conversation-channels', () => realtime)

vi.mock('../ticket-activity.service', () => ({
  recordTicketActivity: vi.fn(),
  listTicketActivity: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

import {
  createTicketType,
  updateTicketType,
  archiveTicketType,
  restoreTicketType,
  listTicketTypes,
  getTicketType,
  countTicketsUsingType,
  resolveTicketTypeForCreate,
  ticketTypeToDTO,
} from '../ticket-type.service'
import {
  listIntakeTypes,
  resolveIntakeCreate,
  ticketTypeToIntakeDTO,
} from '../ticket-type-intake.service'
import { createTicketCore, listTickets } from '../ticket.service'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import type { Actor } from '@/lib/server/policy/types'
import type { TicketFormField } from '@/lib/shared/tickets'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketTypes.id }).from(ticketTypes).limit(0)
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: settings.id }).from(settings).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/** Archive every committed type so a test's seeded set is authoritative (the
 *  0215 seed put one live default per category into the dev/test DBs). */
async function cleanSlate(): Promise<void> {
  await testDb
    .update(ticketTypes)
    .set({ deletedAt: new Date(), isDefault: false })
    .where(isNull(ticketTypes.deletedAt))
}

/** getStageLabels (the DTO builder) needs a workspace settings row. */
async function seedSettings(): Promise<void> {
  await testDb
    .insert(settings)
    .values({ name: 'Test WS', slug: `test_${suffix()}`, createdAt: new Date() })
}

async function seedDefaultStatus(): Promise<void> {
  await testDb
    .update(ticketStatuses)
    .set({ isDefault: false })
    .where(eq(ticketStatuses.isDefault, true))
  await testDb.insert(ticketStatuses).values({
    name: 'T-Open',
    slug: `t_open_${suffix()}`,
    category: 'open',
    position: 100,
    isDefault: true,
    publicStage: 'received',
  })
}

function adminActor(): Actor {
  return {
    principalId: createId('principal') as PrincipalId,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: resolveActorPermissions('admin'),
  }
}

const textField = (over: Partial<TicketFormField> = {}): TicketFormField => ({
  key: 'notes',
  label: 'Notes',
  type: 'text',
  required: false,
  visibleToCustomer: true,
  order: 0,
  ...over,
})

async function liveDefaults(category: 'customer' | 'back_office' | 'tracker') {
  return testDb
    .select()
    .from(ticketTypes)
    .where(
      and(
        eq(ticketTypes.category, category),
        eq(ticketTypes.isDefault, true),
        isNull(ticketTypes.deletedAt)
      )
    )
}

describe.skipIf(!fixture.available)('ticket-type.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  // -------------------------------------------------------------------------
  // CRUD + default-per-category atomicity
  // -------------------------------------------------------------------------

  it('create derives an underscore slug and appends after the category max position', async () => {
    await cleanSlate()
    const a = await createTicketType({ name: 'Bug report', category: 'customer' })
    expect(a.slug).toBe('bug_report')
    expect(a.position).toBe(0)
    const b = await createTicketType({ name: 'Refund request', category: 'customer' })
    expect(b.position).toBe(1)
    // A tracker type positions within ITS category, not the global list.
    const c = await createTicketType({ name: 'Outage', category: 'tracker' })
    expect(c.position).toBe(0)
  })

  it('create with isDefault atomically unsettles the incumbent (exactly one live default)', async () => {
    await cleanSlate()
    const a = await createTicketType({ name: 'Alpha', category: 'customer', isDefault: true })
    const b = await createTicketType({ name: 'Beta', category: 'customer', isDefault: true })
    const defaults = await liveDefaults('customer')
    expect(defaults).toHaveLength(1)
    expect(defaults[0].id).toBe(b.id)
    // …and the incumbent was demoted, not archived.
    const aAfter = await getTicketType(a.id)
    expect(aAfter.isDefault).toBe(false)
    expect(aAfter.deletedAt).toBeNull()
  })

  it('rejects a duplicate slug with ConflictError', async () => {
    await cleanSlate()
    await createTicketType({ name: 'Bug report', category: 'customer' })
    await expect(
      createTicketType({ name: 'Bug report', slug: 'bug_report', category: 'tracker' })
    ).rejects.toThrow(ConflictError)
  })

  it('update isDefault:true swaps atomically; unsetting the only default is refused', async () => {
    await cleanSlate()
    const a = await createTicketType({ name: 'Alpha', category: 'customer', isDefault: true })
    const b = await createTicketType({ name: 'Beta', category: 'customer' })

    await expect(updateTicketType(a.id, { isDefault: false })).rejects.toThrow(
      /cannot unset the category default/i
    )

    await updateTicketType(b.id, { isDefault: true })
    const defaults = await liveDefaults('customer')
    expect(defaults).toHaveLength(1)
    expect(defaults[0].id).toBe(b.id)
  })

  // -------------------------------------------------------------------------
  // Category lock
  // -------------------------------------------------------------------------

  it('locks the category once tickets reference the type (count reported)', async () => {
    await cleanSlate()
    await seedDefaultStatus()
    const type = await createTicketType({ name: 'Bug report', category: 'customer' })
    const [status] = await testDb
      .select()
      .from(ticketStatuses)
      .where(eq(ticketStatuses.isDefault, true))
    await testDb
      .insert(tickets)
      .values({ type: 'customer', title: 'Pinned', statusId: status.id, ticketTypeId: type.id })

    expect(await countTicketsUsingType(type.id)).toBe(1)
    await expect(updateTicketType(type.id, { category: 'tracker' })).rejects.toThrow(
      /cannot change category: 1 ticket/i
    )
  })

  it('recategorizes a type no ticket uses', async () => {
    await cleanSlate()
    const type = await createTicketType({ name: 'Unused', category: 'customer' })
    const updated = await updateTicketType(type.id, { category: 'back_office' })
    expect(updated.category).toBe('back_office')
  })

  // -------------------------------------------------------------------------
  // Archive / restore
  // -------------------------------------------------------------------------

  it('archives an in-use type (kept on history) and hides it from pickers', async () => {
    await cleanSlate()
    await seedDefaultStatus()
    const type = await createTicketType({ name: 'Bug report', category: 'customer' })
    const [status] = await testDb
      .select()
      .from(ticketStatuses)
      .where(eq(ticketStatuses.isDefault, true))
    await testDb
      .insert(tickets)
      .values({ type: 'customer', title: 'History', statusId: status.id, ticketTypeId: type.id })

    await archiveTicketType(type.id)
    expect((await listTicketTypes()).some((t) => t.id === type.id)).toBe(false)
    expect((await listTicketTypes({ includeArchived: true })).some((t) => t.id === type.id)).toBe(
      true
    )
    // History resolves: the chip data is still there.
    const stillThere = await getTicketType(type.id)
    expect(stillThere.deletedAt).not.toBeNull()
    // …and the ticket still POINTS at it (archive, never hard-delete in use).
    const [ticket] = await testDb.select().from(tickets).where(eq(tickets.title, 'History'))
    expect(ticket.ticketTypeId).toBe(type.id)
  })

  it('restores an archived default as non-default when the category gained a live default', async () => {
    await cleanSlate()
    const a = await createTicketType({ name: 'Alpha', category: 'customer', isDefault: true })
    await archiveTicketType(a.id)
    const b = await createTicketType({ name: 'Beta', category: 'customer', isDefault: true })

    const restored = await restoreTicketType(a.id)
    expect(restored.deletedAt).toBeNull()
    expect(restored.isDefault).toBe(false)
    const defaults = await liveDefaults('customer')
    expect(defaults).toHaveLength(1)
    expect(defaults[0].id).toBe(b.id)
  })

  it('restores an archived default AS default when the category has no live default', async () => {
    await cleanSlate()
    const a = await createTicketType({ name: 'Alpha', category: 'customer', isDefault: true })
    await archiveTicketType(a.id)

    const restored = await restoreTicketType(a.id)
    expect(restored.isDefault).toBe(true)
    expect(await liveDefaults('customer')).toHaveLength(1)
  })

  // -------------------------------------------------------------------------
  // Write-time derivation
  // -------------------------------------------------------------------------

  it('resolveTicketTypeForCreate: no type = the explicit category, typeless', async () => {
    expect(await resolveTicketTypeForCreate({ category: 'tracker' })).toEqual({
      category: 'tracker',
      ticketTypeId: null,
    })
    expect(await resolveTicketTypeForCreate({})).toEqual({
      category: 'customer',
      ticketTypeId: null,
    })
  })

  it("resolveTicketTypeForCreate: the type's category wins; a matching explicit category is fine", async () => {
    await cleanSlate()
    const type = await createTicketType({ name: 'Outage', category: 'tracker' })
    expect(await resolveTicketTypeForCreate({ ticketTypeId: type.id })).toEqual({
      category: 'tracker',
      ticketTypeId: type.id,
    })
    expect(
      await resolveTicketTypeForCreate({ ticketTypeId: type.id, category: 'tracker' })
    ).toEqual({ category: 'tracker', ticketTypeId: type.id })
  })

  it('resolveTicketTypeForCreate rejects a mismatched explicit category and archived/unknown types', async () => {
    await cleanSlate()
    const type = await createTicketType({ name: 'Bug report', category: 'customer' })
    await expect(
      resolveTicketTypeForCreate({ ticketTypeId: type.id, category: 'tracker' })
    ).rejects.toThrow(/belongs to category 'customer', not 'tracker'/)

    await archiveTicketType(type.id)
    await expect(resolveTicketTypeForCreate({ ticketTypeId: type.id })).rejects.toThrow(
      NotFoundError
    )
    await expect(
      resolveTicketTypeForCreate({ ticketTypeId: createId('ticket_type') as TicketTypeId })
    ).rejects.toThrow(NotFoundError)
  })

  it('createTicketCore derives tickets.type from the chosen type and stamps ticketTypeId', async () => {
    await cleanSlate()
    await seedSettings()
    await seedDefaultStatus()
    const type = await createTicketType({ name: 'Bug report', category: 'customer' })

    const dto = await createTicketCore(
      { ticketTypeId: type.id, title: 'CSV export drops columns' },
      adminActor()
    )
    expect(dto.type).toBe('customer')
    expect(dto.ticketType).toMatchObject({ id: type.id, name: 'Bug report', category: 'customer' })
    const [row] = await testDb.select().from(tickets).where(eq(tickets.id, dto.id))
    expect(row.type).toBe('customer')
    expect(row.ticketTypeId).toBe(type.id)
  })

  it('createTicketCore rejects an explicit category mismatched with the type', async () => {
    await cleanSlate()
    await seedSettings()
    await seedDefaultStatus()
    const type = await createTicketType({ name: 'Security review', category: 'back_office' })
    await expect(
      createTicketCore({ ticketTypeId: type.id, type: 'customer', title: 'Nope' }, adminActor())
    ).rejects.toThrow(ValidationError)
  })

  // -------------------------------------------------------------------------
  // Intake resolution
  // -------------------------------------------------------------------------

  it('listIntakeTypes returns only live, intake-visible customer types', async () => {
    await cleanSlate()
    const visible = await createTicketType({ name: 'Bug report', category: 'customer' })
    await createTicketType({ name: 'Hidden', category: 'customer', intakeVisible: false })
    await createTicketType({ name: 'Internal', category: 'back_office' })
    const archived = await createTicketType({ name: 'Gone', category: 'customer' })
    await archiveTicketType(archived.id)

    const intake = await listIntakeTypes()
    expect(intake.map((t) => t.id)).toEqual([visible.id])
  })

  it('resolveIntakeCreate validates answers against the type’s customer form', async () => {
    await cleanSlate()
    const type = await createTicketType({
      name: 'Bug report',
      category: 'customer',
      fields: [
        textField({
          key: 'severity',
          label: 'Severity',
          type: 'select',
          required: true,
          options: ['Low', 'High'],
        }),
        textField({ key: 'internal_note', label: 'Internal', visibleToCustomer: false, order: 1 }),
      ],
    })

    const ok = await resolveIntakeCreate(type.id, { severity: 'High', rogue: 'x' })
    expect(ok.ticketTypeId).toBe(type.id)
    // The rogue key is dropped; the customer-hidden field is never settable.
    expect(ok.customAttributes).toEqual({ severity: 'High' })

    // A required customer field is enforced even on an empty submission…
    await expect(resolveIntakeCreate(type.id, {})).rejects.toThrow(/Severity is required/)
    // …and out-of-enum values are rejected.
    await expect(resolveIntakeCreate(type.id, { severity: 'Critical' })).rejects.toThrow(
      /not a valid option/
    )
  })

  it('resolveIntakeCreate rejects non-customer, intake-hidden, and archived explicit types', async () => {
    await cleanSlate()
    const internal = await createTicketType({ name: 'Internal', category: 'back_office' })
    const hidden = await createTicketType({
      name: 'Hidden',
      category: 'customer',
      intakeVisible: false,
    })
    const archived = await createTicketType({ name: 'Gone', category: 'customer' })
    await archiveTicketType(archived.id)

    for (const id of [internal.id, hidden.id, archived.id]) {
      await expect(resolveIntakeCreate(id, {})).rejects.toThrow(/not available/)
    }
    await expect(resolveIntakeCreate('not-a-type-id', {})).rejects.toThrow(/not available/)
  })

  it('resolveIntakeCreate absent: the intake default wins over an intake-hidden category default', async () => {
    await cleanSlate()
    // The category default is intake-HIDDEN — it must not claim customer filings.
    await createTicketType({
      name: 'Hidden default',
      category: 'customer',
      isDefault: true,
      intakeVisible: false,
    })
    const offered = await createTicketType({ name: 'Bug report', category: 'customer' })

    const resolved = await resolveIntakeCreate(undefined, {})
    expect(resolved.ticketTypeId).toBe(offered.id)
  })

  it('resolveIntakeCreate falls back to typeless when no intake types exist', async () => {
    await cleanSlate()
    await createTicketType({ name: 'Internal only', category: 'back_office' })
    await expect(resolveIntakeCreate(undefined, { rogue: 'x' })).resolves.toEqual({
      ticketTypeId: null,
      customAttributes: undefined,
    })
  })

  // -------------------------------------------------------------------------
  // The retype rule: fields[] changes never rewrite stored answers
  // -------------------------------------------------------------------------

  it('updating a type’s fields[] leaves stored customAttributes answers untouched', async () => {
    await cleanSlate()
    await seedSettings()
    await seedDefaultStatus()
    const type = await createTicketType({
      name: 'Bug report',
      category: 'customer',
      fields: [textField({ key: 'severity' }), textField({ key: 'steps', order: 1 })],
    })
    const created = await createTicketCore(
      {
        ticketTypeId: type.id,
        title: 'Keeps its answers',
        customAttributes: { severity: 'High', steps: 'Export then filter' },
      },
      adminActor()
    )

    // The admin removes 'steps' from the schema (the retype rule: orphaned
    // answers stay STORED — additive-only, never silently rewritten).
    await updateTicketType(type.id, { fields: [textField({ key: 'severity' })] })

    const [row] = await testDb.select().from(tickets).where(eq(tickets.id, created.id))
    expect(row.customAttributes).toEqual({ severity: 'High', steps: 'Export then filter' })
  })

  // -------------------------------------------------------------------------
  // listTickets registry-type filter
  // -------------------------------------------------------------------------
  it('listTickets filters by ticketTypeId independently of the category', async () => {
    await cleanSlate()
    await seedSettings()
    await seedDefaultStatus()
    const bug = await createTicketType({ name: 'Bug report', category: 'customer' })
    const refund = await createTicketType({ name: 'Refund request', category: 'customer' })
    const actor = adminActor()
    const a = await createTicketCore({ ticketTypeId: bug.id, title: 'Bug A' }, actor)
    await createTicketCore({ ticketTypeId: refund.id, title: 'Refund B' }, actor)
    await createTicketCore({ type: 'customer', title: 'Legacy C' }, actor)

    const filtered = await listTickets({ ticketTypeId: bug.id }, actor)
    expect(filtered.tickets.map((t) => t.id)).toEqual([a.id])

    // The category axis alone still returns all three.
    const byCategory = await listTickets({ type: 'customer' }, actor)
    expect(byCategory.tickets).toHaveLength(3)
  })

  // -------------------------------------------------------------------------
  // DTO projections
  // -------------------------------------------------------------------------

  it('projections: DTO carries the manager shape; intake DTO filters hidden fields', async () => {
    await cleanSlate()
    const type = await createTicketType({
      name: 'Bug report',
      category: 'customer',
      icon: '🐛',
      fields: [
        textField({ key: 'public_field', order: 1 }),
        textField({ key: 'hidden_field', visibleToCustomer: false, order: 0 }),
      ],
    })

    const dto = ticketTypeToDTO(type, 3)
    expect(dto).toMatchObject({
      id: type.id,
      name: 'Bug report',
      slug: 'bug_report',
      category: 'customer',
      icon: '🐛',
      archived: false,
      ticketCount: 3,
    })
    expect(dto.fields).toHaveLength(2)

    const intake = ticketTypeToIntakeDTO(type)
    expect(intake.isDefault).toBe(false)
    expect(intake.fields.map((f) => f.key)).toEqual(['public_field'])
  })
})
