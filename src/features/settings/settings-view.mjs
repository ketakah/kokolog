import {
  MAX_BACKUP_BYTES,
} from '../../domain/backup.mjs';
import { createDisplayTitle } from '../../domain/display-title.mjs';
import { button, element } from '../../ui/dom.mjs';
import {
  createBottomTabs,
  createScreen,
  createTopBar,
} from '../../ui/layout.mjs';
import { showToast } from '../../ui/toast.mjs';
import {
  confirmBackupSaved,
  exportAuthorizedFullBackup,
} from './backup-export.mjs';
import { requestPinReauthentication } from '../pin/pin-reauth.mjs';

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString('ja-JP') : '未実施';
}

function createSettingRow(title, description, value, onClick, options = {}) {
  const row = button('', {
    className: 'setting-row',
    attributes: {
      'aria-label': `${title} ${value || ''}`.trim(),
      ...(options.disabled ? { disabled: '' } : {}),
    },
    on: onClick ? { click: onClick } : {},
  });
  row.append(
    element('span', { className: 'setting-copy' }, [
      element('strong', { text: title }),
      element('small', { text: description }),
    ]),
    element('span', {
      className: options.accent ? 'setting-value setting-value-accent' : 'setting-value',
      text: value || '›',
    }),
  );
  return row;
}

function createImportSummary(analysis) {
  const values = [
    ['新規', analysis.summary.newRecords],
    ['更新', analysis.summary.updatedRecords],
    ['重複', analysis.summary.duplicateRecords],
    ['端末優先', analysis.summary.keptCurrentRecords],
    ['復活防止', analysis.summary.blockedRecords],
    ['削除予定', analysis.summary.recordIdsToDelete],
    ['競合', analysis.summary.conflicts],
  ];
  const grid = element('div', { className: 'import-summary-grid' });
  for (const [label, value] of values) {
    grid.append(
      element('div', {}, [
        element('span', { text: label }),
        element('strong', { text: value }),
      ]),
    );
  }
  return grid;
}

function createConflictResolver(conflict, resolutions, updateApplyState) {
  const section = element('section', { className: 'conflict-card card' });
  section.append(
    element('h3', { text: createDisplayTitle(conflict.current) }),
    element('p', {
      text: `端末更新: ${formatDateTime(conflict.current.updatedAt)} ／ ファイル更新: ${formatDateTime(conflict.incoming.updatedAt)}`,
    }),
  );
  const options = element('div', { className: 'conflict-options' });
  const groupName = `conflict-${conflict.id}`;
  for (const [value, label] of [
    ['current', '端末側を残す'],
    ['incoming', 'ファイル側を使う'],
  ]) {
    const input = element('input', {
      attributes: {
        type: 'radio',
        name: groupName,
        value,
        id: `${groupName}-${value}`,
      },
      on: {
        change: () => {
          resolutions[conflict.id] = value;
          updateApplyState();
        },
      },
    });
    options.append(
      element('label', { attributes: { for: `${groupName}-${value}` } }, [
        input,
        document.createTextNode(label),
      ]),
    );
  }
  section.append(options);
  return section;
}

