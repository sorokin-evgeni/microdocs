import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';
import type { PageId } from '../../shared/types';
import type { BaseStorage, DocMeta, DocRef, WriteMeta } from './port';

/**
 * Адаптер к S3. Только здесь известно, что база — это объекты в бакете:
 *
 *   <baseId>/tree.json       структура
 *   <baseId>/pages/<id>.md   тело страницы
 *   <baseId>/assets/<путь>   вложения; пока их кладут только импорты
 *
 * Ключ к бакету живёт только на сервере и в браузер не попадает (NFR-17).
 * История версий держится на версионировании объектов (NFR-7), поэтому
 * удаление страницы — обычный DELETE: прежние версии остаются. Насовсем
 * удаляются только промежуточные версии одной серии правок (deleteDocVersion).
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
  const docKey = (baseId: string, ref: DocRef) =>
    ref.kind === 'tree' ? treeKey(baseId) : pageKey(baseId, ref.id);
  const docType = (ref: DocRef) =>
    ref.kind === 'tree' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8';

  return {
    async readDoc(baseId, ref) {
      try {
        const res = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: docKey(baseId, ref) }),
        );
        const body = (await res.Body?.transformToString()) ?? '';
        return { body, meta: fromS3(res.Metadata, res.VersionId) };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async headDoc(baseId, ref) {
      try {
        const res = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: docKey(baseId, ref) }),
        );
        return fromS3(res.Metadata, res.VersionId);
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async writeDoc(baseId, ref, body, meta) {
      const res = await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: docKey(baseId, ref),
          Body: body,
          ContentType: docType(ref),
          Metadata: toS3(meta),
        }),
      );
      return res.VersionId ?? null;
    },
    async deleteDocVersion(baseId, ref, versionId) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: docKey(baseId, ref),
          VersionId: versionId,
        }),
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

/**
 * Метаданные версии лежат в пользовательских метаданных объекта
 * (`x-amz-meta-*`): тело остаётся чистым Markdown или JSON.
 * У объектов, записанных до появления версий, их нет — это версия 0.
 */
function toS3(meta: WriteMeta): Record<string, string> {
  const out: Record<string, string> = { rev: String(meta.rev) };
  if (meta.device) out.device = meta.device;
  if (meta.burstStart !== null) out['burst-start'] = String(meta.burstStart);
  return out;
}

function fromS3(metadata: Record<string, string> | undefined, versionId: string | undefined): DocMeta {
  const number = (value: string | undefined) => {
    const n = Number(value);
    return value !== undefined && Number.isFinite(n) ? n : null;
  };
  return {
    rev: number(metadata?.rev) ?? 0,
    device: metadata?.device || null,
    burstStart: number(metadata?.['burst-start']),
    versionId: versionId ?? null,
  };
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    ?.$metadata?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}
