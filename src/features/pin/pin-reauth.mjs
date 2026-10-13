import { button, element } from '../../ui/dom.mjs';
import { pinConfigurationFingerprint } from '../../security/pin-service.mjs';

function authorizationFor(config) {
  return {
    pinConfigFingerprint: pinConfigurationFingerprint(config),
  };
}

export async function requestPinReauthentication(context, reason) {
  const config = await context.pin.getConfig();
  if (!config) {
    return authorizationFor(null);
  }

  return new Promise((resolve) => {
    const input = element('input', {
      className: 'field',
      attributes: {
        type: 'password',
        inputmode: 'numeric',
        autocomplete: 'current-password',
        maxlength: '6',
        'aria-label': '現在のPIN',
        placeholder: '6桁のPIN',
      },
    });
    const status = element('div', {
      className: 'draft-status',
      attributes: { role: 'alert' },
    });
    const confirmButton = button('確認', {
      className: 'detail-action',
      attributes: { disabled: '' },
    });
    let verifying = false;

    function close(result) {
      document.removeEventListener('keydown', handleKeyDown);
      container.remove();
      resolve(result);
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
      }
    }

    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/gu, '').slice(0, 6);
      confirmButton.disabled = verifying || input.value.length !== 6;
      status.textContent = '';
    });
    confirmButton.addEventListener('click', async () => {
      if (verifying || confirmButton.disabled) {
        return;
      }
      verifying = true;
      confirmButton.disabled = true;
      status.textContent = '確認しています…';
      try {
        const result = await context.pin.verifyPin(input.value);
        if (!result.success) {
          const waitSeconds = Math.ceil((result.waitMs || 0) / 1000);
          status.textContent = result.locked
            ? `PINが違います。${waitSeconds}秒後に再試行してください。`
            : 'PINが違います。';
          input.value = '';
          input.focus();
          return;
        }
        close(authorizationFor(await context.pin.getConfig()));
      } catch (error) {
        status.textContent = `PINを確認できませんでした: ${error.message}`;
      } finally {
        verifying = false;
        confirmButton.disabled = input.value.length !== 6;
      }
    });

    const backdrop = element('div', {
      className: 'sheet-backdrop',
      on: { click: () => close(null) },
    });
    const sheet = element('section', {
      className: 'bottom-sheet',
      attributes: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'pin-reauth-title',
      },
    }, [
      element('div', { className: 'sheet-handle', attributes: { 'aria-hidden': 'true' } }),
      element('header', { className: 'sheet-header' }, [
        button('キャンセル', {
          className: 'top-bar-action',
          on: { click: () => close(null) },
        }),
        element('h2', {
          text: 'PIN再確認',
          attributes: { id: 'pin-reauth-title' },
        }),
        element('span'),
      ]),
      element('div', { className: 'sheet-body' }, [
        element('p', {
          text: `${reason}の前に現在のPINを入力してください。`,
        }),
        input,
        status,
        confirmButton,
      ]),
    ]);
    const container = element('div', {}, [backdrop, sheet]);
    document.body.append(container);
    document.addEventListener('keydown', handleKeyDown);
    queueMicrotask(() => input.focus());
  });
}
