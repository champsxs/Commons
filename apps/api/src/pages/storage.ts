import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "../config.ts";

const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId: config.s3.accessKey, secretAccessKey: config.s3.secretKey },
});

let ready: Promise<void> | undefined;
export function ensureBucket() {
  ready ??= (async () => {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
    } catch {
      await s3.send(new CreateBucketCommand({ Bucket: config.s3.bucket }));
    }
  })();
  return ready;
}

export async function putObject(key: string, body: string | Buffer, contentType: string) {
  await ensureBucket();
  await s3.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function getObject(key: string): Promise<Buffer | null> {
  await ensureBucket();
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  } catch (e: any) {
    if (e.name === "NoSuchKey") return null;
    throw e;
  }
}
