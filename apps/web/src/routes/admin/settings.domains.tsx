import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import {
  GlobeAltIcon,
  PlusIcon,
  TrashIcon,
  StarIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ClockIcon,
  ClipboardDocumentIcon,
} from '@heroicons/react/24/outline'
import { StarIcon as StarIconSolid, CheckIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
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
import { domainQueries } from '@/lib/queries/domains'
import {
  useDomains,
  useAddDomain,
  useDeleteDomain,
  useSetDomainPrimary,
  useRefreshDomainVerification,
  domainKeys,
} from '@/lib/hooks/use-domain-actions'
import { isCloud } from '@/lib/features'
import { useFeature, Feature } from '@/lib/hooks/use-features'
import { getDisplayStatus, type Domain } from '@/lib/domains'
import { cn } from '@/lib/utils'
import { ProUpgradeModal } from '@/components/admin/pro-upgrade-modal'

export const Route = createFileRoute('/admin/settings/domains')({
  loader: async ({ context }) => {
    if (isCloud()) {
      await context.queryClient.ensureQueryData(domainQueries.list())
    }
  },
  component: DomainsPage,
})

function DomainsPage() {
  const { enabled: hasCustomDomainFeature, isLoading: isFeatureLoading } = useFeature(
    Feature.CUSTOM_DOMAIN
  )

  // If not cloud mode, show "not available" message
  if (!isCloud()) {
    return <NotAvailableInSelfHosted />
  }

  // Show full UI but disable parts when lacking feature access
  return <DomainManagement hasFeature={!isFeatureLoading && hasCustomDomainFeature} />
}

function NotAvailableInSelfHosted() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">Custom Domains</h1>
        <p className="text-sm text-muted-foreground">
          Connect your own domain to your feedback portal
        </p>
      </div>

      {/* Not Available Card */}
      <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <div className="px-6 py-12 flex flex-col items-center justify-center text-center">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <GlobeAltIcon className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-base font-medium text-foreground mb-1">
            Not available in self-hosted mode
          </h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Custom domains are only available in the cloud version of Quackback. In self-hosted
            mode, you can configure your own domain and SSL certificates directly on your server.
          </p>
        </div>
      </div>
    </div>
  )
}

function DomainManagement({ hasFeature }: { hasFeature: boolean }) {
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [domainToDelete, setDomainToDelete] = useState<Domain | null>(null)
  const queryClient = useQueryClient()

  const { data: domains = [] } = useDomains()

  // Auto-refresh for pending domains
  const hasPendingDomains = domains.some(
    (d) => d.sslStatus && !['active', 'expired', 'deleted'].includes(d.sslStatus)
  )

  useEffect(() => {
    if (!hasPendingDomains) return

    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: domainKeys.lists() })
    }, 30000) // Refresh every 30 seconds

    return () => clearInterval(interval)
  }, [hasPendingDomains, queryClient])

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Custom Domains</h1>
          <p className="text-sm text-muted-foreground">
            Connect your own domain to your feedback portal
          </p>
        </div>
        <Button onClick={() => (hasFeature ? setShowAddDialog(true) : setShowUpgradeModal(true))}>
          <PlusIcon className="h-4 w-4 mr-2" />
          Add Domain
        </Button>
      </div>

      {/* Domain List */}
      {domains.length === 0 ? (
        <EmptyState
          onAddDomain={() => (hasFeature ? setShowAddDialog(true) : setShowUpgradeModal(true))}
        />
      ) : (
        <DomainList domains={domains} onDelete={setDomainToDelete} hasFeature={hasFeature} />
      )}

      {/* Add Domain Dialog */}
      <AddDomainDialog open={showAddDialog} onOpenChange={setShowAddDialog} />

      {/* Delete Confirmation Dialog */}
      <DeleteDomainDialog
        domain={domainToDelete}
        open={!!domainToDelete}
        onOpenChange={(open) => !open && setDomainToDelete(null)}
      />

      {/* Pro Upgrade Modal */}
      <ProUpgradeModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        feature="Custom Domains"
        description="Connect your own domain to your feedback portal for a professional, branded experience."
        benefits={[
          'Use your own domain like feedback.yourcompany.com',
          'Automatic SSL certificate provisioning',
          'Seamless DNS verification',
        ]}
      />
    </div>
  )
}

