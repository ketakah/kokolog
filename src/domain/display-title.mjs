import { getMoodLabel } from './moods.mjs';

export const DEFAULT_DISPLAY_TITLE_LENGTH = 32;

export function truncateText(value, maxCharacters = DEFAULT_DISPLAY_TITLE_LENGTH) {
  const characters = Array.from(String(value || '').trim());
  if (characters.length <= maxCharacters) {
    return characters.join('');
  }
  return `${characters.slice(0, maxCharacters).join('').trimEnd()}…`;
}

function firstMeaningfulBodyLine(body) {
  const line = String(body || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((value) => value.trim())
    .find(Boolean);

  if (!line) {
    return '';
  }

  const sentenceEnd = line.search(/[。！？!?]/u);
  return sentenceEnd >= 0 ? line.slice(0, sentenceEnd + 1) : line;
}

export function createDisplayTitle(record, maxCharacters = DEFAULT_DISPLAY_TITLE_LENGTH) {
  const explicitTitle = String(record?.title || '').trim();
  if (explicitTitle) {
    return truncateText(explicitTitle, maxCharacters);
  }

  const bodyTitle = firstMeaningfulBodyLine(record?.body);
  if (bodyTitle) {
    return truncateText(bodyTitle, maxCharacters);
  }

  const moodLabel = getMoodLabel(record?.mood);
  if (moodLabel) {
    return `調子：${moodLabel}`;
  }

  return '記録';
}
