/**
 * CLI: create the S3 bucket named by S3_BUCKET on S3_ENDPOINT if it is missing.
 * Used by the support suite's setup and the CI jobs that run the storage
 * container (the container starts empty).
 *
 * Usage: bun ensure-storage-bucket.ts
 */
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'

const { S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env
if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
  console.error('S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required')
  process.exit(1)
}

const client = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
})

try {
  try {
    await client.send(new HeadBucketCommand({ Bucket: S3_BUCKET }))
    console.log(JSON.stringify({ bucket: S3_BUCKET, created: false }))
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: S3_BUCKET }))
    console.log(JSON.stringify({ bucket: S3_BUCKET, created: true }))
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
