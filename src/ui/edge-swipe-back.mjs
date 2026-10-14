const EDGE_WIDTH = 44;
const AXIS_LOCK_DISTANCE = 8;
const SETTLE_MS = 180;

export function edgeSwipeShouldNavigate({
  deltaX,
  deltaY,
  elapsedMs,
  viewportWidth,
}) {
  if (
    deltaX <= 0 ||
    Math.max(Math.abs(deltaX), Math.abs(deltaY)) < AXIS_LOCK_DISTANCE ||
    Math.abs(deltaX) <= Math.abs(deltaY) * 1.15
  ) {
    return false;
  }
  const distanceThreshold = Math.min(
    120,
    Math.max(72, viewportWidth * 0.28),
  );
  const velocity = deltaX / Math.max(1, elapsedMs);
  return (
    deltaX >= distanceThreshold ||
    (deltaX >= 36 && velocity >= 0.6)
  );
}

export function attachEdgeSwipeBack(surface, onBack) {
  let gesture = null;
  let navigating = false;

  function setOffset(offset, settling = false) {
    surface.classList.add('edge-swipe-surface');
    surface.classList.toggle('is-settling', settling);
    surface.style.setProperty('--edge-swipe-x', `${offset}px`);
  }

  function clearSurface() {
    surface.classList.remove('is-settling', 'edge-swipe-surface');
    surface.style.removeProperty('--edge-swipe-x');
  }

  function handlePointerDown(event) {
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      event.clientX > EDGE_WIDTH ||
      navigating
    ) {
      return;
    }
    gesture = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startedAt: performance.now(),
      horizontal: false,
    };
  }

  function handlePointerMove(event) {
    if (!gesture || gesture.id !== event.pointerId) {
      return;
    }
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (
      !gesture.horizontal &&
      Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= AXIS_LOCK_DISTANCE
    ) {
      gesture.horizontal =
        deltaX > 0 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15;
      if (gesture.horizontal) {
        surface.setPointerCapture?.(event.pointerId);
      }
    }
    if (!gesture.horizontal) {
      return;
    }
    event.preventDefault();
    setOffset(
      Math.min(surface.getBoundingClientRect().width, Math.max(0, deltaX)),
    );
  }

  function settleBack() {
    setOffset(0, true);
    setTimeout(clearSurface, SETTLE_MS);
  }

  function handlePointerUp(event) {
    if (!gesture || gesture.id !== event.pointerId) {
      gesture = null;
      return;
    }
    const current = gesture;
    gesture = null;
    if (surface.hasPointerCapture?.(event.pointerId)) {
      surface.releasePointerCapture(event.pointerId);
    }
    if (
      !current.horizontal ||
      !edgeSwipeShouldNavigate({
        deltaX: current.lastX - current.startX,
        deltaY: current.lastY - current.startY,
        elapsedMs: performance.now() - current.startedAt,
        viewportWidth: surface.getBoundingClientRect().width,
      })
    ) {
      settleBack();
      return;
    }
    navigating = true;
    setOffset(surface.getBoundingClientRect().width, true);
    setTimeout(onBack, SETTLE_MS);
  }

  function handlePointerCancel() {
    gesture = null;
    settleBack();
  }

  surface.addEventListener('pointerdown', handlePointerDown);
  surface.addEventListener('pointermove', handlePointerMove);
  surface.addEventListener('pointerup', handlePointerUp);
  surface.addEventListener('pointercancel', handlePointerCancel);

  return () => {
    surface.removeEventListener('pointerdown', handlePointerDown);
    surface.removeEventListener('pointermove', handlePointerMove);
    surface.removeEventListener('pointerup', handlePointerUp);
    surface.removeEventListener('pointercancel', handlePointerCancel);
    clearSurface();
  };
}
