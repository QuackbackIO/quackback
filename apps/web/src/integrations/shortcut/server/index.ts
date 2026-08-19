import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { archiveShortcutStory } from '@/integrations/shortcut/server/archive'
import { fetchShortcutStates } from '@/integrations/shortcut/server/statuses'
import { shortcutHook } from '@/integrations/shortcut/server/hook'
import { shortcutInboundHandler } from '@/integrations/shortcut/server/inbound'
import { shortcutCatalog } from '@/integrations/shortcut/server/catalog'
import { listShortcutProjects } from '@/integrations/shortcut/server/projects'

export const shortcutIntegration: IntegrationDefinition = {
  id: 'shortcut',
  catalog: shortcutCatalog,
  destinations: {
    project: {
      label: 'Project',
      list: async ({ accessToken }) => {
        const projects = await listShortcutProjects(accessToken)
        return projects.map((p) => ({ id: String(p.id), name: p.name }))
      },
    },
  },
  hook: shortcutHook,
  inbound: shortcutInboundHandler,
  archive: archiveShortcutStory,
  webhookRegistration: 'manual',
  listExternalStatuses: fetchShortcutStates,
  platformCredentials: [],
}
