import assert from 'assert';
import { webcrypto } from 'crypto';

import {
  createCalendarCells,
  daysInMonth,
  getMonthRange,
  getYearRange,
  isValidDateKey,
  shiftYearMonth,
} from '../../src/domain/calendar.mjs';
import {
  MAX_BACKUP_BYTES,
  createBackupFileName,
  createBackupEnvelope,
  validateBackupEnvelope,
} from '../../src/domain/backup.mjs';
import {
  formatLocalDateTime,
  getLocalDateKey,
  localDateTimeToUtcMilliseconds,
  normalizeLocalDateTime,
} from '../../src/domain/dates.mjs';
import {
  createDisplayTitle,
  truncateText,
} from '../../src/domain/display-title.mjs';
import {
  addContentHash,
  createRecord,
  updateRecord,
  validateRecordInput,
} from '../../src/domain/record.mjs';
import {
  calculateDailyMoodAverages,
  calculateMonthMoodSummary,
  calculateYearMoodSummary,
} from '../../src/domain/statistics.mjs';
import {
  countTimelineFilters,
  normalizeSearchText,
  prepareSearchRecord,
  searchPreparedRecords,
  tokenizeSearchQuery,
} from '../../src/domain/search.mjs';
import {
  formatStorageBytes,
  storageUsagePercent,
} from '../../src/domain/storage.mjs';
import {
  normalizeThemePreference,
  resolveTheme,
} from '../../src/app/theme.mjs';
import {
  isKokologCacheName,
  isKokologStorageKey,
} from '../../src/data/delete-all-service.mjs';
import {
  parseAndValidateBackupText,
  shouldDeleteSelectedRecord,
} from '../../src/data/backup-service.mjs';
import { createTimelineSearchEngine } from '../../src/features/timeline/search-engine.mjs';
import { createDraftSaveCoordinator } from '../../src/features/editor/draft-save-coordinator.mjs';
import {
  calendarSwipeAxis,
  calendarSwipeDirection,
  clampCalendarDrag,
} from '../../src/features/calendar/swipe-gesture.mjs';
import {
  PinService,
  createPinConfiguration,
  pinConfigurationFingerprint,
  verifyPinConfiguration,
  verifyRecoveryConfiguration,
} from '../../src/security/pin-service.mjs';
import {
  decodeBase64Url,
  encodeBase64Url,
  normalizeEs256Signature,
  validateDeviceRegistration,
  verifyDeviceAssertion,
} from '../../src/security/device-auth-service.mjs';
import { IdleLockController } from '../../src/security/idle-lock-controller.mjs';
import { edgeSwipeShouldNavigate } from '../../src/ui/edge-swipe-back.mjs';

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const tests = [];

function test(name, run) {
  tests.push({ name, run });
}

function concatTestBytes(...values) {
  const arrays = values.map((value) =>
    value instanceof Uint8Array ? value : new Uint8Array(value),
  );
  const result = new Uint8Array(
    arrays.reduce((total, value) => total + value.length, 0),
  );
  let offset = 0;
  for (const value of arrays) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

function rawEs256ToDer(rawValue) {
  const raw = new Uint8Array(rawValue);
  assert.strictEqual(raw.length, 64);
  function integer(value) {
    let start = 0;
    while (start < value.length - 1 && value[start] === 0) {
      start += 1;
    }
    let bytes = value.slice(start);
    if ((bytes[0] & 0x80) !== 0) {
      bytes = concatTestBytes(Uint8Array.of(0), bytes);
    }
    return concatTestBytes(Uint8Array.of(0x02, bytes.length), bytes);
  }
  const left = integer(raw.slice(0, 32));
  const right = integer(raw.slice(32));
  const body = concatTestBytes(left, right);
  return concatTestBytes(Uint8Array.of(0x30, body.length), body);
}

async function createAuthenticatorData(rpId, flags = 0x05, signCount = 1) {
  const rpIdHash = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(rpId),
    ),
  );
  const suffix = new Uint8Array(5);
  suffix[0] = flags;
  new DataView(suffix.buffer).setUint32(1, signCount, false);
  return concatTestBytes(rpIdHash, suffix);
}

