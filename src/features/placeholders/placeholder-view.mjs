import { element } from '../../ui/dom.mjs';
import {
  createBottomTabs,
  createScreen,
  createTopBar,
} from '../../ui/layout.mjs';

const LABELS = {
  calendar: {
    title: 'カレンダー',
    message: 'カレンダーは次のマイルストーンで実装します。',
  },
  statistics: {
    title: '統計',
    message: '月・年の調子グラフは次のマイルストーンで実装します。',
  },
  settings: {
    title: '設定',
    message: 'バックアップ、PIN、タグ管理などは順次ここへ追加します。',
  },
};

export async function renderPlaceholderView(context, routeName) {
  const copy = LABELS[routeName];
  const screen = createScreen({ withTabs: true });
  screen.append(
    createTopBar({ title: copy.title }),
    element('main', { className: 'placeholder-content' }, [
      element('section', { className: 'status-panel card' }, [
        element('h2', { text: `${copy.title}を準備中です` }),
        element('p', { text: copy.message }),
      ]),
    ]),
    createBottomTabs(routeName, (path) => context.router.navigate(path)),
  );
  return { element: screen };
}
