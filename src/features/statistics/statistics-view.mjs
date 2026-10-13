import {
  currentYearMonth,
  daysInMonth,
  formatYearMonth,
  formatYearMonthTitle,
  parseYearMonth,
  shiftYearMonth,
} from '../../domain/calendar.mjs';
import {
  calculateMonthMoodSummary,
  calculateYearMoodSummary,
} from '../../domain/statistics.mjs';
import { button, element } from '../../ui/dom.mjs';
import {
  createBottomTabs,
  createScreen,
  createTopBar,
} from '../../ui/layout.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgElement(tagName, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tagName);
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, String(value));
  }
  return node;
}

function makeInteractive(node, label, activate) {
  node.setAttribute('role', 'button');
  node.setAttribute('tabindex', '0');
  node.setAttribute('aria-label', label);
  node.addEventListener('click', activate);
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  });
}

function createSummaryCard(values, label) {
  const card = element('section', {
    className: 'statistics-summary card',
    attributes: { 'aria-label': label },
  });
  values.forEach(([title, value]) =>
    card.append(
      element('div', {}, [
        element('span', { text: title }),
        element('strong', { text: value }),
      ]),
    ),
  );
  return card;
}

function createAxes(chart, dimensions) {
  const { left, right, top, bottom, width, height } = dimensions;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const yForValue = (value) => top + ((5 - value) / 4) * plotHeight;

  for (let value = 1; value <= 5; value += 1) {
    const y = yForValue(value);
    chart.append(
      svgElement('line', {
        class: 'stats-grid-line',
        x1: left,
        y1: y,
        x2: left + plotWidth,
        y2: y,
      }),
      svgElement('text', {
        x: left - 12,
        y: y + 3,
        'text-anchor': 'middle',
      }),
    );
    chart.lastElementChild.textContent = String(value);
  }
  return { plotWidth, plotHeight, yForValue };
}

function createMonthChart(summary, onSelect) {
  const dimensions = {
    width: 340,
    height: 250,
    left: 30,
    right: 12,
    top: 20,
    bottom: 30,
  };
  const chart = svgElement('svg', {
    class: 'stats-chart',
    viewBox: `0 0 ${dimensions.width} ${dimensions.height}`,
    role: 'group',
    'aria-label': `${formatYearMonthTitle(summary.yearMonth)}の日ごとの平均調子`,
  });
  const { plotWidth, yForValue } = createAxes(chart, dimensions);
  const totalDays = daysInMonth(summary.yearMonth);
  const xForDay = (day) =>
    dimensions.left + ((day - 1) / Math.max(1, totalDays - 1)) * plotWidth;

  for (const day of [1, 8, 15, 22, totalDays]) {
    const text = svgElement('text', {
      x: xForDay(day),
      y: dimensions.height - 7,
      'text-anchor': 'middle',
    });
    text.textContent = String(day);
    chart.append(text);
  }

  for (let index = 1; index < summary.daily.length; index += 1) {
    const previous = summary.daily[index - 1];
    const current = summary.daily[index];
    const previousDay = Number(previous.date.slice(-2));
    const currentDay = Number(current.date.slice(-2));
    chart.append(
      svgElement('line', {
        class:
          currentDay - previousDay > 1
            ? 'stats-trend-line is-missing'
            : 'stats-trend-line',
        x1: xForDay(previousDay),
        y1: yForValue(previous.average),
        x2: xForDay(currentDay),
        y2: yForValue(current.average),
      }),
    );
  }

  const pointNodes = new Map();
  function select(day) {
    pointNodes.forEach((node, date) => {
      node.classList.toggle('is-selected', date === day.date);
      node.querySelector('.stats-visible-point').setAttribute(
        'r',
        date === day.date ? '7' : '5',
      );
    });
    onSelect(day);
  }

  for (const day of summary.daily) {
    const dayNumber = Number(day.date.slice(-2));
    const moodValue = Math.min(5, Math.max(1, Math.round(day.average)));
    const group = svgElement('g', { class: 'stats-point-group' });
    group.append(
      svgElement('circle', {
        class: 'stats-hit-target',
        cx: xForDay(dayNumber),
        cy: yForValue(day.average),
        r: 15,
      }),
      svgElement('circle', {
        class: 'stats-visible-point',
        cx: xForDay(dayNumber),
        cy: yForValue(day.average),
        r: 5,
        fill: `var(--cp-mood-${moodValue})`,
      }),
    );
    makeInteractive(
      group,
      `${dayNumber}日、平均調子${day.average}、${day.moodRecordCount}件`,
      () => select(day),
    );
    pointNodes.set(day.date, group);
    chart.append(group);
  }

  return {
    chart,
    select,
  };
}

