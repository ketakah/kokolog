'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TOOL_NAME = 'kokolog-notion-migration';
const TOOL_VERSION = '1.0.0';
const RECORD_SCHEMA_VERSION = 1;
const BACKUP_SCHEMA_VERSION = 1;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const NOTION_FILE_PATTERN = /^(.*) ([0-9a-f]{32})\.md$/i;
const MONTHS = new Map([
  ['January', 0],
  ['February', 1],
  ['March', 2],
  ['April', 3],
  ['May', 4],
  ['June', 5],
  ['July', 6],
  ['August', 7],
  ['September', 8],
  ['October', 9],
  ['November', 10],
  ['December', 11],
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeNewlines(value) {
  return value.replace(/\r\n?/g, '\n');
}

function normalizeTagName(value) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('ja-JP');
}

function parseCsv(text) {
  const source = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      if (row.some((value) => value !== '')) {
        rows.push(row);
      }
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (inQuotes) {
    throw new Error('CSV contains an unterminated quoted field');
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((value) => value !== '')) {
      rows.push(row);
    }
  }

  if (rows.length === 0) {
    throw new Error('CSV is empty');
  }

  const headers = rows.shift();
  if (new Set(headers).size !== headers.length) {
    throw new Error('CSV contains duplicate column names');
  }

  return rows.map((values, rowIndex) => {
    if (values.length !== headers.length) {
      throw new Error(
        `CSV row ${rowIndex + 2} has ${values.length} columns; expected ${headers.length}`,
      );
    }
    return Object.fromEntries(headers.map((header, columnIndex) => [header, values[columnIndex]]));
  });
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function parseNotionDate(value, utcOffsetMinutes) {
  const match = /^([A-Za-z]+) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (AM|PM)$/.exec(value);
  if (!match) {
    throw new Error(`Unsupported Notion date: ${value}`);
  }

  const month = MONTHS.get(match[1]);
  if (month === undefined) {
    throw new Error(`Unsupported month in Notion date: ${value}`);
  }

  const day = Number(match[2]);
  const year = Number(match[3]);
  let hour = Number(match[4]);
  const minute = Number(match[5]);
  const meridiem = match[6];

  if (hour === 12) {
    hour = 0;
  }
  if (meridiem === 'PM') {
    hour += 12;
  }

  const localCalendarDate = new Date(Date.UTC(year, month, day, hour, minute, 0, 0));
  if (
    localCalendarDate.getUTCFullYear() !== year ||
    localCalendarDate.getUTCMonth() !== month ||
    localCalendarDate.getUTCDate() !== day ||
    localCalendarDate.getUTCHours() !== hour ||
    localCalendarDate.getUTCMinutes() !== minute
  ) {
    throw new Error(`Invalid Notion date: ${value}`);
  }

  const utcMilliseconds = localCalendarDate.getTime() - utcOffsetMinutes * 60 * 1000;
  const utcDate = new Date(utcMilliseconds);

  return {
    local: `${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`,
    utc: utcDate.toISOString(),
  };
}

function markdownToPlainText(markdown) {
  let text = normalizeNewlines(markdown).trim();

  text = text
    .replace(/^(\s*)-\s+\[ \]\s+/gm, '$1☐ ')
    .replace(/^(\s*)-\s+\[[xX]\]\s+/gm, '$1☑ ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => (alt ? `${alt} (${url})` : url))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

function parseNotionMarkdown(filePath) {
  const fileName = path.basename(filePath);
  const fileMatch = NOTION_FILE_PATTERN.exec(fileName);
  if (!fileMatch) {
    throw new Error(`Markdown filename does not contain a Notion page ID: ${fileName}`);
  }

  const markdown = normalizeNewlines(fs.readFileSync(filePath, 'utf8')).replace(/^\uFEFF/, '');
  const lines = markdown.split('\n');
  if (!lines[0] || !lines[0].startsWith('# ')) {
    throw new Error(`Markdown does not start with an H1 title: ${fileName}`);
  }

  const title = lines[0].slice(2).trim();
  const createdIndex = lines.findIndex((line, index) => index > 0 && line.startsWith('Created: '));
  const updatedIndex = lines.findIndex((line, index) => index > 0 && line.startsWith('Updated: '));
  if (createdIndex < 0 || updatedIndex < 0 || updatedIndex < createdIndex) {
    throw new Error(`Markdown metadata is incomplete: ${fileName}`);
  }

  let bodyStart = updatedIndex + 1;
  while (bodyStart < lines.length && lines[bodyStart].trim() === '') {
    bodyStart += 1;
  }

  const bodyMarkdown = lines.slice(bodyStart).join('\n').trim();
  return {
    notionId: fileMatch[2].toLowerCase(),
    fileName,
    title,
    createdText: lines[createdIndex].slice('Created: '.length).trim(),
    updatedText: lines[updatedIndex].slice('Updated: '.length).trim(),
    bodyMarkdown,
    body: markdownToPlainText(bodyMarkdown),
    fileSha256: sha256(markdown),
  };
}

function notionRecordId(notionId) {
  const id = `notion_${notionId.toLowerCase()}`;
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Generated record ID is invalid: ${id}`);
  }
  return id;
}

function canonicalRecordContent(record) {
  return JSON.stringify({
    title: record.title,
    body: record.body,
    mood: record.mood,
    tagIds: [...new Set(record.tagIds)].sort(),
    favorite: record.favorite,
    occurredAtLocal: record.occurredAtLocal,
    occurredUtcOffsetMinutes: record.occurredUtcOffsetMinutes,
    deletedAt: record.deletedAt,
  });
}

function addContentHash(record) {
  return {
    ...record,
    contentHash: `sha256:${sha256(canonicalRecordContent(record))}`,
  };
}

function rowKey(title, createdText, updatedText) {
  return `${title}\u0000${createdText}\u0000${updatedText}`;
}

function createTag(name, now) {
  const normalizedName = normalizeTagName(name);
  const id = `notion_tag_${sha256(normalizedName).slice(0, 20)}`;
  return {
    id,
    schemaVersion: RECORD_SCHEMA_VERSION,
    name: name.trim(),
    normalizedName,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

function splitTags(value) {
  if (!value.trim()) {
    return [];
  }
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function convertNotionExport(options) {
  const {
    csvPath,
    markdownDir,
    zipSha256,
    utcOffsetMinutes = 540,
    exportedAt = new Date().toISOString(),
  } = options;

  const csvText = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(csvText);
  const expectedColumns = ['Name', 'Created', 'Tags', 'Updated'];
  for (const column of expectedColumns) {
    if (!rows.every((row) => Object.prototype.hasOwnProperty.call(row, column))) {
      throw new Error(`CSV is missing required column: ${column}`);
    }
  }

  const rowMap = new Map();
  for (const [index, row] of rows.entries()) {
    const key = rowKey(row.Name, row.Created, row.Updated);
    if (rowMap.has(key)) {
      throw new Error(`CSV contains an ambiguous duplicate at row ${index + 2}: ${row.Name}`);
    }
    rowMap.set(key, { ...row, rowNumber: index + 2 });
  }

  const markdownPaths = fs
    .readdirSync(markdownDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => path.join(markdownDir, entry.name));

  const tagsByNormalizedName = new Map();
  const records = [];
  const auditRows = [];
  const seenIds = new Set();

  for (const markdownPath of markdownPaths) {
    const parsed = parseNotionMarkdown(markdownPath);
    const key = rowKey(parsed.title, parsed.createdText, parsed.updatedText);
    const csvRow = rowMap.get(key);
    if (!csvRow) {
      throw new Error(`No CSV row matches Markdown metadata: ${parsed.fileName}`);
    }
    rowMap.delete(key);

    const id = notionRecordId(parsed.notionId);
    if (seenIds.has(id)) {
      throw new Error(`Duplicate Notion page ID: ${parsed.notionId}`);
    }
    seenIds.add(id);

    const created = parseNotionDate(parsed.createdText, utcOffsetMinutes);
    const updated = parseNotionDate(parsed.updatedText, utcOffsetMinutes);
    if (updated.utc < created.utc) {
      throw new Error(`Updated time is before created time: ${parsed.fileName}`);
    }

    const tagIds = [];
    for (const tagName of splitTags(csvRow.Tags)) {
      const normalizedName = normalizeTagName(tagName);
      if (!tagsByNormalizedName.has(normalizedName)) {
        tagsByNormalizedName.set(normalizedName, createTag(tagName, created.utc));
      }
      tagIds.push(tagsByNormalizedName.get(normalizedName).id);
    }

    const record = addContentHash({
      id,
      schemaVersion: RECORD_SCHEMA_VERSION,
      title: parsed.title.slice(0, 300),
      body: parsed.body.slice(0, 100000),
      mood: null,
      tagIds: [...new Set(tagIds)].sort(),
      favorite: false,
      occurredAtLocal: created.local,
      occurredUtcOffsetMinutes: utcOffsetMinutes,
      createdAt: created.utc,
      updatedAt: updated.utc,
      deletedAt: null,
      revision: 1,
      source: {
        kind: 'notion',
        externalId: parsed.notionId,
        fileName: parsed.fileName,
        fileSha256: `sha256:${parsed.fileSha256}`,
      },
    });

    records.push(record);
    auditRows.push({
      id,
      title: parsed.title,
      occurredAtLocal: created.local,
      updatedAt: updated.utc,
      bodyLength: parsed.body.length,
      bodyPreview: parsed.body.slice(0, 160),
      tagCount: tagIds.length,
      sourceFile: parsed.fileName,
      status: 'success',
    });
  }

  if (rowMap.size > 0) {
    const unmatchedRows = [...rowMap.values()].map((row) => `row ${row.rowNumber}: ${row.Name}`);
    throw new Error(`CSV rows have no matching Markdown file:\n${unmatchedRows.join('\n')}`);
  }

  records.sort((left, right) => {
    const dateOrder = left.occurredAtLocal.localeCompare(right.occurredAtLocal);
    return dateOrder || left.id.localeCompare(right.id);
  });
  auditRows.sort((left, right) => {
    const dateOrder = left.occurredAtLocal.localeCompare(right.occurredAtLocal);
    return dateOrder || left.id.localeCompare(right.id);
  });

  const tags = [...tagsByNormalizedName.values()].sort((left, right) =>
    left.normalizedName.localeCompare(right.normalizedName, 'ja'),
  );

  const backup = {
    format: 'kokolog-backup',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: null,
    producer: {
      name: TOOL_NAME,
      version: TOOL_VERSION,
    },
    exportedAt,
    scope: {
      type: 'all',
      fromLocal: null,
      toLocal: null,
    },
    source: {
      kind: 'notion-export',
      zipSha256: `sha256:${zipSha256.toLowerCase()}`,
      csvFile: path.basename(csvPath),
      markdownCount: markdownPaths.length,
      assumedUtcOffsetMinutes: utcOffsetMinutes,
    },
    records,
    tags,
    revisions: [],
    tombstones: [],
    settings: {
      theme: 'system',
    },
  };

  return {
    backup,
    auditRows,
    summary: {
      csvRows: rows.length,
      markdownFiles: markdownPaths.length,
      convertedRecords: records.length,
      tags: tags.length,
      emptyBodies: records.filter((record) => record.body.length === 0).length,
      earliestLocal: records[0] ? records[0].occurredAtLocal : null,
      latestLocal: records.length > 0 ? records[records.length - 1].occurredAtLocal : null,
    },
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function createReportHtml(result) {
  const { summary, auditRows, backup } = result;
  const rows = auditRows
    .map((row, index) => `<tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(row.occurredAtLocal.replace('T', ' '))}</td>
      <td>${escapeHtml(row.title)}</td>
      <td>${escapeHtml(row.bodyPreview)}</td>
      <td>${row.bodyLength}</td>
      <td>${escapeHtml(row.status)}</td>
    </tr>`)
    .join('');

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ここログ Notion移行レポート</title>
  <script>
    (() => {
      const param = new URLSearchParams(window.location.search).get("scoutTheme");
      const theme =
        param || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      document.documentElement.setAttribute("data-theme", theme);
    })();
  </script>
  <style>
    :root {
      color-scheme: light;
      --cp-bg: #f7f4ef;
      --cp-bg-elevated: #fcfbf8;
      --cp-surface: #ffffff;
      --cp-surface-soft: #f5f5f5;
      --cp-border: #dedede;
      --cp-border-strong: #919191;
      --cp-text: #242424;
      --cp-text-muted: #5c5c5c;
      --cp-text-soft: #6f6f6f;
      --cp-accent: #b11f4b;
      --cp-accent-hover: #9a1a41;
      --cp-accent-soft: rgba(177, 31, 75, 0.08);
      --cp-accent-fg: #ffffff;
      --cp-success: #16a34a;
      --cp-danger: #dc2626;
      --cp-warning: #f59e0b;
      --cp-link: #0078d4;
      --cp-shadow: 0 18px 48px rgba(0, 0, 0, 0.12);
      --cp-overlay: rgba(255, 255, 255, 0.8);
      --cp-panel: rgba(255, 255, 255, 0.86);
      --cp-panel-strong: rgba(255, 255, 255, 0.96);
      --cp-sheen: rgba(255, 255, 255, 0.55);
      --cp-highlight: rgba(177, 31, 75, 0.12);
      --cp-app-accent: #397b91;
      --cp-app-accent-soft: rgba(57, 123, 145, 0.1);
    }
    html[data-theme="dark"] {
      color-scheme: dark;
      --cp-bg: #3d3b3a;
      --cp-bg-elevated: #343231;
      --cp-surface: #292929;
      --cp-surface-soft: #2e2e2e;
      --cp-border: #474747;
      --cp-border-strong: #5f5f5f;
      --cp-text: #dedede;
      --cp-text-muted: #919191;
      --cp-text-soft: #b0b0b0;
      --cp-accent: #fd8ea1;
      --cp-accent-hover: #fb7b91;
      --cp-accent-soft: rgba(253, 142, 161, 0.14);
      --cp-accent-fg: #1a1a1a;
      --cp-success: #4ade80;
      --cp-danger: #f87171;
      --cp-warning: #fbbf24;
      --cp-link: #4da6ff;
      --cp-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
      --cp-overlay: rgba(41, 41, 41, 0.88);
      --cp-panel: rgba(41, 41, 41, 0.72);
      --cp-panel-strong: rgba(41, 41, 41, 0.96);
      --cp-sheen: rgba(255, 255, 255, 0.04);
      --cp-highlight: rgba(253, 142, 161, 0.12);
      --cp-app-accent: #78b9d0;
      --cp-app-accent-soft: rgba(120, 185, 208, 0.16);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--cp-bg);
      color: var(--cp-text);
      font-family: "Segoe UI", Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif;
    }
    main { width: min(1200px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0 56px; }
    h1 { margin: 0 0 8px; }
    .meta { color: var(--cp-text-muted); line-height: 1.6; }
    .stats {
      display: grid;
      margin: 22px 0;
      grid-template-columns: repeat(6, minmax(110px, 1fr));
      border: 1px solid var(--cp-border);
      border-radius: 16px;
      overflow: hidden;
      background: var(--cp-surface);
    }
    .stats div { padding: 13px 8px; text-align: center; }
    .stats div + div { border-left: 1px solid var(--cp-border); }
    .stats span { display: block; color: var(--cp-text-muted); font-size: .75rem; }
    .stats strong { display: block; margin-top: 4px; font-size: 1.05rem; }
    .notice {
      margin-bottom: 18px;
      padding: 12px 14px;
      border: 1px solid var(--cp-border);
      border-radius: 0.625rem;
      background: var(--cp-app-accent-soft);
      color: var(--cp-text-soft);
    }
    .table-wrap {
      overflow: auto;
      border: 1px solid var(--cp-border);
      border-radius: 16px;
      background: var(--cp-surface);
    }
    table { width: 100%; border-collapse: collapse; font-size: .78rem; }
    th, td { padding: 9px 10px; border-bottom: 1px solid var(--cp-border); text-align: left; vertical-align: top; }
    th { position: sticky; top: 0; background: var(--cp-bg-elevated); color: var(--cp-text-muted); }
    td:nth-child(4) { min-width: 360px; color: var(--cp-text-soft); }
    code { font-family: Consolas, "Courier New", Courier, monospace; }
    @media (max-width: 780px) {
      .stats { grid-template-columns: repeat(2, 1fr); }
      .stats div + div { border-left: 0; border-top: 1px solid var(--cp-border); }
    }
  </style>
</head>
<body>
  <main>
    <h1>ここログ Notion移行レポート</h1>
    <p class="meta">生成: ${escapeHtml(backup.exportedAt)}<br>ZIP SHA-256: <code>${escapeHtml(backup.source.zipSha256)}</code></p>
    <section class="stats">
      <div><span>CSV行</span><strong>${summary.csvRows}</strong></div>
      <div><span>Markdown</span><strong>${summary.markdownFiles}</strong></div>
      <div><span>変換成功</span><strong>${summary.convertedRecords}</strong></div>
      <div><span>空本文</span><strong>${summary.emptyBodies}</strong></div>
      <div><span>タグ</span><strong>${summary.tags}</strong></div>
      <div><span>UTCオフセット</span><strong>+${backup.source.assumedUtcOffsetMinutes}</strong></div>
    </section>
    <div class="notice">Notionの日時は日本標準時（UTC+09:00）として変換しています。本文はMarkdownメタデータを除外し、プレーンテキストへ正規化しています。</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>記録日時</th><th>タイトル</th><th>本文冒頭</th><th>文字数</th><th>状態</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </main>
</body>
</html>
`;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) {
      throw new Error(`Unexpected argument: ${key}`);
    }
    const name = key.slice(2);
    if (name === 'force') {
      args.force = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${name}`);
    }
    args[name] = value;
    index += 1;
  }
  return args;
}

function writeFileAtomic(filePath, content, force) {
  if (fs.existsSync(filePath) && !force) {
    throw new Error(`Output already exists; use --force to replace it: ${filePath}`);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, content, 'utf8');
  try {
    if (force && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
    throw error;
  }
}

function main(argv) {
  const args = parseArgs(argv);
  const required = ['csv', 'markdown-dir', 'output', 'report', 'zip-sha256'];
  for (const name of required) {
    if (!args[name]) {
      throw new Error(`Missing required argument: --${name}`);
    }
  }

  const utcOffsetMinutes = args['utc-offset-minutes']
    ? Number(args['utc-offset-minutes'])
    : 540;
  if (!Number.isInteger(utcOffsetMinutes) || utcOffsetMinutes < -840 || utcOffsetMinutes > 840) {
    throw new Error('--utc-offset-minutes must be an integer between -840 and 840');
  }
  if (!/^[0-9a-f]{64}$/i.test(args['zip-sha256'])) {
    throw new Error('--zip-sha256 must be a 64-character hexadecimal SHA-256');
  }
  if (args['exported-at'] && Number.isNaN(Date.parse(args['exported-at']))) {
    throw new Error('--exported-at must be an ISO 8601 timestamp');
  }

  const result = convertNotionExport({
    csvPath: path.resolve(args.csv),
    markdownDir: path.resolve(args['markdown-dir']),
    zipSha256: args['zip-sha256'],
    utcOffsetMinutes,
    exportedAt: args['exported-at'] || new Date().toISOString(),
  });

  writeFileAtomic(
    path.resolve(args.output),
    `${JSON.stringify(result.backup, null, 2)}\n`,
    Boolean(args.force),
  );
  writeFileAtomic(path.resolve(args.report), createReportHtml(result), Boolean(args.force));

  process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
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
  addContentHash,
  canonicalRecordContent,
  convertNotionExport,
  createReportHtml,
  markdownToPlainText,
  notionRecordId,
  parseCsv,
  parseNotionDate,
  parseNotionMarkdown,
  sha256,
};
