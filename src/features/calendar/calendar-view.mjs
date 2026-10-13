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

const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];

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
  const [records] = await Promise.all([
    context.services.records.listByMonth(month),
  ]);
  const dayMap = createDayMap(records);
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
        className: 'top-bar-action',
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
        className: 'top-bar-action',
        attributes: { 'aria-label': '次の年' },
        on: {
          click: () => {
            selectedYear += 1;
            renderMonths();
          },
        },
      }),
    ]);
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
    const body = element('div', { className: 'sheet-body' }, [months, actions]);
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
  const grid = element('div', { className: 'calendar-grid' });

  for (const cell of createCalendarCells(month)) {
    const data = dayMap.get(cell.dateKey);
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
      },
      on: {
        click: () => {
          if (Date.now() < suppressCellClickUntil) {
            return;
          }
          context.router.navigate(`/day/${cell.dateKey}`);
        },
      },
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

  let pointerStart = null;
  grid.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary) {
      return;
    }
    pointerStart = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  });
  grid.addEventListener('pointerup', (event) => {
    if (!pointerStart || pointerStart.id !== event.pointerId) {
      pointerStart = null;
      return;
    }
    const deltaX = event.clientX - pointerStart.x;
    const deltaY = event.clientY - pointerStart.y;
    pointerStart = null;
    if (Math.abs(deltaX) >= 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
      suppressCellClickUntil = Date.now() + 400;
      const amount = deltaX < 0 ? 1 : -1;
      context.router.navigate(`/calendar?month=${shiftYearMonth(month, amount)}`);
    }
  });
  grid.addEventListener('pointercancel', () => {
    pointerStart = null;
  });

  panel.append(weekdays, grid);
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
