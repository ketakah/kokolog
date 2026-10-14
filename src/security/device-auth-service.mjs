import {
  pinConfigurationFingerprint,
} from './pin-service.mjs';

const DEVICE_AUTH_VERSION = 1;
const ES256_ALGORITHM = -7;
const CHALLENGE_BYTES = 32;
const USER_ID_BYTES = 32;
const MIN_AUTHENTICATOR_DATA_BYTES = 37;
const USER_PRESENT_FLAG = 0x01;
const USER_VERIFIED_FLAG = 0x04;

function asBytes(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError('バイナリデータの形式が正しくありません。');
}

function bytesEqual(leftValue, rightValue) {
  const left = asBytes(leftValue);
  const right = asBytes(rightValue);
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function concatBytes(...values) {
  const arrays = values.map(asBytes);
  const combined = new Uint8Array(
    arrays.reduce((total, value) => total + value.length, 0),
  );
  let offset = 0;
  for (const value of arrays) {
    combined.set(value, offset);
    offset += value.length;
  }
  return combined;
}

export function encodeBase64Url(value) {
  const bytes = asBytes(value);
  let base64;
  if (typeof btoa === 'function') {
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    base64 = btoa(binary);
  } else {
    base64 = Buffer.from(bytes).toString('base64');
  }
  return base64
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '');
}

export function decodeBase64Url(value) {
  const source = String(value || '');
  if (!/^[A-Za-z0-9_-]+$/u.test(source)) {
    throw new Error('端末認証データの形式が正しくありません。');
  }
  const padded = source
    .replace(/-/gu, '+')
    .replace(/_/gu, '/')
    .padEnd(Math.ceil(source.length / 4) * 4, '=');
  if (typeof atob === 'function') {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  return Uint8Array.from(Buffer.from(padded, 'base64'));
}

function randomBytes(cryptoProvider, length) {
  if (!cryptoProvider?.getRandomValues) {
    throw new Error('端末認証に必要な安全な乱数を生成できません。');
  }
  const bytes = new Uint8Array(length);
  cryptoProvider.getRandomValues(bytes);
  return bytes;
}

function readDerLength(bytes, index) {
  const first = bytes[index];
  if (first === undefined) {
    throw new Error('端末認証の署名形式が正しくありません。');
  }
  if ((first & 0x80) === 0) {
    return { length: first, nextIndex: index + 1 };
  }
  const octets = first & 0x7f;
  if (octets < 1 || octets > 2 || index + octets >= bytes.length) {
    throw new Error('端末認証の署名長が正しくありません。');
  }
  let length = 0;
  for (let offset = 1; offset <= octets; offset += 1) {
    length = (length << 8) | bytes[index + offset];
  }
  return { length, nextIndex: index + octets + 1 };
}

function readDerInteger(bytes, index) {
  if (bytes[index] !== 0x02) {
    throw new Error('端末認証の署名整数が見つかりません。');
  }
  const lengthInfo = readDerLength(bytes, index + 1);
  const end = lengthInfo.nextIndex + lengthInfo.length;
  if (lengthInfo.length < 1 || end > bytes.length) {
    throw new Error('端末認証の署名整数が正しくありません。');
  }
  let integer = bytes.slice(lengthInfo.nextIndex, end);
  if (integer[0] === 0) {
    integer = integer.slice(1);
  } else if ((integer[0] & 0x80) !== 0) {
    throw new Error('端末認証の署名整数が負数です。');
  }
  if (integer.length > 32) {
    throw new Error('端末認証の署名整数が長すぎます。');
  }
  const padded = new Uint8Array(32);
  padded.set(integer, 32 - integer.length);
  return { value: padded, nextIndex: end };
}

export function normalizeEs256Signature(value) {
  const signature = asBytes(value);
  if (signature.length === 64) {
    return signature;
  }
  if (signature[0] !== 0x30) {
    throw new Error('端末認証の署名形式が正しくありません。');
  }
  const sequence = readDerLength(signature, 1);
  const sequenceEnd = sequence.nextIndex + sequence.length;
  if (sequenceEnd !== signature.length) {
    throw new Error('端末認証の署名列が正しくありません。');
  }
  const left = readDerInteger(signature, sequence.nextIndex);
  const right = readDerInteger(signature, left.nextIndex);
  if (right.nextIndex !== sequenceEnd) {
    throw new Error('端末認証の署名に余分なデータがあります。');
  }
  return concatBytes(left.value, right.value);
}

function parseClientData(clientDataJSON, expected) {
  let clientData;
  try {
    clientData = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(clientDataJSON),
    );
  } catch {
    throw new Error('端末認証の応答内容を読み取れません。');
  }
  if (clientData.type !== expected.type) {
    throw new Error('端末認証の操作種別が一致しません。');
  }
  if (clientData.challenge !== encodeBase64Url(expected.challenge)) {
    throw new Error('端末認証のチャレンジが一致しません。');
  }
  if (clientData.origin !== expected.origin || clientData.crossOrigin === true) {
    throw new Error('端末認証のオリジンが一致しません。');
  }
  return clientData;
}

