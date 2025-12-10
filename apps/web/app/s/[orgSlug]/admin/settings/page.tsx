import { redirect } from 'next/navigation'

export default async function SettingsPage() {
  // Redirect to team settings - use external path (proxy handles /s/[orgSlug] rewriting)
  redirect('/admin/settings/team')
}
