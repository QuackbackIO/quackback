'use client'

import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState, useTransition } from 'react'
import { DocumentTextIcon, CheckCircleIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/shared/spinner'
import { toast } from 'sonner'
import { changelogVisibilityQueries, adminQueries } from '@/lib/client/queries/admin'
import type { ChangelogVisibilityConfig } from '@/lib/server/db'

export const Route = createFileRoute('/admin/settings/changelog-visibility')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context
    await Promise.all([
      queryClient.ensureQueryData(changelogVisibilityQueries.adminData()),
      queryClient.ensureQueryData(adminQueries.segmentList()),
    ])

    return {}
  },
  component: ChangelogVisibilitySettingsPage,
})

// --------------------------------
// Helpers
// --------------------------------

interface TaxonomyItem {
  id: string
  name: string
  slug: string
}

interface VisibilityState {
  restrictCategories: boolean
  allowedCategoryIds: string[]
  restrictProducts: boolean
  allowedProductIds: string[]
}

function defaultState(config: ChangelogVisibilityConfig): VisibilityState {
  return {
    restrictCategories: config.restrictCategories ?? false,
    allowedCategoryIds: config.allowedCategoryIds ?? [],
    restrictProducts: config.restrictProducts ?? false,
    allowedProductIds: config.allowedProductIds ?? [],
  }
}

// --------------------------------
// Sub-component: VisibilityEditor
// --------------------------------

