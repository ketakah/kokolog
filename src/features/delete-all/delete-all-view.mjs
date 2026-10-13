import { deleteAllKokologData } from '../../data/delete-all-service.mjs';
import { button, element } from '../../ui/dom.mjs';
import { createScreen, createTopBar } from '../../ui/layout.mjs';
import { showToast } from '../../ui/toast.mjs';
import {
  confirmBackupSaved,
  exportAuthorizedFullBackup,
} from '../settings/backup-export.mjs';
import { requestPinReauthentication } from '../pin/pin-reauth.mjs';
import {
  cancelDeletionPreparation,
  prepareOtherClientsForDeletion,
} from '../../pwa/service-worker.mjs';
import { pinConfigurationFingerprint } from '../../security/pin-service.mjs';

const CONFIRMATION_TEXT = 'ここログの全データを削除';

function countLine(label, count) {
  return element('li', { text: `${label}: ${count}件` });
}

export async function renderDeleteAllView(context) {
  const [counts, trash, pinConfig] = await Promise.all([
    context.services.storage.getStorageCounts(context.services.database),
    context.services.records.listTrash(),
    context.pin.getConfig(),
  ]);
  const expectedPinConfigFingerprint =
    pinConfigurationFingerprint(pinConfig);
  let deleting = false;

  const screen = createScreen();
  screen.append(
    createTopBar({
      title: '全データ削除',
      left: {
        label: '‹ 戻る',
        onClick: () => context.router.back('/settings'),
      },
    }),
  );
  const content = element('main', { className: 'settings-content' });
  const backupCheckbox = element('input', {
    attributes: {
      type: 'checkbox',
      id: 'delete-backup-confirmed',
    },
  });
  const pinInput = pinConfig
    ? element('input', {
        className: 'field',
        attributes: {
          type: 'password',
          inputmode: 'numeric',
          autocomplete: 'current-password',
          maxlength: '6',
          'aria-label': '現在のPIN',
          placeholder: '現在の6桁PIN',
        },
      })
    : null;
  const phraseInput = element('input', {
    className: 'field',
    attributes: {
      type: 'text',
      autocomplete: 'off',
      'aria-label': '削除確認文言',
      placeholder: CONFIRMATION_TEXT,
    },
  });
  const deleteButton = button('ここログの全データを削除', {
    className: 'detail-action danger-action',
  });

  function updateDeleteState() {
    deleteButton.disabled =
      deleting ||
      !backupCheckbox.checked ||
      phraseInput.value !== CONFIRMATION_TEXT ||
      Boolean(pinInput && !/^\d{6}$/.test(pinInput.value));
  }

  backupCheckbox.addEventListener('change', updateDeleteState);
  phraseInput.addEventListener('input', updateDeleteState);
  pinInput?.addEventListener('input', updateDeleteState);

  const backupButton = button('完全JSONを作成', {
    className: 'detail-action',
    on: {
      click: async (event) => {
        event.currentTarget.disabled = true;
        try {
          const authorization = await requestPinReauthentication(
            context,
            '完全JSONバックアップ',
          );
          if (!authorization) {
            return;
          }
          const result = await exportAuthorizedFullBackup(
            context,
            authorization,
          );
          const confirmed = await confirmBackupSaved(context, result);
          if (confirmed) {
            backupCheckbox.checked = true;
            updateDeleteState();
            showToast(
              `${result.validation.summary.records}件の保存を確認しました。`,
            );
          } else {
            showToast('保存を確認後、チェック欄を手動で確認してください。', {
              duration: 6000,
            });
          }
        } catch (error) {
          showToast(`バックアップを作成できませんでした: ${error.message}`, {
            error: true,
          });
        } finally {
          event.currentTarget.disabled = false;
        }
      },
    },
  });

  deleteButton.addEventListener('click', async () => {
    if (
      deleting ||
      deleteButton.disabled ||
      !globalThis.confirm(
        'この端末のここログデータを完全に削除します。元に戻せません。続けますか？',
      )
    ) {
      return;
    }
    deleting = true;
    updateDeleteState();
    let deletionPrepared = false;
    try {
      const currentPinConfig = await context.pin.getConfig();
      if (
        pinConfigurationFingerprint(currentPinConfig) !==
        expectedPinConfigFingerprint
      ) {
        throw new Error(
          'PIN設定が別の画面で変更されました。画面を開き直して確認してください。',
        );
      }
      if (currentPinConfig) {
        const verification = await context.pin.verifyPin(pinInput.value);
        if (!verification.success) {
          deleting = false;
          updateDeleteState();
          const waitSeconds = Math.ceil((verification.waitMs || 0) / 1000);
          showToast(
            verification.locked
              ? `PINが違います。${waitSeconds}秒後に再試行してください。`
              : 'PINが違います。',
            { error: true, duration: 6000 },
          );
          return;
        }
      }

      const verifiedPinConfig = await context.pin.getConfig();
      const verifiedPinConfigFingerprint =
        pinConfigurationFingerprint(verifiedPinConfig);
      await prepareOtherClientsForDeletion();
      deletionPrepared = true;
      const finalPinConfig = await context.pin.getConfig();
      if (
        pinConfigurationFingerprint(finalPinConfig) !==
        verifiedPinConfigFingerprint
      ) {
        throw new Error(
          'PIN設定が削除確認中に変更されました。削除を中断しました。',
        );
      }

      context.router.stop();
      await deleteAllKokologData();
      localStorage.setItem('kokolog:resetAfterDelete', '1');
      screen.replaceChildren(
        element('main', { className: 'integrity-screen' }, [
          element('section', { className: 'integrity-card card' }, [
            element('h1', { text: 'この端末のデータを削除しました' }),
            element('p', {
              text: 'IndexedDB、ここログのブラウザー設定、App Shellキャッシュ、Service Worker登録を削除しました。',
            }),
            element('p', {
              text: navigator.onLine
                ? '初期状態で開き直してください。'
                : 'オンラインへ戻ってから初期状態で開き直してください。',
            }),
            button('初期状態で開き直す', {
              className: 'detail-action',
              on: {
                click: () => {
                  globalThis.location.replace(
                    new URL('./#/timeline', globalThis.location.href),
                  );
                  globalThis.location.reload();
                },
              },
            }),
          ]),
        ]),
      );
    } catch (error) {
      if (deletionPrepared) {
        try {
          await cancelDeletionPreparation();
        } catch (cancelError) {
          console.error('他画面の削除待機状態を解除できませんでした。', cancelError);
        }
      }
      deleting = false;
      updateDeleteState();
      showToast(`全データを削除できませんでした: ${error.message}`, {
        error: true,
        duration: 7000,
      });
    }
  });

  content.append(
    element('section', { className: 'card danger-zone' }, [
      element('h2', { text: '元に戻せない操作です' }),
      element('p', {
        text: 'この端末にある記録と設定を完全に消します。他の端末へ保存したJSONは削除しません。',
      }),
      element('ul', {}, [
        countLine('記録', counts.records),
        countLine('ゴミ箱', trash.length),
        countLine('編集履歴', counts.revisions),
        countLine('削除墓標', counts.tombstones),
        countLine('タグ', counts.tags),
        countLine('下書き', counts.drafts),
        countLine('スナップショット', counts.snapshots),
      ]),
    ]),
    element('section', { className: 'card delete-confirmation' }, [
      element('h2', { text: '1. バックアップ' }),
      element('p', {
        text: '必要な記録を完全JSONへ保存し、ファイルを安全な場所へ移してください。',
      }),
      backupButton,
      element('label', { attributes: { for: 'delete-backup-confirmed' } }, [
        backupCheckbox,
        document.createTextNode('完全JSONを保存した、または不要であることを確認しました'),
      ]),
    ]),
  );
  if (pinInput) {
    content.append(
      element('section', { className: 'card delete-confirmation' }, [
        element('h2', { text: '2. PIN再確認' }),
        pinInput,
      ]),
    );
  }
  content.append(
    element('section', { className: 'card delete-confirmation' }, [
      element('h2', { text: pinInput ? '3. 確認文言' : '2. 確認文言' }),
      element('p', {
        text: `「${CONFIRMATION_TEXT}」と入力してください。`,
      }),
      phraseInput,
      deleteButton,
    ]),
  );
  updateDeleteState();
  screen.append(content);
  return { element: screen };
}
