import { useEffect, useRef, useState } from 'react'

interface UseDebouncedSearchOptions {
  /** The externally-controlled search value (e.g., from URL or parent state) */
  externalValue: string | undefined
  /** Called when the debounced local value differs from the external value */
  onChange: (value: string | undefined) => void
  /** Debounce delay in ms (default 300) */
  delay?: number
}

/**
 * Manages a local search input value with debounced syncing to an external value.
 * Handles: local state, sync-from-external effect, and debounce-to-external effect.
 */
export function useDebouncedSearch({
  externalValue,
  onChange,
  delay = 300,
}: UseDebouncedSearchOptions) {
  const [value, setValue] = useState(externalValue || '')
  const onChangeRef = useRef(onChange)
  const externalRef = useRef(externalValue)
  useEffect(() => {
    onChangeRef.current = onChange
    externalRef.current = externalValue
  })

  // Sync input when external value changes (e.g., clear filters)
  useEffect(() => {
    setValue(externalValue || '')
  }, [externalValue])

  // Debounce local value before updating external
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (value !== (externalRef.current || '')) {
        onChangeRef.current(value || undefined)
      }
    }, delay)
    return () => clearTimeout(timeoutId)
  }, [value, delay])

  return { value, setValue }
}
