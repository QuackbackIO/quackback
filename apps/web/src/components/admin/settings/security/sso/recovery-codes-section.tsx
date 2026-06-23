/**
 * Recovery-codes management for the admin's own account.
 *
 * Lists active codes (metadata only — plaintext is shown ONCE in the
 * generation modal). "Generate new codes" invalidates the prior batch
 * and shows the new 10-code list in a show-once modal that requires
 * an explicit acknowledgement before dismissal.
 */
import { useState } from 'react'
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  KeyIcon,
  ArrowDownTrayIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/solid'
import { adminQueries } from '@/lib/client/queries/admin'
import { generateRecoveryCodesFn } from '@/lib/server/functions/recovery-codes'

function downloadCodes(codes: string[]): void {
  const content = ['Quackback SSO recovery codes', '', ...codes].join('\n')
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `quackback-recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function copyCodes(codes: string[]): Promise<void> {
  await navigator.clipboard.writeText(codes.join('\n'))
}

export function RecoveryCodesSection() {
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery(adminQueries.recoveryCodes())
  const codes = data.codes
  const activeCount = codes.filter((c) => !c.usedAt).length
  const latest = codes[0]

  const [revealedCodes, setRevealedCodes] = useState<string[] | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  const generate = useMutation({
    mutationFn: () => generateRecoveryCodesFn({ data: {} }),
    onSuccess: (result) => {
      setRevealedCodes(result.codes)
      setAcknowledged(false)
      // Invalidate every admin query that depends on whether codes
      // exist. ssoRequiredPreview is the most important — without
      // this, the Require-SSO confirmation modal would show "Not
      // generated" until the next 30s staleTime tick or a full page
      // reload, gating the enable button behind a stale read.
      void queryClient.invalidateQueries({ queryKey: ['admin', 'recoveryCodes'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'ssoRequiredPreview'] })
    },
  })

  return (
    <section className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-medium">
            <KeyIcon className="size-4 text-muted-foreground" />
            Recovery codes
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            One-time codes to sign in when SSO is unavailable. Generate a fresh batch any time.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => generate.mutate()}
          disabled={generate.isPending}
          className="h-9"
        >
          {generate.isPending ? 'Generating…' : 'Generate new codes'}
        </Button>
      </div>

      <div className="mt-4 flex items-center gap-3 text-xs">
        <Badge variant={activeCount > 0 ? 'secondary' : 'destructive'}>{activeCount} active</Badge>
        {latest ? (
          <span className="text-muted-foreground">
            Last generated {new Date(latest.createdAt).toLocaleDateString()}
          </span>
        ) : (
          <span className="text-muted-foreground">No codes generated yet.</span>
        )}
      </div>

      {/* Low-codes warning. Fires when fewer than 3 codes remain so
       *  the admin sees it before they're down to zero — running out
       *  on the way into a broken-SSO incident is the worst possible
       *  time. Matches GitHub's 3-remaining threshold. Hidden when
       *  no codes exist at all (the empty state speaks for itself). */}
      {activeCount > 0 && activeCount < 3 ? (
        <Alert variant="destructive" className="mt-4">
          <ExclamationTriangleIcon className="size-4" />
          <AlertDescription>
            Only {activeCount} recovery {activeCount === 1 ? 'code' : 'codes'} left. Generate a
            fresh batch before you run out — running out during a broken-SSO incident leaves you
            locked out.
          </AlertDescription>
        </Alert>
      ) : null}

      <Dialog
        open={revealedCodes !== null}
        onOpenChange={(open) => {
          // The X / Escape / backdrop always dismiss — codes can be regenerated,
          // so never trap the admin behind the acknowledgement checkbox (which
          // only gates the primary "Done" button).
          if (!open) {
            setRevealedCodes(null)
            setAcknowledged(false)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save these recovery codes</DialogTitle>
            <DialogDescription>
              These codes will not be shown again. Store them somewhere safe — a password manager,
              encrypted note, or printed copy in a locked drawer.
            </DialogDescription>
          </DialogHeader>
          {revealedCodes ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-1.5 rounded-md border bg-muted/30 p-3 font-mono text-sm">
                {revealedCodes.map((code) => (
                  <span key={code} className="select-all">
                    {code}
                  </span>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void copyCodes(revealedCodes)}>
                  <ClipboardDocumentIcon className="size-3.5" />
                  Copy
                </Button>
                <Button variant="outline" size="sm" onClick={() => downloadCodes(revealedCodes)}>
                  <ArrowDownTrayIcon className="size-3.5" />
                  Download .txt
                </Button>
                <Button variant="outline" size="sm" onClick={() => window.print()}>
                  Print
                </Button>
              </div>

              <label className="flex items-start gap-2 pt-2 text-xs">
                <Checkbox
                  checked={acknowledged}
                  onCheckedChange={(v) => setAcknowledged(v === true)}
                />
                <span>
                  I&apos;ve saved these codes somewhere safe. I understand they won&apos;t be shown
                  again.
                </span>
              </label>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              disabled={!acknowledged}
              onClick={() => {
                setRevealedCodes(null)
                setAcknowledged(false)
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
