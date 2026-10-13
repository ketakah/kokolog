export const MOODS = Object.freeze([
  Object.freeze({ value: 1, label: 'どん底', colorToken: '--cp-mood-1' }),
  Object.freeze({ value: 2, label: '落ち気味', colorToken: '--cp-mood-2' }),
  Object.freeze({ value: 3, label: '普通', colorToken: '--cp-mood-3' }),
  Object.freeze({ value: 4, label: 'いい感じ', colorToken: '--cp-mood-4' }),
  Object.freeze({ value: 5, label: '絶好調', colorToken: '--cp-mood-5' }),
]);

export function getMoodDefinition(value) {
  return MOODS.find((mood) => mood.value === value) || null;
}

export function getMoodLabel(value) {
  return getMoodDefinition(value)?.label || '';
}

export function isMoodValue(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}
