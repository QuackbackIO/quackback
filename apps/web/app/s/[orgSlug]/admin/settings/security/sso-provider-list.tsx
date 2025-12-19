'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Trash2, Loader2, Plus } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { listSsoProvidersAction, deleteSsoProviderAction } from '@/lib/actions/workspace'
import type { WorkspaceId } from '@quackback/ids'

interface SsoProvider {
  id: string
  workspaceId: string
  issuer: string
  domain: string
  providerId: string
  oidcConfig: Record<string, unknown> | null
  samlConfig: Record<string, unknown> | null
  createdAt: Date | string
  updatedAt: Date | string
}

interface SsoProviderListProps {
  workspaceId: WorkspaceId
}

export function SsoProviderList({ workspaceId }: SsoProviderListProps) {
  const router = useRouter()
  const [providers, setProviders] = useState<SsoProvider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchProviders = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const result = await listSsoProvidersAction({ workspaceId })
      if (!result.success) {
        throw new Error(result.error.message || 'Failed to fetch SSO providers')
      }
      setProviders(result.data as SsoProvider[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch SSO providers')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  async function handleDelete() {
    if (!deleteId) return

    try {
      setDeleting(true)
      const result = await deleteSsoProviderAction({
        workspaceId,
        providerId: deleteId,
      })
      if (!result.success) {
        throw new Error(result.error.message || 'Failed to delete SSO provider')
      }
      setProviders((prev) => prev.filter((p) => p.id !== deleteId))
      setDeleteId(null)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete SSO provider')
    } finally {
      setDeleting(false)
    }
  }

  function getProviderType(provider: SsoProvider): 'OIDC' | 'SAML' {
    return provider.oidcConfig ? 'OIDC' : 'SAML'
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>SSO Providers</CardTitle>
          <CardDescription>Configure SAML and OIDC providers for your organization</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>SSO Providers</CardTitle>
            <CardDescription>
              Configure SAML and OIDC providers for your organization
            </CardDescription>
          </div>
          <Button asChild size="sm">
            <Link href="/admin/settings/security/sso/new">
              <Plus className="h-4 w-4" />
              Add Provider
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {providers.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <p>No SSO providers configured</p>
              <p className="mt-1 text-sm">
                Add a SAML or OIDC provider to enable SSO for your organization
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {providers.map((provider) => (
                <li
                  key={provider.id}
                  className="flex items-center justify-between py-4 first:pt-0 last:pb-0"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground">{provider.domain}</p>
                      <Badge variant="secondary">{getProviderType(provider)}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{provider.issuer}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteId(provider.id)}
                    className="text-destructive hover:text-destructive"
                    title="Delete provider"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete SSO Provider</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this SSO provider? Users will no longer be able to
              sign in using this provider.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
