'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const outputDirectory = path.join(root, 'icons');
const samplesPerAxis = 4;
const background = [57, 123, 145, 255];
const bubble = [252, 251, 248, 255];
const heart = [48, 105, 125, 255];

function createCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

const crcTable = createCrcTable();

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function insideRoundedRectangle(x, y, centerX, centerY, width, height, radius) {
  const dx = Math.abs(x - centerX) - (width / 2 - radius);
  const dy = Math.abs(y - centerY) - (height / 2 - radius);
  const outsideX = Math.max(dx, 0);
  const outsideY = Math.max(dy, 0);
  return (
    Math.hypot(outsideX, outsideY) + Math.min(Math.max(dx, dy), 0) <= radius
  );
}

function triangleSign(px, py, ax, ay, bx, by) {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by);
}

function insideTriangle(px, py, points) {
  const [a, b, c] = points;
  const first = triangleSign(px, py, ...a, ...b);
  const second = triangleSign(px, py, ...b, ...c);
  const third = triangleSign(px, py, ...c, ...a);
  const hasNegative = first < 0 || second < 0 || third < 0;
  const hasPositive = first > 0 || second > 0 || third > 0;
  return !(hasNegative && hasPositive);
}

function insideHeart(x, y) {
  const scaledX = (x - 0.5) / 0.115;
  const scaledY = (0.49 - y) / 0.115;
  const squared = scaledX * scaledX + scaledY * scaledY;
  return (squared - 1) ** 3 - scaledX * scaledX * scaledY ** 3 <= 0;
}

function sampleIcon(x, y, maskable) {
  const bubbleWidth = maskable ? 0.5 : 0.62;
  const bubbleHeight = maskable ? 0.42 : 0.52;
  const bubbleCenterY = maskable ? 0.46 : 0.45;
  const inBubble =
    insideRoundedRectangle(
      x,
      y,
      0.5,
      bubbleCenterY,
      bubbleWidth,
      bubbleHeight,
      0.13,
    ) ||
    insideTriangle(
      x,
      y,
      maskable
        ? [
            [0.37, 0.62],
            [0.45, 0.61],
            [0.39, 0.7],
          ]
        : [
            [0.32, 0.65],
            [0.43, 0.63],
            [0.34, 0.76],
          ],
    );

  if (!inBubble) {
    return background;
  }
  if (insideHeart(x, y)) {
    return heart;
  }
  return bubble;
}

function renderIcon(size, maskable = false) {
  const pixels = Buffer.alloc(size * size * 4);
  const sampleCount = samplesPerAxis * samplesPerAxis;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const totals = [0, 0, 0, 0];
      for (let sampleY = 0; sampleY < samplesPerAxis; sampleY += 1) {
        for (let sampleX = 0; sampleX < samplesPerAxis; sampleX += 1) {
          const color = sampleIcon(
            (x + (sampleX + 0.5) / samplesPerAxis) / size,
            (y + (sampleY + 0.5) / samplesPerAxis) / size,
            maskable,
          );
          for (let channel = 0; channel < 4; channel += 1) {
            totals[channel] += color[channel];
          }
        }
      }
      const offset = (y * size + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        pixels[offset + channel] = Math.round(totals[channel] / sampleCount);
      }
    }
  }
  return pixels;
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  const rowLength = size * 4;
  const raw = Buffer.alloc((rowLength + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * (rowLength + 1);
    raw[rowOffset] = 0;
    pixels.copy(raw, rowOffset + 1, y * rowLength, (y + 1) * rowLength);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function writeIcon(fileName, size, maskable = false) {
  const pixels = renderIcon(size, maskable);
  fs.writeFileSync(
    path.join(outputDirectory, fileName),
    encodePng(size, pixels),
  );
}

fs.mkdirSync(outputDirectory, { recursive: true });
writeIcon('icon-180.png', 180);
writeIcon('icon-192.png', 192);
writeIcon('icon-512.png', 512);
writeIcon('icon-maskable-512.png', 512, true);
process.stdout.write(`Wrote 4 Kokolog icons to ${outputDirectory}\n`);
