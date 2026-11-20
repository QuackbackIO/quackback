import { useCallback } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { isPersonBlockedRefusal } from '@/lib/shared/person-blocked'

/**
 * For an action with no form to hold an error (a vote): says why the server
 * refused a blocked person, in their language. Any other failure stays quiet,
 * as it was.
 */
export function useBlockedRefusalToast(): (error: unknown) => void {
  const intl = useIntl()
  return useCallback(
    (error: unknown) => {
      if (!isPersonBlockedRefusal(error)) return
      toast.error(
        intl.formatMessage({
          id: 'portal.blocked',
          defaultMessage: "You can't post, vote or comment here.",
        })
      )
    },
    [intl]
  )
}
