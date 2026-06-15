// Plain config with no Node.js deps — re-exported here so client code
// does not reach into lib/server/
export type { AuthProviderDefinition } from '@/lib/server/auth/auth-providers'
export {
  AUTH_PROVIDERS,
  getAuthProvider,
  getAuthProviderByProviderId,
  getAllAuthProviders,
  isAuthProviderCredentialType,
  credentialTypeForProvider,
  authProviderCallbackPath,
} from '@/lib/server/auth/auth-providers'
