import {
  createCalendarCells,
  currentYearMonth,
  formatYearMonth,
  formatYearMonthTitle,
  parseYearMonth,
  shiftYearMonth,
} from '../../domain/calendar.mjs';
import {
  formatLocalDateTime,
  getLocalDateKey,
} from '../../domain/dates.mjs';
import { calculateMonthMoodSummary } from '../../domain/statistics.mjs';
import { button, element } from '../../ui/dom.mjs';
import { createMoodIcon } from '../../ui/icons.mjs';
import {
  createBottomTabs,
  createScreen,
  createTopBar,
} from '../../ui/layout.mjs';
import {
  calendarSwipeAxis,
  calendarSwipeDirection,
  clampCalendarDrag,
} from './swipe-gesture.mjs';

const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];
const SWIPE_SETTLE_MS = 220;

function resolveMonth(query) {
  const requested = query.get('month');
  if (!requested) {
    return currentYearMonth();
  }
  try {
    parseYearMonth(requested);
    return requested;
  } catch {
    return currentYearMonth();
  }
}

function createDayMap(records) {
  const map = new Map();
  for (const record of records) {
    const dateKey = getLocalDateKey(record.occurredAtLocal);
    const day = map.get(dateKey) || {
      count: 0,
      moods: [],
      average: null,
    };
    day.count += 1;
    if (record.mood !== null) {
      day.moods.push(record.mood);
    }
    map.set(dateKey, day);
  }
  for (const day of map.values()) {
    day.average =
      day.moods.length === 0
        ? null
        : Math.round(
            (day.moods.reduce((sum, value) => sum + value, 0) / day.moods.length) *
              10,
          ) / 10;
  }
  return map;
}

