import { createFileRoute, redirect } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'

export const Route = createFileRoute('/admin/automation/skills')({
  beforeLoad: ({ context }) => {
    if (!(context.permissions ?? []).includes(PERMISSIONS.ASSISTANT_MANAGE))
      throw new Error('Access denied: requires assistant.manage')
    throw redirect({ to: '/admin/automation/guidance', replace: true })
  },
})