test('display title prefers an explicit title', () => {
  assert.strictEqual(
    createDisplayTitle({ title: ' 明示タイトル ', body: '本文', mood: 3 }),
    '明示タイトル',
  );
});

test('display title uses the first meaningful sentence from body', () => {
  assert.strictEqual(
    createDisplayTitle({
      title: '',
      body: '\n\n今日は少し落ち着かなかった。でも話したら軽くなった。',
      mood: null,
    }),
    '今日は少し落ち着かなかった。',
  );
});

test('display title truncates by Unicode characters without breaking emoji', () => {
  const source = `${'考'.repeat(31)}😀続き`;
  const result = truncateText(source, 32);
  assert.strictEqual(Array.from(result.slice(0, -1)).length, 32);
  assert.ok(result.includes('😀'));
  assert.ok(result.endsWith('…'));
});

test('display title falls back to mood-only label', () => {
  assert.strictEqual(
    createDisplayTitle({ title: '', body: '', mood: 4 }),
    '調子：いい感じ',
  );
});

test('theme preference resolves system, light, and dark modes', () => {
  assert.strictEqual(normalizeThemePreference('invalid'), 'system');
  assert.strictEqual(resolveTheme('system', false), 'light');
  assert.strictEqual(resolveTheme('system', true), 'dark');
  assert.strictEqual(resolveTheme('light', true), 'light');
  assert.strictEqual(resolveTheme('dark', false), 'dark');
});

test('storage formatting and Kokolog ownership checks are deterministic', () => {
  assert.strictEqual(formatStorageBytes(0), '0 B');
  assert.strictEqual(formatStorageBytes(1024), '1.00 KB');
  assert.strictEqual(formatStorageBytes(5 * 1024 * 1024), '5.00 MB');
  assert.strictEqual(storageUsagePercent(25, 100), 25);
  assert.strictEqual(storageUsagePercent(1, 0), null);
  assert.strictEqual(isKokologStorageKey('kokolog:theme'), true);
  assert.strictEqual(isKokologStorageKey('nomilog:theme'), false);
  assert.strictEqual(isKokologCacheName('kokolog-app-v9'), true);
  assert.strictEqual(isKokologCacheName('nomilog-v9'), false);
});

test('search normalization absorbs width, case, and whitespace differences', () => {
  assert.strictEqual(normalizeSearchText(' ＡＢＣ　Test  '), 'abc test');
  assert.deepStrictEqual(tokenizeSearchQuery('仕事　不安 仕事'), ['仕事', '不安']);
});

test('search combines AND keywords and all filters', () => {
  const records = [
    {
      id: 'a',
      title: '仕事の気づき',
      body: '今日は少し不安だった',
      mood: 2,
      tagIds: ['work', 'insight'],
      favorite: true,
      occurredAtLocal: '2026-10-01T09:00:00',
    },
    {
      id: 'b',
      title: '',
      body: '家族と穏やかに過ごした',
      mood: null,
      tagIds: ['family'],
      favorite: false,
      occurredAtLocal: '2026-10-02T09:00:00',
    },
  ].map(prepareSearchRecord);

  assert.deepStrictEqual(
    searchPreparedRecords(records, {
      query: '仕事 不安',
      moods: [2],
      includeMoodless: false,
      favoriteOnly: true,
      tagIds: ['work', 'insight'],
      tagMode: 'and',
      fromDate: '2026-10-01',
      toDate: '2026-10-01',
    }),
    ['a'],
  );
  assert.deepStrictEqual(
    searchPreparedRecords(records, {
      query: '',
      moods: [],
      includeMoodless: true,
      favoriteOnly: false,
      tagIds: ['family', 'work'],
      tagMode: 'or',
      fromDate: '',
      toDate: '',
    }),
    ['b'],
  );
  assert.deepStrictEqual(
    searchPreparedRecords(records, {
      query: '',
      moods: [],
      includeMoodless: false,
      favoriteOnly: false,
      tagIds: ['family', 'work'],
      tagMode: 'or',
      fromDate: '',
      toDate: '',
    }),
    ['a', 'b'],
  );
});

