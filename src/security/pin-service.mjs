const PIN_CONFIG_KEY = 'pinConfig';
const DEFAULT_ITERATIONS = 150000;
const MIN_TEST_ITERATIONS = 1000;
const RECOVERY_BYTES = 16;

function bytesToBase64(bytes) {
  if (typeof btoa === 'function') {
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(value) {
  if (typeof atob === 'function') {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

function randomBytes(length) {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('安全な乱数を生成できません。');
  }
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function normalizeRecoveryCode(value) {
  return String(value || '').replace(/[^0-9a-f]/giu, '').toUpperCase();
}

function validatePin(pin) {
  if (!/^\d{6}$/.test(String(pin || ''))) {
    throw new Error('PINは6桁の数字で入力してください。');
  }
}

async function deriveVerifier(secret, saltBytes, iterations) {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256',
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function failureDelay(failureCount) {
  if (failureCount < 5) {
    return 0;
  }
  return Math.min(300000, 30000 * 2 ** (failureCount - 5));
}

function createRecoveryCode() {
  const hex = [...randomBytes(RECOVERY_BYTES)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return hex.match(/.{1,4}/g).join('-');
}

export async function createPinConfiguration(pin, options = {}) {
  validatePin(pin);
  const iterations = Math.max(
    MIN_TEST_ITERATIONS,
    Number(options.iterations || DEFAULT_ITERATIONS),
  );
  const pinSalt = randomBytes(16);
  const recoverySalt = randomBytes(16);
  const recoveryCode = createRecoveryCode();
  const [pinVerifier, recoveryVerifier] = await Promise.all([
    deriveVerifier(pin, pinSalt, iterations),
    deriveVerifier(normalizeRecoveryCode(recoveryCode), recoverySalt, iterations),
  ]);
  const updatedAt = (options.now || new Date()).toISOString();

  return {
    recoveryCode,
    config: {
      version: 1,
      enabled: true,
      iterations,
      pinSalt: bytesToBase64(pinSalt),
      pinVerifier: bytesToBase64(pinVerifier),
      recoverySalt: bytesToBase64(recoverySalt),
      recoveryVerifier: bytesToBase64(recoveryVerifier),
      failureCount: 0,
      lockedUntil: null,
      autoLockMs:
        options.autoLockMs === undefined ? 60000 : Number(options.autoLockMs),
      updatedAt,
    },
  };
}

async function verifySecret(config, secret, kind, options = {}) {
  const now = options.now || new Date();
  const lockedUntil = config.lockedUntil ? Date.parse(config.lockedUntil) : 0;
  if (lockedUntil > now.getTime()) {
    return {
      success: false,
      locked: true,
      waitMs: lockedUntil - now.getTime(),
      config,
    };
  }
  const normalizedSecret =
    kind === 'recovery' ? normalizeRecoveryCode(secret) : String(secret || '');
  if (kind === 'pin') {
    validatePin(normalizedSecret);
  }
  const salt = base64ToBytes(
    kind === 'recovery' ? config.recoverySalt : config.pinSalt,
  );
  const expected = base64ToBytes(
    kind === 'recovery' ? config.recoveryVerifier : config.pinVerifier,
  );
  const actual = await deriveVerifier(
    normalizedSecret,
    salt,
    config.iterations,
  );
  const success = constantTimeEqual(actual, expected);
  if (success) {
    return {
      success: true,
      locked: false,
      waitMs: 0,
      config: {
        ...config,
        failureCount: 0,
        lockedUntil: null,
        updatedAt: now.toISOString(),
      },
    };
  }

  const failureCount = Number(config.failureCount || 0) + 1;
  const waitMs = failureDelay(failureCount);
  return {
    success: false,
    locked: waitMs > 0,
    waitMs,
    config: {
      ...config,
      failureCount,
      lockedUntil:
        waitMs > 0 ? new Date(now.getTime() + waitMs).toISOString() : null,
      updatedAt: now.toISOString(),
    },
  };
}

export function verifyPinConfiguration(config, pin, options = {}) {
  return verifySecret(config, pin, 'pin', options);
}

export function verifyRecoveryConfiguration(config, code, options = {}) {
  return verifySecret(config, code, 'recovery', options);
}

export function pinConfigurationFingerprint(config) {
  return config?.enabled
    ? `${config.version}:${config.pinVerifier}:${config.recoveryVerifier}`
    : null;
}

export class PinService {
  constructor(settingsRepository) {
    this.settings = settingsRepository;
    this.enabled = null;
    this.config = null;
  }

  async getConfig() {
    const config = await this.settings.get(PIN_CONFIG_KEY, null);
    this.enabled = Boolean(config?.enabled);
    this.config = this.enabled ? config : null;
    return this.config;
  }

  async isEnabled() {
    return Boolean(await this.getConfig());
  }

  isEnabledInMemory() {
    return this.enabled === true;
  }

  getAutoLockMsInMemory() {
    return Number(this.config?.autoLockMs || 0);
  }

  async enable(pin, options = {}) {
    const result = await createPinConfiguration(pin, options);
    await this.settings.set(PIN_CONFIG_KEY, result.config);
    this.enabled = true;
    this.config = result.config;
    return result;
  }

  async verifyPin(pin, options = {}) {
    const config = await this.getConfig();
    if (!config) {
      return { success: true, disabled: true, waitMs: 0 };
    }
    const result = await verifyPinConfiguration(config, pin, options);
    await this.settings.set(PIN_CONFIG_KEY, result.config);
    this.config = result.config;
    return result;
  }

  async recover(code, options = {}) {
    const config = await this.getConfig();
    if (!config) {
      return { success: true, disabled: true, waitMs: 0 };
    }
    const result = await verifyRecoveryConfiguration(config, code, options);
    if (result.success) {
      await this.settings.set(PIN_CONFIG_KEY, null);
      this.enabled = false;
      this.config = null;
      return { ...result, disabled: true };
    }
    await this.settings.set(PIN_CONFIG_KEY, result.config);
    this.config = result.config;
    return result;
  }

  async disable(pin) {
    const result = await this.verifyPin(pin);
    if (!result.success) {
      return result;
    }
    await this.settings.set(PIN_CONFIG_KEY, null);
    this.enabled = false;
    this.config = null;
    return { success: true, disabled: true, waitMs: 0 };
  }

  async setAutoLock(autoLockMs) {
    const config = await this.getConfig();
    if (!config) {
      throw new Error('PINロックが設定されていません。');
    }
    const allowed = [0, 60000, 300000, 900000];
    if (!allowed.includes(Number(autoLockMs))) {
      throw new Error('自動ロック時間が正しくありません。');
    }
    const updated = {
      ...config,
      autoLockMs: Number(autoLockMs),
      updatedAt: new Date().toISOString(),
    };
    await this.settings.set(PIN_CONFIG_KEY, updated);
    this.config = updated;
    return updated;
  }
}
