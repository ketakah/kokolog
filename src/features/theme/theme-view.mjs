import { THEME_PREFERENCES } from '../../app/theme.mjs';
import { button, element } from '../../ui/dom.mjs';
import { createScreen, createTopBar } from '../../ui/layout.mjs';
import { showToast } from '../../ui/toast.mjs';

const THEME_LABELS = Object.freeze({
  system: ['自動', 'iPhoneまたはブラウザーの設定に合わせます'],
  light: ['ライト', '常に明るい配色で表示します'],
  dark: ['ダーク', '常に暗い配色で表示します'],
});

export async function renderThemeView(context) {
  const screen = createScreen();
  screen.append(
    createTopBar({
      title: 'テーマ',
      left: {
        label: '‹ 戻る',
        onClick: () => context.router.back('/settings'),
      },
    }),
  );
  const content = element('main', { className: 'settings-content' });
  const group = element('section', {
    className: 'settings-group card',
    attributes: {
      role: 'group',
      'aria-label': 'テーマ',
    },
  });

  function renderOptions() {
    group.replaceChildren();
    const current = context.theme.getPreference();
    for (const preference of THEME_PREFERENCES) {
      const [label, description] = THEME_LABELS[preference];
      group.append(
        button('', {
          className: 'setting-row',
          attributes: {
            'aria-label': `${label} ${description}`,
            'aria-pressed': String(current === preference),
          },
          on: {
            click: async (event) => {
              event.currentTarget.disabled = true;
              try {
                await context.theme.setPreference(preference);
                renderOptions();
                showToast(`テーマを「${label}」へ変更しました。`);
              } catch (error) {
                event.currentTarget.disabled = false;
                showToast(`テーマを変更できませんでした: ${error.message}`, {
                  error: true,
                });
              }
            },
          },
        }, [
          element('span', { className: 'setting-copy' }, [
            element('strong', { text: label }),
            element('small', { text: description }),
          ]),
          element('span', {
            className: 'setting-value setting-value-accent',
            text: current === preference ? '✓' : '',
          }),
        ]),
      );
    }
  }

  renderOptions();
  content.append(
    element('p', {
      className: 'settings-note',
      text: 'テーマ設定は完全JSONバックアップへ含まれます。記録本文には影響しません。',
    }),
    group,
  );
  screen.append(content);
  return { element: screen };
}
