'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Trash2,
  Loader2,
  Plus,
  Copy,
  CheckCircle2,
  ExternalLink,
  AlertCircle,
  Clock,
  Star,
} from 'lucide-react'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  listDomainsAction,
  addDomainAction,
  deleteDomainAction,
  setPrimaryDomainAction,
  verifyDomainAction,
  type WorkspaceDomain,
  type VerifyDomainResult,
} from '@/lib/actions/domains'
import type { WorkspaceId } from '@quackback/ids'

interface DomainVerificationStatus {
  checking: boolean
  check?: {
    reachable: boolean
    tokenMatch: boolean | null
    error: string | null
  }
}

interface DomainListProps {
  workspaceId: string
  cnameTarget: string
}

export function DomainList({ workspaceId, cnameTarget }: DomainListProps) {
  const router = useRouter()
  const [domains, setDomains] = useState<WorkspaceDomain[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newDomain, setNewDomain] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [verificationStatus, setVerificationStatus] = useState<
    Record<string, DomainVerificationStatus>
  >({})
  const [settingPrimary, setSettingPrimary] = useState<string | null>(null)

  const fetchDomains = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const result = await listDomainsAction({ workspaceId: workspaceId as WorkspaceId })
      if (!result.success) {
        throw new Error(result.error.message)
      }
      setDomains((result.data as unknown as { domains: WorkspaceDomain[] }).domains)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch domains')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    fetchDomains()
  }, [fetchDomains])

  // Auto-poll verification for pending domains
  useEffect(() => {
    const pendingDomains = domains.filter((d) => d.domainType === 'custom' && !d.verified)
    if (pendingDomains.length === 0) return

    let isMounted = true

    const checkVerification = async (domain: WorkspaceDomain, showChecking = false) => {
      if (showChecking) {
        setVerificationStatus((prev) => ({
          ...prev,
          [domain.id]: { ...prev[domain.id], checking: true },
        }))
      }

      try {
        // Use status endpoint for CF-managed domains, verify endpoint for self-hosted
        if (domain.cloudflareHostnameId) {
          // Cloudflare-managed: poll status endpoint
          const response = await fetch(`/api/domains/status?domainId=${domain.id}`)
          const data = await response.json()

          if (!isMounted) return

          if (data.verified) {
            setDomains((prev) =>
              prev.map((d) =>
                d.id === domain.id
                  ? {
                      ...d,
                      verified: true,
                      sslStatus: data.sslStatus,
                      ownershipStatus: data.ownershipStatus,
                    }
                  : d
              )
            )
            setVerificationStatus((prev) => ({
              ...prev,
              [domain.id]: { checking: false },
            }))
            router.refresh()
          } else {
            // Update SSL status even if not yet verified
            setDomains((prev) =>
              prev.map((d) =>
                d.id === domain.id
                  ? { ...d, sslStatus: data.sslStatus, ownershipStatus: data.ownershipStatus }
                  : d
              )
            )
            setVerificationStatus((prev) => ({
              ...prev,
              [domain.id]: { checking: false },
            }))
          }
        } else {
          // Self-hosted: use verify action
          const result = await verifyDomainAction({
            workspaceId: workspaceId as WorkspaceId,
            domainId: domain.id,
          })

          if (!isMounted) return

          const verifyData = result.success ? (result.data as VerifyDomainResult) : null

          if (result.success && verifyData?.verified) {
            setDomains((prev) =>
              prev.map((d) => (d.id === domain.id ? { ...d, verified: true } : d))
            )
            setVerificationStatus((prev) => ({
              ...prev,
              [domain.id]: { checking: false },
            }))
            router.refresh()
          } else {
            setVerificationStatus((prev) => ({
              ...prev,
              [domain.id]: { checking: false, check: verifyData?.check },
            }))
          }
        }
      } catch {
        if (!isMounted) return
        setVerificationStatus((prev) => ({
          ...prev,
          [domain.id]: { checking: false },
        }))
      }
    }

    // Check each pending domain once on mount (with loading indicator)
    pendingDomains.forEach((domain) => {
      checkVerification(domain, true)
    })

    // Poll every 10 seconds for CF domains (faster), 30 seconds for self-hosted
    const cfDomains = pendingDomains.filter((d) => d.cloudflareHostnameId)
    const selfHostedDomains = pendingDomains.filter((d) => !d.cloudflareHostnameId)

    const cfInterval =
      cfDomains.length > 0
        ? setInterval(() => {
            const stillPending = domains.filter(
              (d) => d.domainType === 'custom' && !d.verified && d.cloudflareHostnameId
            )
            stillPending.forEach((domain) => checkVerification(domain, false))
          }, 10000)
        : null

    const selfHostedInterval =
      selfHostedDomains.length > 0
        ? setInterval(() => {
            const stillPending = domains.filter(
              (d) => d.domainType === 'custom' && !d.verified && !d.cloudflareHostnameId
            )
            stillPending.forEach((domain) => checkVerification(domain, false))
          }, 30000)
        : null

    return () => {
      isMounted = false
      if (cfInterval) clearInterval(cfInterval)
      if (selfHostedInterval) clearInterval(selfHostedInterval)
    }
  }, [domains, router])

  async function handleAddDomain() {
    if (!newDomain.trim()) return

    try {
      setAdding(true)
      setAddError(null)
      const result = await addDomainAction({
        domain: newDomain.trim(),
        workspaceId: workspaceId as WorkspaceId,
      })

      if (!result.success) {
        throw new Error(result.error.message)
      }

      const addedData = result.data as unknown as { domain: WorkspaceDomain }
      setDomains((prev) => [...prev, addedData.domain])
      setNewDomain('')
      setShowAddDialog(false)
      router.refresh()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add domain')
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete() {
    if (!deleteId) return

    try {
      setDeleting(true)
      const result = await deleteDomainAction({
        workspaceId: workspaceId as WorkspaceId,
        domainId: deleteId,
      })
      if (!result.success) {
        throw new Error(result.error.message)
      }
      setDeleteId(null)
      // Refetch domains to get updated primary status (subdomain may have been auto-promoted)
      await fetchDomains()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete domain')
    } finally {
      setDeleting(false)
    }
  }

  async function handleSetPrimary(domainId: string) {
    try {
      setSettingPrimary(domainId)
      const result = await setPrimaryDomainAction({
        workspaceId: workspaceId as WorkspaceId,
        domainId,
      })
      if (!result.success) {
        throw new Error(result.error.message)
      }
      // Update local state
      setDomains((prev) =>
        prev.map((d) => ({
          ...d,
          isPrimary: d.id === domainId,
        }))
      )
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set primary domain')
    } finally {
      setSettingPrimary(null)
    }
  }

  function copyToClipboard(text: string, domainId: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(domainId)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // Render status badge for custom domains (handles both CF and self-hosted)
  function renderStatusBadge(domain: WorkspaceDomain, isChecking: boolean) {
    // Cloudflare-managed domain
    if (domain.cloudflareHostnameId) {
      if (domain.verified || domain.sslStatus === 'active') {
        return (
          <Badge variant="outline" className="text-green-600 border-green-600/50">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            SSL Active
          </Badge>
        )
      }

      // Show SSL provisioning status
      switch (domain.sslStatus) {
        case 'pending_validation':
        case 'pending_issuance':
        case 'pending_deployment':
          return (
            <Badge variant="outline" className="text-blue-600 border-blue-600">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              SSL {domain.sslStatus?.replace('pending_', '').replace('_', ' ')}
            </Badge>
          )
        case 'initializing':
          return (
            <Badge variant="outline" className="text-amber-600 border-amber-600">
              <Clock className="mr-1 h-3 w-3" />
              Initializing
            </Badge>
          )
        default:
          return (
            <Badge variant="outline" className="text-amber-600 border-amber-600">
              <Clock className="mr-1 h-3 w-3" />
              {domain.sslStatus || 'Pending'}
            </Badge>
          )
      }
    }

    // Self-hosted domain (existing logic)
    if (domain.verified) {
      return (
        <Badge variant="outline" className="text-green-600 border-green-600/50">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Verified
        </Badge>
      )
    }

    if (isChecking) {
      return (
        <Badge variant="outline" className="text-blue-600 border-blue-600">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          Checking...
        </Badge>
      )
    }

    return (
      <Badge variant="outline" className="text-amber-600 border-amber-600">
        <Clock className="mr-1 h-3 w-3" />
        Pending
      </Badge>
    )
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Domains</CardTitle>
          <CardDescription>Manage your portal domains</CardDescription>
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
      {/* All Domains */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Domains</CardTitle>
            <CardDescription>Manage domains for your feedback portal</CardDescription>
          </div>
          <Button size="sm" onClick={() => setShowAddDialog(true)}>
            <Plus className="h-4 w-4" />
            Add Domain
          </Button>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
              <button onClick={() => setError(null)} className="ml-2 underline">
                Dismiss
              </button>
            </div>
          )}

          <div className="space-y-4">
            {domains.map((domain) => {
              const status = verificationStatus[domain.id]
              const isChecking = status?.checking
              const isSubdomain = domain.domainType === 'subdomain'

              return (
                <div key={domain.id} className="rounded-lg border p-4 space-y-3">
                  {/* Domain header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-medium">{domain.domain}</span>
                      {domain.isPrimary && (
                        <Badge variant="secondary">
                          <Star className="mr-1 h-3 w-3 fill-current" />
                          Primary
                        </Badge>
                      )}
                      {!isSubdomain && renderStatusBadge(domain, isChecking)}
                    </div>
                    <div className="flex items-center gap-2">
                      {(domain.verified || isSubdomain) && !domain.isPrimary && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSetPrimary(domain.id)}
                          disabled={settingPrimary === domain.id}
                          title="Set as primary domain"
                        >
                          {settingPrimary === domain.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Star className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" asChild>
                        <a
                          href={`https://${domain.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                      {!isSubdomain && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteId(domain.id)}
                          className="text-destructive hover:text-destructive"
                          title="Delete domain"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* DNS Instructions for pending custom domains */}
                  {!isSubdomain && !domain.verified && (
                    <div className="rounded-md bg-muted/50 p-3 space-y-2">
                      <p className="text-sm font-medium">Configure your DNS</p>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground w-16">Type:</span>
                        <code className="rounded bg-background px-2 py-0.5">CNAME</code>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground w-16">Name:</span>
                        <code className="rounded bg-background px-2 py-0.5">{domain.domain}</code>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground w-16">Target:</span>
                        <code className="rounded bg-background px-2 py-0.5 flex-1">
                          {cnameTarget}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => copyToClipboard(cnameTarget, domain.id)}
                        >
                          {copiedId === domain.id ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>

                      {/* Verification status feedback */}
                      {status?.check && !isChecking && (
                        <div className="mt-2 pt-2 border-t border-border">
                          {status.check.error ? (
                            <div className="flex items-start gap-2 text-sm text-amber-600">
                              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                              <div>
                                <p>{status.check.error}</p>
                                {!status.check.reachable && (
                                  <p className="text-muted-foreground mt-1">
                                    Make sure your CNAME record points to{' '}
                                    <code className="bg-background px-1 rounded">
                                      {cnameTarget}
                                    </code>
                                  </p>
                                )}
                              </div>
                            </div>
                          ) : (
                            <p className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Clock className="h-4 w-4" />
                              Waiting for DNS propagation... (checking every 30s)
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Add Domain Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Custom Domain</DialogTitle>
            <DialogDescription>
              Enter the domain you want to use for your feedback portal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {addError && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {addError}
              </div>
            )}
            <div className="space-y-2">
              <label htmlFor="domain" className="text-sm font-medium">
                Domain
              </label>
              <Input
                id="domain"
                placeholder="feedback.yourcompany.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                disabled={adding}
              />
              <p className="text-xs text-muted-foreground">
                Enter your domain without http:// or https://
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)} disabled={adding}>
              Cancel
            </Button>
            <Button onClick={handleAddDomain} disabled={adding || !newDomain.trim()}>
              {adding ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Domain'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Domain</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this domain? Users will no longer be able to access
              your portal via this domain.
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
