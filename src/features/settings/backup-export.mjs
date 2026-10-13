import { createBackupFileName } from '../../domain/backup.mjs';
import { pinConfigurationFingerprint } from '../../security/pin-service.mjs';
import { button, element } from '../../ui/dom.mjs';
import { downloadTextFile } from '../../ui/download.mjs';

export async function exportAuthorizedFullBackup(context, authorization) {
  if (
    !authorization ||
    !Object.prototype.hasOwnProperty.call(
      authorization,
      'pinConfigFingerprint',
    )
  ) {
    throw new Error('PIN再確認結果がありません。');
  }
  const currentConfig = await context.pin.getConfig();
  if (
    pinConfigurationFingerprint(currentConfig) !==
    authorization.pinConfigFingerprint
  ) {
    throw new Error('PIN設定が変更されました。もう一度確認してください。');
  }
  const result = await context.services.backup.createSerializedBackup(
    context.services.database,
  );
  const fileName = createBackupFileName(result.backup.exportedAt);
  downloadTextFile(result.json, fileName);
  return result;
}

export function confirmBackupSaved(context, result) {
  return new Promise((resolve) => {
    let saving = false;

    function close(value) {
      container.remove();
      resolve(value);
    }

    const confirmButton = button('保存を確認した', {
      className: 'detail-action',
      on: {
        click: async () => {
          if (saving) {
            return;
          }
          saving = true;
          confirmButton.disabled = true;
          try {
            await context.services.settings.markFullBackup(
              result.backup.exportedAt,
            );
            close(true);
          } catch (error) {
            saving = false;
            confirmButton.disabled = false;
            status.textContent = `バックアップ日時を記録できませんでした: ${error.message}`;
          }
        },
      },
    });
    const status = element('div', {
      className: 'draft-status',
      attributes: { role: 'alert' },
    });
    const sheet = element('section', {
      className: 'bottom-sheet',
      attributes: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'backup-confirm-title',
      },
    }, [
      element('div', { className: 'sheet-handle', attributes: { 'aria-hidden': 'true' } }),
      element('header', { className: 'sheet-header' }, [
        button('後で確認', {
          className: 'top-bar-action',
          on: { click: () => close(false) },
        }),
        element('h2', {
          text: 'JSON保存の確認',
          attributes: { id: 'backup-confirm-title' },
        }),
        element('span'),
      ]),
      element('div', { className: 'sheet-body' }, [
        element('p', {
          text: '保存先または共有先にJSONファイルが存在することを確認してください。ダウンロード開始だけでは完了扱いにしません。',
        }),
        element('code', { text: createBackupFileName(result.backup.exportedAt) }),
        status,
        confirmButton,
      ]),
    ]);
    const container = element('div', {}, [
      element('div', {
        className: 'sheet-backdrop',
        on: { click: () => close(false) },
      }),
      sheet,
    ]);
    document.body.append(container);
  });
}