function EmptyState({ onAddDomain }: { onAddDomain: () => void }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
      <div className="px-6 py-12 flex flex-col items-center justify-center text-center">
        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
          <GlobeAltIcon className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="text-base font-medium text-foreground mb-1">No custom domains yet</h3>
        <p className="text-sm text-muted-foreground max-w-md mb-4">
          Add a custom domain to access your feedback portal at your own URL, like
          feedback.yourcompany.com. We'll handle the SSL certificate for you.
        </p>
        <Button onClick={onAddDomain}>
          <PlusIcon className="h-4 w-4 mr-2" />
          Add Your First Domain
        </Button>
      </div>
    </div>
  )
}

function DomainList({
  domains,
  onDelete,
  hasFeature,
}: {
  domains: Domain[]
  onDelete: (domain: Domain) => void
  hasFeature: boolean
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-border/50">
        <p className="text-sm text-muted-foreground">
          {domains.length} domain{domains.length !== 1 ? 's' : ''}
        </p>
      </div>
      <ul className="divide-y divide-border/50">
        {domains.map((domain) => (
          <DomainCard key={domain.id} domain={domain} onDelete={onDelete} hasFeature={hasFeature} />
        ))}
      </ul>
    </div>
  )
}

function DomainCard({
  domain,
  onDelete,
  hasFeature,
}: {
  domain: Domain
  onDelete: (domain: Domain) => void
  hasFeature: boolean
}) {
  const [copied, setCopied] = useState(false)

  const setAsPrimaryMutation = useSetDomainPrimary()
  const refreshMutation = useRefreshDomainVerification()

  const displayStatus = getDisplayStatus(domain.sslStatus)
  const isPending = !['active', 'expired', 'error'].includes(displayStatus)
  const cnameTarget = process.env.CLOUD_APP_DOMAIN || 'proxy.quackback.cloud'

  const handleCopyCname = () => {
    navigator.clipboard.writeText(cnameTarget)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isCustomDomain = domain.domainType === 'custom'

  return (
    <li className={cn('px-6 py-4', isCustomDomain && !hasFeature && 'opacity-60')}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-foreground truncate">{domain.domain}</span>
            {domain.isPrimary && (
              <Badge variant="default" className="bg-primary/10 text-primary border-primary/30">
                <StarIconSolid className="h-3 w-3 mr-1" />
                Primary
              </Badge>
            )}
            <DomainTypeBadge type={domain.domainType} />
            {/* Only show status badge for custom domains - subdomains inherit SSL from parent */}
            {isCustomDomain && <StatusBadge status={displayStatus} />}
          </div>

          {/* CNAME Instructions for pending domains */}
          {isPending && domain.domainType === 'custom' && (
            <div className="mt-3 p-3 bg-muted/30 rounded-lg border border-border/50">
              <p className="text-xs text-muted-foreground mb-2">
                Add a CNAME record in your DNS settings:
              </p>
              <div className="flex items-center gap-2 text-sm font-mono bg-background rounded px-3 py-2 border border-border/50">
                <span className="text-muted-foreground">{domain.domain}</span>
                <span className="text-muted-foreground/50">&rarr;</span>
                <span className="text-foreground">{cnameTarget}</span>
                <button
                  onClick={handleCopyCname}
                  className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
                  title="Copy CNAME target"
                >
                  {copied ? (
                    <CheckIcon className="h-4 w-4 text-green-500" />
                  ) : (
                    <ClipboardDocumentIcon className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {isPending && isCustomDomain && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refreshMutation.mutate(domain.id)}
              disabled={!hasFeature || refreshMutation.isPending}
            >
              <ArrowPathIcon
                className={cn('h-4 w-4', refreshMutation.isPending && 'animate-spin')}
              />
              <span className="sr-only">Refresh</span>
            </Button>
          )}

          {domain.verified && !domain.isPrimary && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAsPrimaryMutation.mutate(domain.id)}
              disabled={(isCustomDomain && !hasFeature) || setAsPrimaryMutation.isPending}
              title="Set as primary"
            >
              <StarIcon className="h-4 w-4" />
              <span className="sr-only">Set as Primary</span>
            </Button>
          )}

          {isCustomDomain && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(domain)}
              disabled={!hasFeature}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <TrashIcon className="h-4 w-4" />
              <span className="sr-only">Delete</span>
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}

function DomainTypeBadge({ type }: { type: 'subdomain' | 'custom' }) {
  if (type === 'subdomain') {
    return (
      <Badge variant="secondary" className="text-xs">
        Subdomain
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-xs">
      Custom
    </Badge>
  )
}

function StatusBadge({ status }: { status: ReturnType<typeof getDisplayStatus> }) {
  switch (status) {
    case 'active':
      return (
        <Badge
          variant="default"
          className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30"
        >
          <CheckCircleIcon className="h-3 w-3 mr-1" />
          Active
        </Badge>
      )
    case 'awaiting_dns':
      return (
        <Badge
          variant="default"
          className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30"
        >
          <ClockIcon className="h-3 w-3 mr-1" />
          Awaiting DNS
        </Badge>
      )
    case 'issuing_certificate':
      return (
        <Badge
          variant="default"
          className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
        >
          <ArrowPathIcon className="h-3 w-3 mr-1 animate-spin" />
          Issuing...
        </Badge>
      )
    case 'deploying':
      return (
        <Badge
          variant="default"
          className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
        >
          <ArrowPathIcon className="h-3 w-3 mr-1 animate-spin" />
          Deploying...
        </Badge>
      )
    case 'configuring':
      return (
        <Badge variant="secondary">
          <ArrowPathIcon className="h-3 w-3 mr-1 animate-spin" />
          Configuring...
        </Badge>
      )
    case 'expired':
      return (
        <Badge
          variant="default"
          className="bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30"
        >
          <ExclamationCircleIcon className="h-3 w-3 mr-1" />
          Expired
        </Badge>
      )
    case 'error':
    default:
      return (
        <Badge variant="destructive">
          <ExclamationCircleIcon className="h-3 w-3 mr-1" />
          Error
        </Badge>
      )
  }
}

function AddDomainDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [domain, setDomain] = useState('')
  const [error, setError] = useState<string | null>(null)

  const addMutation = useAddDomain()

  const domainRegex = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$/

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const normalizedDomain = domain.toLowerCase().trim()

    if (!normalizedDomain) {
      setError('Domain is required')
      return
    }

    if (!domainRegex.test(normalizedDomain)) {
      setError('Please enter a valid domain (e.g., feedback.example.com)')
      return
    }

    addMutation.mutate(normalizedDomain, {
      onSuccess: () => {
        setDomain('')
        setError(null)
        onOpenChange(false)
      },
      onError: (err) => {
        setError(err instanceof Error ? err.message : 'Failed to add domain')
      },
    })
  }

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setDomain('')
      setError(null)
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Custom Domain</DialogTitle>
          <DialogDescription>
            Connect your own domain to your feedback portal. We'll automatically provision an SSL
            certificate for you.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="domain">Domain</Label>
            <Input
              id="domain"
              placeholder="feedback.example.com"
              value={domain}
              onChange={(e) => {
                setDomain(e.target.value)
                setError(null)
              }}
              aria-invalid={!!error}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={addMutation.isPending}>
              {addMutation.isPending ? (
                <>
                  <ArrowPathIcon className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Domain'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteDomainDialog({
  domain,
  open,
  onOpenChange,
}: {
  domain: Domain | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const deleteMutation = useDeleteDomain()

  const handleDelete = () => {
    if (domain) {
      deleteMutation.mutate(domain.id, {
        onSuccess: () => {
          onOpenChange(false)
        },
      })
    }
  }

  if (!domain) return null

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Domain</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <strong>{domain.domain}</strong>? This action cannot be
            undone. The SSL certificate will be revoked and the domain will no longer work.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete Domain'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
