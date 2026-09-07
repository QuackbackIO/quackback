/**
 * #mapping — how Quackback reads this provider's claims.
 *
 * Dialogs edit a local draft; Save diffs closed operations against stored JSON.
 * `CLAIMS_TABLE` selects presentation only. Both branches share this save path.
 */
import { useMemo, useRef, useState } from 'react'
import { PlusIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { useUserAttributes } from '@/lib/client/hooks/use-user-attributes-queries'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import type { IdentitySource } from '@/lib/shared/oidc-claim-mapping'
import { diffClaimMappingOperations, mappingSaveRisks } from '@/lib/shared/sso-claim-mapping-edit'
import { ClaimMappingEditor } from './claim-mapping-editor'
import { ClaimAttributeMappingEditor } from './claim-attribute-mapping-editor'
import {
  ClaimRowDialog,
  type ClaimRowDialogCommit,
  type ClaimRowDialogTarget,
} from './claim-row-dialog'
import { AdvancedSourcesEditor, ClaimsTable } from './claims-table'
import { OutcomePreviewRail } from './outcome-preview-rail'
import { useSsoTestSignIn } from '../sso/use-sso-test-sign-in'
import { selectMappingCapture } from '@/lib/shared/sso-mapping-preview'
import {
  CLAIMS_TABLE,
  availableAddTargets,
  buildClaimsTableModel,
  draftSources,
  hasCustomProfileClaims,
  mergeClaimMapping,
  normalizeAttributeMapping,
  normalizeProfileClaims,
  normalizeRoleMapping,
  withAllowMissingEmail,
  type AttributeMapping,
  type ClaimsTableRow,
  type RoleMapping,
} from './provider-shared'
import { useProviderSave } from './use-provider-save'

export { CLAIMS_TABLE }

export function ClaimMappingCard({
  provider,
  presentation,
}: {
  provider: IdentityProvider
  presentation?: 'table' | 'legacy'
}) {
  const mode = presentation ?? (CLAIMS_TABLE ? 'table' : 'legacy')
  const { saving, saveClaimMapping } = useProviderSave(provider)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [removeRow, setRemoveRow] = useState<ClaimsTableRow | null>(null)
  const [dialog, setDialog] = useState<{
    mode: 'add' | 'edit'
    target?: ClaimRowDialogTarget
    path?: string
    role?: RoleMapping | null
  } | null>(null)
  const [mapping, setMapping] = useState<RoleMapping | null>(provider.claimMapping?.role ?? null)
  const [attributes, setAttributes] = useState<AttributeMapping | null>(
    provider.claimMapping?.attributes ?? null
  )
  const [allowMissingEmail, setAllowMissingEmail] = useState(
    provider.claimMapping?.profile?.allowMissingEmail === true
  )
  const [profileClaims, setProfileClaims] = useState<{
    id?: string
    email?: string
    name?: string
  }>(() => ({ ...(provider.claimMapping?.profile?.claims ?? {}) }))
  const [sources, setSources] = useState<IdentitySource[]>(() =>
    draftSources(provider.claimMapping)
  )
  const { lastSuccess, lastCapture, open: openTest } = useSsoTestSignIn()
  const pendingOps = useRef<typeof operations>([])
  const pendingTest = useRef(false)
  const { data: attributeDefs } = useUserAttributes()
  const definitions = useMemo(
    () =>
      (attributeDefs ?? []).map((d) => ({
        key: d.key,
        label: d.label,
        type: d.type,
      })),
    [attributeDefs]
  )

  const capture = selectMappingCapture({
    registrationId: provider.registrationId,
    sessionCapture:
      lastCapture?.registrationId === provider.registrationId
        ? lastCapture
        : lastSuccess?.registrationId === provider.registrationId
          ? lastSuccess
          : null,
    persistedCapture: provider.lastTestCapture,
  })

  const draftMapping = useMemo(
    () =>
      mergeClaimMapping(provider.claimMapping, {
        role: mapping ?? undefined,
        profile: normalizeProfileClaims({
          ...withAllowMissingEmail({ claims: profileClaims, sources }, allowMissingEmail),
          claims: profileClaims,
          sources,
        }),
        attributes: attributes ?? undefined,
      }),
    [provider.claimMapping, mapping, profileClaims, sources, allowMissingEmail, attributes]
  )

  const proposed = mergeClaimMapping(provider.claimMapping, {
    role: normalizeRoleMapping(mapping),
    profile: normalizeProfileClaims({
      ...withAllowMissingEmail({ claims: profileClaims, sources }, allowMissingEmail),
      claims: profileClaims,
      sources,
    }),
    attributes: normalizeAttributeMapping(attributes),
  })
  const operations = diffClaimMappingOperations(provider.claimMapping, proposed)
  const risks = mappingSaveRisks(provider.claimMapping, proposed)
  const dirty = operations.length > 0

  const rebaseFrom = (next: IdentityProvider) => {
    setMapping(next.claimMapping?.role ?? null)
    setAttributes(next.claimMapping?.attributes ?? null)
    setAllowMissingEmail(next.claimMapping?.profile?.allowMissingEmail === true)
    setProfileClaims({ ...(next.claimMapping?.profile?.claims ?? {}) })
    setSources(draftSources(next.claimMapping))
  }

  const persist = async (acks?: {
    acknowledgeIdentifierChange?: boolean
    acknowledgeAdminRules?: boolean
  }) => {
    const thenTest = pendingTest.current
    pendingTest.current = false
    const saved = await saveClaimMapping(
      {
        operations,
        acknowledgeIdentifierChange: acks?.acknowledgeIdentifierChange,
        acknowledgeAdminRules: acks?.acknowledgeAdminRules,
      },
      'Claim mapping saved.'
    )
    if (!saved) return false
    if (saved !== provider) rebaseFrom(saved)
    if (thenTest) openTest({ registrationId: provider.registrationId })
    return true
  }

  const requestSave = (thenTest = false) => {
    pendingTest.current = thenTest
    if (operations.length > 0 && (risks.identifierChanged || risks.hasAdminRules)) {
      pendingOps.current = operations
      setConfirmOpen(true)
      return
    }
    void persist()
  }

  const handleSave = () => requestSave(false)
  const handleSaveAndTest = () => requestSave(true)

  const commitDialog = (commit: ClaimRowDialogCommit) => {
    if (commit.type === 'profile') {
      setProfileClaims((prev) => {
        const next = { ...prev }
        if (commit.path == null) delete next[commit.field]
        else next[commit.field] = commit.path
        return next
      })
      return
    }
    if (commit.type === 'role') {
      setMapping(commit.mapping)
      return
    }
    setAttributes((prev) => {
      const map = [...(prev?.map ?? [])]
      if (typeof commit.baselineIndex === 'number' && map[commit.baselineIndex]) {
        map[commit.baselineIndex] = {
          ...map[commit.baselineIndex],
          claimPath: commit.claimPath,
          attributeKey: commit.attributeKey,
        }
      } else {
        map.push({ claimPath: commit.claimPath, attributeKey: commit.attributeKey })
      }
      return { ...(prev ?? { map: [] }), map }
    })
  }

  const applyRemove = (row: ClaimsTableRow) => {
    if (row.kind === 'role') {
      setMapping(null)
      return
    }
    if (row.kind === 'people') {
      setAttributes((prev) => {
        if (!prev) return prev
        const map = (prev.map ?? []).filter((_, i) => i !== row.baselineIndex)
        if (map.length === 0) return null
        return { ...prev, map }
      })
    }
  }

  const resetProfile = () => {
    setProfileClaims({})
    setResetOpen(false)
  }

  const tableModel = buildClaimsTableModel({
    mapping: {
      profile: { claims: profileClaims, allowMissingEmail, sources },
      role: mapping ?? undefined,
      attributes: attributes ?? undefined,
    },
    definitions,
  })
  const addTargets = availableAddTargets({
    mapping: draftMapping,
    definitions,
  })
  const resetEnabled = hasCustomProfileClaims({ profile: { claims: profileClaims } })

  const confirmBody = (
    <ConfirmDialog
      open={confirmOpen}
      onOpenChange={(open) => {
        setConfirmOpen(open)
        if (!open) pendingTest.current = false
      }}
      title="Confirm mapping changes"
      confirmLabel="Save mappings"
      description={
        <div className="space-y-2 text-sm">
          {risks.identifierChanged ? (
            <p>
              Changing the identifier can stop existing account matches and create another account.
              Existing accounts will not be migrated. This invalidates the connection test.
            </p>
          ) : null}
          {risks.hasAdminRules ? (
            <div className="space-y-1">
              <p>
                This can grant admin access even when the person&apos;s email is outside this
                provider&apos;s verified domains.
              </p>
              <ul className="list-disc pl-4">
                {risks.adminRules.map((rule) => (
                  <li key={rule.index}>
                    Rule {rule.index + 1} {'->'} admin
                  </li>
                ))}
              </ul>
              <p>The preview matching member does not limit this admin rule.</p>
            </div>
          ) : null}
        </div>
      }
      onConfirm={() => {
        if (JSON.stringify(operations) !== JSON.stringify(pendingOps.current)) {
          setConfirmOpen(false)
          requestSave(pendingTest.current)
          return
        }
        setConfirmOpen(false)
        void persist({
          acknowledgeIdentifierChange: risks.identifierChanged,
          acknowledgeAdminRules: risks.hasAdminRules,
        })
      }}
    />
  )

  if (mode === 'legacy') {
    return (
      <div id="mapping" className="scroll-mt-6">
        <SettingsCard
          title="Claim mapping"
          description="How Quackback reads this provider. Applies on every sign-in, including for people who already have accounts."
          contentClassName="space-y-4"
        >
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={allowMissingEmail}
              onCheckedChange={(v) => setAllowMissingEmail(v === true)}
              disabled={saving}
              aria-label="Allow accounts without an email address"
              className="mt-0.5"
            />
            <span>
              Allow accounts without an email address
              <span className="mt-0.5 block text-xs text-muted-foreground">
                For providers that release no email. Quackback creates a placeholder so people can
                still sign in, then asks them for a real address afterwards. Placeholders are
                permanent: turning this off later does not convert accounts that already have one.
                Off, these people cannot sign in at all.
              </span>
            </span>
          </label>

          <ClaimMappingEditor
            mapping={mapping}
            disabled={saving}
            registrationId={provider.registrationId}
            canTest
            onChange={setMapping}
          />

          <ClaimAttributeMappingEditor
            mapping={attributes}
            disabled={saving}
            registrationId={provider.registrationId}
            canTest
            capture={capture}
            detailsChangedAt={provider.detailsChangedAt}
            onChange={setAttributes}
          />

          <div className="flex justify-end border-t border-border/40 pt-5">
            <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save claim mapping'}
            </Button>
          </div>
        </SettingsCard>
        {confirmBody}
      </div>
    )
  }

  return (
    <div id="mapping" className="scroll-mt-6">
      <SettingsCard
        title="Attributes & Claims"
        description="Configure how Quackback identifies accounts and reads this provider's claims. Email and name are set at account creation. Role and People updates depend on the settings below."
        contentClassName="space-y-4"
        action={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              disabled={!resetEnabled || saving}
              onClick={() => setResetOpen(true)}
            >
              Reset profile claims
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setDialog({ mode: 'add' })}
              disabled={saving}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Add claim
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="min-w-0 flex-1 space-y-4">
            <ClaimsTable
              requiredRows={tableModel.required}
              additionalRows={tableModel.additional}
              allowMissingEmail={allowMissingEmail}
              onAllowMissingEmailChange={setAllowMissingEmail}
              peopleFlags={{
                overrideExisting: attributes?.overrideExisting === true,
                syncOnSignIn: attributes?.syncOnSignIn === true,
              }}
              onPeopleFlagsChange={(flags) =>
                setAttributes((prev) => ({
                  map: prev?.map ?? [],
                  ...(flags.overrideExisting ? { overrideExisting: true } : {}),
                  ...(flags.syncOnSignIn ? { syncOnSignIn: true } : {}),
                }))
              }
              onEdit={(row) => {
                if (row.kind === 'profile') {
                  setDialog({
                    mode: 'edit',
                    target: { type: 'profile', field: row.field },
                    path: row.isDefault ? undefined : row.path,
                  })
                  return
                }
                if (row.kind === 'role') {
                  setDialog({ mode: 'edit', target: { type: 'role' }, role: mapping })
                  return
                }
                if (row.kind === 'people') {
                  setDialog({
                    mode: 'edit',
                    target: {
                      type: 'people',
                      attributeKey: row.attributeKey,
                      baselineIndex: row.baselineIndex,
                    },
                    path: row.claimPath,
                  })
                }
              }}
              onRemove={setRemoveRow}
              onResetName={() =>
                setProfileClaims((prev) => {
                  const next = { ...prev }
                  delete next.name
                  return next
                })
              }
              disabled={saving}
              autoCreateUsers={provider.autoCreateUsers}
              autoProvisionRole={provider.autoProvisionRole}
            />
            <AdvancedSourcesEditor sources={sources} onChange={setSources} disabled={saving} />
            <div className="flex justify-end border-t border-border/40 pt-5">
              <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
          <div className="lg:w-[22rem] lg:shrink-0" data-preview-slot>
            <OutcomePreviewRail
              capture={capture}
              draft={draftMapping}
              definitions={definitions}
              providerPolicy={{
                autoCreateUsers: provider.autoCreateUsers,
                autoProvisionRole: provider.autoProvisionRole,
                detailsChangedAt: provider.detailsChangedAt,
                registrationId: provider.registrationId,
              }}
              dirty={dirty}
              onSaveAndTest={handleSaveAndTest}
              registrationId={provider.registrationId}
              canTest
            />
          </div>
        </div>
      </SettingsCard>

      <ClaimRowDialog
        open={dialog != null}
        mode={dialog?.mode ?? 'add'}
        lockedTarget={dialog?.mode === 'edit' ? dialog.target : undefined}
        availableTargets={addTargets}
        definitions={definitions}
        initialPath={dialog?.path}
        initialRole={dialog?.role}
        registrationId={provider.registrationId}
        canTest
        capture={capture}
        providerKind={provider.kind}
        autoCreateUsers={provider.autoCreateUsers}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
        onCommit={commitDialog}
      />

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset profile claims"
        confirmLabel="Reset profile claims"
        description={
          <div className="space-y-2 text-sm">
            <p>
              Restore identifier, email and display-name defaults. Keep source order, missing-email
              policy, Role and People mappings.
            </p>
            {profileClaims.id ? (
              <p>
                Changing the identifier can stop existing account matches and create another
                account. Existing accounts will not be migrated. This invalidates the connection
                test.
              </p>
            ) : null}
          </div>
        }
        onConfirm={resetProfile}
      />

      <ConfirmDialog
        open={removeRow != null}
        onOpenChange={(open) => {
          if (!open) setRemoveRow(null)
        }}
        title="Remove mapping"
        confirmLabel="Remove mapping"
        variant="destructive"
        description="This removes the mapping from the draft. It is not saved until you save the card."
        onConfirm={() => {
          if (removeRow) applyRemove(removeRow)
          setRemoveRow(null)
        }}
      />
      {confirmBody}
    </div>
  )
}
