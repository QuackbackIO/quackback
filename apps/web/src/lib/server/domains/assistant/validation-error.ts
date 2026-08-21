import { ValidationError } from '@/lib/shared/errors'

export function validationError(noun: string, error: unknown): never {
  const issueMessage =
    typeof error === 'object' && error !== null && 'issues' in error
      ? (error as { issues?: Array<{ message?: string }> }).issues?.[0]?.message
      : undefined
  throw new ValidationError('VALIDATION_ERROR', issueMessage ?? `Invalid ${noun}`)
}
