import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';
import type { PageId, Tree } from '../../shared/types';
import type { BaseStorage } from './port';

/**
 * Адаптер к S3. Только здесь известно, что база — это объекты в бакете:
 *
 *   <baseId>/tree.json       структура
 *   <baseId>/pages/<id>.md   тело страницы
 *   <baseId>/assets/<путь>   вложения; пока их кладут только импорты
 *
 * Ключ к бакету живёт только на сервере и в браузер не попадает (NFR-17).
 * История версий держится на версионировании объектов (NFR-7), поэтому
 * удаление здесь — обычный DELETE: прежние версии остаются.
 */
export function createS3Storage(): BaseStorage {
  const bucket = process.env.MICRODOCS_S3_BUCKET ?? 'microdocs-data';

  const client = new S3Client({
    endpoint: process.env.MICRODOCS_S3_ENDPOINT ?? 'https://storage.mwsapis.ru',
    region: process.env.MICRODOCS_S3_REGION ?? 'ru-central1',
    forcePathStyle: true,
    credentials: fromIni({
      profile: process.env.MICRODOCS_AWS_PROFILE ?? 'microdocs',
      filepath: process.env.MICRODOCS_AWS_CREDENTIALS ?? '.secrets/credentials',
    }),
  });

  const treeKey = (baseId: string) => `${baseId}/tree.json`;
  const pageKey = (baseId: string, id: PageId) => `${baseId}/pages/${id}.md`;
  const assetKey = (baseId: string, path: string) => `${baseId}/assets/${path}`;

  async function get(key: string): Promise<string | null> {
    try {
      const res = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      return (await res.Body?.transformToString()) ?? null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function put(key: string, body: string, contentType: string) {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  return {
    async readTree(baseId) {
      const text = await get(treeKey(baseId));
      return text === null ? null : (JSON.parse(text) as Tree);
    },

    async writeTree(baseId, tree) {
      await put(
        treeKey(baseId),
        JSON.stringify(tree, null, 2),
        'application/json; charset=utf-8',
      );
    },

    readPage(baseId, pageId) {
      return get(pageKey(baseId, pageId));
    },

    async writePage(baseId, pageId, markdown) {
      await put(
        pageKey(baseId, pageId),
        markdown,
        'text/markdown; charset=utf-8',
      );
    },

    async deletePage(baseId, pageId) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: pageKey(baseId, pageId),
        }),
      );
    },

    // Файл читается в память целиком: вложения — картинки и документы на мегабайты.
    async readAsset(baseId, path) {
      try {
        const res = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: assetKey(baseId, path) }),
        );
        const body = await res.Body?.transformToByteArray();
        return body ? { body, contentType: res.ContentType ?? null } : null;
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
  };
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    ?.$metadata?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}