test('active filter count treats each filter category once', () => {
  assert.strictEqual(
    countTimelineFilters({
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      moods: [1, 2],
      includeMoodless: true,
      favoriteOnly: true,
      tagIds: ['a', 'b'],
      tagMode: 'and',
    }),
    4,
  );
});

test('search engine falls back when Web Worker is unavailable', async () => {
  const engine = await createTimelineSearchEngine([
    {
      id: 'fallback',
      title: '検索',
      body: 'フォールバック',
      mood: null,
      tagIds: [],
      favorite: false,
      occurredAtLocal: '2026-10-12T12:00:00',
    },
  ]);
  assert.strictEqual(engine.mode, 'main-thread');
  assert.deepStrictEqual((await engine.search({ query: '検索' })).ids, ['fallback']);
  engine.terminate();
});

test('PIN verifier accepts the PIN and high-entropy recovery code', async () => {
  const created = await createPinConfiguration('123456', {
    iterations: 1000,
    autoLockMs: 60000,
    now: new Date('2026-10-12T12:00:00.000Z'),
  });
  assert.ok(/^(?:[0-9A-F]{4}-){7}[0-9A-F]{4}$/.test(created.recoveryCode));
  const pinResult = await verifyPinConfiguration(created.config, '123456', {
    now: new Date('2026-10-12T12:01:00.000Z'),
  });
  assert.strictEqual(pinResult.success, true);
  assert.strictEqual(
    pinConfigurationFingerprint(pinResult.config),
    pinConfigurationFingerprint(created.config),
  );
  const recoveryResult = await verifyRecoveryConfiguration(
    created.config,
    created.recoveryCode.toLowerCase(),
    { now: new Date('2026-10-12T12:01:00.000Z') },
  );
  assert.strictEqual(recoveryResult.success, true);
});

test('PIN verifier rate-limits after five failures', async () => {
  const created = await createPinConfiguration('123456', {
    iterations: 1000,
    now: new Date('2026-10-12T12:00:00.000Z'),
  });

  let config = created.config;
  let result = null;
  for (let index = 0; index < 5; index += 1) {
    result = await verifyPinConfiguration(config, '000000', {
      now: new Date('2026-10-12T12:01:00.000Z'),
    });
    config = result.config;
  }
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.locked, true);
  assert.strictEqual(result.waitMs, 30000);
  const duringLock = await verifyPinConfiguration(config, '123456', {
    now: new Date('2026-10-12T12:01:10.000Z'),
  });
  assert.strictEqual(duringLock.success, false);
  assert.strictEqual(duringLock.locked, true);
  assert.strictEqual(duringLock.waitMs, 20000);
});

test('device authentication verifies registration and ES256 assertion', async () => {
  const origin = 'https://ketakah.github.io';
  const rpId = 'ketakah.github.io';
  const challenge = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const rawId = Uint8Array.from({ length: 16 }, (_, index) => index + 8);
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const publicKey = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const registrationClientData = new TextEncoder().encode(
    JSON.stringify({
      type: 'webauthn.create',
      challenge: encodeBase64Url(challenge),
      origin,
      crossOrigin: false,
    }),
  );
  const registrationAuthenticatorData = await createAuthenticatorData(
    rpId,
    0x05,
    1,
  );
  const config = await validateDeviceRegistration({
    credential: {
      type: 'public-key',
      rawId,
      response: {
        clientDataJSON: registrationClientData,
        getAuthenticatorData: () => registrationAuthenticatorData,
        getPublicKey: () => publicKey,
        getPublicKeyAlgorithm: () => -7,
      },
    },
    challenge,
    origin,
    rpId,
    now: new Date('2026-10-14T08:00:00.000Z'),
  });
  assert.strictEqual(config.credentialId, encodeBase64Url(rawId));
  assert.deepStrictEqual(
    decodeBase64Url(config.credentialId),
    rawId,
  );

  const assertionChallenge = Uint8Array.from(
    { length: 32 },
    (_, index) => 255 - index,
  );
  const assertionClientData = new TextEncoder().encode(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: encodeBase64Url(assertionChallenge),
      origin,
      crossOrigin: false,
    }),
  );
  const assertionAuthenticatorData = await createAuthenticatorData(
    rpId,
    0x05,
    2,
  );
  const clientDataHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', assertionClientData),
  );
  const rawSignature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      keyPair.privateKey,
      concatTestBytes(assertionAuthenticatorData, clientDataHash),
    ),
  );
  const derSignature = rawEs256ToDer(rawSignature);
  assert.deepStrictEqual(normalizeEs256Signature(derSignature), rawSignature);
  const result = await verifyDeviceAssertion({
    config,
    credential: {
      type: 'public-key',
      rawId,
      response: {
        clientDataJSON: assertionClientData,
        authenticatorData: assertionAuthenticatorData,
        signature: derSignature,
      },
    },
    challenge: assertionChallenge,
    origin,
  });
  assert.strictEqual(result.signCount, 2);
});

