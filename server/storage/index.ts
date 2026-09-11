import type { BaseStorage } from './port';
import { createS3Storage } from './s3Storage';

/**
 * Выбор хранилища. Добавить Postgres — значит написать ещё один адаптер
 * под `BaseStorage` и дописать сюда ветку; ни API, ни клиент не меняются.
 */
export function createStorage(): BaseStorage {
  const backend = process.env.MICRODOCS_BACKEND ?? 's3';

  switch (backend) {
    case 's3':
      return createS3Storage();
    default:
      throw new Error(`Неизвестное хранилище: ${backend}`);
  }
}

export type { BaseStorage } from './port';
