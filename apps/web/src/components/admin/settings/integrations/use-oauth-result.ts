import { useEffect, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { oauthErrorMessage } from './oauth-error-message'

/**
 * Reads the result the OAuth callback appends on its way back
 * (`?<integration>=connected` or `?<integration>=error&reason=<code>`),
 * shows it once, and strips it through the router. Stripping with
 * window.history would leave the params in the router's search state, and the
 * next navigation that spreads the previous search would put them back.
 *
 * Returns true for three seconds after a successful connection.
 */
export function useOAuthResult(searchParamKey: string, displayName: string): boolean {
  const intl = useIntl()
  const search = useSearch({ strict: false }) as Record<string, unknown>
  const navigate = useNavigate()
  const [showSuccess, setShowSuccess] = useState(false)

  const result = search[searchParamKey]
  const reason = typeof search.reason === 'string' ? search.reason : undefined

  useEffect(() => {
    if (result !== 'connected' && result !== 'error') return

    void navigate({
      to: '.',
      search: (previous) => {
        const { [searchParamKey]: _result, reason: _reason, ...rest } = previous
        return rest
      },
      replace: true,
    })

    if (result === 'error') {
      // A stable id keeps one toast if the effect runs again before the
      // router applies the stripped search (StrictMode, a re-render).
      toast.error(oauthErrorMessage(intl, reason, searchParamKey, displayName), {
        id: `oauth-result-${searchParamKey}`,
      })
      return
    }
    setShowSuccess(true)
  }, [result, reason, searchParamKey, displayName, intl, navigate])

  // Separate from the effect above: stripping the params re-runs that effect,
  // and its cleanup would cancel this timer and leave the banner up.
  useEffect(() => {
    if (!showSuccess) return
    const timer = setTimeout(() => setShowSuccess(false), 3000)
    return () => clearTimeout(timer)
  }, [showSuccess])

  return showSuccess
}