test('device authentication rejects wrong origin and missing verification', async () => {
  const rpId = 'ketakah.github.io';
  const challenge = new Uint8Array(32);
  const rawId = new Uint8Array(16);
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const publicKey = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const clientData = new TextEncoder().encode(
    JSON.stringify({
      type: 'webauthn.create',
      challenge: encodeBase64Url(challenge),
      origin: 'https://attacker.example',
      crossOrigin: false,
    }),
  );
  await assert.rejects(
    () =>
      validateDeviceRegistration({
        credential: {
          type: 'public-key',
          rawId,
          response: {
            clientDataJSON: clientData,
            getAuthenticatorData: async () =>
              createAuthenticatorData(rpId, 0x01, 1),
            getPublicKey: () => publicKey,
            getPublicKeyAlgorithm: () => -7,
          },
        },
        challenge,
        origin: 'https://ketakah.github.io',
        rpId,
      }),
    /オリジン/,
  );

  const correctClientData = new TextEncoder().encode(
    JSON.stringify({
      type: 'webauthn.create',
      challenge: encodeBase64Url(challenge),
      origin: 'https://ketakah.github.io',
      crossOrigin: false,
    }),
  );
  const presenceOnlyAuthenticatorData = await createAuthenticatorData(
    rpId,
    0x01,
    1,
  );
  await assert.rejects(
    () =>
      validateDeviceRegistration({
        credential: {
          type: 'public-key',
          rawId,
          response: {
            clientDataJSON: correctClientData,
            getAuthenticatorData: () => presenceOnlyAuthenticatorData,
            getPublicKey: () => publicKey,
            getPublicKeyAlgorithm: () => -7,
          },
        },
        challenge,
        origin: 'https://ketakah.github.io',
        rpId,
      }),
    /Face ID/,
  );
});

test('device authentication configuration follows PIN lifecycle', async () => {
  const values = new Map();
  const settings = {
    async get(key, fallback = null) {
      return values.has(key) ? values.get(key) : fallback;
    },
    async set(key, value) {
      values.set(key, value);
      return value;
    },
  };
  const pin = new PinService(settings);
  const enabled = await pin.enable('123456', {
    iterations: 1000,
    now: new Date('2026-10-14T08:00:00.000Z'),
  });
  const before = pinConfigurationFingerprint(enabled.config);
  await pin.setDeviceAuthConfig(
    {
      version: 1,
      enabled: true,
      credentialId: 'credential-one',
      publicKeySpki: 'public-key',
      algorithm: -7,
      rpId: 'ketakah.github.io',
      origin: 'https://ketakah.github.io',
      signCount: 0,
      createdAt: '2026-10-14T08:01:00.000Z',
      updatedAt: '2026-10-14T08:01:00.000Z',
      lastUsedAt: null,
    },
    before,
  );
  const withDevice = await pin.getConfig();
  assert.notStrictEqual(
    pinConfigurationFingerprint(withDevice),
    before,
  );
  assert.strictEqual(
    pin.getDeviceAuthConfigInMemory().credentialId,
    'credential-one',
  );

  const recovered = await pin.recover(enabled.recoveryCode, {
    now: new Date('2026-10-14T08:02:00.000Z'),
  });
  assert.strictEqual(recovered.success, true);
  assert.strictEqual(await pin.getConfig(), null);
  assert.strictEqual(pin.getDeviceAuthConfigInMemory(), null);
});

