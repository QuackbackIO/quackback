/**
 * Shared client hook for ticket creation with file attachments.
 *
 * Orchestrates a two-step process:
 * 1. Create the ticket via the provided mutation
 * 2. If files are selected, create an initial thread and upload them
 *
 * Handles partial failures gracefully: if ticket creation succeeds but file
 * uploads fail, the ticket is preserved and the user sees per-file errors
 * with retry options.
 */

import { useState, useCallback } from 'react'
import type { TicketId, TicketThreadId } from '@quackback/ids'

export interface FileToAttach {
  file: File
  id: string // unique client-side ID for tracking
}

export interface AttachmentUploadResult {
  id: string // matches FileToAttach.id
  success: boolean
  error?: string
}

export interface TicketCreateWithAttachmentsState {
  isUploading: boolean
  uploadProgress: Record<string, { loaded: number; total: number }> // by FileToAttach.id
  uploadErrors: Record<string, string> // by FileToAttach.id
  successCount: number
  failureCount: number
  isDone: boolean
}

interface TicketCreateOptions<T extends { id: TicketId }> {
  /**
   * Mutation function that creates the ticket.
   * Should return { id: TicketId, ... }
   */
  createFn: () => Promise<T>
  /**
   * Function to create the initial thread for the ticket.
   * Called with (ticketId) and should return { id: TicketThreadId }
   */
  createThreadFn: (ticketId: TicketId) => Promise<{ id: TicketThreadId }>
  /**
   * Function to upload a single file to a thread.
   * Called with (ticketId, threadId, file) and should return { success: boolean, error?: string }
   */
  uploadFileFn: (
    ticketId: TicketId,
    threadId: TicketThreadId,
    file: File
  ) => Promise<{ success: boolean; error?: string }>
  /**
   * Files to attach after ticket creation.
   */
  files: FileToAttach[]
  /**
   * Optional callback on each file upload completion.
   */
  onFileUploadComplete?: (result: AttachmentUploadResult) => void
}

export function useTicketCreateWithAttachments<T extends { id: TicketId }>({
  createFn,
  createThreadFn,
  uploadFileFn,
  files,
  onFileUploadComplete,
}: TicketCreateOptions<T>) {
  const [state, setState] = useState<TicketCreateWithAttachmentsState>({
    isUploading: false,
    uploadProgress: {},
    uploadErrors: {},
    successCount: 0,
    failureCount: 0,
    isDone: false,
  })

  const execute = useCallback(async (): Promise<T | null> => {
    try {
      setState((prev) => ({
        ...prev,
        isUploading: true,
        uploadErrors: {},
        uploadProgress: {},
        successCount: 0,
        failureCount: 0,
        isDone: false,
      }))

      // Step 1: Create the ticket
      const ticket = await createFn()

      // If no files, we're done
      if (files.length === 0) {
        setState((prev) => ({
          ...prev,
          isUploading: false,
          isDone: true,
        }))
        return ticket
      }

      // Step 2: Ensure there's an initial thread
      const { id: threadId } = await createThreadFn(ticket.id)

      // Step 3: Upload files in parallel with progress tracking
      const uploadPromises = files.map(async ({ file, id: fileId }) => {
        try {
          const result = await uploadFileFn(ticket.id, threadId, file)
          const uploadResult: AttachmentUploadResult = {
            id: fileId,
            success: result.success,
            error: result.error,
          }
          setState((prev) => ({
            ...prev,
            successCount: result.success ? prev.successCount + 1 : prev.successCount,
            failureCount: !result.success ? prev.failureCount + 1 : prev.failureCount,
            uploadErrors: result.error
              ? { ...prev.uploadErrors, [fileId]: result.error }
              : { ...prev.uploadErrors },
          }))
          onFileUploadComplete?.(uploadResult)
          return uploadResult
        } catch (err) {
          const error = err instanceof Error ? err.message : 'Unknown error'
          const uploadResult: AttachmentUploadResult = {
            id: fileId,
            success: false,
            error,
          }
          setState((prev) => ({
            ...prev,
            failureCount: prev.failureCount + 1,
            uploadErrors: { ...prev.uploadErrors, [fileId]: error },
          }))
          onFileUploadComplete?.(uploadResult)
          return uploadResult
        }
      })

      await Promise.all(uploadPromises)

      setState((prev) => ({
        ...prev,
        isUploading: false,
        isDone: true,
      }))

      return ticket
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to create ticket'
      setState((prev) => ({
        ...prev,
        isUploading: false,
        isDone: true,
        uploadErrors: { general: error },
        failureCount: prev.failureCount + 1,
      }))
      throw err
    }
  }, [createFn, createThreadFn, uploadFileFn, files, onFileUploadComplete])

  return {
    state,
    execute,
  }
}
