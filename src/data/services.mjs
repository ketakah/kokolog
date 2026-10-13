import { DraftsRepository } from './drafts-repository.mjs';
import { openVerifiedDatabase } from './safety-guard.mjs';
import { RecordsRepository } from './records-repository.mjs';
import { TagsRepository } from './tags-repository.mjs';
import { SettingsRepository } from './settings-repository.mjs';
import * as backup from './backup-service.mjs';
import * as storage from './storage-service.mjs';

export async function createDataServices() {
  const verified = await openVerifiedDatabase();
  const records = new RecordsRepository(verified.database);
  const expiredRevisions = await records.cleanupExpiredRevisions();
  const purgedTrash = await records.purgeExpiredTrash();
  const maintenanceWarnings = [];
  if (expiredRevisions > 0) {
    maintenanceWarnings.push(`期限切れの編集履歴${expiredRevisions}件を整理しました。`);
  }
  if (purgedTrash > 0) {
    maintenanceWarnings.push(`30日を過ぎたゴミ箱の記録${purgedTrash}件を完全削除しました。`);
  }
  return {
    database: verified.database,
    records,
    tags: new TagsRepository(verified.database),
    drafts: new DraftsRepository(verified.database),
    settings: new SettingsRepository(verified.database),
    backup,
    storage,
    warnings: [...verified.warnings, ...maintenanceWarnings],
  };
}
