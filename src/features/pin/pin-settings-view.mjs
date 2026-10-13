import { button, element } from '../../ui/dom.mjs';
import { createScreen, createTopBar } from '../../ui/layout.mjs';
import { showToast } from '../../ui/toast.mjs';

const AUTO_LOCK_OPTIONS = [
  [0, 'アプリを閉じた時だけ'],
  [60000, '無操作1分'],
  [300000, '無操作5分'],
  [900000, '無操作15分'],
];

function createAutoLockSelect(value) {
  const select = element('select', {
    className: 'field pin-select',
    attributes: { 'aria-label': '自動ロック時間' },
  });
  for (const [milliseconds, label] of AUTO_LOCK_OPTIONS) {
    const option = element('option', {
      text: label,
      attributes: { value: milliseconds },
    });
    option.selected = Number(value) === milliseconds;
    select.append(option);
  }
  return select;
}

function renderRecoveryCode(content, recoveryCode, context) {
  content.replaceChildren();
  const saved = element('input', {
    attributes: {
      type: 'checkbox',
      id: 'recovery-saved',
    },
  });
  const done = button('保存したので完了', {
    className: 'pin-primary',
    attributes: { disabled: '' },
    on: {
      click: () => {
        context.lock.resumeIdle();
        context.router.navigate('/settings', { replace: true });
      },
    },
  });
  saved.addEventListener('change', () => {
    done.disabled = !saved.checked;
  });
  const code = element('code', {
    className: 'recovery-code',
    text: recoveryCode,
  });
  const copy = button('復旧コードをコピー', {
    className: 'detail-action',
    on: {
      click: async () => {
        try {
          await navigator.clipboard.writeText(recoveryCode);
          showToast('復旧コードをコピーしました。');
        } catch (error) {
          showToast(`コピーできませんでした: ${error.message}`, { error: true });
        }
      },
    },
  });
  content.append(
    element('section', { className: 'pin-panel card' }, [
      element('h2', { text: '復旧コードを保存してください' }),
      element('p', {
        text: 'このコードは一度だけ表示します。PINを忘れた時に必要です。ここログ外の安全な場所へ保存してください。',
      }),
      code,
      copy,
      element('label', {
        className: 'pin-confirm',
        attributes: { for: 'recovery-saved' },
      }, [
        saved,
        document.createTextNode('復旧コードを安全な場所へ保存しました'),
      ]),
      done,
    ]),
  );
}

export async function renderPinSettingsView(context) {
  const config = await context.pin.getConfig();
  const screen = createScreen();
  screen.append(
    createTopBar({
      title: 'PINロック',
      left: {
        label: '‹ 戻る',
        onClick: () => context.router.navigate('/settings', { replace: true }),
      },
    }),
  );
  const content = element('main', { className: 'pin-settings-content' });

  if (!config) {
    const pin = element('input', {
      className: 'field pin-field',
      attributes: {
        type: 'password',
        inputmode: 'numeric',
        maxlength: '6',
        autocomplete: 'new-password',
        placeholder: '6桁のPIN',
        'aria-label': '新しい6桁のPIN',
      },
    });
    const confirmation = element('input', {
      className: 'field pin-field',
      attributes: {
        type: 'password',
        inputmode: 'numeric',
        maxlength: '6',
        autocomplete: 'new-password',
        placeholder: 'PINをもう一度入力',
        'aria-label': '確認用PIN',
      },
    });
    [pin, confirmation].forEach((input) =>
      input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/gu, '').slice(0, 6);
      }),
    );
    const autoLock = createAutoLockSelect(60000);
    const submit = button('PINロックを有効にする', {
      className: 'pin-primary',
      on: {
        click: async () => {
          if (pin.value !== confirmation.value) {
            showToast('2つのPINが一致しません。', { error: true });
            return;
          }
          submit.disabled = true;
          try {
            const result = await context.pin.enable(pin.value, {
              autoLockMs: Number(autoLock.value),
            });
            context.lock.pauseIdle();
            renderRecoveryCode(content, result.recoveryCode, context);
          } catch (error) {
            submit.disabled = false;
            showToast(error.message, { error: true });
          }
        },
      },
    });
    content.append(
      element('section', { className: 'pin-panel card' }, [
        element('h2', { text: '任意の覗き見防止ロック' }),
        element('p', {
          text: 'PINは平文保存せず、salt付きPBKDF2検証値だけを端末内へ保存します。本文自体は暗号化されません。',
        }),
        element('label', { className: 'field-label', text: 'PIN' }),
        pin,
        confirmation,
        element('label', { className: 'field-label', text: '無操作でロック' }),
        element('p', {
          className: 'pin-help',
          text: '操作中はタイマーを延長します。設定に関係なく、アプリを閉じたり他のアプリへ移った後は次回表示時にロックします。',
        }),
        autoLock,
        submit,
      ]),
    );
  } else {
    const autoLock = createAutoLockSelect(config.autoLockMs);
    autoLock.addEventListener('change', async () => {
      try {
        await context.pin.setAutoLock(Number(autoLock.value));
        context.lock.resetIdle();
        showToast('自動ロック時間を変更しました。');
      } catch (error) {
        showToast(error.message, { error: true });
      }
    });
    const currentPin = element('input', {
      className: 'field pin-field',
      attributes: {
        type: 'password',
        inputmode: 'numeric',
        maxlength: '6',
        autocomplete: 'current-password',
        placeholder: '現在のPIN',
        'aria-label': '現在のPIN',
      },
    });
    currentPin.addEventListener('input', () => {
      currentPin.value = currentPin.value.replace(/\D/gu, '').slice(0, 6);
    });
    const disable = button('PINロックを無効にする', {
      className: 'detail-action danger-button',
      on: {
        click: async () => {
          try {
            const result = await context.pin.disable(currentPin.value);
            if (!result.success) {
              showToast(
                result.locked
                  ? `あと${Math.ceil(result.waitMs / 1000)}秒お待ちください。`
                  : 'PINが違います。',
                { error: true },
              );
              currentPin.value = '';
              return;
            }
            showToast('PINロックを無効にしました。');
            context.router.navigate('/settings', { replace: true });
          } catch (error) {
            showToast(error.message, { error: true });
          }
        },
      },
    });
    content.append(
      element('section', { className: 'pin-panel card' }, [
        element('h2', { text: 'PINロックは有効です' }),
        element('p', {
          text: '端末のロック解除後に他人がアプリを開くことを防ぐための簡易ロックです。',
        }),
        element('label', { className: 'field-label', text: '無操作でロック' }),
        element('p', {
          className: 'pin-help',
          text: 'タップ、文字入力、スクロールでタイマーを延長します。アプリを閉じたり他のアプリへ移ると、時間に関係なく次回表示時にロックします。',
        }),
        autoLock,
        button('今すぐロック', {
          className: 'pin-primary',
          on: { click: () => context.lock.lockNow() },
        }),
        element('label', { className: 'field-label', text: 'ロックを無効化' }),
        currentPin,
        disable,
      ]),
    );
  }

  screen.append(content);
  return {
    element: screen,
    afterRender() {
      content.querySelector('input')?.focus();
    },
  };
}