test('idle lock resets on activity and disables for close-only mode', async () => {
  let delay = 60000;
  let nextTimerId = 0;
  let lockCount = 0;
  const timers = new Map();
  const cleared = [];
  const controller = new IdleLockController({
    getDelay: () => delay,
    onLock: () => {
      lockCount += 1;
    },
    setTimer: (callback, milliseconds) => {
      nextTimerId += 1;
      timers.set(nextTimerId, { callback, milliseconds });
      return nextTimerId;
    },
    clearTimer: (timerId) => {
      cleared.push(timerId);
      timers.delete(timerId);
    },
  });

  assert.strictEqual(controller.start(), true);
  assert.strictEqual(timers.get(1).milliseconds, 60000);
  assert.strictEqual(controller.reset(), true);
  assert.deepStrictEqual(cleared, [1]);
  assert.strictEqual(timers.get(2).milliseconds, 60000);

  timers.get(2).callback();
  await Promise.resolve();
  assert.strictEqual(lockCount, 1);
  assert.strictEqual(controller.isArmed(), false);

  delay = 0;
  assert.strictEqual(controller.start(), false);
  assert.strictEqual(controller.isArmed(), false);
});

test('draft save coordinator preserves an edit made during an in-flight save', async () => {
  const writes = [];
  let releaseFirstWrite;
  const firstWriteBlocked = new Promise((resolve) => {
    releaseFirstWrite = resolve;
  });
  const coordinator = createDraftSaveCoordinator(async (snapshot) => {
    writes.push(snapshot.body);
    if (snapshot.body === 'first') {
      await firstWriteBlocked;
    }
  });

  coordinator.markEdited();
  const firstSave = coordinator.save({ body: 'first' });
  await new Promise((resolve) => setImmediate(resolve));

  coordinator.markEdited();
  const secondSave = coordinator.save({ body: 'second' });
  assert.strictEqual(coordinator.hasUnsavedChanges(), true);

  releaseFirstWrite();
  await Promise.all([firstSave, secondSave]);
  assert.deepStrictEqual(writes, ['first', 'second']);
  assert.strictEqual(coordinator.hasUnsavedChanges(), false);
});

test('local date normalization handles leap day and offset conversion', () => {
  assert.strictEqual(
    normalizeLocalDateTime('2024-02-29T23:45'),
    '2024-02-29T23:45:00',
  );
  assert.strictEqual(
    new Date(localDateTimeToUtcMilliseconds('2024-02-29T23:45:00', 540)).toISOString(),
    '2024-02-29T14:45:00.000Z',
  );
  assert.strictEqual(getLocalDateKey('2024-02-29T23:45:00'), '2024-02-29');
  assert.throws(() => normalizeLocalDateTime('2023-02-29T12:00'), /存在しない日付/);
});

test('formatLocalDateTime keeps local wall-clock fields', () => {
  const date = new Date(2026, 9, 12, 17, 30, 45);
  assert.strictEqual(formatLocalDateTime(date), '2026-10-12T17:30:45');
  assert.strictEqual(formatLocalDateTime(date, false), '2026-10-12T17:30');
});

test('calendar uses Monday-first cells across month and year boundaries', () => {
  const cells = createCalendarCells('2026-10');
  assert.strictEqual(cells.length, 42);
  assert.deepStrictEqual(cells[0], {
    dateKey: '2026-09-28',
    day: 28,
    inCurrentMonth: false,
  });
  assert.deepStrictEqual(cells[3], {
    dateKey: '2026-10-01',
    day: 1,
    inCurrentMonth: true,
  });
  assert.strictEqual(shiftYearMonth('2026-01', -1), '2025-12');
  assert.strictEqual(shiftYearMonth('2026-12', 1), '2027-01');
  assert.deepStrictEqual(getMonthRange('2026-12'), {
    start: '2026-12-01T00:00:00',
    end: '2027-01-01T00:00:00',
  });
  assert.deepStrictEqual(getYearRange(2026), {
    start: '2026-01-01T00:00:00',
    end: '2027-01-01T00:00:00',
  });
});

