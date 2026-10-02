import { useState, useTransition } from 'react'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { createFileRoute, useRouter, useNavigate, redirect } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { HeaderLinksCard } from '@/components/admin/settings/help-center/header-links-card'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DomainsLanguagesTab } from '@/components/admin/settings/help-center/domains-languages-tab'
import { settingsQueries } from '@/lib/client/queries/settings'
import { useUpdateHelpCenterConfig } from '@/lib/client/mutations/settings'
import { useDebouncedSave } from '@/lib/client/hooks/use-debounced-save'
import { isProductEnabled, type HelpCenterConfig } from '@/lib/shared/types/settings'

/**
 * Split by concern, matching the Access & Security page's `?tab=` pattern:
 *  - `general`            — homepage chrome
 *  - `domains-languages`  — custom domain, redirect rules, indexing (IA:
 *                           Products > Help Center > Domains & languages)
 */
const searchSchema = z.object({
  tab: z.enum(['general', 'domains-languages']).optional(),
})

export const Route = createFileRoute('/admin/settings/help-center')({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'helpCenter')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.HELP_CENTER_MANAGE)

    const { queryClient } = context
    await queryClient.ensureQueryData(settingsQueries.helpCenterConfig())
    return {}
  },
  component: HelpCenterSettingsRoute,
})

function HelpCenterSettingsRoute() {
  return <HelpCenterSettingsPage />
}

function HelpCenterSettingsPage() {
  const router = useRouter()
  const navigate = useNavigate()
  const search = Route.useSearch()
  const tab = search.tab ?? 'general'
  const updateHelpCenterConfig = useUpdateHelpCenterConfig()
  const helpCenterConfigQuery = useSuspenseQuery(settingsQueries.helpCenterConfig())
  const config = helpCenterConfigQuery.data as HelpCenterConfig

  const [homepageTitle, setHomepageTitle] = useState(config.homepageTitle)
  const [homepageDescription, setHomepageDescription] = useState(config.homepageDescription)
  const [, startTransition] = useTransition()

  // A failed save shows the shared autosave toast, so nothing is caught here.
  function saveField(data: Parameters<typeof updateHelpCenterConfig.mutate>[0]) {
    updateHelpCenterConfig.mutate(data, {
      onSuccess: () => startTransition(() => router.invalidate()),
    })
  }

  // Debounced homepage title/description saves. `useDebouncedSave` flushes
  // any pending value on unmount, so navigating away mid-debounce no longer
  // drops it.
  const { queue: queueTitleSave } = useDebouncedSave<string>((value) => {
    if (value.trim()) {
      saveField({ homepageTitle: value.trim() })
    }
  }, 800)

  const { queue: queueDescriptionSave } = useDebouncedSave<string>((value) => {
    saveField({ homepageDescription: value })
  }, 800)

  function handleTitleChange(value: string) {
    setHomepageTitle(value)
    queueTitleSave(value)
  }

  function handleDescriptionChange(value: string) {
    setHomepageDescription(value)
    queueDescriptionSave(value)
  }

  return (
    <SettingsPage page="/admin/settings/help-center">
      <Tabs
        value={tab}
        onValueChange={(next) => {
          void navigate({
            to: '/admin/settings/help-center',
            search: (prev) => ({ ...prev, tab: next as 'general' | 'domains-languages' }),
            replace: true,
          })
        }}
        variant="line"
        className="space-y-6"
      >
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="domains-languages">Domains & languages</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <SettingsCard title="Homepage" description="Customize the help center landing page.">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="homepage-title" className="text-sm font-medium">
                  Title
                </Label>
                <Input
                  id="homepage-title"
                  value={homepageTitle}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  placeholder="How can we help?"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="homepage-description" className="text-sm font-medium">
                  Description
                </Label>
                <Input
                  id="homepage-description"
                  value={homepageDescription}
                  onChange={(e) => handleDescriptionChange(e.target.value)}
                  placeholder="Search our knowledge base or browse by category"
                />
              </div>
            </div>
          </SettingsCard>

          <HeaderLinksCard links={config.headerLinks ?? []} />
        </TabsContent>

        <TabsContent value="domains-languages">
          <DomainsLanguagesTab config={config} />
        </TabsContent>
      </Tabs>
    </SettingsPage>
  )
}
