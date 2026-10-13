'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist-pages');
const files = [
  'index.html',
  'manifest.webmanifest',
  'robots.txt',
  'sw.js',
];
const directories = [
  'assets\\icons',
  'icons',
  'src',
  'styles',
];

function removeOutput() {
  if (path.dirname(output) !== root || path.basename(output) !== 'dist-pages') {
    throw new Error('Pages出力先が想定外です。');
  }
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
}

function copyFile(relativePath) {
  const source = path.join(root, relativePath);
  const destination = path.join(output, relativePath);
  const stats = fs.lstatSync(source);
  if (stats.isSymbolicLink()) {
    throw new Error(`シンボリックリンクは公開できません: ${relativePath}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function copyDirectory(relativeDirectory) {
  const sourceDirectory = path.join(root, relativeDirectory);
  for (const entry of fs.readdirSync(sourceDirectory, {
    withFileTypes: true,
  })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`シンボリックリンクは公開できません: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      copyDirectory(relativePath);
    } else if (entry.isFile()) {
      copyFile(relativePath);
    }
  }
}

function buildVersion() {
  const raw =
    process.env.KOKOLOG_BUILD_VERSION ||
    process.env.GITHUB_SHA?.slice(0, 12) ||
    `local-${Date.now()}`;
  const normalized = raw.toLowerCase().replace(/[^a-z0-9._-]/gu, '-');
  if (!normalized) {
    throw new Error('ビルド識別子を生成できませんでした。');
  }
  return normalized;
}

function rewriteServiceWorker(version) {
  const serviceWorkerPath = path.join(output, 'sw.js');
  const source = fs.readFileSync(serviceWorkerPath, 'utf8');
  const rewritten = source.replace(
    /const CACHE_NAME = 'kokolog-app-[^']+';/u,
    `const CACHE_NAME = 'kokolog-app-${version}';`,
  );
  if (rewritten === source) {
    throw new Error('Service Workerのキャッシュ識別子を更新できませんでした。');
  }
  fs.writeFileSync(serviceWorkerPath, rewritten);
}

function summarize(directory) {
  let count = 0;
  let bytes = 0;
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        const stats = fs.statSync(absolutePath);
        count += 1;
        bytes += stats.size;
      }
    }
  }
  visit(directory);
  return { count, bytes };
}

removeOutput();
files.forEach(copyFile);
directories.forEach(copyDirectory);
fs.writeFileSync(path.join(output, '.nojekyll'), '');

const version = buildVersion();
rewriteServiceWorker(version);
fs.writeFileSync(
  path.join(output, 'build-info.json'),
  `${JSON.stringify(
    {
      version,
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);

const summary = summarize(output);
process.stdout.write(
  `Pages artifact: ${summary.count} files / ${summary.bytes} bytes / ${version}\n`,
);
