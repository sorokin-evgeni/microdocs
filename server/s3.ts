import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';

const ENDPOINT = process.env.MICRODOCS_S3_ENDPOINT ?? 'https://storage.mwsapis.ru';
const REGION = process.env.MICRODOCS_S3_REGION ?? 'ru-central1';
const BUCKET = process.env.MICRODOCS_S3_BUCKET ?? 'microdocs-data';

/**
 * Ключ живёт только здесь, на сервере: в браузер он не попадает (NFR-17).
 * Берём его из профиля в `.secrets/`, который лежит вне гита.
 */
const client = new S3Client({
  endpoint: ENDPOINT,
  region: REGION,
  forcePathStyle: true,
  credentials: fromIni({
    profile: process.env.MICRODOCS_AWS_PROFILE ?? 'microdocs',
    filepath: process.env.MICRODOCS_AWS_CREDENTIALS ?? '.secrets/credentials',
  }),
});

export const treeKey = (baseId: string) => `${baseId}/tree.json`;
export const pageKey = (baseId: string, id: string) =>
  `${baseId}/pages/${id}.md`;

/** Возвращает null, если объекта нет — это не ошибка. */
export async function getObject(key: string): Promise<string | null> {
  try {
    const res = await client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    );
    return (await res.Body?.transformToString()) ?? null;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function putObject(
  key: string,
  body: string,
  contentType: string,
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/**
 * Удаление в версионированном бакете ставит delete marker, прежние версии
 * остаются — на них и держится история (NFR-7).
 */
export async function deleteObject(key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    ?.$metadata?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}
