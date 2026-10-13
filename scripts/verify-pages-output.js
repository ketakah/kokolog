'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist-pages');
const allowedTopLevel = new Set([
  '.nojekyll',
  'assets',
  'build-info.json',
  'icons',
  'index.html',
  'manifest.webmanifest',
  'robots.txt',
  'src',
  'styles',
  'sw.js',
]);
const forbiddenTopLevel = [
  '.git',
  '.github',
  'design',
  'scripts',
  'tests',
  'tools',
];

assert.ok(fs.statSync(output).isDirectory(), 'dist-pages is missing');
const topLevel = fs.readdirSync(output);
for (const entry of topLevel) {
  assert.ok(allowedTopLevel.has(entry), `Unexpected Pages entry: ${entry}`);
}
for (const entry of forbiddenTopLevel) {
  assert.strictEqual(
    fs.existsSync(path.join(output, entry)),
    false,
    `Development-only directory was published: ${entry}`,
  );
}

const publishedFiles = [];
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(output, absolutePath);
    const stats = fs.lstatSync(absolutePath);
    assert.strictEqual(
      stats.isSymbolicLink(),
      false,
      `Symbolic link was published: ${relativePath}`,
    );
    if (entry.isDirectory()) {
      visit(absolutePath);
    } else if (entry.isFile()) {
      publishedFiles.push(relativePath);
    }
  }
}
visit(output);

for (const file of publishedFiles) {
  assert.strictEqual(
    /\.md$/iu.test(file),
    false,
    `Documentation file was published: ${file}`,
  );
  assert.strictEqual(
    /notion|migration-report|private/iu.test(file),
    false,
    `Private migration path was published: ${file}`,
  );
}

const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
assert.strictEqual(
  /C:\\Users\\|OneDrive - Microsoft/iu.test(html),
  false,
  'Local path leaked into published HTML',
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(output, 'manifest.webmanifest'), 'utf8'),
);
assert.strictEqual(manifest.start_url, './#/timeline');
assert.strictEqual(manifest.scope, './');

const buildInfo = JSON.parse(
  fs.readFileSync(path.join(output, 'build-info.json'), 'utf8'),
);
assert.match(buildInfo.version, /^[a-z0-9._-]+$/u);
const serviceWorker = fs.readFileSync(path.join(output, 'sw.js'), 'utf8');
assert.ok(
  serviceWorker.includes(
    `const CACHE_NAME = 'kokolog-app-${buildInfo.version}';`,
  ),
  'Published Service Worker does not use the build version',
);

process.stdout.write(
  `Pages output validation passed (${publishedFiles.length} files)\n`,
);
