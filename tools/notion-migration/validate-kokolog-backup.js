'use strict';

const fs = require('fs');
const path = require('path');

const {
  canonicalRecordContent,
  parseNotionDate,
  parseNotionMarkdown,
  sha256,
} = require('./convert-notion-export');

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

function isValidUtc(value) {
  return typeof value === 'string' && UTC_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function isValidLocal(value) {
  if (typeof value !== 'string' || !LOCAL_PATTERN.test(value)) {
    return false;
  }
  const [datePart, timePart] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);
  const checked = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    checked.getUTCFullYear() === year &&
    checked.getUTCMonth() === month - 1 &&
    checked.getUTCDate() === day &&
    checked.getUTCHours() === hour &&
    checked.getUTCMinutes() === minute &&
    checked.getUTCSeconds() === second
  );
}

function validateNotionSources(backup, markdownDir) {
  const markdownFiles = fs
    .readdirSync(markdownDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'));
  const filesByName = new Map(markdownFiles.map((entry) => [entry.name, entry]));
  const referencedFiles = new Set();
  const errors = [];

  for (const record of backup.records) {
    if (!record.source || record.source.kind !== 'notion') {
      continue;
    }

    const fileName = record.source.fileName;
    if (!filesByName.has(fileName)) {
      errors.push(`Source file is missing for ${record.id}: ${fileName}`);
      continue;
    }
    if (referencedFiles.has(fileName)) {
      errors.push(`Source file is referenced more than once: ${fileName}`);
      continue;
    }
    referencedFiles.add(fileName);

    const parsed = parseNotionMarkdown(path.join(markdownDir, fileName));
    const created = parseNotionDate(
      parsed.createdText,
      backup.source.assumedUtcOffsetMinutes,
    );
    const updated = parseNotionDate(
      parsed.updatedText,
      backup.source.assumedUtcOffsetMinutes,
    );

    if (parsed.notionId !== record.source.externalId) {
      errors.push(`Notion ID mismatch for ${fileName}`);
    }
    if (`sha256:${parsed.fileSha256}` !== record.source.fileSha256) {
      errors.push(`Source file hash mismatch for ${fileName}`);
    }
    if (parsed.title !== record.title) {
      errors.push(`Title mismatch for ${fileName}`);
    }
    if (parsed.body !== record.body) {
      errors.push(`Body mismatch for ${fileName}`);
    }
    if (created.local !== record.occurredAtLocal || created.utc !== record.createdAt) {
      errors.push(`Created time mismatch for ${fileName}`);
    }
    if (updated.utc !== record.updatedAt) {
      errors.push(`Updated time mismatch for ${fileName}`);
    }
  }

  const unreferenced = markdownFiles
    .map((entry) => entry.name)
    .filter((fileName) => !referencedFiles.has(fileName));
  if (unreferenced.length > 0) {
    errors.push(`Unreferenced Markdown files: ${unreferenced.join(', ')}`);
  }
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  return {
    notionSourceFiles: markdownFiles.length,
    notionSourceFilesVerified: referencedFiles.size,
  };
}

function validateBackup(backup, options = {}) {
  const errors = [];
  const warnings = [];
  const fail = (message) => errors.push(message);

  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    throw new Error('Backup root must be an object');
  }

  if (backup.format !== 'kokolog-backup') {
    fail('format must be kokolog-backup');
  }
  if (backup.schemaVersion !== 1) {
    fail('schemaVersion must be 1');
  }
  if (!isValidUtc(backup.exportedAt)) {
    fail('exportedAt must be a valid UTC ISO timestamp');
  }
  if (!backup.producer || typeof backup.producer.name !== 'string') {
    fail('producer.name is required');
  }
  if (!backup.source || typeof backup.source.kind !== 'string') {
    fail('source.kind is required');
  }

  for (const collection of ['records', 'tags', 'revisions', 'tombstones']) {
    if (!Array.isArray(backup[collection])) {
      fail(`${collection} must be an array`);
    }
  }
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  if (
    options.expectedRecords !== undefined &&
    backup.records.length !== options.expectedRecords
  ) {
    fail(`records count ${backup.records.length} does not match expected ${options.expectedRecords}`);
  }

  if (
    options.expectedSourceSha256 &&
    backup.source.zipSha256 !== `sha256:${options.expectedSourceSha256.toLowerCase()}`
  ) {
    fail('source ZIP SHA-256 does not match expected value');
  }

  const tagIds = new Set();
  const normalizedTagNames = new Set();
  for (const [index, tag] of backup.tags.entries()) {
    const prefix = `tags[${index}]`;
    if (!tag || typeof tag !== 'object') {
      fail(`${prefix} must be an object`);
      continue;
    }
    if (!ID_PATTERN.test(tag.id || '')) {
      fail(`${prefix}.id is invalid`);
    } else if (tagIds.has(tag.id)) {
      fail(`${prefix}.id is duplicated`);
    } else {
      tagIds.add(tag.id);
    }
    if (typeof tag.name !== 'string' || tag.name.length < 1 || tag.name.length > 100) {
      fail(`${prefix}.name must contain 1 to 100 characters`);
    }
    if (typeof tag.normalizedName !== 'string' || tag.normalizedName.length < 1) {
      fail(`${prefix}.normalizedName is required`);
    } else if (normalizedTagNames.has(tag.normalizedName) && tag.deletedAt === null) {
      fail(`${prefix}.normalizedName duplicates an active tag`);
    } else if (tag.deletedAt === null) {
      normalizedTagNames.add(tag.normalizedName);
    }
    if (!isValidUtc(tag.createdAt) || !isValidUtc(tag.updatedAt)) {
      fail(`${prefix} has an invalid createdAt or updatedAt`);
    }
  }

  const recordIds = new Set();
  const externalIds = new Set();
  let bodyCharacters = 0;
  let emptyBodies = 0;
  let earliestLocal = null;
  let latestLocal = null;

  for (const [index, record] of backup.records.entries()) {
    const prefix = `records[${index}]`;
    if (!record || typeof record !== 'object') {
      fail(`${prefix} must be an object`);
      continue;
    }

    if (!ID_PATTERN.test(record.id || '')) {
      fail(`${prefix}.id is invalid`);
    } else if (recordIds.has(record.id)) {
      fail(`${prefix}.id is duplicated`);
    } else {
      recordIds.add(record.id);
    }

    if (record.schemaVersion !== 1) {
      fail(`${prefix}.schemaVersion must be 1`);
    }
    if (typeof record.title !== 'string' || record.title.length > 300) {
      fail(`${prefix}.title must be a string with at most 300 characters`);
    }
    if (typeof record.body !== 'string' || record.body.length > 100000) {
      fail(`${prefix}.body must be a string with at most 100000 characters`);
    } else {
      bodyCharacters += record.body.length;
      if (record.body.length === 0) {
        emptyBodies += 1;
      }
    }
    if (
      record.mood !== null &&
      (!Number.isInteger(record.mood) || record.mood < 1 || record.mood > 5)
    ) {
      fail(`${prefix}.mood must be null or an integer from 1 to 5`);
    }
    if (!Array.isArray(record.tagIds) || new Set(record.tagIds).size !== record.tagIds.length) {
      fail(`${prefix}.tagIds must be a unique array`);
    } else {
      for (const tagId of record.tagIds) {
        if (!tagIds.has(tagId)) {
          fail(`${prefix}.tagIds references missing tag ${tagId}`);
        }
      }
    }
    if (typeof record.favorite !== 'boolean') {
      fail(`${prefix}.favorite must be boolean`);
    }
    if (!isValidLocal(record.occurredAtLocal)) {
      fail(`${prefix}.occurredAtLocal is invalid`);
    } else {
      earliestLocal =
        earliestLocal === null || record.occurredAtLocal < earliestLocal
          ? record.occurredAtLocal
          : earliestLocal;
      latestLocal =
        latestLocal === null || record.occurredAtLocal > latestLocal
          ? record.occurredAtLocal
          : latestLocal;
    }
    if (
      !Number.isInteger(record.occurredUtcOffsetMinutes) ||
      record.occurredUtcOffsetMinutes < -840 ||
      record.occurredUtcOffsetMinutes > 840
    ) {
      fail(`${prefix}.occurredUtcOffsetMinutes is invalid`);
    }
    if (!isValidUtc(record.createdAt) || !isValidUtc(record.updatedAt)) {
      fail(`${prefix} has an invalid createdAt or updatedAt`);
    } else if (record.updatedAt < record.createdAt) {
      fail(`${prefix}.updatedAt is before createdAt`);
    }
    if (record.deletedAt !== null && !isValidUtc(record.deletedAt)) {
      fail(`${prefix}.deletedAt is invalid`);
    }
    if (!Number.isInteger(record.revision) || record.revision < 1) {
      fail(`${prefix}.revision must be an integer of at least 1`);
    }
    if (!HASH_PATTERN.test(record.contentHash || '')) {
      fail(`${prefix}.contentHash is invalid`);
    } else {
      const expectedHash = `sha256:${sha256(canonicalRecordContent(record))}`;
      if (record.contentHash !== expectedHash) {
        fail(`${prefix}.contentHash does not match record content`);
      }
    }
    if (!record.title && !record.body && record.mood === null) {
      fail(`${prefix} does not satisfy the minimum save condition`);
    }
    if (!record.source || typeof record.source.kind !== 'string') {
      fail(`${prefix}.source.kind is required`);
    } else if (record.source.externalId) {
      if (externalIds.has(record.source.externalId)) {
        fail(`${prefix}.source.externalId is duplicated`);
      } else {
        externalIds.add(record.source.externalId);
      }
    }
  }

  for (const [index, revision] of backup.revisions.entries()) {
    if (!revision || !recordIds.has(revision.recordId)) {
      fail(`revisions[${index}] references a missing record`);
    }
  }

  for (const [index, tombstone] of backup.tombstones.entries()) {
    if (!tombstone || !['record', 'tag'].includes(tombstone.entityType)) {
      fail(`tombstones[${index}].entityType is invalid`);
    }
    if (!ID_PATTERN.test((tombstone && tombstone.entityId) || '')) {
      fail(`tombstones[${index}].entityId is invalid`);
    }
    if (!isValidUtc(tombstone && tombstone.deletedAt)) {
      fail(`tombstones[${index}].deletedAt is invalid`);
    }
  }

  if (backup.records.length === 0) {
    warnings.push('Backup contains no records');
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  return {
    records: backup.records.length,
    tags: backup.tags.length,
    revisions: backup.revisions.length,
    tombstones: backup.tombstones.length,
    emptyBodies,
    bodyCharacters,
    earliestLocal,
    latestLocal,
    warnings,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`Invalid argument near: ${key}`);
    }
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args.input) {
    throw new Error('Missing required argument: --input');
  }

  const inputPath = path.resolve(args.input);
  const content = fs.readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '');
  const backup = JSON.parse(content);
  const summary = validateBackup(backup, {
    expectedRecords: args['expected-records'] ? Number(args['expected-records']) : undefined,
    expectedSourceSha256: args['expected-source-sha256'],
  });
  const sourceSummary = args['markdown-dir']
    ? validateNotionSources(backup, path.resolve(args['markdown-dir']))
    : {};

  const result = {
    file: inputPath,
    fileSha256: `sha256:${sha256(content)}`,
    bytes: Buffer.byteLength(content, 'utf8'),
    ...summary,
    ...sourceSummary,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  isValidLocal,
  isValidUtc,
  validateBackup,
  validateNotionSources,
};