test('calendar handles leap years and validates date keys', () => {
  assert.strictEqual(daysInMonth('2024-02'), 29);
  assert.strictEqual(daysInMonth('2025-02'), 28);
  assert.strictEqual(isValidDateKey('2024-02-29'), true);
  assert.strictEqual(isValidDateKey('2025-02-29'), false);
});

test('calendar swipe follows horizontal intent and threshold', () => {
  assert.strictEqual(calendarSwipeAxis(5, 1), null);
  assert.strictEqual(calendarSwipeAxis(12, 2), 'horizontal');
  assert.strictEqual(calendarSwipeAxis(10, 18), 'vertical');
  assert.strictEqual(
    calendarSwipeDirection({
      deltaX: -100,
      deltaY: 8,
      elapsedMs: 300,
      viewportWidth: 390,
    }),
    1,
  );
  assert.strictEqual(
    calendarSwipeDirection({
      deltaX: 30,
      deltaY: 2,
      elapsedMs: 40,
      viewportWidth: 390,
    }),
    -1,
  );
  assert.strictEqual(
    calendarSwipeDirection({
      deltaX: 35,
      deltaY: 4,
      elapsedMs: 400,
      viewportWidth: 390,
    }),
    0,
  );
  assert.strictEqual(clampCalendarDrag(-500, 390), -390);
  assert.strictEqual(clampCalendarDrag(500, 390), 390);
});

test('edge swipe back requires a deliberate rightward gesture', () => {
  assert.strictEqual(
    edgeSwipeShouldNavigate({
      deltaX: 120,
      deltaY: 8,
      elapsedMs: 300,
      viewportWidth: 390,
    }),
    true,
  );
  assert.strictEqual(
    edgeSwipeShouldNavigate({
      deltaX: 40,
      deltaY: 2,
      elapsedMs: 50,
      viewportWidth: 390,
    }),
    true,
  );
  assert.strictEqual(
    edgeSwipeShouldNavigate({
      deltaX: 50,
      deltaY: 45,
      elapsedMs: 100,
      viewportWidth: 390,
    }),
    false,
  );
  assert.strictEqual(
    edgeSwipeShouldNavigate({
      deltaX: -120,
      deltaY: 0,
      elapsedMs: 100,
      viewportWidth: 390,
    }),
    false,
  );
});

test('record validation accepts body-only and mood-only records', () => {
  const now = new Date('2026-10-12T09:00:00.000Z');
  const base = {
    occurredAtLocal: '2026-10-12T18:00:00',
    occurredUtcOffsetMinutes: 540,
    tagIds: [],
  };
  assert.strictEqual(
    validateRecordInput({ ...base, body: '本文', title: '', mood: null }, { now }).valid,
    true,
  );
  assert.strictEqual(
    validateRecordInput({ ...base, body: '', title: '', mood: 3 }, { now }).valid,
    true,
  );
});

test('record validation rejects empty and future records', () => {
  const now = new Date('2026-10-12T09:00:00.000Z');
  const empty = validateRecordInput(
    {
      title: '',
      body: '  ',
      mood: null,
      tagIds: [],
      occurredAtLocal: '2026-10-12T18:00:00',
      occurredUtcOffsetMinutes: 540,
    },
    { now },
  );
  assert.strictEqual(empty.valid, false);
  assert.ok(empty.errors.some((error) => error.includes('いずれか')));

  const future = validateRecordInput(
    {
      title: '',
      body: '本文',
      mood: null,
      tagIds: [],
      occurredAtLocal: '2026-10-12T18:01:00',
      occurredUtcOffsetMinutes: 540,
    },
    { now },
  );
  assert.strictEqual(future.valid, false);
  assert.ok(future.errors.some((error) => error.includes('未来')));
});

