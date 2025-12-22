import { redirect } from 'next/navigation'

export default async function SettingsPage() {
  // Redirect to team settings
  redirect('/admin/settings/team')
}
