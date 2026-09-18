import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { PERMISSIONS } from '@/lib/shared/permissions'

export const Route = createFileRoute('/admin/automation/agent')({
  validateSearch: z.object({
    tab: z.enum(['basics', 'knowledge', 'guidance', 'actions']).optional(),
  }),
  beforeLoad: ({ context, search }) => {
    if (!(context.permissions ?? []).includes(PERMISSIONS.ASSISTANT_MANAGE))
      throw new Error('Access denied: requires assistant.manage')
    const to =
      search.tab === 'actions'
        ? '/admin/automation/connectors'
        : search.tab === 'guidance'
          ? '/admin/automation/guidance'
          : search.tab === 'knowledge'
            ? '/admin/automation/knowledge'
            : '/admin/automation/deploy'
    throw redirect({ to, replace: true })
  },
})