async function parseAuthenticatorData(
  authenticatorDataValue,
  rpId,
  cryptoProvider,
) {
  const authenticatorData = asBytes(authenticatorDataValue);
  if (authenticatorData.length < MIN_AUTHENTICATOR_DATA_BYTES) {
    throw new Error('端末認証の認証器データが短すぎます。');
  }
  const expectedRpIdHash = new Uint8Array(
    await cryptoProvider.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(rpId),
    ),
  );
  if (!bytesEqual(authenticatorData.slice(0, 32), expectedRpIdHash)) {
    throw new Error('端末認証のRP IDが一致しません。');
  }
  const flags = authenticatorData[32];
  if ((flags & USER_PRESENT_FLAG) === 0) {
    throw new Error('端末認証で利用者の操作を確認できません。');
  }
  if ((flags & USER_VERIFIED_FLAG) === 0) {
    throw new Error('Face ID、Touch ID、または端末パスコードを確認できません。');
  }
  const signCount = new DataView(
    authenticatorData.buffer,
    authenticatorData.byteOffset + 33,
    4,
  ).getUint32(0, false);
  return { authenticatorData, signCount };
}

function requireCredential(credential) {
  if (
    !credential ||
    credential.type !== 'public-key' ||
    !credential.rawId ||
    !credential.response
  ) {
    throw new Error('端末認証の応答が正しくありません。');
  }
}

export async function validateDeviceRegistration({
  credential,
  challenge,
  origin,
  rpId,
  cryptoProvider = globalThis.crypto,
  now = new Date(),
}) {
  requireCredential(credential);
  const response = credential.response;
  if (
    typeof response.getPublicKey !== 'function' ||
    typeof response.getAuthenticatorData !== 'function'
  ) {
    throw new Error('このブラウザーは端末認証の公開鍵取得に対応していません。');
  }
  parseClientData(response.clientDataJSON, {
    type: 'webauthn.create',
    challenge,
    origin,
  });
  const { signCount } = await parseAuthenticatorData(
    response.getAuthenticatorData(),
    rpId,
    cryptoProvider,
  );
  const publicKey = response.getPublicKey();
  const algorithm =
    typeof response.getPublicKeyAlgorithm === 'function'
      ? response.getPublicKeyAlgorithm()
      : ES256_ALGORITHM;
  if (!publicKey || algorithm !== ES256_ALGORITHM) {
    throw new Error('端末認証が対応していない公開鍵方式を返しました。');
  }

  const timestamp = now.toISOString();
  return {
    version: DEVICE_AUTH_VERSION,
    enabled: true,
    credentialId: encodeBase64Url(credential.rawId),
    publicKeySpki: encodeBase64Url(publicKey),
    algorithm,
    rpId,
    origin,
    signCount,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastUsedAt: null,
  };
}

