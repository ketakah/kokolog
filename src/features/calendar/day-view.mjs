import {
  formatDayTitle,
  isValidDateKey,
} from '../../domain/calendar.mjs';
import { formatLocalDateTime } from '../../domain/dates.mjs';
import { calculateDailyMoodAverages } from '../../domain/statistics.mjs';
import { button, element } from '../../ui/dom.mjs';
import { createMoodIcon } from '../../ui/icons.mjs';
import { createScreen, createTopBar } from '../../ui/layout.mjs';
import { createRecordCard } from '../timeline/timeline-view.mjs';

export async function renderDayView(context, dateKey) {
  if (!isValidDateKey(dateKey)) {
    throw new Error('日付が正しくありません。');
  }
  const [records, tags] = await Promise.all([
    context.services.records.listByDay(dateKey, { direction: 'asc' }),
    context.services.tags.listActive(),
  ]);
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const daily = calculateDailyMoodAverages(records)[0] || null;
  const currentDateKey = formatLocalDateTime(new Date()).slice(0, 10);
  const canCreate = dateKey <= currentDateKey;

  const screen = createScreen();
  screen.append(
    createTopBar({
      title: formatDayTitle(dateKey),
      left: {
        label: '‹ 戻る',
        onClick: () =>
          context.router.navigate(`/calendar?month=${dateKey.slice(0, 7)}`),
      },
    }),
  );
  const content = element('main', { className: 'day-content' });
  const summary = element('section', { className: 'day-summary card' });
  if (daily) {
    const moodValue = Math.min(5, Math.max(1, Math.round(daily.average)));
    const icon = createMoodIcon(moodValue, {
      label: `平均調子${daily.average}`,
    });
    summary.append(icon);
  } else {
    summary.append(
      element('div', {
        className: 'day-summary-placeholder',
        text: '—',
        attributes: { 'aria-hidden': 'true' },
      }),
    );
  }
  summary.append(
    element('div', {}, [
      element('strong', {
        text: daily ? `平均 ${daily.average.toFixed(1)}` : '調子の記録なし',
      }),
      element('span', {
        text: daily ? `調子を入力した投稿 ${daily.moodRecordCount}件` : '',
      }),
    ]),
    element('div', { className: 'day-summary-count' }, [
      element('strong', { text: `${records.length}件` }),
      element('span', { text: '投稿' }),
    ]),
  );
  content.append(summary);

  if (records.length === 0) {
    content.append(
      element('section', { className: 'status-panel card' }, [
        element('h2', { text: 'この日の記録はまだありません' }),
        element('p', {
          text: canCreate
            ? 'この日に感じたことを残せます。'
            : '未来の日付には記録を作成できません。',
        }),
      ]),
    );
  } else {
    const list = element('section', { className: 'day-records' });
    list.append(
      element('header', { className: 'date-group-header' }, [
        element('strong', { text: '朝から夜の順' }),
        element('span', { text: `${records.length}件` }),
      ]),
    );
    records.forEach((record) =>
      list.append(createRecordCard(record, tagsById, context)),
    );
    content.append(list);
  }
  screen.append(content);
  if (canCreate) {
    screen.append(
      button('＋ この日に記録', {
        className: 'day-create-button',
        on: {
          click: () =>
            context.router.navigate(`/record/new?date=${dateKey}`),
        },
      }),
    );
  }
  return { element: screen };
}
