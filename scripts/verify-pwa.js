'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function listFiles(relativeDirectory, extension) {
  const directory = path.join(root, relativeDirectory);
  const entries = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDirectory, item.name);
    if (item.isDirectory()) {
      entries.push(...listFiles(relativePath, extension));
    } else if (!extension || item.name.endsWith(extension)) {
      entries.push(`./${relativePath}`);
    }
  }
  return entries;
}

function pngSize(relativePath) {
  const buffer = fs.readFileSync(path.join(root, relativePath));
  assert.deepStrictEqual(
    [...buffer.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    `${relativePath} is not a PNG`,
  );
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

const manifest = JSON.parse(read('manifest.webmanifest'));
assert.strictEqual(manifest.id, './');
assert.strictEqual(manifest.start_url, './#/timeline');
assert.strictEqual(manifest.scope, './');
assert.strictEqual(manifest.display, 'standalone');
assert.strictEqual(manifest.theme_color, '#347da5');

for (const icon of manifest.icons) {
  const relativePath = icon.src.replace(/^\.\//, '');
  const dimensions = pngSize(relativePath);
  const [width, height] = icon.sizes.split('x').map(Number);
  assert.deepStrictEqual(dimensions, { width, height });
}

const html = read('index.html');
const firstScript = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(firstScript, 'Theme detection script is missing');
const scriptHash = crypto
  .createHash('sha256')
  .update(firstScript[1].replace(/\r\n?/g, '\n'), 'utf8')
  .digest('base64');
assert.ok(
  html.includes(`'sha256-${scriptHash}'`),
  'CSP does not allow exactly the inline theme script',
);
assert.ok(
  html.indexOf('http-equiv="Content-Security-Policy"') <
    html.indexOf('<script>'),
  'CSP must be declared before the inline script',
);
assert.ok(html.includes('rel="apple-touch-icon"'));

const screenStyles = read('styles/screens.css');
const themeTokens = read('styles/tokens.css');
assert.match(themeTokens, /--cp-app-accent:\s*#347da5/u);
assert.match(themeTokens, /--cp-app-accent-text:\s*#347da5/u);
const excerptRule = screenStyles.match(
  /\.record-excerpt\s*\{([\s\S]*?)\}/u,
)?.[1];
assert.ok(excerptRule, 'Timeline excerpt style is missing');
assert.match(excerptRule, /-webkit-line-clamp:\s*4/u);
assert.match(excerptRule, /white-space:\s*normal/u);
assert.match(excerptRule, /min-height:\s*0/u);
assert.match(excerptRule, /max-height:\s*calc\(1\.55em \* 4\)/u);

const serviceWorker = read('sw.js');
const appShellMatch = serviceWorker.match(
  /const APP_SHELL = Object\.freeze\((\[[\s\S]*?\])\);/,
);
assert.ok(appShellMatch, 'APP_SHELL is missing from sw.js');
const appShell = vm.runInNewContext(appShellMatch[1]);
const expectedAssets = new Set([
  './',
  './index.html',
  './manifest.webmanifest',
  ...listFiles('styles', '.css'),
  ...listFiles('src', '.mjs'),
  ...listFiles('assets/icons', '.svg'),
  ...listFiles('icons', '.png'),
]);
assert.deepStrictEqual(new Set(appShell), expectedAssets);
for (const asset of appShell) {
  assert.ok(asset.startsWith('./'));
  if (asset !== './') {
    assert.ok(fs.existsSync(path.join(root, asset.slice(2))), `${asset} is missing`);
  }
}
assert.match(serviceWorker, /const CACHE_PREFIX = 'kokolog-';/);
assert.match(
  serviceWorker,
  /key\.startsWith\(CACHE_PREFIX\) && key !== CACHE_NAME/,
);
assert.doesNotMatch(serviceWorker, /caches\.match\(/);

async function verifyServiceWorkerBehavior() {
  const currentCacheName = serviceWorker.match(
    /const CACHE_NAME = '([^']+)';/,
  )[1];
  const listeners = {};
  const deletedCaches = [];
  let addedResourceCount = 0;
  let skipWaitingCalled = false;
  const cache = {
    async addAll(resources) {
      addedResourceCount = resources.length;
    },
    async match(request) {
      const url = typeof request === 'string' ? request : request.url;
      if (url.endsWith('/icons/icon-512.png')) {
        return { kind: 'icon' };
      }
      if (url.endsWith('/index.html')) {
        return { kind: 'index' };
      }
      return null;
    },
  };
  const context = {
    URL,
    fetch: async () => ({ kind: 'network' }),
    caches: {
      open: async () => cache,
      keys: async () => [
        'kokolog-app-old',
        currentCacheName,
        'nomilog-v9',
        'other-app-cache',
      ],
      delete: async (key) => {
        deletedCaches.push(key);
        return true;
      },
    },
    self: {
      registration: {
        scope: 'https://example.test/kokolog/',
      },
      clients: {
        claim: async () => undefined,
        matchAll: async () => [],
      },
      addEventListener(type, listener) {
        listeners[type] = listener;
      },
      skipWaiting() {
        skipWaitingCalled = true;
      },
    },
  };
  vm.runInNewContext(serviceWorker, context, { filename: 'sw.js' });

  let activation;
  listeners.activate({
    waitUntil(promise) {
      activation = promise;
    },
  });
  await activation;
  assert.deepStrictEqual(deletedCaches, ['kokolog-app-old']);

  async function dispatchFetch(url, mode = 'navigate') {
    let response;
    listeners.fetch({
      request: {
        method: 'GET',
        mode,
        url,
      },
      respondWith(promise) {
        response = promise;
      },
    });
    return response;
  }

  assert.deepStrictEqual(
    await dispatchFetch('https://example.test/kokolog/icons/icon-512.png'),
    { kind: 'icon' },
  );
  assert.deepStrictEqual(
    await dispatchFetch('https://example.test/kokolog/?scoutTheme=dark'),
    { kind: 'index' },
  );
  assert.deepStrictEqual(
    await dispatchFetch('https://example.test/kokolog/unknown.txt'),
    { kind: 'network' },
  );

  listeners.message({ data: { type: 'SKIP_WAITING' } });
  assert.strictEqual(skipWaitingCalled, true);

  let ensurePromise;
  let ensureResult;
  listeners.message({
    data: { type: 'ENSURE_APP_SHELL' },
    ports: [
      {
        postMessage(result) {
          ensureResult = result;
        },
      },
    ],
    waitUntil(promise) {
      ensurePromise = promise;
    },
  });
  await ensurePromise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(addedResourceCount, appShell.length);
  assert.strictEqual(ensureResult.success, true);

  let preparePromise;
  let prepareResult;
  listeners.message({
    data: { type: 'PREPARE_DELETE' },
    source: { id: 'requesting-client' },
    ports: [
      {
        postMessage(result) {
          prepareResult = result;
        },
      },
    ],
    waitUntil(promise) {
      preparePromise = promise;
    },
  });
  await preparePromise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(prepareResult.success, true);
  assert.strictEqual(prepareResult.clientCount, 0);
}

verifyServiceWorkerBehavior()
  .then(() => {
    process.stdout.write(`PWA validation passed (${appShell.length} shell assets)\n`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
