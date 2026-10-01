import { useEffect } from 'react'
import type { ViewerEngineProps } from '../types'

export default function TextEngine({ onError }: ViewerEngineProps) {
  useEffect(() => onError('unsupported'), [onError])
  return null
}
