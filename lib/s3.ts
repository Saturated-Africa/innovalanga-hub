import { S3Client } from '@aws-sdk/client-s3'

/**
 * Shared S3 client.
 *
 * Credentials come from the AWS default provider chain. That is the whole point
 * of this module: the previous code passed `accessKeyId` and `secretAccessKey`
 * explicitly at module scope, which bypasses the chain entirely and therefore
 * makes an EC2 instance role impossible to use. Long-lived static keys in the
 * environment are also the thing you least want on a platform holding personal
 * information.
 *
 * SDK v3 rather than v2: v2 reached end of support in July 2025, and measured
 * 99 MB on disk here for three S3 calls.
 */
let client: S3Client | null = null

export function getS3(): S3Client {
  if (!client) {
    client = new S3Client({
      // af-south-1 is an opt-in region and is SigV4 only. v3 signs with SigV4
      // unconditionally, which also removes the asymmetry the old code had,
      // where one route set signatureVersion 'v4' and the other did not.
      region: process.env.AWS_REGION ?? 'af-south-1',
    })
  }
  return client
}

export function bucket(): string {
  const name = process.env.AWS_S3_BUCKET
  if (!name) throw new Error('AWS_S3_BUCKET is not set')
  return name
}

/** Presigned URL lifetime, in seconds. */
export const PRESIGN_TTL = 300