async function verifyEs256(
  cryptoProvider,
  publicKeySpki,
  signature,
  signedData,
) {
  const key = await cryptoProvider.subtle.importKey(
    'spki',
    decodeBase64Url(publicKeySpki),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const normalized = normalizeEs256Signature(signature);
  try {
    if (
      await cryptoProvider.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        normalized,
        signedData,
      )
    ) {
      return true;
    }
  } catch {
    // Some older implementations accept WebAuthn's DER signature directly.
  }
  if (bytesEqual(normalized, signature)) {
    return false;
  }
  try {
    return await cryptoProvider.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signature,
      signedData,
    );
  } catch {
    return false;
  }
}

export async function verifyDeviceAssertion({
  config,
  credential,
  challenge,
  origin,
  cryptoProvider = globalThis.crypto,
}) {
  requireCredential(credential);
  if (
    config?.version !== DEVICE_AUTH_VERSION ||
    config?.algorithm !== ES256_ALGORITHM ||
    config?.origin !== origin
  ) {
    throw new Error('保存済みの端末認証設定が現在のアプリと一致しません。');
  }
  if (!bytesEqual(credential.rawId, decodeBase64Url(config.credentialId))) {
    throw new Error('登録済みとは異なる端末認証情報が返されました。');
  }
  const response = credential.response;
  parseClientData(response.clientDataJSON, {
    type: 'webauthn.get',
    challenge,
    origin,
  });
  const { authenticatorData, signCount } = await parseAuthenticatorData(
    response.authenticatorData,
    config.rpId,
    cryptoProvider,
  );
  const clientDataHash = new Uint8Array(
    await cryptoProvider.subtle.digest('SHA-256', response.clientDataJSON),
  );
  const valid = await verifyEs256(
    cryptoProvider,
    config.publicKeySpki,
    response.signature,
    concatBytes(authenticatorData, clientDataHash),
  );
  if (!valid) {
    throw new Error('端末認証の署名を検証できませんでした。');
  }
  return { signCount };
}

function browserErrorMessage(error, action) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'AbortError':
      return `${action}がキャンセルされたか、端末で確認できませんでした。`;
    case 'InvalidStateError':
      return 'この端末には同じ認証情報がすでに登録されています。';
    case 'NotSupportedError':
      return 'この端末は必要なWebAuthn方式に対応していません。';
    case 'SecurityError':
      return '安全な接続または現在のドメインでは端末認証を利用できません。';
    default:
      return error?.message || `${action}に失敗しました。`;
  }
}

export class DeviceAuthService {
  constructor(pinService, options = {}) {
    this.pin = pinService;
    this.credentials =
      options.credentials || globalThis.navigator?.credentials || null;
    this.publicKeyCredential =
      options.publicKeyCredential || globalThis.PublicKeyCredential || null;
    this.crypto = options.cryptoProvider || globalThis.crypto;
    this.getOrigin =
      options.getOrigin || (() => globalThis.location?.origin || '');
    this.getNow = options.getNow || (() => new Date());
  }

  isApiSupported() {
    return Boolean(
      globalThis.isSecureContext !== false &&
        this.credentials?.create &&
        this.credentials?.get &&
        this.publicKeyCredential &&
        this.crypto?.subtle,
    );
  }

  async getAvailability() {
    if (!this.isApiSupported()) {
      return {
        supported: false,
        available: false,
        message: 'このブラウザーでは端末認証を利用できません。',
      };
    }
    const check =
      this.publicKeyCredential
        .isUserVerifyingPlatformAuthenticatorAvailable;
    if (typeof check !== 'function') {
      return {
        supported: false,
        available: false,
        message: 'このブラウザーでは端末認証器を確認できません。',
      };
    }
    try {
      const available = await check.call(this.publicKeyCredential);
      return {
        supported: true,
        available,
        message: available
          ? 'Face ID、Touch ID、または端末パスコードを利用できます。'
          : 'この端末では利用者確認付きの端末認証を利用できません。',
      };
    } catch (error) {
      return {
        supported: true,
        available: false,
        message: `端末認証の対応状況を確認できませんでした: ${error.message}`,
      };
    }
  }

  getConfigInMemory() {
    return this.pin.getDeviceAuthConfigInMemory();
  }

