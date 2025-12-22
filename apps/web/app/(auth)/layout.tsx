import { redirect } from 'next/navigation'
import { getSettings } from '@/lib/tenant'

/**
 * Auth Layout
 *
 * Auth routes (login, signup) for portal users.
 */
interface AuthLayoutProps {
  children: React.ReactNode
  params?: Promise<{}>
}

export default async function AuthLayout({ children }: AuthLayoutProps) {
  // Validate settings exists
  const settings = await getSettings()
  if (!settings) {
    redirect('/workspace-not-found')
  }

  return <>{children}</>
}
