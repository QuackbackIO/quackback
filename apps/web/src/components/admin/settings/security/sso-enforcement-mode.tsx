/**
 * Tri-state SSO enforcement mode selector.
 *
 *   Off              — no hard-binding; admins can use any enabled method.
 *   Per verified     — only emails at sso_verified_domain rows with
 *   domain            enforced=true are bound. (Status of those rows is
 *                     managed in the Verified Domains block above.)
 *   Required for     — every admin/member must sign in via SSO,
 *   all team members  regardless of email domain. The strictest mode.
 *
 * Switching to Required opens a confirmation modal that calls
 * previewSsoRequiredImpactFn for the impact counts and gates the
 * enable button behind two acknowledgement checkboxes:
 *   1. I've confirmed every team member exists in the IdP
 *   2. I've saved my recovery codes
 */
import { useState } from 'react'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
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
import { Alert, AlertDescription } from '@/components/ui/alert'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/solid'
import { previewSsoRequiredImpactFn, setSsoRequiredFn } from '@/lib/server/functions/sso-required'
import type { AuthConfig } from '@/lib/shared/types/settings'

interface SsoEnforcementModeProps {
  authConfig: AuthConfig
  hasEnforcedDomain: boolean
}

type Mode = 'off' | 'per-domain' | 'required'

function currentMode(authConfig: AuthConfig, hasEnforcedDomain: boolean): Mode {
  if (authConfig.ssoOidc?.required === true) return 'required'
  if (hasEnforcedDomain) return 'per-domain'
  return 'off'
}

export function SsoEnforcementMode({ authConfig, hasEnforcedDomain }: SsoEnforcementModeProps) {
  const queryClient = useQueryClient()
  const mode = currentMode(authConfig, hasEnforcedDomain)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const setRequired = useMutation({
    mutationFn: (input: { required: boolean }) =>
      setSsoRequiredFn({ data: input as { required: boolean } }),
    onSuccess: (result) => {
      toast.success(
        result.revokeCount
          ? `Workspace SSO enforced. ${result.revokeCount} session(s) revoked.`
          : 'Workspace SSO enforced.'
      )
      setConfirmOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to update enforcement.'
      toast.error(message)
    },
  })

  function handleModeChange(next: string) {
    if (next === 'required' && mode !== 'required') {
      setConfirmOpen(true)
      return
    }
    if (next === 'off' && mode === 'required') {
      setRequired.mutate({ required: false })
      return
    }
    // per-domain mode is managed inline by the verified-domain rows
    // — toggle them from the block above.
  }

  return (
    <section className="space-y-4 pt-6 border-t border-border/40">
      <div className="flex items-start gap-2">
        <ShieldCheckIcon className="size-4 text-muted-foreground mt-0.5" />
        <div>
          <h3 className="text-sm font-medium">Enforcement</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            How strictly team members must use SSO to sign in.
          </p>
        </div>
      </div>

      <RadioGroup value={mode} onValueChange={handleModeChange} className="space-y-2">
        <label
          htmlFor="enf-off"
          className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/40"
        >
          <RadioGroupItem id="enf-off" value="off" />
          <div>
            <div className="text-sm font-medium">Off</div>
            <p className="text-xs text-muted-foreground">
              No hard-binding. Team can use any enabled method.
            </p>
          </div>
        </label>
        <label
          htmlFor="enf-domain"
          className="flex items-start gap-3 rounded-md border p-3 opacity-80 cursor-default"
        >
          <RadioGroupItem id="enf-domain" value="per-domain" disabled />
          <div>
            <div className="text-sm font-medium">Per verified domain</div>
            <p className="text-xs text-muted-foreground">
              Only emails at domains marked Enforced above are bound. Toggle individual domains in
              the Verified domains block.
            </p>
          </div>
        </label>
        <label
          htmlFor="enf-required"
          className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/40"
        >
          <RadioGroupItem id="enf-required" value="required" />
          <div>
            <div className="text-sm font-medium">Required for all team members</div>
            <p className="text-xs text-muted-foreground">
              Every admin and member must sign in via SSO, regardless of email domain. The strictest
              option.
            </p>
          </div>
        </label>
      </RadioGroup>

      {mode === 'required' ? (
        <Alert>
          <ExclamationTriangleIcon className="size-4" />
          <AlertDescription>
            Every new SSO sign-in is auto-provisioned at the workspace&apos;s default role. Review
            your auto-provision settings, or set up attribute mapping to source the role from your
            IdP&apos;s group claim.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Only mount the dialog when the user has chosen to open it —
       *  the dialog's preview query suspends, and rendering it
       *  unconditionally would block the section from ever appearing. */}
      {confirmOpen ? (
        <ConfirmRequiredDialog
          onOpenChange={setConfirmOpen}
          onConfirm={() => setRequired.mutate({ required: true })}
          submitting={setRequired.isPending}
        />
      ) : null}
    </section>
  )
}

function ConfirmRequiredDialog({
  onOpenChange,
  onConfirm,
  submitting,
}: {
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  submitting: boolean
}) {
  const [ackTeam, setAckTeam] = useState(false)
  const [ackCodes, setAckCodes] = useState(false)

  // Lazy preview: only loaded when the dialog is mounted (which the
  // parent gates on `confirmOpen`). Wrapping in Suspense at the parent
  // would also work, but mount-gating keeps the section's
  // initial-render path Suspense-free.
  const { data: impact } = useSuspenseQuery({
    queryKey: ['admin', 'ssoRequiredPreview'],
    queryFn: () => previewSsoRequiredImpactFn({ data: {} }),
    staleTime: 30 * 1000,
  })

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Require SSO for the whole workspace?</DialogTitle>
          <DialogDescription>
            Anyone signed in with a method other than SSO will be signed out immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-md border p-3 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Team members without SSO</span>
              <span className="font-medium">{impact.teamMembersWithoutSso}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Active non-SSO sessions</span>
              <span className="font-medium">{impact.activeNonSsoSessions}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Magic-link sign-in</span>
              <span className="font-medium">
                {impact.magicLinkEnabled ? 'Will be disabled' : 'Already off'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Recovery codes</span>
              <span className="font-medium">
                {impact.recoveryCodesGenerated ? (
                  <span className="text-green-600">
                    <CheckCircleIcon className="inline size-3" /> Saved
                  </span>
                ) : (
                  <span className="text-destructive">Not generated</span>
                )}
              </span>
            </div>
          </div>

          {!impact.recoveryCodesGenerated ? (
            <Alert variant="destructive">
              <AlertDescription>
                Generate recovery codes first. They&apos;re your only break-glass if SSO breaks
                after enforcement.
              </AlertDescription>
            </Alert>
          ) : null}

          <label className="flex items-start gap-2 text-xs">
            <Checkbox checked={ackTeam} onCheckedChange={(v) => setAckTeam(v === true)} />
            <span>I&apos;ve confirmed every team member exists in our identity provider.</span>
          </label>
          <label className="flex items-start gap-2 text-xs">
            <Checkbox checked={ackCodes} onCheckedChange={(v) => setAckCodes(v === true)} />
            <span>
              I&apos;ve saved my recovery codes somewhere safe (1Password, Bitwarden, or printed
              copy).
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!ackTeam || !ackCodes || !impact.recoveryCodesGenerated || submitting}
            onClick={onConfirm}
          >
            {submitting ? 'Enabling…' : 'Enable SSO requirement'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
