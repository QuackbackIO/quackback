import { importSPKI, jwtVerify } from 'jose'

function normalizePem(value: string): string {
  return value.includes('\\n') ? value.replaceAll('\\n', '\n') : value
}

export async function verifyWorkspaceProjectionToken<T>(options: {
  token: string
  publicKeyPem?: string
  audience: string
  type: string
  claim: string
  parse: (value: unknown) => T | null
  errorPrefix: string
}): Promise<{ workspaceKey: string; projection: T }> {
  if (!options.publicKeyPem) throw new Error(`${options.errorPrefix}_key_missing`)
  const publicKey = await importSPKI(normalizePem(options.publicKeyPem), 'EdDSA')
  const { payload } = await jwtVerify(options.token, publicKey, {
    algorithms: ['EdDSA'],
    issuer: 'quackback-control-plane',
    audience: options.audience,
    typ: options.type,
    requiredClaims: ['iat', 'workspaceKey', options.claim],
  })
  if (typeof payload.workspaceKey !== 'string' || payload.workspaceKey.length === 0) {
    throw new Error(`${options.errorPrefix}_workspace_missing`)
  }
  const projection = options.parse(payload[options.claim])
  if (!projection) throw new Error(`${options.errorPrefix}_invalid`)
  return { workspaceKey: payload.workspaceKey, projection }
}
