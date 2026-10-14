import { createDefaultTimelineFilters } from '../domain/search.mjs';

export function createAppState() {
  return {
    timelineDirection: 'desc',
    timelineQuery: '',
    timelineFilters: createDefaultTimelineFilters(),
    timelineScrollY: 0,
    timelineVisibleLimit: 100,
  };
}
