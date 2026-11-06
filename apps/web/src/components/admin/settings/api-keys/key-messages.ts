/**
 * The words of the key dialogs. The admin pages use these; a page in another
 * message area (a teammate's own API keys) passes its own set with the same
 * shape.
 */
import { defineMessages, type IntlShape, type MessageDescriptor } from 'react-intl'
import type { ApiKeyRefusalCode } from '@/lib/shared/api-key-refusal'

export interface KeyDialogMessages {
  rotateTitle: MessageDescriptor
  /** Has a `{name}` value. */
  rotateDescription: MessageDescriptor
  rotateWarningTitle: MessageDescriptor
  rotateWarningDescription: MessageDescriptor
  rotateConfirm: MessageDescriptor
  rotatePending: MessageDescriptor
  revokeTitle: MessageDescriptor
  /** Has a `{name}` value. */
  revokeDescription: MessageDescriptor
  revokeWarningTitle: MessageDescriptor
  revokeWarningDescription: MessageDescriptor
  revokeConfirm: MessageDescriptor
  revokePending: MessageDescriptor
  revealTitle: MessageDescriptor
  /** Has a `{name}` value. */
  revealDescription: MessageDescriptor
  revealSecretLabel: MessageDescriptor
  revealConfirm: MessageDescriptor
  revealCopyTitle: MessageDescriptor
  revealCopyDescription: MessageDescriptor
  revealCopy: MessageDescriptor
  revealUsage: MessageDescriptor
  renameTitle: MessageDescriptor
  name: MessageDescriptor
  cancel: MessageDescriptor
  save: MessageDescriptor
  refusalNotFound: MessageDescriptor
  refusalGrantCeiling: MessageDescriptor
  refusalPolicyOff: MessageDescriptor
  refusalInvalid: MessageDescriptor
  failed: MessageDescriptor
}

export const ADMIN_KEY_MESSAGES: KeyDialogMessages = defineMessages({
  rotateTitle: { id: 'apiKeys.rotate.title', defaultMessage: 'Rotate API key' },
  rotateDescription: {
    id: 'apiKeys.rotate.description',
    defaultMessage: 'Generate a new secret for the API key {name}.',
  },
  rotateWarningTitle: {
    id: 'apiKeys.rotate.warningTitle',
    defaultMessage: 'The old key will stop working immediately',
  },
  rotateWarningDescription: {
    id: 'apiKeys.rotate.warningDescription',
    defaultMessage:
      'Any applications using the current key will lose access until you update them with the new key. The key name and settings will be preserved.',
  },
  rotateConfirm: { id: 'apiKeys.rotate.confirm', defaultMessage: 'Rotate key' },
  rotatePending: { id: 'apiKeys.rotate.pending', defaultMessage: 'Rotating...' },
  revokeTitle: { id: 'apiKeys.revoke.title', defaultMessage: 'Revoke API key' },
  revokeDescription: {
    id: 'apiKeys.revoke.description',
    defaultMessage: 'Are you sure you want to revoke the API key {name}?',
  },
  revokeWarningTitle: {
    id: 'apiKeys.revoke.warningTitle',
    defaultMessage: 'This action cannot be undone',
  },
  revokeWarningDescription: {
    id: 'apiKeys.revoke.warningDescription',
    defaultMessage:
      'Any applications using this key will immediately lose access to the API. You will need to create a new key and update your integrations.',
  },
  revokeConfirm: { id: 'apiKeys.revoke.confirm', defaultMessage: 'Revoke key' },
  revokePending: { id: 'apiKeys.revoke.pending', defaultMessage: 'Revoking...' },
  revealTitle: { id: 'apiKeys.reveal.title', defaultMessage: 'API key created' },
  revealDescription: {
    id: 'apiKeys.reveal.description',
    defaultMessage: 'Your API key {name} is ready.',
  },
  revealSecretLabel: { id: 'apiKeys.reveal.secretLabel', defaultMessage: 'API key' },
  revealConfirm: { id: 'apiKeys.reveal.confirm', defaultMessage: "I've saved my key" },
  revealCopyTitle: { id: 'apiKeys.reveal.copyTitle', defaultMessage: 'Copy this now' },
  revealCopyDescription: {
    id: 'apiKeys.reveal.copyDescription',
    defaultMessage:
      "This is the only time you'll see it. Store it securely and never share it publicly.",
  },
  revealCopy: { id: 'apiKeys.reveal.copy', defaultMessage: 'Copy to clipboard' },
  revealUsage: { id: 'apiKeys.reveal.usage', defaultMessage: 'Usage' },
  renameTitle: { id: 'apiKeys.rename.title', defaultMessage: 'Rename key' },
  name: { id: 'apiKeys.form.name', defaultMessage: 'Name' },
  cancel: { id: 'apiKeys.form.cancel', defaultMessage: 'Cancel' },
  save: { id: 'apiKeys.form.save', defaultMessage: 'Save' },
  refusalNotFound: {
    id: 'apiKeys.refusal.notFound',
    defaultMessage: 'This key no longer exists or has expired.',
  },
  refusalGrantCeiling: {
    id: 'apiKeys.refusal.grantCeiling',
    defaultMessage: 'You can only manage keys whose role you could give.',
  },
  refusalPolicyOff: {
    id: 'apiKeys.refusal.policyOff',
    defaultMessage: 'New personal keys are turned off.',
  },
  refusalInvalid: {
    id: 'apiKeys.refusal.invalid',
    defaultMessage: 'Check the name and access, then try again.',
  },
  failed: { id: 'apiKeys.form.saveFailed', defaultMessage: 'The change could not be saved.' },
})

const REFUSAL_KEYS: Record<ApiKeyRefusalCode, keyof KeyDialogMessages> = {
  NOT_FOUND: 'refusalNotFound',
  GRANT_CEILING: 'refusalGrantCeiling',
  POLICY_OFF: 'refusalPolicyOff',
  INVALID: 'refusalInvalid',
}

/** The words for a refusal the server returned. */
export function refusalText(
  intl: IntlShape,
  messages: KeyDialogMessages,
  code: ApiKeyRefusalCode
): string {
  return intl.formatMessage(messages[REFUSAL_KEYS[code]])
}