  async getConfig() {
    return this.pin.getDeviceAuthConfig();
  }

  register(options = {}) {
    if (!this.isApiSupported()) {
      return Promise.reject(
        new Error('このブラウザーでは端末認証を利用できません。'),
      );
    }
    const pinConfig = this.pin.getConfigInMemory();
    const expectedFingerprint = options.expectedPinFingerprint;
    if (
      !pinConfig ||
      !expectedFingerprint ||
      pinConfigurationFingerprint(pinConfig) !== expectedFingerprint
    ) {
      return Promise.reject(
        new Error('PINの再確認期限が切れました。もう一度確認してください。'),
      );
    }
    const origin = this.getOrigin();
    const rpId = new URL(origin).hostname;
    const challenge = randomBytes(this.crypto, CHALLENGE_BYTES);
    const userId = randomBytes(this.crypto, USER_ID_BYTES);
    let operation;
    try {
      operation = this.credentials.create({
        publicKey: {
          rp: { id: rpId, name: 'ここログ' },
          user: {
            id: userId,
            name: 'ここログ',
            displayName: 'ここログ',
          },
          challenge,
          pubKeyCredParams: [
            { type: 'public-key', alg: ES256_ALGORITHM },
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            residentKey: 'discouraged',
            requireResidentKey: false,
            userVerification: 'required',
          },
          timeout: 60000,
          attestation: 'none',
        },
      });
    } catch (error) {
      return Promise.reject(
        new Error(browserErrorMessage(error, '端末認証の登録')),
      );
    }
    return this.finishRegistration(operation, {
      challenge,
      origin,
      rpId,
      expectedFingerprint,
    });
  }

  async finishRegistration(operation, expected) {
    try {
      const credential = await operation;
      const deviceConfig = await validateDeviceRegistration({
        credential,
        challenge: expected.challenge,
        origin: expected.origin,
        rpId: expected.rpId,
        cryptoProvider: this.crypto,
        now: this.getNow(),
      });
      await this.pin.setDeviceAuthConfig(
        deviceConfig,
        expected.expectedFingerprint,
      );
      return deviceConfig;
    } catch (error) {
      throw new Error(browserErrorMessage(error, '端末認証の登録'));
    }
  }

  authenticate() {
    if (!this.isApiSupported()) {
      return Promise.reject(
        new Error('このブラウザーでは端末認証を利用できません。'),
      );
    }
    const config = this.getConfigInMemory();
    if (!config?.enabled) {
      return Promise.reject(new Error('端末認証が設定されていません。'));
    }
    const origin = this.getOrigin();
    if (config.origin !== origin) {
      return Promise.reject(
        new Error('端末認証を設定したURLと現在のURLが異なります。'),
      );
    }
    const challenge = randomBytes(this.crypto, CHALLENGE_BYTES);
    let operation;
    try {
      operation = this.credentials.get({
        publicKey: {
          challenge,
          rpId: config.rpId,
          allowCredentials: [
            {
              type: 'public-key',
              id: decodeBase64Url(config.credentialId),
              transports: ['internal'],
            },
          ],
          userVerification: 'required',
          timeout: 60000,
        },
      });
    } catch (error) {
      return Promise.reject(
        new Error(browserErrorMessage(error, '端末認証')),
      );
    }
    return this.finishAuthentication(operation, {
      config,
      challenge,
      origin,
    });
  }

  async finishAuthentication(operation, expected) {
    try {
      const credential = await operation;
      const result = await verifyDeviceAssertion({
        config: expected.config,
        credential,
        challenge: expected.challenge,
        origin: expected.origin,
        cryptoProvider: this.crypto,
      });
      await this.pin.recordDeviceAuthUse(
        expected.config.credentialId,
        result.signCount,
        this.getNow(),
      );
      return { success: true, ...result };
    } catch (error) {
      throw new Error(browserErrorMessage(error, '端末認証'));
    }
  }

  async disable(expectedFingerprint) {
    await this.pin.clearDeviceAuthConfig(expectedFingerprint);
  }
}
