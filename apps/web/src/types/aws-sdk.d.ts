/**
 * Type declarations for AWS SDK modules.
 * These are used when the AWS SDK packages aren't properly linked by the package manager.
 * The actual implementation will dynamically import the modules at runtime.
 */

declare module '@aws-sdk/client-s3' {
  export class S3Client {
    constructor(config: {
      region: string
      endpoint?: string
      forcePathStyle?: boolean
      credentials: {
        accessKeyId: string
        secretAccessKey: string
      }
    })
  }

  export class PutObjectCommand {
    constructor(input: { Bucket: string; Key: string; ContentType: string })
  }
}

declare module '@aws-sdk/s3-request-presigner' {
  import type { S3Client } from '@aws-sdk/client-s3'

  export function getSignedUrl(
    client: S3Client,
    command: unknown,
    options: { expiresIn: number }
  ): Promise<string>
}
