import { useState } from 'react'
import {
  ArrowPathIcon,
  ClipboardDocumentIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { copyWithFallback } from '@/components/admin/activation-action-button'
import { useRegenerateWidgetSecret } from '@/lib/client/mutations/settings'

export function maskSigningSecret(secret: string): string {
  return `${secret.slice(0, 8)}${'•'.repeat(8)}`
}

export function WidgetSigningSecret({ secret }: { secret: string }) {
  const [revealed, setRevealed] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [copying, setCopying] = useState(false)
  const regenerate = useRegenerateWidgetSecret()

  async function copySecret() {
    setCopying(true)
    try {
      await copyWithFallback(secret)
      toast.success('Copied')
    } catch {
      toast.error('Copy failed. Select the text and copy it manually.')
    } finally {
      setCopying(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Verifies the identity of signed-in users. Keep it private and server-side only.
      </p>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs" data-testid="signing-secret">
          {revealed ? secret : maskSigningSecret(secret)}
        </code>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRevealed((value) => !value)}
            aria-label={revealed ? 'Hide signing secret' : 'Reveal signing secret'}
          >
            {revealed ? <EyeSlashIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
            {revealed ? 'Hide' : 'Reveal'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void copySecret()}
            disabled={copying}
          >
            <ClipboardDocumentIcon className="h-4 w-4" />
            {copying ? 'Copying…' : 'Copy'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={regenerate.isPending}
            onClick={() => setConfirmOpen(true)}
            aria-label="Regenerate signing secret"
          >
            <ArrowPathIcon className="h-4 w-4" />
            {regenerate.isPending ? 'Regenerating…' : 'Regenerate'}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Regenerate signing secret?"
        description="Signed-in users won't be recognized until you put the new secret in your app and redeploy. The launcher keeps working."
        warning={{
          title: 'Update the secret in your app before you regenerate',
          description:
            'The old secret stops working immediately. Anonymous visitors are unaffected.',
        }}
        confirmLabel="Regenerate secret"
        variant="destructive"
        isPending={regenerate.isPending}
        onConfirm={async () => {
          try {
            await regenerate.mutateAsync()
            toast.success('Signing secret regenerated')
            setRevealed(false)
            setConfirmOpen(false)
          } catch {
            toast.error('Could not regenerate the signing secret')
          }
        }}
      />
    </div>
  )
}
