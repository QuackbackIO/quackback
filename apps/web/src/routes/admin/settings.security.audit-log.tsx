import { createFileRoute, redirect } from '@tanstack/react-router'

/** Retired route: the audit log is a tab of Access & Security. */
export const Route = createFileRoute('/admin/settings/security/audit-log')({
  beforeLoad: () => {
    throw redirect({
      to: '/admin/settings/security/authentication',
      search: { tab: 'audit-log' },
      replace: true,
    })
  },
})