test('record hashes are deterministic and updates increment revision', async () => {
  const now = new Date('2026-10-12T09:00:00.000Z');
  const input = {
    title: '',
    body: '本文',
    mood: 3,
    tagIds: ['tag_b', 'tag_a', 'tag_a'],
    favorite: false,
    occurredAtLocal: '2026-10-12T18:00:00',
    occurredUtcOffsetMinutes: 540,
  };
  const first = await createRecord(input, {
    now,
    id: 'test_record',
  });
  const same = await createRecord(
    { ...input, tagIds: ['tag_a', 'tag_b'] },
    { now, id: 'test_record' },
  );
  assert.strictEqual(first.contentHash, same.contentHash);

  const updated = await updateRecord(
    first,
    { favorite: true },
    { now: new Date('2026-10-12T09:05:00.000Z') },
  );
  assert.strictEqual(updated.revision, 2);
  assert.strictEqual(updated.favorite, true);
  assert.notStrictEqual(updated.contentHash, first.contentHash);

  const rehashed = await addContentHash({ ...first, contentHash: '' });
  assert.strictEqual(rehashed.contentHash, first.contentHash);
});

test('statistics average within a day before averaging the month', () => {
  const records = [
    { occurredAtLocal: '2026-10-01T09:00:00', mood: 1, deletedAt: null },
    { occurredAtLocal: '2026-10-01T20:00:00', mood: 5, deletedAt: null },
    { occurredAtLocal: '2026-10-02T12:00:00', mood: 5, deletedAt: null },
    { occurredAtLocal: '2026-10-03T12:00:00', mood: null, deletedAt: null },
    { occurredAtLocal: '2026-10-04T12:00:00', mood: 1, deletedAt: '2026-10-05T00:00:00.000Z' },
  ];
  assert.deepStrictEqual(calculateDailyMoodAverages(records), [
    { date: '2026-10-01', average: 3, moodRecordCount: 2 },
    { date: '2026-10-02', average: 5, moodRecordCount: 1 },
  ]);
  assert.deepStrictEqual(calculateMonthMoodSummary(records, '2026-10'), {
    yearMonth: '2026-10',
    average: 4,
    moodDays: 2,
    moodRecordCount: 3,
    recordCount: 4,
    daily: [
      { date: '2026-10-01', average: 3, moodRecordCount: 2 },
      { date: '2026-10-02', average: 5, moodRecordCount: 1 },
    ],
  });

  test('year statistics average daily values and preserve empty months', () => {
    const records = [
      { occurredAtLocal: '2026-01-01T09:00:00', mood: 1, deletedAt: null },
      { occurredAtLocal: '2026-01-01T20:00:00', mood: 5, deletedAt: null },
      { occurredAtLocal: '2026-02-01T12:00:00', mood: 5, deletedAt: null },
      { occurredAtLocal: '2026-03-01T12:00:00', mood: null, deletedAt: null },
    ];
    const summary = calculateYearMoodSummary(records, 2026);
    assert.strictEqual(summary.average, 4);
    assert.strictEqual(summary.moodDays, 2);
    assert.strictEqual(summary.moodMonths, 2);
    assert.strictEqual(summary.recordCount, 4);
    assert.strictEqual(summary.months[0].average, 3);
    assert.strictEqual(summary.months[1].average, 5);
    assert.strictEqual(summary.months[2].average, null);
  });
});

