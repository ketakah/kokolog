const AXIS_LOCK_DISTANCE = 8;
const MIN_FLING_DISTANCE = 24;
const FLING_VELOCITY = 0.55;
const DISTANCE_RATIO = 0.22;

export function calendarSwipeAxis(deltaX, deltaY) {
  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < AXIS_LOCK_DISTANCE) {
    return null;
  }
  return Math.abs(deltaX) > Math.abs(deltaY) * 1.15
    ? 'horizontal'
    : 'vertical';
}

export function calendarSwipeDirection({
  deltaX,
  deltaY,
  elapsedMs,
  viewportWidth,
}) {
  if (calendarSwipeAxis(deltaX, deltaY) !== 'horizontal') {
    return 0;
  }
  const distance = Math.abs(deltaX);
  const threshold = Math.min(96, Math.max(54, viewportWidth * DISTANCE_RATIO));
  const velocity = distance / Math.max(1, elapsedMs);
  if (
    distance < threshold &&
    !(distance >= MIN_FLING_DISTANCE && velocity >= FLING_VELOCITY)
  ) {
    return 0;
  }
  return deltaX < 0 ? 1 : -1;
}

export function clampCalendarDrag(deltaX, viewportWidth) {
  const limit = Math.max(1, Number(viewportWidth) || 1);
  return Math.max(-limit, Math.min(limit, deltaX));
}