function VisibilityEditor({
  state,
  onChange,
  categories,
  products,
  disabled,
}: {
  state: VisibilityState
  onChange: (next: VisibilityState) => void
  categories: TaxonomyItem[]
  products: TaxonomyItem[]
  disabled?: boolean
}) {
  const toggleCategory = (id: string) => {
    const next = state.allowedCategoryIds.includes(id)
      ? state.allowedCategoryIds.filter((c) => c !== id)
      : [...state.allowedCategoryIds, id]
    onChange({ ...state, allowedCategoryIds: next })
  }
  const toggleProduct = (id: string) => {
    const next = state.allowedProductIds.includes(id)
      ? state.allowedProductIds.filter((p) => p !== id)
      : [...state.allowedProductIds, id]
    onChange({ ...state, allowedProductIds: next })
  }

  return (
    <div className="space-y-4">
      {/* Categories */}
      <div className="space-y-2">
        <div className="flex items-center justify-between py-2">
          <div>
            <Label className="text-sm font-medium">Restrict by Category</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              When enabled, only entries from selected categories are visible (uncategorized entries
              always show)
            </p>
          </div>
          <Switch
            checked={state.restrictCategories}
            onCheckedChange={(v) => onChange({ ...state, restrictCategories: v })}
            disabled={disabled}
          />
        </div>
        {state.restrictCategories && (
          <div className="pl-2 space-y-1">
            {categories.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No categories defined yet</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => {
                  const selected = state.allowedCategoryIds.includes(cat.id)
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => toggleCategory(cat.id)}
                      className="focus:outline-none"
                    >
                      <Badge
                        variant={selected ? 'default' : 'outline'}
                        className="cursor-pointer text-xs"
                      >
                        {cat.name}
                      </Badge>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Products */}
      <div className="space-y-2 border-t border-border/50 pt-4">
        <div className="flex items-center justify-between py-2">
          <div>
            <Label className="text-sm font-medium">Restrict by Product</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              When enabled, only entries from selected products are visible (entries without a
              product always show)
            </p>
          </div>
          <Switch
            checked={state.restrictProducts}
            onCheckedChange={(v) => onChange({ ...state, restrictProducts: v })}
            disabled={disabled}
          />
        </div>
        {state.restrictProducts && (
          <div className="pl-2 space-y-1">
            {products.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No products defined yet</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {products.map((prod) => {
                  const selected = state.allowedProductIds.includes(prod.id)
                  return (
                    <button
                      key={prod.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => toggleProduct(prod.id)}
                      className="focus:outline-none"
                    >
                      <Badge
                        variant={selected ? 'default' : 'outline'}
                        className="cursor-pointer text-xs"
                      >
                        {prod.name}
                      </Badge>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// --------------------------------
// Main page
// --------------------------------

function ChangelogVisibilitySettingsPage() {
  const router = useRouter()
  const [_isPending, startTransition] = useTransition()

  const dataQuery = useSuspenseQuery(changelogVisibilityQueries.adminData())
  const segmentsQuery = useSuspenseQuery(adminQueries.segmentList())

  const { orgConfig, segmentVisibilities, taxonomy } = dataQuery.data
  const categories: TaxonomyItem[] = taxonomy.categories ?? []
  const products: TaxonomyItem[] = taxonomy.products ?? []

  const [orgState, setOrgState] = useState<VisibilityState>(() => defaultState(orgConfig))
  const [segmentStates, setSegmentStates] = useState<Map<string, VisibilityState>>(() => {
    const map = new Map<string, VisibilityState>()
    for (const sv of segmentVisibilities) {
      map.set(sv.segmentId, defaultState(sv.config))
    }
    return map
  })
  const [saving, setSaving] = useState(false)

  const segments = (segmentsQuery.data ?? []) as Array<{
    id: string
    name: string
    description?: string | null
  }>

  async function handleOrgSave() {
    setSaving(true)
    try {
      const { updateOrgChangelogVisibilityFn } = await import('@/lib/server/functions/changelog')
      await updateOrgChangelogVisibilityFn({ data: orgState })
      toast.success('Saved', { description: 'Changelog visibility defaults updated' })
      startTransition(() => router.invalidate())
    } catch {
      toast.error('Error', { description: 'Failed to save changelog visibility defaults' })
    } finally {
      setSaving(false)
    }
  }

  async function handleSegmentSave(segmentId: string) {
    const state = segmentStates.get(segmentId)
    if (!state) return
    setSaving(true)
    try {
      const { updateSegmentChangelogVisibilityFn } =
        await import('@/lib/server/functions/changelog')
      await updateSegmentChangelogVisibilityFn({ data: { segmentId, ...state } })
      toast.success('Saved', { description: 'Segment changelog visibility updated' })
      startTransition(() => router.invalidate())
    } catch {
      toast.error('Error', { description: 'Failed to save segment changelog visibility' })
    } finally {
      setSaving(false)
    }
  }

  async function handleSegmentReset(segmentId: string) {
    setSaving(true)
    try {
      const { deleteSegmentChangelogVisibilityFn } =
        await import('@/lib/server/functions/changelog')
      await deleteSegmentChangelogVisibilityFn({ data: { segmentId } })
      setSegmentStates((prev) => {
        const next = new Map(prev)
        next.delete(segmentId)
        return next
      })
      toast.success('Reset', { description: 'Segment reverted to org defaults' })
      startTransition(() => router.invalidate())
    } catch {
      toast.error('Error', { description: 'Failed to reset segment changelog visibility' })
    } finally {
      setSaving(false)
    }
  }

  const getSegmentState = (segmentId: string): VisibilityState =>
    segmentStates.get(segmentId) ?? defaultState(orgState)

  const hasSegmentOverride = (segmentId: string) => segmentStates.has(segmentId)

  if (!dataQuery.data) {
    return <Spinner />
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={DocumentTextIcon}
        title="Changelog Visibility"
        description="Control which changelog categories and products are visible to portal users and user segments"
      />

      {/* Org-Level Defaults */}
      <SettingsCard
        title="Default Visibility"
        description="These settings apply to all portal users unless overridden by a segment below"
      >
        <VisibilityEditor
          state={orgState}
          onChange={setOrgState}
          categories={categories}
          products={products}
          disabled={saving}
        />
        <Button onClick={handleOrgSave} disabled={saving} className="mt-6">
          {saving ? (
            <Spinner className="mr-2 h-4 w-4" />
          ) : (
            <CheckCircleIcon className="mr-2 h-4 w-4" />
          )}
          Save Defaults
        </Button>
      </SettingsCard>

      {/* Segment Overrides */}
      {segments.length > 0 && (
        <SettingsCard
          title="Segment Overrides"
          description="Configure different changelog visibility for specific user segments. Merged with union logic — if any segment allows a category, users in that segment see it."
        >
          <div className="space-y-6">
            {segments.map((segment) => {
              const state = getSegmentState(segment.id)
              const hasOverride = hasSegmentOverride(segment.id)

              return (
                <div key={segment.id} className="border border-border/50 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h4 className="font-medium text-sm">{segment.name}</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        {segment.description || 'No description'}
                      </p>
                    </div>
                    {hasOverride && (
                      <Badge variant="secondary" className="text-xs shrink-0 ml-2">
                        Override active
                      </Badge>
                    )}
                  </div>

                  <VisibilityEditor
                    state={state}
                    onChange={(next) => {
                      setSegmentStates((prev) => new Map(prev).set(segment.id, next))
                    }}
                    categories={categories}
                    products={products}
                    disabled={saving}
                  />

                  <div className="flex gap-2 mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSegmentSave(segment.id)}
                      disabled={saving}
                    >
                      Save Override
                    </Button>
                    {hasOverride && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSegmentReset(segment.id)}
                        disabled={saving}
                        className="text-muted-foreground"
                      >
                        Reset to Defaults
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </SettingsCard>
      )}
    </div>
  )
}
