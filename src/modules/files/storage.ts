import { randomUUID } from "node:crypto";

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { config } from "../../config.js";
import { AppError } from "../../http/errors.js";

let client: S3Client | undefined;

function storageClient(): S3Client {
  if (!config.files.accessKeyId || !config.files.bucket || !config.files.secretAccessKey) {
    throw new AppError(503, "BACKEND_UNAVAILABLE");
  }
  if (!client) {
    client = new S3Client({
      credentials: { accessKeyId: config.files.accessKeyId, secretAccessKey: config.files.secretAccessKey },
      ...(config.files.endpoint ? { endpoint: config.files.endpoint } : {}),
      forcePathStyle: Boolean(config.files.endpoint),
      region: config.files.region,
    });
  }
  return client;
}

function objectKey(purpose: "PRODUCT_IMAGE" | "SELLER_DOCUMENT" | "USER_AVATAR", filename: string): string {
  const extension = filename.toLowerCase().match(/\.[a-z0-9]{1,10}$/)?.[0] ?? "";
  return `${purpose.toLowerCase()}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
}

export async function storeFile(input: {
  body: Buffer;
  contentType: string;
  originalFilename: string;
  purpose: "PRODUCT_IMAGE" | "SELLER_DOCUMENT" | "USER_AVATAR";
}): Promise<string> {
  const key = objectKey(input.purpose, input.originalFilename);
  await storageClient().send(new PutObjectCommand({
    Body: input.body,
    Bucket: config.files.bucket,
    ContentType: input.contentType,
    Key: key,
  }));
  return key;
}

export async function deleteStoredFile(key: string): Promise<void> {
  await storageClient().send(new DeleteObjectCommand({ Bucket: config.files.bucket, Key: key }));
}

export async function createReadUrl(key: string): Promise<string> {
  return getSignedUrl(storageClient(), new GetObjectCommand({ Bucket: config.files.bucket, Key: key }), { expiresIn: 300 });
}
