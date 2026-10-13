import assert from 'assert';
import { webcrypto } from 'crypto';
import fs from 'fs';
import path from 'path';

import { validateBackupEnvelope } from '../../src/domain/backup.mjs';
import { addContentHash } from '../../src/domain/record.mjs';

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const [sourcePath, outputDirectory] = process.argv.slice(2);
if (!sourcePath || !outputDirectory) {
  throw new Error('Usage: node generate-m4-fixtures.mjs <source.json> <output-directory>');
}

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
assert.ok(source.records.length > 0, 'Source backup must contain records');
fs.mkdirSync(outputDirectory, { recursive: true });

const conflict = JSON.parse(JSON.stringify(source));
conflict.exportedAt = new Date().toISOString();
conflict.records[0] = await addContentHash({
  ...conflict.records[0],
  body: `${conflict.records[0].body}\n競合検証`,
});
assert.strictEqual((await validateBackupEnvelope(conflict)).valid, true);

const singleRecord = JSON.parse(JSON.stringify(source));
singleRecord.exportedAt = new Date().toISOString();
singleRecord.records = [singleRecord.records[0]];
singleRecord.tags = singleRecord.tags.filter((tag) =>
  singleRecord.records[0].tagIds.includes(tag.id),
);
singleRecord.revisions = singleRecord.revisions.filter(
  (revision) => revision.recordId === singleRecord.records[0].id,
);
assert.strictEqual((await validateBackupEnvelope(singleRecord)).valid, true);

const corrupted = JSON.parse(JSON.stringify(singleRecord));
corrupted.records[0].body = `${corrupted.records[0].body}\nハッシュ不一致`;
assert.strictEqual((await validateBackupEnvelope(corrupted)).valid, false);

const exportedAtMilliseconds = Date.parse(source.exportedAt);
const tombstoneTime = new Date(exportedAtMilliseconds - 60000).toISOString();
const incomingTime = new Date(exportedAtMilliseconds - 30000).toISOString();

const tombstoneDelete = JSON.parse(JSON.stringify(source));
const deletedRecord = tombstoneDelete.records.shift();
tombstoneDelete.tombstones.push({
  entityType: 'record',
  entityId: deletedRecord.id,
  deletedAt: tombstoneTime,
  source: {
    kind: 'test',
    externalId: deletedRecord.source?.externalId || null,
  },
});
assert.strictEqual((await validateBackupEnvelope(tombstoneDelete)).valid, true);

const intermediateTombstone = JSON.parse(JSON.stringify(source));
intermediateTombstone.records[0] = await addContentHash({
  ...intermediateTombstone.records[0],
  body: `${intermediateTombstone.records[0].body}\n墓標より新しい本文`,
  updatedAt: incomingTime,
});
intermediateTombstone.tombstones.push({
  entityType: 'record',
  entityId: intermediateTombstone.records[0].id,
  deletedAt: tombstoneTime,
  source: {
    kind: 'test',
    externalId: intermediateTombstone.records[0].source?.externalId || null,
  },
});
assert.strictEqual((await validateBackupEnvelope(intermediateTombstone)).valid, true);

const outputs = [
  ['conflict-test.json', conflict],
  ['single-record-test.json', singleRecord],
  ['corrupted-hash-test.json', corrupted],
  ['tombstone-delete-test.json', tombstoneDelete],
  ['intermediate-tombstone-test.json', intermediateTombstone],
];
for (const [fileName, value] of outputs) {
  fs.writeFileSync(
    path.join(outputDirectory, fileName),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

process.stdout.write(
  `${JSON.stringify(
    {
      sourceRecords: source.records.length,
      outputDirectory,
      files: outputs.map(([fileName]) => fileName),
    },
    null,
    2,
  )}\n`,
);
