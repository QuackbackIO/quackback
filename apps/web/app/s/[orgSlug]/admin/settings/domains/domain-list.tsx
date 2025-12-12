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
  RefreshCw,
  Copy,
  CheckCircle2,
  XCircle,
  ExternalLink,
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

interface WorkspaceDomain {
  id: string
  organizationId: string
  domain: string
  domainType: 'subdomain' | 'custom'
  isPrimary: boolean
  verified: boolean
  verificationToken: string | null
  createdAt: string
}

interface DomainListProps {
  organizationId: string
  orgSlug: string
}

export function DomainList({ organizationId, orgSlug: _orgSlug }: DomainListProps) {
  const router = useRouter()
  const [domains, setDomains] = useState<WorkspaceDomain[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newDomain, setNewDomain] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [verificationInfo, setVerificationInfo] = useState<{
    domain: string
    record: { type: string; name: string; value: string }
  } | null>(null)
  const [copied, setCopied] = useState(false)

  const fetchDomains = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch(`/api/domains?organizationId=${organizationId}`)
      if (!response.ok) {
        throw new Error('Failed to fetch domains')
      }
      const data = await response.json()
      setDomains(data.domains)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch domains')
    } finally {
      setLoading(false)
    }
  }, [organizationId])

  useEffect(() => {
    fetchDomains()
  }, [fetchDomains])

  async function handleAddDomain() {
    if (!newDomain.trim()) return

    try {
      setAdding(true)
      setAddError(null)
      const response = await fetch('/api/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: newDomain.trim(), organizationId }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add domain')
      }

      setDomains((prev) => [...prev, data.domain])
      setVerificationInfo({
        domain: data.domain.domain,
        record: data.verificationRecord,
      })
      setNewDomain('')
      setShowAddDialog(false)
      router.refresh()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add domain')
    } finally {
      setAdding(false)
    }
  }

  async function handleVerify(domainId: string) {
    try {
      setVerifyingId(domainId)
      const response = await fetch('/api/domains/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domainId }),
      })

      const data = await response.json()

      if (data.verified) {
        setDomains((prev) =>
          prev.map((d) =>
            d.id === domainId ? { ...d, verified: true, verificationToken: null } : d
          )
        )
        router.refresh()
      } else {
        // Show verification instructions
        const domain = domains.find((d) => d.id === domainId)
        if (domain && data.expectedRecord) {
          setVerificationInfo({
            domain: domain.domain,
            record: data.expectedRecord,
          })
        }
        setError(data.message || 'Verification failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setVerifyingId(null)
    }
  }

  async function handleDelete() {
    if (!deleteId) return

    try {
      setDeleting(true)
      const response = await fetch(`/api/domains?id=${deleteId}`, { method: 'DELETE' })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete domain')
      }
      setDomains((prev) => prev.filter((d) => d.id !== deleteId))
      setDeleteId(null)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete domain')
    } finally {
      setDeleting(false)
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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

  const subdomainEntry = domains.find((d) => d.domainType === 'subdomain')
  const customDomains = domains.filter((d) => d.domainType === 'custom')

  return (
    <>
      {/* Primary Subdomain */}
      <Card>
        <CardHeader>
          <CardTitle>Primary Domain</CardTitle>
          <CardDescription>Your default portal subdomain</CardDescription>
        </CardHeader>
        <CardContent>
          {subdomainEntry && (
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm">{subdomainEntry.domain}</span>
                <Badge variant="secondary">Primary</Badge>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <a
                  href={`https://${subdomainEntry.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Custom Domains */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Custom Domains</CardTitle>
            <CardDescription>
              Add your own domain to white-label your feedback portal
            </CardDescription>
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

          {customDomains.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <p>No custom domains configured</p>
              <p className="mt-1 text-sm">Add a custom domain to use your own branding</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {customDomains.map((domain) => (
                <li
                  key={domain.id}
                  className="flex items-center justify-between py-4 first:pt-0 last:pb-0"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{domain.domain}</span>
                      {domain.verified ? (
                        <Badge variant="default" className="bg-green-600">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          Verified
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-600 border-amber-600">
                          <XCircle className="mr-1 h-3 w-3" />
                          Pending
                        </Badge>
                      )}
                    </div>
                    {!domain.verified && (
                      <p className="text-xs text-muted-foreground">
                        Add DNS record to verify ownership
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!domain.verified && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleVerify(domain.id)}
                        disabled={verifyingId === domain.id}
                      >
                        {verifyingId === domain.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        Verify
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteId(domain.id)}
                      className="text-destructive hover:text-destructive"
                      title="Delete domain"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Add Domain Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Custom Domain</DialogTitle>
            <DialogDescription>
              Enter the domain you want to use for your feedback portal. You&apos;ll need to
              configure DNS records to verify ownership.
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

      {/* Verification Instructions Dialog */}
      <Dialog open={!!verificationInfo} onOpenChange={(open) => !open && setVerificationInfo(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Verify Domain Ownership</DialogTitle>
            <DialogDescription>
              Add the following DNS TXT record to verify ownership of {verificationInfo?.domain}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Record Type</p>
                <p className="font-mono text-sm">{verificationInfo?.record.type}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Name / Host</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-background px-2 py-1 font-mono text-sm">
                    {verificationInfo?.record.name}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard(verificationInfo?.record.name || '')}
                  >
                    {copied ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Value</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-background px-2 py-1 font-mono text-sm break-all">
                    {verificationInfo?.record.value}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard(verificationInfo?.record.value || '')}
                  >
                    {copied ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              After adding the DNS record, click &quot;Verify&quot; on the domain. DNS changes can
              take up to 48 hours to propagate, but usually complete within a few minutes.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setVerificationInfo(null)}>Done</Button>
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