export async function renderCalendarView(context, query) {
  const month = resolveMonth(query);
  const previousMonth = shiftYearMonth(month, -1);
  const nextMonth = shiftYearMonth(month, 1);
  const [previousRecords, records, nextRecords] = await Promise.all([
    context.services.records.listByMonth(previousMonth),
    context.services.records.listByMonth(month),
    context.services.records.listByMonth(nextMonth),
  ]);
  const summary = calculateMonthMoodSummary(records, month);
  const todayKey = formatLocalDateTime(new Date()).slice(0, 10);
  const currentMonth = currentYearMonth();
  let suppressCellClickUntil = 0;
  let activeSheet = null;

  function closeMonthSheet() {
    activeSheet?.remove();
    activeSheet = null;
  }

  function openMonthSheet() {
    closeMonthSheet();
    let selectedYear = parseYearMonth(month).year;
    let suppressMonthClickUntil = 0;
    let yearGesture = null;
    const backdrop = element('div', {
      className: 'sheet-backdrop',
      on: { click: closeMonthSheet },
    });
    const sheet = element('section', {
      className: 'bottom-sheet month-picker-sheet',
      attributes: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'month-picker-title',
      },
    });
    const title = element('h2', {
      text: `${selectedYear}年`,
      attributes: { id: 'month-picker-title' },
    });
    const months = element('div', { className: 'month-picker-grid' });

    function renderMonths() {
      title.textContent = `${selectedYear}年`;
      months.replaceChildren();
      for (let monthNumber = 1; monthNumber <= 12; monthNumber += 1) {
        const value = formatYearMonth(selectedYear, monthNumber);
        months.append(
          button(`${monthNumber}月`, {
            className:
              value === month
                ? 'month-picker-button is-selected'
                : 'month-picker-button',
            attributes: {
              'aria-current': value === month ? 'true' : null,
            },
            on: {
              click: () => {
                if (Date.now() < suppressMonthClickUntil) {
                  return;
                }
                closeMonthSheet();
                context.router.navigate(`/calendar?month=${value}`);
              },
            },
          }),
        );
      }
    }

    const header = element('header', { className: 'sheet-header' }, [
      button('‹', {
        className: 'month-picker-year-button',
        attributes: { 'aria-label': '前の年' },
        on: {
          click: () => {
            selectedYear -= 1;
            renderMonths();
          },
        },
      }),
      title,
      button('›', {
        className: 'month-picker-year-button',
        attributes: { 'aria-label': '次の年' },
        on: {
          click: () => {
            selectedYear += 1;
            renderMonths();
          },
        },
      }),
    ]);
    const yearViewport = element('div', {
      className: 'month-picker-year-viewport',
    }, [months]);

    function setYearDragOffset(offset, settling = false) {
      months.classList.toggle('is-settling', settling);
      months.style.setProperty('--month-picker-drag-x', `${offset}px`);
    }

    function settleYear(direction) {
      const width = yearViewport.getBoundingClientRect().width;
      const target =
        direction === 1 ? -width : direction === -1 ? width : 0;
      setYearDragOffset(target, true);
      if (direction === 0) {
        setTimeout(() => setYearDragOffset(0, false), 180);
        return;
      }
      suppressMonthClickUntil = Date.now() + 500;
      setTimeout(() => {
        selectedYear += direction;
        renderMonths();
        setYearDragOffset(direction === 1 ? width : -width, false);
        requestAnimationFrame(() => {
          setYearDragOffset(0, true);
          setTimeout(() => setYearDragOffset(0, false), 180);
        });
      }, 180);
    }

    yearViewport.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || event.button !== 0) {
        return;
      }
      yearGesture = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        startedAt: performance.now(),
        axis: null,
      };
      yearViewport.setPointerCapture?.(event.pointerId);
      setYearDragOffset(0, false);
    });
    yearViewport.addEventListener('pointermove', (event) => {
      if (!yearGesture || yearGesture.id !== event.pointerId) {
        return;
      }
      yearGesture.lastX = event.clientX;
      yearGesture.lastY = event.clientY;
      const deltaX = event.clientX - yearGesture.x;
      const deltaY = event.clientY - yearGesture.y;
      if (!yearGesture.axis) {
        yearGesture.axis = calendarSwipeAxis(deltaX, deltaY);
      }
      if (yearGesture.axis !== 'horizontal') {
        return;
      }
      event.preventDefault();
      suppressMonthClickUntil = Date.now() + 400;
      setYearDragOffset(
        clampCalendarDrag(
          deltaX,
          yearViewport.getBoundingClientRect().width,
        ),
      );
    });
    yearViewport.addEventListener('pointerup', (event) => {
      if (!yearGesture || yearGesture.id !== event.pointerId) {
        yearGesture = null;
        return;
      }
      const currentGesture = yearGesture;
      yearGesture = null;
      yearViewport.releasePointerCapture?.(event.pointerId);
      settleYear(
        calendarSwipeDirection({
          deltaX: currentGesture.lastX - currentGesture.x,
          deltaY: currentGesture.lastY - currentGesture.y,
          elapsedMs: performance.now() - currentGesture.startedAt,
          viewportWidth: yearViewport.getBoundingClientRect().width,
        }),
      );
    });
    yearViewport.addEventListener('pointercancel', () => {
      yearGesture = null;
      settleYear(0);
    });

    const actions = element('div', { className: 'month-picker-actions' }, [
      button('閉じる', {
        className: 'detail-action',
        on: { click: closeMonthSheet },
      }),
      button('今月へ戻る', {
        className: 'detail-action',
        on: {
          click: () => {
            closeMonthSheet();
            context.router.navigate(`/calendar?month=${currentMonth}`);
          },
        },
      }),
    ]);
    const body = element('div', { className: 'sheet-body' }, [
      yearViewport,
      actions,
    ]);
    renderMonths();
    sheet.append(
      element('div', {
        className: 'sheet-handle',
        attributes: { 'aria-hidden': 'true' },
      }),
      header,
      body,
    );
    activeSheet = element('div', {}, [backdrop, sheet]);
    document.body.append(activeSheet);
    queueMicrotask(() =>
      (months.querySelector('[aria-current="true"]') ||
        months.querySelector('button'))?.focus(),
    );
  }

  const screen = createScreen({ withTabs: true });
  const topBar = createTopBar({
    title: `${formatYearMonthTitle(month)}⌄`,
    titleAriaLabel: `${formatYearMonthTitle(month)}。月を選ぶ`,
    onTitleClick: openMonthSheet,
    left: {
      label: '‹',
      ariaLabel: '前の月',
      onClick: () =>
        context.router.navigate(`/calendar?month=${shiftYearMonth(month, -1)}`),
    },
    right: {
      label: '›',
      ariaLabel: '次の月',
      onClick: () =>
        context.router.navigate(`/calendar?month=${shiftYearMonth(month, 1)}`),
    },
  });
  screen.append(topBar);

  const content = element('main', { className: 'calendar-content' });
  if (month !== currentMonth) {
    content.append(
      button('今日へ戻る', {
        className: 'calendar-today-button',
        on: {
          click: () =>
            context.router.navigate(`/calendar?month=${currentMonth}`),
        },
      }),
    );
  }

  const panel = element('section', {
    className: 'calendar-panel',
    attributes: { 'aria-label': formatYearMonthTitle(month) },
  });
  const weekdays = element('div', {
    className: 'calendar-weekdays',
    attributes: { 'aria-hidden': 'true' },
  });
  WEEKDAYS.forEach((weekday) =>
    weekdays.append(element('span', { text: weekday })),
  );
  function createMonthSlide(displayMonth, displayRecords, interactive) {
    const displayDayMap = createDayMap(displayRecords);
    const grid = element('div', { className: 'calendar-grid' });
    for (const cell of createCalendarCells(displayMonth)) {
      const data = displayDayMap.get(cell.dateKey);
      const moodValue =
        data?.average === null || data?.average === undefined
          ? null
          : Math.min(5, Math.max(1, Math.round(data.average)));
      const labels = [
        cell.dateKey,
        data ? `${data.count}件` : '記録なし',
        data?.average !== null && data?.average !== undefined
          ? `平均調子${data.average}`
          : '',
      ].filter(Boolean);
      const cellButton = button('', {
        className: [
          'calendar-cell',
          cell.inCurrentMonth ? '' : 'is-other-month',
          cell.dateKey === todayKey ? 'is-today' : '',
        ]
          .filter(Boolean)
          .join(' '),
        attributes: {
          'aria-label': labels.join('、'),
          ...(interactive ? {} : { tabindex: '-1' }),
        },
        on: interactive
          ? {
              click: () => {
                if (Date.now() < suppressCellClickUntil) {
                  return;
                }
                context.router.navigate(`/day/${cell.dateKey}`);
              },
            }
          : {},
      });
      cellButton.append(
        element('span', { className: 'calendar-date', text: cell.day }),
      );
      if (data?.count) {
        cellButton.append(
          element('span', {
            className: 'calendar-count',
            text: data.count,
            attributes: { 'aria-hidden': 'true' },
          }),
        );
      }
      if (moodValue !== null) {
        const mood = createMoodIcon(moodValue);
        mood.classList.add('calendar-mood');
        cellButton.append(
          mood,
          element('span', {
            className: 'calendar-average',
            text: data.average.toFixed(1),
            attributes: { 'aria-hidden': 'true' },
          }),
        );
      } else if (data?.count) {
        cellButton.append(
          element('span', {
            className: 'calendar-no-mood',
            text: '調子なし',
            attributes: { 'aria-hidden': 'true' },
          }),
        );
      }
      grid.append(cellButton);
    }
    return element('div', {
      className: 'calendar-month-slide',
      attributes: {
        'aria-label': formatYearMonthTitle(displayMonth),
        ...(interactive ? {} : { 'aria-hidden': 'true' }),
      },
    }, [grid]);
  }

  const swipeViewport = element('div', {
    className: 'calendar-swipe-viewport',
  });
  const swipeTrack = element('div', {
    className: 'calendar-swipe-track',
  }, [
    createMonthSlide(previousMonth, previousRecords, false),
    createMonthSlide(month, records, true),
    createMonthSlide(nextMonth, nextRecords, false),
  ]);
  swipeViewport.append(swipeTrack);

  let pointerStart = null;
  let navigationStarted = false;

  function setDragOffset(offset, settling = false) {
    swipeTrack.classList.toggle('is-settling', settling);
    swipeTrack.style.setProperty('--calendar-drag-x', `${offset}px`);
  }

  function finishGesture(direction) {
    const viewportWidth = swipeViewport.getBoundingClientRect().width;
    const targetOffset =
      direction === 1 ? -viewportWidth : direction === -1 ? viewportWidth : 0;
    setDragOffset(targetOffset, true);
    if (direction === 0) {
      setTimeout(() => setDragOffset(0, false), SWIPE_SETTLE_MS);
      return;
    }
    navigationStarted = true;
    suppressCellClickUntil = Date.now() + SWIPE_SETTLE_MS + 250;
    setTimeout(() => {
      context.router.navigate(
        `/calendar?month=${shiftYearMonth(month, direction)}`,
      );
    }, SWIPE_SETTLE_MS);
  }

  swipeViewport.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0 || navigationStarted) {
      return;
    }
    pointerStart = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startedAt: performance.now(),
      axis: null,
    };
    swipeViewport.setPointerCapture?.(event.pointerId);
    setDragOffset(0, false);
  });

  swipeViewport.addEventListener('pointermove', (event) => {
    if (!pointerStart || pointerStart.id !== event.pointerId) {
      return;
    }
    pointerStart.lastX = event.clientX;
    pointerStart.lastY = event.clientY;
    const deltaX = event.clientX - pointerStart.x;
    const deltaY = event.clientY - pointerStart.y;
    if (!pointerStart.axis) {
      pointerStart.axis = calendarSwipeAxis(deltaX, deltaY);
    }
    if (pointerStart.axis !== 'horizontal') {
      return;
    }
    event.preventDefault();
    suppressCellClickUntil = Date.now() + 400;
    setDragOffset(
      clampCalendarDrag(
        deltaX,
        swipeViewport.getBoundingClientRect().width,
      ),
      false,
    );
  });

  swipeViewport.addEventListener('pointerup', (event) => {
    if (!pointerStart || pointerStart.id !== event.pointerId) {
      pointerStart = null;
      return;
    }
    const deltaX = pointerStart.lastX - pointerStart.x;
    const deltaY = pointerStart.lastY - pointerStart.y;
    const direction = calendarSwipeDirection({
      deltaX,
      deltaY,
      elapsedMs: performance.now() - pointerStart.startedAt,
      viewportWidth: swipeViewport.getBoundingClientRect().width,
    });
    pointerStart = null;
    swipeViewport.releasePointerCapture?.(event.pointerId);
    finishGesture(direction);
  });

  swipeViewport.addEventListener('pointercancel', () => {
    pointerStart = null;
    finishGesture(0);
  });

  panel.append(weekdays, swipeViewport);
  const summaryCard = element('section', {
    className: 'calendar-summary card',
    attributes: { 'aria-label': `${formatYearMonthTitle(month)}のまとめ` },
  });
  for (const [label, value] of [
    ['平均調子', summary.average === null ? '—' : summary.average.toFixed(1)],
    ['調子記録日', `${summary.moodDays}日`],
    ['投稿数', `${summary.recordCount}件`],
  ]) {
    summaryCard.append(
      element('div', {}, [
        element('span', { text: label }),
        element('strong', { text: value }),
      ]),
    );
  }
  content.append(panel, summaryCard);

  screen.append(
    content,
    button('＋ 今を記録', {
      className: 'primary-floating',
      on: { click: () => context.router.navigate('/record/new') },
    }),
    createBottomTabs('calendar', (path) => context.router.navigate(path)),
  );
  return {
    element: screen,
    cleanup() {
      closeMonthSheet();
    },
  };
}
