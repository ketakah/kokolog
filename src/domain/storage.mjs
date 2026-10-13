export function formatStorageBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '取得できません';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = bytes / 1024;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(digits)} ${units[unitIndex]}`;
}

export function storageUsagePercent(usage, quota) {
  const normalizedUsage = Number(usage);
  const normalizedQuota = Number(quota);
  if (
    !Number.isFinite(normalizedUsage) ||
    !Number.isFinite(normalizedQuota) ||
    normalizedUsage < 0 ||
    normalizedQuota <= 0
  ) {
    return null;
  }
  return Math.min(100, Math.max(0, (normalizedUsage / normalizedQuota) * 100));
}