function createYearChart(summary, onSelect) {
  const dimensions = {
    width: 340,
    height: 250,
    left: 30,
    right: 10,
    top: 20,
    bottom: 30,
  };
  const chart = svgElement('svg', {
    class: 'stats-chart',
    viewBox: `0 0 ${dimensions.width} ${dimensions.height}`,
    role: 'group',
    'aria-label': `${summary.year}年の月ごとの平均調子`,
  });
  const { plotWidth, yForValue } = createAxes(chart, dimensions);
  const slotWidth = plotWidth / 12;
  const barWidth = Math.min(16, slotWidth * 0.62);
  const bottomY = yForValue(1);
  const barNodes = new Map();

  function select(month) {
    barNodes.forEach((node, yearMonth) => {
      node.classList.toggle('is-selected', yearMonth === month.yearMonth);
    });
    onSelect(month);
  }

  summary.months.forEach((month, index) => {
    const centerX = dimensions.left + slotWidth * index + slotWidth / 2;
    const label = svgElement('text', {
      x: centerX,
      y: dimensions.height - 7,
      'text-anchor': 'middle',
    });
    label.textContent = String(index + 1);
    chart.append(label);

    if (month.average === null) {
      return;
    }
    const moodValue = Math.min(5, Math.max(1, Math.round(month.average)));
    const valueY = yForValue(month.average);
    const group = svgElement('g', { class: 'stats-bar-group' });
    group.append(
      svgElement('rect', {
        class: 'stats-visible-bar',
        x: centerX - barWidth / 2,
        y: Math.min(valueY, bottomY - 2),
        width: barWidth,
        height: Math.max(2, bottomY - valueY),
        rx: 4,
        fill: `var(--cp-mood-${moodValue})`,
      }),
      svgElement('rect', {
        class: 'stats-hit-target',
        x: centerX - slotWidth / 2,
        y: dimensions.top,
        width: slotWidth,
        height: bottomY - dimensions.top + 12,
      }),
    );
    makeInteractive(
      group,
      `${index + 1}月、平均調子${month.average}、${month.moodDays}日、${month.recordCount}件`,
      () => select(month),
    );
    barNodes.set(month.yearMonth, group);
    chart.append(group);
  });

  return { chart, select };
}

function resolveView(query) {
  return query.get('view') === 'year' ? 'year' : 'month';
}

function resolveMonth(query) {
  const requested = query.get('at') || currentYearMonth();
  try {
    parseYearMonth(requested);
    return requested;
  } catch {
    return currentYearMonth();
  }
}

function resolveYear(query) {
  const requested = Number(query.get('at') || currentYearMonth().slice(0, 4));
  return Number.isInteger(requested) && requested >= 1 && requested <= 9999
    ? requested
    : Number(currentYearMonth().slice(0, 4));
}

