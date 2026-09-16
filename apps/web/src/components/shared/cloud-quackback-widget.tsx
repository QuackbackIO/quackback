'use client'

import { useEffect, useRef } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { isSyntheticAnonEmail } from '@/lib/shared/anonymous-email'

const INSTANCE_URL = 'https://feedback.quackback.io'
const SDK_URL = `${INSTANCE_URL}/api/widget/sdk.js`

function installStub() {
  if (window.Quackback) return
  const stub = function Quackback(this: unknown, ...args: unknown[]) {
    ;(stub.q = stub.q || []).push(args)
  } as NonNullable<Window['Quackback']>
  stub.q = []
  window.Quackback = stub
}

function loadSdk() {
  if (document.querySelector(`script[src="${SDK_URL}"]`)) return
  const script = document.createElement('script')
  script.async = true
  script.src = SDK_URL
  document.head.appendChild(script)
}

/**
 * Cloud-only dogfood: load the feedback.quackback.io widget on Cloud
 * workspace admin pages. Self-host never loads it. Portal / public /
 * widget surfaces stay clean so customer end-users never see it.
 */
export function CloudQuackbackWidget() {
  const { cloudEnabled, session } = useRouteContext({ from: '__root__' })
  const booted = useRef(false)

  const userId = session?.user?.id
  const email = session?.user?.email
  const canIdentify = Boolean(
    session?.session.scope === 'dashboard' &&
      userId &&
      email &&
      session.user.principalType !== 'anonymous' &&
      !isSyntheticAnonEmail(email)
  )

  useEffect(() => {
    if (!cloudEnabled) return
    installStub()
    loadSdk()
    if (!booted.current) {
      window.Quackback?.('init')
      booted.current = true
    }
  }, [cloudEnabled])

  useEffect(() => {
    if (!cloudEnabled || !canIdentify) return
    let cancelled = false
    void (async () => {
      const res = await fetch('/api/widget-sso')
      if (!res.ok || cancelled) return
      const body: unknown = await res.json().catch(() => null)
      const ssoToken =
        body && typeof body === 'object' && 'ssoToken' in body && typeof body.ssoToken === 'string'
          ? body.ssoToken
          : null
      if (!ssoToken || cancelled) return
      window.Quackback?.('identify', { ssoToken })
    })()
    return () => {
      cancelled = true
    }
  }, [cloudEnabled, canIdentify, userId])

  return null
}
