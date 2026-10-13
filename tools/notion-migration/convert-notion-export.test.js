'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  addContentHash,
  convertNotionExport,
  markdownToPlainText,
  notionRecordId,
  parseCsv,
  parseNotionDate,
  parseNotionMarkdown,
} = require('./convert-notion-export');
const {
  validateBackup,
  validateNotionSources,
} = require('./validate-kokolog-backup');

const tests = [];

function test(name, run) {
  tests.push({ name, run });
}

test('parseCsv handles BOM, commas, quotes, and multiline values', () => {
  const csv = '\uFEFFName,Created,Tags,Updated\n"Title, one","Date A","tag1, tag2","Date B"\n"Two","Date C","line ""quoted""","Date D"\n';
  assert.deepStrictEqual(parseCsv(csv), [
    {
      Name: 'Title, one',
      Created: 'Date A',
      Tags: 'tag1, tag2',
      Updated: 'Date B',
    },
    {
      Name: 'Two',
      Created: 'Date C',
      Tags: 'line "quoted"',
      Updated: 'Date D',
    },
  ]);
});

test('parseNotionDate converts local JST to UTC without losing local text', () => {
  const parsed = parseNotionDate('November 7, 2011 2:00 PM', 540);
  assert.strictEqual(parsed.local, '2011-11-07T14:00:00');
  assert.strictEqual(parsed.utc, '2011-11-07T05:00:00.000Z');

  const midnight = parseNotionDate('January 30, 2017 12:32 AM', 540);
  assert.strictEqual(midnight.local, '2017-01-30T00:32:00');
  assert.strictEqual(midnight.utc, '2017-01-29T15:32:00.000Z');
});

test('markdownToPlainText removes formatting while preserving readable structure', () => {
  const markdown = [
    '**Keywords**',
    '',
    '- item',
    '    - child',
    '- [ ] todo',
    '- [x] done',
    '[label](https://example.com)',
    '<keep this text>',
  ].join('\n');

  assert.strictEqual(
    markdownToPlainText(markdown),
    [
      'Keywords',
      '',
      '- item',
      '    - child',
      '☐ todo',
      '☑ done',
      'label (https://example.com)',
      '<keep this text>',
    ].join('\n'),
  );
});

test('notionRecordId is deterministic', () => {
  const notionId = '6942683b04ca83bea5fd8107510365f8';
  assert.strictEqual(notionRecordId(notionId), `notion_${notionId}`);
  assert.strictEqual(notionRecordId(notionId.toUpperCase()), `notion_${notionId}`);
});

test('content hash is stable and changes with record content', () => {
  const record = {
    title: 'Title',
    body: 'Body',
    mood: null,
    tagIds: ['b', 'a', 'a'],
    favorite: false,
    occurredAtLocal: '2026-10-11T22:10:00',
    occurredUtcOffsetMinutes: 540,
    deletedAt: null,
  };
  const first = addContentHash(record);
  const second = addContentHash({ ...record, tagIds: ['a', 'b'] });
  assert.strictEqual(first.contentHash, second.contentHash);

  const changed = addContentHash({ ...record, body: 'Changed' });
  assert.notStrictEqual(first.contentHash, changed.contentHash);
});

test('parseNotionMarkdown reads metadata and body', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kokolog-md-test-'));
  const filePath = path.join(root, 'Sample 11111111111111111111111111111111.md');
  fs.writeFileSync(
    filePath,
    '# Sample\n\nCreated: November 7, 2011 2:00 PM\nUpdated: November 8, 2011 6:10 PM\n\n**Body**\n',
    'utf8',
  );
  try {
    const parsed = parseNotionMarkdown(filePath);
    assert.strictEqual(parsed.notionId, '11111111111111111111111111111111');
    assert.strictEqual(parsed.title, 'Sample');
    assert.strictEqual(parsed.body, 'Body');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('convertNotionExport validates one-to-one mapping and creates stable records', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kokolog-convert-test-'));
  const csvPath = path.join(root, 'export_all.csv');
  const markdownDir = path.join(root, 'markdown');
  fs.mkdirSync(markdownDir);
  fs.writeFileSync(
    csvPath,
    [
      'Name,Created,Tags,Updated',
      'First,"November 7, 2011 2:00 PM","work, insight","November 8, 2011 6:10 PM"',
      'Second,"January 2, 2025 11:44 PM",,"January 2, 2025 11:53 PM"',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(markdownDir, 'First 11111111111111111111111111111111.md'),
    '# First\n\nCreated: November 7, 2011 2:00 PM\nUpdated: November 8, 2011 6:10 PM\n\n- [ ] First body\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(markdownDir, 'Second 22222222222222222222222222222222.md'),
    '# Second\n\nCreated: January 2, 2025 11:44 PM\nUpdated: January 2, 2025 11:53 PM\n\nSecond body\n',
    'utf8',
  );

  try {
    const result = convertNotionExport({
      csvPath,
      markdownDir,
      zipSha256: 'a'.repeat(64),
      utcOffsetMinutes: 540,
      exportedAt: '2026-10-11T14:00:00.000Z',
    });

    assert.strictEqual(result.summary.csvRows, 2);
    assert.strictEqual(result.summary.markdownFiles, 2);
    assert.strictEqual(result.summary.convertedRecords, 2);
    assert.strictEqual(result.summary.tags, 2);
    assert.strictEqual(result.backup.records[0].id, 'notion_11111111111111111111111111111111');
    assert.strictEqual(result.backup.records[0].body, '☐ First body');
    assert.strictEqual(result.backup.records[0].occurredAtLocal, '2011-11-07T14:00:00');
    assert.strictEqual(result.backup.records[1].id, 'notion_22222222222222222222222222222222');
    assert.strictEqual(result.backup.source.zipSha256, `sha256:${'a'.repeat(64)}`);
    assert.strictEqual(validateBackup(result.backup, { expectedRecords: 2 }).records, 2);
    assert.deepStrictEqual(validateNotionSources(result.backup, markdownDir), {
      notionSourceFiles: 2,
      notionSourceFilesVerified: 2,
    });

    const corrupted = JSON.parse(JSON.stringify(result.backup));
    corrupted.records[0].body = 'Tampered';
    assert.throws(() => validateBackup(corrupted), /contentHash does not match/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

let failed = 0;
for (const { name, run } of tests) {
  try {
    run();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stderr.write(`FAIL ${name}\n${error.stack || error.message}\n`);
  }
}

if (failed > 0) {
  process.exitCode = 1;
} else {
  process.stdout.write(`\n${tests.length} tests passed\n`);
}