export async function renderSettingsView(context) {
  const [backupStatus, snapshots, recordCount, tags, trash, pinConfig] = await Promise.all([
    context.services.settings.getBackupStatus(),
    context.services.backup.listSnapshots(context.services.database),
    context.services.records.countAll(),
    context.services.tags.listActive(),
    context.services.records.listTrash(),
    context.pin.getConfig(),
  ]);
  let activeModal = null;
  let fileInput = null;

  const screen = createScreen({ withTabs: true });
  screen.append(createTopBar({ title: '設定' }));
  const content = element('main', { className: 'settings-content' });

  if (backupStatus.reminderNeeded) {
    const copy = backupStatus.lastFullBackupAt
      ? `最後の完全JSONバックアップから${backupStatus.daysSinceBackup}日、${backupStatus.changesSinceBackup}件の変更があります。`
      : '完全JSONバックアップがまだありません。';
    content.append(
      element('section', { className: 'backup-reminder card' }, [
        element('strong', { text: 'バックアップをおすすめします' }),
        element('p', { text: copy }),
      ]),
    );
  }

  async function exportCurrentBackup() {
    try {
      const authorization = await requestPinReauthentication(
        context,
        '完全JSONバックアップ',
      );
      if (!authorization) {
        return null;
      }
      const result = await exportAuthorizedFullBackup(context, authorization);
      const confirmed = await confirmBackupSaved(context, result);
      if (!confirmed) {
        showToast('保存確認が完了していないため、バックアップ日時は更新していません。', {
          duration: 6000,
        });
        return null;
      }
      showToast(`${result.validation.summary.records}件の保存を確認しました。`);
      return result;
    } catch (error) {
      showToast(`バックアップを作成できませんでした: ${error.message}`, { error: true });
      throw error;
    }
  }

  function closeModal() {
    activeModal?.remove();
    activeModal = null;
    fileInput?.focus();
  }

  function openImportPreview(file, parsed, analysis) {
    closeModal();
    const resolutions = {};
    let mode = 'merge';
    let replaceBackupPrepared = false;
    let replaceConfirmed = false;
    let mergeDeletionConfirmed = analysis.recordIdsToDelete.length === 0;
    let applying = false;

    const backdrop = element('div', {
      className: 'sheet-backdrop',
      on: { click: closeModal },
    });
    const sheet = element('section', {
      className: 'bottom-sheet import-sheet',
      attributes: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'import-title',
      },
    });
    const applyButton = button('実行', {
      className: 'top-bar-action',
    });
    const header = element('header', { className: 'sheet-header' }, [
      button('取消', {
        className: 'top-bar-action',
        on: { click: closeModal },
      }),
      element('h2', {
        text: 'インポート確認',
        attributes: { id: 'import-title' },
      }),
      applyButton,
    ]);
    const body = element('div', { className: 'sheet-body' });
    const modeButtons = element('div', { className: 'import-mode' });
    const mergeButton = button('追加・統合', {
      className: 'import-mode-button is-selected',
    });
    const replaceButton = button('全置換', {
      className: 'import-mode-button',
    });
    modeButtons.append(mergeButton, replaceButton);

    const modeDetails = element('div');
    function updateApplyState() {
      const conflictsResolved = analysis.conflicts.every(
        (conflict) => resolutions[conflict.id],
      );
      applyButton.disabled =
        applying ||
        (mode === 'merge' &&
          (!conflictsResolved || !mergeDeletionConfirmed)) ||
        (mode === 'replace' && (!replaceBackupPrepared || !replaceConfirmed));
    }

    function renderModeDetails() {
      modeDetails.replaceChildren();
      mergeButton.classList.toggle('is-selected', mode === 'merge');
      replaceButton.classList.toggle('is-selected', mode === 'replace');

      if (mode === 'merge') {
        modeDetails.append(
          element('p', {
            className: 'import-note',
            text: '同じIDは更新日時が新しい方を採用し、削除墓標より古い記録は復活させません。',
          }),
        );
        if (analysis.conflicts.length > 0) {
          modeDetails.append(
            element('h3', {
              className: 'section-label',
              text: `競合 ${analysis.conflicts.length}件`,
            }),
          );
          analysis.conflicts.forEach((conflict) =>
            modeDetails.append(
              createConflictResolver(conflict, resolutions, updateApplyState),
            ),
          );
        }
        if (analysis.recordIdsToDelete.length > 0) {
          const deletionConfirm = element('input', {
            attributes: {
              type: 'checkbox',
              id: 'merge-delete-confirm',
            },
            on: {
              change: (event) => {
                mergeDeletionConfirmed = event.currentTarget.checked;
                updateApplyState();
              },
            },
          });
          deletionConfirm.checked = mergeDeletionConfirmed;
          modeDetails.append(
            element('div', { className: 'replace-warning' }, [
              element('strong', {
                text: `${analysis.recordIdsToDelete.length}件の端末記録を削除します`,
              }),
              element('p', {
                text: '適用前に端末内へ7日間の復元スナップショットを自動作成します。',
              }),
            ]),
            element('label', {
              className: 'replace-confirm',
              attributes: { for: 'merge-delete-confirm' },
            }, [
              deletionConfirm,
              document.createTextNode('削除予定を確認し、追加・統合を実行します'),
            ]),
          );
        }
      } else {
        const warning = element('div', { className: 'replace-warning' }, [
          element('strong', { text: '現在のデータをすべて置き換えます' }),
          element('p', {
            text: '実行前に完全JSONをダウンロードし、端末内にも7日間の復元スナップショットを作成します。',
          }),
        ]);
        const backupButton = button(
          replaceBackupPrepared ? '現在データのJSONを作成済み' : '現在データのJSONを保存',
          {
            className: 'detail-action',
            attributes: replaceBackupPrepared ? { disabled: '' } : {},
            on: {
              click: async () => {
                try {
                  const exported = await exportCurrentBackup();
                  if (!exported) {
                    return;
                  }
                  replaceBackupPrepared = true;
                  renderModeDetails();
                } catch (error) {
                  console.error('全置換前のバックアップ作成に失敗しました。', error);
                  updateApplyState();
                }
              },
            },
          },
        );
        const confirmInput = element('input', {
          attributes: {
            type: 'checkbox',
            id: 'replace-confirm',
          },
          on: {
            change: (event) => {
              replaceConfirmed = event.currentTarget.checked;
              updateApplyState();
            },
          },
        });
        confirmInput.checked = replaceConfirmed;
        const confirmLabel = element('label', {
          className: 'replace-confirm',
          attributes: { for: 'replace-confirm' },
        }, [
          confirmInput,
          document.createTextNode('内容を確認し、全データを置換することを理解しました'),
        ]);
        modeDetails.append(warning, backupButton, confirmLabel);
      }
      updateApplyState();
    }

    mergeButton.addEventListener('click', () => {
      mode = 'merge';
      renderModeDetails();
    });
    replaceButton.addEventListener('click', () => {
      mode = 'replace';
      renderModeDetails();
    });

    applyButton.addEventListener('click', async () => {
      applying = true;
      updateApplyState();
      try {
        if (mode === 'merge') {
          const result = await context.services.backup.applyMerge(
            context.services.database,
            analysis,
            resolutions,
          );
          showToast(
            `追加${result.newRecords}件、更新${result.updatedRecords + result.conflictsUsingIncoming}件、削除${result.recordIdsToDelete}件を反映しました。`,
            { duration: 5000 },
          );
        } else {
          const result = await context.services.backup.replaceWithBackup(
            context.services.database,
            parsed.backup,
            {
              expectedMutationGeneration: analysis.baseMutationGeneration,
            },
          );
          showToast(`${result.records}件で全置換しました。7日間は設定から復元できます。`, {
            duration: 5000,
          });
        }
        await context.theme.refresh();
        closeModal();
        await context.refresh();
      } catch (error) {
        applying = false;
        updateApplyState();
        showToast(`インポートに失敗しました: ${error.message}`, {
          error: true,
          duration: 6000,
        });
      }
    });

    body.append(
      element('div', { className: 'import-file-card' }, [
        element('strong', { text: file.name }),
        element('span', {
          text: `${file.size.toLocaleString('ja-JP')} bytes・検証済み`,
        }),
      ]),
      createImportSummary(analysis),
      modeButtons,
      modeDetails,
    );
    renderModeDetails();
    sheet.append(
      element('div', { className: 'sheet-handle', attributes: { 'aria-hidden': 'true' } }),
      header,
      body,
    );
    activeModal = element('div', {}, [backdrop, sheet]);
    document.body.append(activeModal);
    queueMicrotask(() => mergeButton.focus());
  }

  async function handleImportFile(file) {
    if (!file) {
      return;
    }
    if (file.size > MAX_BACKUP_BYTES) {
      showToast(`ファイルが大きすぎます。上限は${MAX_BACKUP_BYTES} bytesです。`, {
        error: true,
      });
      return;
    }
    try {
      showToast('バックアップを検証しています…', { duration: 5000 });
      const text = await file.text();
      const parsed = await context.services.backup.parseAndValidateBackupText(text, {
        byteLength: file.size,
      });
      const analysis = await context.services.backup.analyzeImport(
        context.services.database,
        parsed.backup,
      );
      openImportPreview(file, parsed, analysis);
    } catch (error) {
      showToast(error.message, { error: true, duration: 7000 });
    } finally {
      fileInput.value = '';
    }
  }

  fileInput = element('input', {
    className: 'visually-hidden',
    attributes: {
      type: 'file',
      accept: '.json,application/json',
      'aria-label': 'JSONバックアップを選択',
    },
    on: {
      change: (event) => handleImportFile(event.currentTarget.files?.[0]),
    },
  });
  content.append(fileInput);

  content.append(
    element('h2', { className: 'section-label', text: '表示とプライバシー' }),
    element('section', { className: 'settings-group card' }, [
      createSettingRow(
        'テーマ',
        '自動 / ライト / ダーク',
        `${context.theme.getPreference() === 'system' ? '自動' : context.theme.getPreference() === 'light' ? 'ライト' : 'ダーク'}　›`,
        () => context.router.navigate('/settings/theme'),
      ),
      createSettingRow(
        'PIN・端末認証',
        '覗き見防止。本文は暗号化されません',
        `${
          pinConfig?.deviceAuth?.enabled
            ? '両方オン'
            : pinConfig
              ? 'PINオン'
              : 'オフ'
        }　›`,
        () => context.router.navigate('/settings/pin'),
      ),
    ]),
  );

  content.append(
    element('h2', { className: 'section-label', text: 'データ' }),
    element('section', { className: 'settings-group card' }, [
      createSettingRow(
        '完全JSONバックアップ',
        `${recordCount}件の記録・${tags.length}件のタグ`,
        '作成',
        async () => {
          try {
            const exported = await exportCurrentBackup();
            if (!exported) {
              return;
            }
            await context.refresh();
          } catch (error) {
            console.error('設定画面からのバックアップ作成に失敗しました。', error);
          }
        },
        { accent: true },
      ),
      createSettingRow(
        'インポート・復元',
        '追加・統合または全置換',
        '›',
        () => fileInput.click(),
      ),
      createSettingRow(
        '最後の完全バックアップ',
        backupStatus.lastFullBackupAt
          ? `${backupStatus.changesSinceBackup}件の変更あり`
          : 'まだありません',
        formatDateTime(backupStatus.lastFullBackupAt),
        null,
        { disabled: true },
      ),
      createSettingRow(
        'ストレージ・データ状態',
        '件数、概算使用量、オフライン準備',
        '›',
        () => context.router.navigate('/settings/storage'),
      ),
    ]),
  );

  if (snapshots.length > 0) {
    const snapshot = snapshots[0];
    content.append(
      element('h2', { className: 'section-label', text: '復元' }),
      element('section', { className: 'settings-group card' }, [
        createSettingRow(
          '置換前スナップショット',
          `作成 ${formatDateTime(snapshot.createdAt)} ／ 期限 ${formatDateTime(snapshot.expiresAt)}`,
          '復元',
          async () => {
            if (!globalThis.confirm('現在のデータをスナップショットの状態へ戻しますか？')) {
              return;
            }
            try {
              const result = await context.services.backup.restoreSnapshot(
                context.services.database,
                snapshot,
              );
              showToast(`${result.records}件の状態へ復元しました。`, { duration: 5000 });
              await context.theme.refresh();
              await context.refresh();
            } catch (error) {
              showToast(`スナップショットを復元できませんでした: ${error.message}`, {
                error: true,
              });
            }
          },
          { accent: true },
        ),
      ]),
    );
  }

  content.append(
    element('h2', { className: 'section-label', text: '管理' }),
    element('section', { className: 'settings-group card' }, [
      createSettingRow(
        'ゴミ箱',
        '30日後に完全削除',
        `${trash.length}件　›`,
        () => context.router.navigate('/settings/trash'),
      ),
      createSettingRow(
        '全データ削除',
        'この端末の記録と設定を完全に削除',
        '›',
        () => context.router.navigate('/settings/delete-all'),
        { accent: true },
      ),
    ]),
  );

  content.append(
    element('h2', { className: 'section-label', text: 'このバージョン' }),
    element('section', { className: 'settings-group card' }, [
      createSettingRow(
        '実装状況',
        '記録・検索・統計・履歴・PIN・端末認証・オフライン・端末管理',
        'M10+',
        null,
        { disabled: true },
      ),
    ]),
  );

  screen.append(
    content,
    createBottomTabs('settings', (path) => context.router.navigate(path)),
  );
  return {
    element: screen,
    cleanup() {
      activeModal?.remove();
    },
  };
}
