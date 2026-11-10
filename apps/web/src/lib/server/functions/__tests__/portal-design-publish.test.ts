/**
 * Publishing the portal design is its own permission: someone who may edit
 * the draft but not publish it can save, and is refused publish, restore and
 * switching. The editor says which they may do.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

const hoisted = vi.hoisted(() => ({ permissions: [] as string[], published: [] as unknown[] }))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: (input: unknown) => Promise<unknown>) => fn,
    }
    return chain
  },
}))
vi.mock('../auth-helpers', () => ({
  requireAuth: async (options?: { permission?: string }) => {
    if (options?.permission && !hoisted.permissions.includes(options.permission))
      throw new Error(`Access denied: Requires permission '${options.permission}'`)
    return { principal: { id: 'principal_1' }, permissions: hoisted.permissions }
  },
}))
vi.mock('@/lib/server/domains/design/design-author', () => ({
  designAuthor: async () => ({ principalId: 'principal_1' }),
}))
vi.mock('@/lib/server/domains/design/design.actions', () => ({
  readDesignForEditing: async () => ({ revision: 'r1' }),
  saveDesignDraft: async () => ({ ok: true }),
  publishDesign: async (input: unknown) => {
    hoisted.published.push(input)
    return { ok: true, number: 2 }
  },
  restoreDesign: async () => ({ ok: true, number: 3 }),
}))
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'https://acme.quackback.io' } }))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettingsRow: async () => ({
    cloudIdentity: {
      version: 1,
      displayName: 'Acme',
      canonicalOrigin: 'https://acme.quackback.io',
      platformHostname: 'acme.quackback.io',
      customDomains: [],
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
  }),
}))
vi.mock('@/lib/server/domains/design/switch', () => ({
  switchToDesign: async () => ({ ok: true, number: 1 }),
  switchBackFromDesign: async () => ({ ok: true }),
}))

const fns = (await import('../portal-design')) as unknown as Record<
  string,
  (input?: unknown) => Promise<unknown>
>
const input = { data: { design: {}, revisionId: 'portal_design_revision_1' } }

beforeEach(() => {
  hoisted.permissions = [PERMISSIONS.SETTINGS_BRANDING]
  hoisted.published = []
})

describe('the design publish permission', () => {
  it('lets someone with branding alone edit the draft but not make it live', async () => {
    expect(await fns.getPortalDesignFn!()).toMatchObject({ canPublish: false })
    await expect(fns.savePortalDesignDraftFn!(input)).resolves.toEqual({ ok: true })
    for (const name of [
      'publishPortalDesignFn',
      'restorePortalDesignVersionFn',
      'switchPortalDesignFn',
      'switchBackPortalDesignFn',
    ]) {
      await expect(fns[name]!(input), name).rejects.toThrow(PERMISSIONS.DESIGN_PUBLISH)
    }
  })

  it('lets someone who may publish do each', async () => {
    hoisted.permissions = [PERMISSIONS.SETTINGS_BRANDING, PERMISSIONS.DESIGN_PUBLISH]
    expect(await fns.getPortalDesignFn!()).toMatchObject({ canPublish: true, revision: 'r1' })
    await expect(fns.publishPortalDesignFn!(input)).resolves.toMatchObject({ ok: true })
    await expect(fns.restorePortalDesignVersionFn!(input)).resolves.toMatchObject({ ok: true })
    await expect(fns.switchPortalDesignFn!(input)).resolves.toMatchObject({ ok: true })
    await expect(fns.switchBackPortalDesignFn!(input)).resolves.toMatchObject({ ok: true })
  })
})

describe('using the new portal logo in the admin and emails', () => {
  const asked = (workspaceLogo?: boolean) => ({ data: { message: 'New logo', workspaceLogo } })

  it('publishes with the workspace logo only when asked', async () => {
    hoisted.permissions = [
      PERMISSIONS.SETTINGS_BRANDING,
      PERMISSIONS.DESIGN_PUBLISH,
      PERMISSIONS.SETTINGS_MANAGE,
    ]
    await fns.publishPortalDesignFn!(asked())
    await fns.publishPortalDesignFn!(asked(true))
    expect(hoisted.published).toMatchObject([{ workspaceLogo: false }, { workspaceLogo: true }])
  })

  it('refuses, as a value, someone who may publish but not change the workspace’s settings', async () => {
    hoisted.permissions = [PERMISSIONS.SETTINGS_BRANDING, PERMISSIONS.DESIGN_PUBLISH]
    expect(await fns.publishPortalDesignFn!(asked(true))).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    })
    expect(hoisted.published).toEqual([])
  })
})

describe('where the portal went live', () => {
  it('reports the live address, offering a domain to someone who may set one up', async () => {
    hoisted.permissions = [
      PERMISSIONS.SETTINGS_BRANDING,
      PERMISSIONS.DESIGN_PUBLISH,
      PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
    ]
    await expect(fns.publishPortalDesignFn!({ data: {} })).resolves.toMatchObject({
      ok: true,
      address: { url: 'https://acme.quackback.io', offerDomain: true },
    })
    hoisted.permissions = [PERMISSIONS.SETTINGS_BRANDING, PERMISSIONS.DESIGN_PUBLISH]
    await expect(fns.publishPortalDesignFn!({ data: {} })).resolves.toMatchObject({
      address: { offerDomain: false },
    })
  })
})
