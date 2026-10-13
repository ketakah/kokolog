export function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function tokenizeSearchQuery(query) {
  const normalized = normalizeSearchText(query);
  return normalized ? [...new Set(normalized.split(' ').filter(Boolean))] : [];
}

export function createDefaultTimelineFilters() {
  return {
    fromDate: '',
    toDate: '',
    moods: [],
    includeMoodless: false,
    favoriteOnly: false,
    tagIds: [],
    tagMode: 'and',
  };
}

export function prepareSearchRecord(record) {
  return {
    id: record.id,
    searchText: normalizeSearchText(`${record.title || ''}\n${record.body || ''}`),
    dateKey: record.occurredAtLocal.slice(0, 10),
    mood: record.mood,
    favorite: record.favorite,
    tagIds: [...record.tagIds],
  };
}

export function matchesTimelineCriteria(prepared, criteria = {}) {
  const tokens = tokenizeSearchQuery(criteria.query || '');
  if (tokens.some((token) => !prepared.searchText.includes(token))) {
    return false;
  }
  if (criteria.fromDate && prepared.dateKey < criteria.fromDate) {
    return false;
  }
  if (criteria.toDate && prepared.dateKey > criteria.toDate) {
    return false;
  }

  const moods = Array.isArray(criteria.moods) ? criteria.moods : [];
  const moodFilterActive = moods.length > 0 || Boolean(criteria.includeMoodless);
  if (moodFilterActive) {
    if (prepared.mood === null) {
      if (!criteria.includeMoodless) {
        return false;
      }
    } else if (!moods.includes(prepared.mood)) {
      return false;
    }
  }
  if (criteria.favoriteOnly && !prepared.favorite) {
    return false;
  }

  const tagIds = Array.isArray(criteria.tagIds) ? criteria.tagIds : [];
  if (tagIds.length > 0) {
    const recordTags = new Set(prepared.tagIds);
    if (criteria.tagMode === 'or') {
      if (!tagIds.some((tagId) => recordTags.has(tagId))) {
        return false;
      }
    } else if (!tagIds.every((tagId) => recordTags.has(tagId))) {
      return false;
    }
  }
  return true;
}

export function searchPreparedRecords(preparedRecords, criteria = {}) {
  return preparedRecords
    .filter((record) => matchesTimelineCriteria(record, criteria))
    .map((record) => record.id);
}

export function countTimelineFilters(filters) {
  let count = 0;
  if (filters.fromDate || filters.toDate) {
    count += 1;
  }
  if (filters.moods.length > 0 || filters.includeMoodless) {
    count += 1;
  }
  if (filters.favoriteOnly) {
    count += 1;
  }
  if (filters.tagIds.length > 0) {
    count += 1;
  }
  return count;
}
