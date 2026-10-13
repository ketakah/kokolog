import { button, element } from './dom.mjs';

let timer = null;

export function showToast(message, options = {}) {
  const region = document.getElementById('toast-region');
  if (!region) {
    return;
  }
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  const toast = element('div', {
    className: options.actionLabel ? 'toast toast--action' : 'toast',
    attributes: {
      role: options.error ? 'alert' : 'status',
    },
  }, [
    element('span', { text: message }),
  ]);
  if (options.actionLabel && typeof options.onAction === 'function') {
    const action = button(options.actionLabel, {
      className: 'toast-action',
      on: {
        click: async () => {
          action.disabled = true;
          try {
            await options.onAction();
          } catch (error) {
            action.disabled = false;
            if (typeof options.onActionError === 'function') {
              options.onActionError(error);
              return;
            }
            console.error('通知の操作に失敗しました。', error);
            showToast(`操作に失敗しました: ${error.message}`, {
              error: true,
              duration: 5000,
            });
          }
        },
      },
    });
    toast.append(action);
  }
  region.replaceChildren(toast);
  const duration = options.duration ?? 2800;
  if (duration > 0) {
    timer = setTimeout(() => {
      region.replaceChildren();
      timer = null;
    }, duration);
  }
}
