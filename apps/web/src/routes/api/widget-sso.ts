import { createFileRoute } from '@tanstack/react-router'
import { getSession } from '@/lib/server/auth/session'
import { mintCloudWidgetSsoToken } from '@/lib/server/cloud-widget/sso'

export async function handleWidgetSso(): Promise<Response> {
  const session = await getSession()
  const user = session?.user
  if (!user?.id || session?.session.scope !== 'dashboard') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ssoToken = await mintCloudWidgetSsoToken({
    id: user.id,
    email: user.email,
    name: user.name,
  })
  if (!ssoToken) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return Response.json({ ssoToken })
}

export const Route = createFileRoute('/api/widget-sso')({
  server: {
    handlers: {
      GET: () => handleWidgetSso(),
    },
  },
})