export async function renderStatisticsView(context, query) {
  const view = resolveView(query);
  const month = resolveMonth(query);
  const year = view === 'year' ? resolveYear(query) : Number(month.slice(0, 4));
  const records =
    view === 'year'
      ? await context.services.records.listByYear(year)
      : await context.services.records.listByMonth(month);
  const summary =
    view === 'year'
      ? calculateYearMoodSummary(records, year)
      : calculateMonthMoodSummary(records, month);

  const screen = createScreen({ withTabs: true });
  const shift = (amount) => {
    if (view === 'year') {
      context.router.navigate(`/statistics?view=year&at=${year + amount}`);
    } else {
      context.router.navigate(
        `/statistics?view=month&at=${shiftYearMonth(month, amount)}`,
      );
    }
  };
  screen.append(
    createTopBar({
      title: view === 'year' ? `${year}年` : formatYearMonthTitle(month),
      left: { label: '‹', ariaLabel: '前へ', onClick: () => shift(-1) },
      right: { label: '›', ariaLabel: '次へ', onClick: () => shift(1) },
    }),
  );

  const content = element('main', { className: 'statistics-content' });
  const switcher = element('div', {
    className: 'statistics-switcher',
    attributes: { role: 'group', 'aria-label': '統計の表示範囲' },
  }, [
    button('月', {
      className: view === 'month' ? 'is-selected' : '',
      attributes: { 'aria-pressed': String(view === 'month') },
      on: {
        click: () =>
          context.router.navigate(
            `/statistics?view=month&at=${formatYearMonth(year, Math.min(12, Number(month.slice(5, 7)) || 1))}`,
          ),
      },
    }),
    button('年', {
      className: view === 'year' ? 'is-selected' : '',
      attributes: { 'aria-pressed': String(view === 'year') },
      on: {
        click: () =>
          context.router.navigate(`/statistics?view=year&at=${year}`),
      },
    }),
  ]);
  content.append(switcher);

  if (view === 'month') {
    content.append(
      createSummaryCard(
        [
          ['平均調子', summary.average === null ? '—' : summary.average.toFixed(1)],
          ['調子記録日', `${summary.moodDays}日`],
          ['投稿数', `${summary.recordCount}件`],
        ],
        `${formatYearMonthTitle(month)}のまとめ`,
      ),
    );
  } else {
    content.append(
      createSummaryCard(
        [
          ['年平均', summary.average === null ? '—' : summary.average.toFixed(1)],
          ['調子記録日', `${summary.moodDays}日`],
          ['投稿数', `${summary.recordCount}件`],
        ],
        `${year}年のまとめ`,
      ),
    );
  }

  const chartCard = element('section', { className: 'statistics-chart-card card' });
  chartCard.append(
    element('header', { className: 'statistics-chart-header' }, [
      element('strong', {
        text: view === 'month' ? '日ごとの平均調子' : '月ごとの平均調子',
      }),
      element('span', { text: '縦軸 1〜5' }),
    ]),
  );
  const selection = button('', {
    className: 'statistics-selection',
    attributes: { disabled: '' },
  });
  selection.hidden = true;

  if (
    (view === 'month' && summary.daily.length === 0) ||
    (view === 'year' && summary.moodMonths === 0)
  ) {
    chartCard.append(
      element('div', { className: 'statistics-empty' }, [
        element('strong', { text: '調子の記録がありません' }),
        element('p', {
          text: '調子を入力した記録が増えると、ここに推移が表示されます。',
        }),
      ]),
    );
  } else if (view === 'month') {
    const monthChart = createMonthChart(summary, (day) => {
      selection.hidden = false;
      selection.disabled = false;
      selection.textContent = `${Number(day.date.slice(-2))}日　平均${day.average.toFixed(1)}　${day.moodRecordCount}件の調子 ›`;
      selection.onclick = () => context.router.navigate(`/day/${day.date}`);
    });
    chartCard.append(monthChart.chart);
    const lastDay = summary.daily[summary.daily.length - 1];
    monthChart.select(lastDay);
    chartCard.append(
      element('p', {
        className: 'statistics-legend',
        text: '破線は調子未入力の日をまたぐ区間です。',
      }),
    );
  } else {
    const yearChart = createYearChart(summary, (monthSummary) => {
      selection.hidden = false;
      selection.disabled = false;
      selection.textContent = `${Number(monthSummary.yearMonth.slice(5, 7))}月　平均${monthSummary.average.toFixed(1)}　${monthSummary.moodDays}日　${monthSummary.recordCount}件 ›`;
      selection.onclick = () =>
        context.router.navigate(`/calendar?month=${monthSummary.yearMonth}`);
    });
    chartCard.append(yearChart.chart);
    const lastMonth = [...summary.months]
      .reverse()
      .find((monthSummary) => monthSummary.average !== null);
    if (lastMonth) {
      yearChart.select(lastMonth);
    }
  }
  content.append(chartCard, selection);
  screen.append(
    content,
    createBottomTabs('statistics', (path) => context.router.navigate(path)),
  );
  return { element: screen };
}