test('backup envelope validates records and rejects duplicate IDs', async () => {
  const record = await createRecord(
    {
      title: '',
      body: '本文',
      mood: null,
      tagIds: [],
      favorite: false,
      occurredAtLocal: '2026-10-12T18:00:00',
      occurredUtcOffsetMinutes: 540,
    },
    {
      now: new Date('2026-10-12T09:00:00.000Z'),
      id: 'backup_record',
    },
  );
  const backup = createBackupEnvelope(
    { records: [record] },
    { exportedAt: '2026-10-12T09:10:00.000Z' },
  );
  assert.strictEqual((await validateBackupEnvelope(backup)).valid, true);

  const duplicate = { ...backup, records: [record, record] };
  const validation = await validateBackupEnvelope(duplicate);
  assert.strictEqual(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes('重複')));

  const tampered = JSON.parse(JSON.stringify(backup));
  tampered.records[0].body = '改ざん';
  const tamperedValidation = await validateBackupEnvelope(tampered);
  assert.strictEqual(tamperedValidation.valid, false);
  assert.ok(tamperedValidation.errors.some((error) => error.includes('内容ハッシュ')));
});

test('backup filename is deterministic and filesystem-friendly', () => {
  assert.strictEqual(
    createBackupFileName('2026-10-12T09:10:11.123Z'),
    'kokolog-backup-20261012-091011Z.json',
  );
});

test('backup envelope excludes PIN and recovery configuration', () => {
  const backup = createBackupEnvelope(
    {
      settings: {
        theme: 'dark',
        pinConfig: {
          pinVerifier: 'secret-verifier',
          recoveryVerifier: 'recovery-verifier',
        },
      },
    },
    { exportedAt: '2026-10-12T09:10:00.000Z' },
  );
  assert.deepStrictEqual(backup.settings, { theme: 'dark' });
  assert.strictEqual(JSON.stringify(backup).includes('secret-verifier'), false);
  assert.strictEqual(JSON.stringify(backup).includes('recovery-verifier'), false);
});

test('backup parser rejects malformed JSON and oversized files', async () => {
  await assert.rejects(
    () => parseAndValidateBackupText('{invalid', { byteLength: 8 }),
    /JSONを解析できません/,
  );
  await assert.rejects(
    () =>
      parseAndValidateBackupText('{}', {
        byteLength: MAX_BACKUP_BYTES + 1,
      }),
    /上限/,
  );
});

test('backup validation rejects non-canonical and reversed timestamps', async () => {
  const record = await createRecord(
    {
      title: '',
      body: '本文',
      mood: null,
      tagIds: [],
      favorite: false,
      occurredAtLocal: '2026-10-12T18:00:00',
      occurredUtcOffsetMinutes: 540,
    },
    {
      now: new Date('2026-10-12T09:00:00.000Z'),
      id: 'timestamp_record',
    },
  );
  const backup = createBackupEnvelope(
    { records: [record] },
    { exportedAt: '2026-10-12T09:10:00.000Z' },
  );

  const nonCanonical = JSON.parse(JSON.stringify(backup));
  nonCanonical.records[0].updatedAt = 'Sun, 12 Oct 2026 09:00:00 GMT';
  assert.strictEqual((await validateBackupEnvelope(nonCanonical)).valid, false);

  const reversed = JSON.parse(JSON.stringify(backup));
  reversed.records[0].createdAt = '2026-10-12T09:05:00.000Z';
  reversed.records[0].updatedAt = '2026-10-12T09:00:00.000Z';
  const reversedValidation = await validateBackupEnvelope(reversed);
  assert.strictEqual(reversedValidation.valid, false);
  assert.ok(reversedValidation.errors.some((error) => error.includes('作成日時より前')));
});

test('intermediate tombstone does not delete a newer imported winner', () => {
  const current = { updatedAt: '2026-10-12T09:00:00.000Z' };
  const tombstone = { deletedAt: '2026-10-12T09:05:00.000Z' };
  const incoming = { updatedAt: '2026-10-12T09:10:00.000Z' };
  assert.strictEqual(
    shouldDeleteSelectedRecord(current, incoming, tombstone),
    false,
  );
  assert.strictEqual(
    shouldDeleteSelectedRecord(
      current,
      incoming,
      { deletedAt: '2026-10-12T09:10:00.000Z' },
    ),
    true,
  );
});

let failures = 0;
for (const { name, run } of tests) {
  try {
    await run();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failures += 1;
    process.stderr.write(`FAIL ${name}\n${error.stack || error.message}\n`);
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  process.stdout.write(`\n${tests.length} tests passed\n`);
}
