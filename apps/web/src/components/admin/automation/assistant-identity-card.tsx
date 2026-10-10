import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { ArrowPathIcon, PhotoIcon } from '@heroicons/react/24/solid'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ImageCropper } from '@/components/ui/image-cropper'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { useUpdateAssistantIdentity } from '@/lib/client/mutations/assistant'
import { getAssistantAvatarUploadUrlFn } from '@/lib/server/functions/uploads'
import type { AssistantIdentity } from '@/lib/shared/assistant/config'
import {
  AssistantConflictNotice,
  isAssistantFieldManaged,
  ManagedSettingHint,
  useAssistantAutosave,
  useUnsavedChanges,
} from './assistant-form'

const NAME_SAVE_DELAY_MS = 800

const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const MAX_AVATAR_BYTES = 5 * 1024 * 1024

// The saved name is trimmed, so a trailing space is not an unsaved change.
function identityEquals(a: AssistantIdentity | null, b: AssistantIdentity | null): boolean {
  return Boolean(a && b && a.name.trim() === b.name.trim() && a.avatarUrl === b.avatarUrl)
}

export function AssistantIdentityCard() {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const settingsQuery = useQuery(assistantQueries.settings())
  const updateIdentity = useUpdateAssistantIdentity()
  const [draft, setDraft] = useState<AssistantIdentity | null>(null)
  // The last identity the server is known to hold.
  const [saved, setSaved] = useState<AssistantIdentity | null>(null)
  const [nameFocused, setNameFocused] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const [showCropper, setShowCropper] = useState(false)
  const [uploading, setUploading] = useState(false)

  // Names are typed, so they save after a pause; an avatar change is one action and saves at once.
  const editKind = useRef<'name' | 'avatar'>('name')
  const dirty = Boolean(draft && saved && !identityEquals(draft, saved))
  const nameValid = Boolean(draft && draft.name.trim() && draft.name.length <= 80)
  useUnsavedChanges(dirty, 'basics')

  async function save() {
    const latest = queryClient.getQueryData(assistantQueries.settings().queryKey)
    if (!latest || !draft || !draft.name.trim()) return
    const sent = { name: draft.name.trim(), avatarUrl: draft.avatarUrl }
    await updateIdentity.mutateAsync({ expectedRevision: latest.revision, identity: sent })
    setSaved(sent)
  }

  const { conflict, clearConflict } = useAssistantAutosave({
    dirty,
    valid: nameValid && !uploading,
    signature: `${draft?.name ?? ''}|${draft?.avatarUrl ?? ''}`,
    delayMs: editKind.current === 'avatar' ? 0 : NAME_SAVE_DELAY_MS,
    save,
  })

  // The draft is what the person typed. The server's identity replaces it only
  // when it changed elsewhere and the person has nothing pending or in hand.
  useEffect(() => {
    if (!settingsQuery.data || dirty || nameFocused) return
    const identity = settingsQuery.data.config.identity
    if (draft && identityEquals(identity, saved)) return
    setDraft(identity)
    setSaved(identity)
  }, [settingsQuery.data, dirty, nameFocused, draft, saved])

  if (settingsQuery.isError) {
    return (
      <SettingsCard
        title={intl.formatMessage({
          id: 'automation.agent.identity.title',
          defaultMessage: 'Identity',
        })}
      >
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-sm text-destructive">
            {intl.formatMessage({
              id: 'automation.agent.loadError',
              defaultMessage: 'AI agent settings could not be loaded.',
            })}
          </p>
          <Button variant="outline" size="sm" onClick={() => void settingsQuery.refetch()}>
            {intl.formatMessage({ id: 'automation.agent.retry', defaultMessage: 'Try again' })}
          </Button>
        </div>
      </SettingsCard>
    )
  }

  if (settingsQuery.isPending || !draft || !saved) {
    return (
      <SettingsCard
        title={intl.formatMessage({
          id: 'automation.agent.identity.title',
          defaultMessage: 'Identity',
        })}
      >
        <p role="status" className="text-sm text-muted-foreground">
          {intl.formatMessage({
            id: 'automation.agent.loading',
            defaultMessage: 'Loading AI agent settings...',
          })}
        </p>
      </SettingsCard>
    )
  }

  const managedPaths = settingsQuery.data.managedFieldPaths
  const nameManaged = isAssistantFieldManaged(managedPaths, 'identity.name')
  const avatarManaged = isAssistantFieldManaged(managedPaths, 'identity.avatarUrl')
  const nameError = draft.name.trim()
    ? draft.name.length > 80
      ? intl.formatMessage({
          id: 'automation.agent.identity.nameTooLong',
          defaultMessage: 'Use 80 characters or fewer.',
        })
      : null
    : intl.formatMessage({
        id: 'automation.agent.identity.nameRequired',
        defaultMessage: 'Enter a name for your AI agent.',
      })

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      toast.error('Invalid file type. Allowed: JPEG, PNG, GIF, WebP')
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error('File too large. Maximum size is 5MB')
      return
    }
    setCropImageSrc(URL.createObjectURL(file))
    setShowCropper(true)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleCropComplete(croppedBlob: Blob) {
    if (cropImageSrc) {
      URL.revokeObjectURL(cropImageSrc)
      setCropImageSrc(null)
    }
    const contentType = croppedBlob.type || 'image/png'
    setUploading(true)
    try {
      const { uploadUrl, publicUrl } = await getAssistantAvatarUploadUrlFn({
        data: {
          filename: 'assistant-avatar.png',
          contentType,
          fileSize: croppedBlob.size,
        },
      })
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        body: croppedBlob,
        headers: { 'Content-Type': contentType },
      })
      if (!response.ok) throw new Error('Failed to upload image to storage')
      editKind.current = 'avatar'
      setDraft((current) => (current ? { ...current, avatarUrl: publicUrl } : current))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload image')
    } finally {
      setUploading(false)
    }
  }

  function handleCropperClose(open: boolean) {
    if (!open && cropImageSrc) {
      URL.revokeObjectURL(cropImageSrc)
      setCropImageSrc(null)
    }
    setShowCropper(open)
  }

  function removeAvatar() {
    editKind.current = 'avatar'
    setDraft((current) => (current ? { ...current, avatarUrl: null } : current))
  }

  async function reloadLatest() {
    const result = await settingsQuery.refetch()
    if (!result.data) return
    setDraft(result.data.config.identity)
    setSaved(result.data.config.identity)
    clearConflict()
  }

  const avatarActionsDisabled = avatarManaged || uploading

  return (
    <SettingsCard
      title={intl.formatMessage({
        id: 'automation.agent.identity.title',
        defaultMessage: 'Identity',
      })}
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <Label>
            {intl.formatMessage({
              id: 'automation.agent.identity.avatar',
              defaultMessage: 'Avatar',
            })}
          </Label>
          <div className="flex items-center gap-4">
            <div className="relative">
              <Avatar src={draft.avatarUrl} name={draft.name || 'AI'} className="size-16 text-lg" />
              {uploading && (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
                  <ArrowPathIcon className="size-6 animate-spin text-white" />
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={avatarActionsDisabled}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <>
                    <ArrowPathIcon className="size-4 animate-spin" />
                    {intl.formatMessage({
                      id: 'automation.agent.identity.avatarUploading',
                      defaultMessage: 'Uploading…',
                    })}
                  </>
                ) : (
                  <>
                    <PhotoIcon className="size-4" />
                    {intl.formatMessage({
                      id: 'automation.agent.identity.avatarUpload',
                      defaultMessage: 'Upload image',
                    })}
                  </>
                )}
              </Button>
              {draft.avatarUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  disabled={avatarActionsDisabled}
                  onClick={removeAvatar}
                >
                  {intl.formatMessage({
                    id: 'automation.agent.identity.avatarRemove',
                    defaultMessage: 'Remove image',
                  })}
                </Button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
          {avatarManaged && <ManagedSettingHint />}
        </div>

        <div className="space-y-2">
          <Label htmlFor="assistant-name">
            {intl.formatMessage({ id: 'automation.agent.identity.name', defaultMessage: 'Name' })}
          </Label>
          <Input
            id="assistant-name"
            value={draft.name}
            aria-invalid={Boolean(nameError)}
            aria-describedby={nameError ? 'assistant-name-error' : undefined}
            disabled={nameManaged}
            onFocus={() => setNameFocused(true)}
            onBlur={() => setNameFocused(false)}
            onChange={(event) => {
              editKind.current = 'name'
              setDraft({ ...draft, name: event.target.value })
            }}
          />
          {nameError && (
            <p id="assistant-name-error" className="text-xs text-destructive">
              {nameError}
            </p>
          )}
          {nameManaged && <ManagedSettingHint />}
        </div>

        {conflict && <AssistantConflictNotice onReload={reloadLatest} />}
      </div>

      {cropImageSrc && (
        <ImageCropper
          imageSrc={cropImageSrc}
          open={showCropper}
          onOpenChange={handleCropperClose}
          onCropComplete={handleCropComplete}
        />
      )}
    </SettingsCard>
  )
}
