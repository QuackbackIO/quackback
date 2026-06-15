/** Server config shape returned from `/api/widget/config.json`. */
export interface ServerConfig {
  enabled?: boolean
  /**
   * Theme colors configured in the admin dashboard. Opaque to this package —
   * sdk.ts picks out the primary/foreground fields it needs and pushes them
   * to the launcher via `setColors`.
   */
  theme?: {
    lightPrimary?: string
    lightPrimaryForeground?: string
    darkPrimary?: string
    darkPrimaryForeground?: string
    themeMode?: 'light' | 'dark' | 'user'
  }
  tabs?: { feedback?: boolean; changelog?: boolean; help?: boolean; chat?: boolean; home?: boolean }
  imageUploadsInWidget?: boolean
  hmacRequired?: boolean
  ticketing?: { enabled?: boolean }
  widgetContextToken?: string
}

export interface ServerConfigContext {
  applicationKey?: string
  environment?: string
  hostOrigin?: string
}

export async function fetchServerConfig(
  instanceUrl: string,
  context: ServerConfigContext = {}
): Promise<ServerConfig> {
  try {
    const url = new URL(`${instanceUrl}/api/widget/config.json`)
    if (context.applicationKey) url.searchParams.set('applicationKey', context.applicationKey)
    if (context.environment) url.searchParams.set('environment', context.environment)
    if (context.hostOrigin) url.searchParams.set('hostOrigin', context.hostOrigin)
    const res = await fetch(url.toString())
    if (!res.ok) return {}
    return (await res.json()) as ServerConfig
  } catch {
    return {}
  }
}
