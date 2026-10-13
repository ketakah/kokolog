import {
  createDefaultRecordInput,
  validateRecordInput,
} from '../../domain/record.mjs';
import { isValidDateKey } from '../../domain/calendar.mjs';
import { formatLocalDateTime } from '../../domain/dates.mjs';
import { MOODS } from '../../domain/moods.mjs';
import { button, element } from '../../ui/dom.mjs';
import { createMoodIcon } from '../../ui/icons.mjs';
import { createScreen, createTopBar } from '../../ui/layout.mjs';
import { showToast } from '../../ui/toast.mjs';
import { createDraftSaveCoordinator } from './draft-save-coordinator.mjs';

const DRAFT_SAVE_DELAY = 450;

function draftIdFor(recordId) {
  return recordId ? `edit:${recordId}` : 'create';
}

function fieldsFromRecord(record) {
  return {
    title: record.title,
    body: record.body,
    mood: record.mood,
    tagIds: [...record.tagIds],
    favorite: record.favorite,
    occurredAtLocal: record.occurredAtLocal,
    occurredUtcOffsetMinutes: record.occurredUtcOffsetMinutes,
  };
}

function hasMeaningfulDraft(fields) {
  return Boolean(
    fields.title.trim() ||
      fields.body.trim() ||
      fields.mood !== null ||
      fields.tagIds.length > 0,
  );
}

function sameEditableFields(left, right) {
  const leftTagIds = [...left.tagIds].sort();
  const rightTagIds = [...right.tagIds].sort();
  return (
    left.title === right.title &&
    left.body === right.body &&
    left.mood === right.mood &&
    left.favorite === right.favorite &&
    left.occurredAtLocal === right.occurredAtLocal &&
    left.occurredUtcOffsetMinutes === right.occurredUtcOffsetMinutes &&
    leftTagIds.length === rightTagIds.length &&
    leftTagIds.every((tagId, index) => tagId === rightTagIds[index])
  );
}

export async function renderEditorView(context, options = {}) {
  const recordId = options.recordId || null;
  const existing = recordId ? await context.services.records.get(recordId) : null;
  if (recordId && (!existing || existing.deletedAt !== null)) {
    throw new Error('編集する記録が見つかりません。');
  }

  const id = draftIdFor(recordId);
  const storedDraft = await context.services.drafts.get(id);
  if (
    storedDraft &&
    existing &&
    storedDraft.baseRevision !== null &&
    storedDraft.baseRevision !== existing.revision
  ) {
    throw new Error('下書きの作成後に記録が更新されています。下書きを破棄するか、現在の記録を確認してください。');
  }

  const baseFields = existing ? fieldsFromRecord(existing) : createDefaultRecordInput();
  if (!existing && options.initialDate && isValidDateKey(options.initialDate)) {
    baseFields.occurredAtLocal =
      `${options.initialDate}T${baseFields.occurredAtLocal.slice(11)}`;
  }
  const initialFields = storedDraft?.fields
    ? {
        ...baseFields,
        ...storedDraft.fields,
        tagIds: [...(storedDraft.fields.tagIds || [])],
      }
    : baseFields;
  const selectedTagIds = new Set(initialFields.tagIds);
  let selectedMood = initialFields.mood;
  let draftTimer = null;
  let activeSheet = null;
  let isComposing = false;
  let titleVisible = Boolean(initialFields.title);
  let saving = false;
  let tagSheetTrigger = null;

  const screen = createScreen();
  const titleInput = element('input', {
    className: 'field title-field',
    attributes: {
      type: 'text',
      maxlength: '300',
      value: initialFields.title,
      'aria-label': 'タイトル',
      placeholder: 'タイトル',
    },
  });
  titleInput.hidden = !titleVisible;

  const bodyInput = element('textarea', {
    className: 'field body-field',
    attributes: {
      maxlength: '100000',
      placeholder: 'いま考えていること、感じていることを書いてください',
      'aria-label': '本文',
    },
    text: initialFields.body,
  });
  const datetimeInput = element('input', {
    className: 'field datetime-field',
    attributes: {
      type: 'datetime-local',
      step: '60',
      max: formatLocalDateTime(new Date(), false),
      value: initialFields.occurredAtLocal.slice(0, 16),
      'aria-label': '記録日時',
    },
  });
  const draftStatus = element('div', {
    className: 'draft-status',
    text: storedDraft ? '保存していた下書きを復元しました' : '',
    attributes: { role: 'status' },
  });
  const moodPicker = element('div', {
    className: 'mood-picker',
    attributes: { role: 'group', 'aria-label': '調子' },
  });
  const moodClear = button('選択を解除', {
    className: 'text-button mood-clear',
  });
  const selectedTags = element('div', {
    className: 'selected-tags',
    attributes: { 'aria-label': '選択済みタグ' },
  });
  const draftCoordinator = createDraftSaveCoordinator(async (fields) => {
    if (hasMeaningfulDraft(fields)) {
      await context.services.drafts.save({
        id,
        mode: existing ? 'edit' : 'create',
        recordId: existing?.id || null,
        baseRevision: existing?.revision || null,
        fields,
        savedAt: new Date().toISOString(),
      });
    } else {
      await context.services.drafts.delete(id);
    }
  });

  let tags = await context.services.tags.listActive();
  let tagsById = new Map(tags.map((tag) => [tag.id, tag]));

  function getFields() {
    const localValue = datetimeInput.value
      ? `${datetimeInput.value}:00`
      : initialFields.occurredAtLocal;
    return {
      title: titleVisible ? titleInput.value : '',
      body: bodyInput.value,
      mood: selectedMood,
      tagIds: [...selectedTagIds],
      favorite: existing?.favorite || false,
      occurredAtLocal: localValue,
      occurredUtcOffsetMinutes: initialFields.occurredUtcOffsetMinutes,
    };
  }

  function updateSaveState() {
    const fields = getFields();
    const validation = validateRecordInput(fields, { now: new Date() });
    const unchanged =
      Boolean(existing) &&
      sameEditableFields(fields, fieldsFromRecord(existing));
    saveButton.disabled = !validation.valid || saving || unchanged;
    saveButton.title = !validation.valid
      ? validation.errors[0]
      : unchanged
        ? '変更はありません'
        : '';
  }

  function freezeEditor() {
    const controls = [...screen.querySelectorAll('button, input, select, textarea')];
    const disabledStates = controls.map((control) => control.disabled);
    controls.forEach((control) => {
      control.disabled = true;
    });
    screen.setAttribute('aria-busy', 'true');
    return () => {
      controls.forEach((control, index) => {
        control.disabled = disabledStates[index];
      });
      screen.removeAttribute('aria-busy');
      updateSaveState();
    };
  }

  function renderMoods() {
    moodPicker.replaceChildren();
    for (const mood of MOODS) {
      const moodButton = button('', {
        className: 'mood-option',
        dataset: { mood: mood.value },
        attributes: {
          'aria-label': `${mood.label} ${mood.value}`,
          'aria-pressed': String(selectedMood === mood.value),
        },
        on: {
          click: () => {
            selectedMood = mood.value;
            renderMoods();
            markDraftDirty();
          },
        },
      });
      moodButton.append(
        createMoodIcon(mood.value),
        element('span', { text: mood.label }),
      );
      moodPicker.append(moodButton);
    }
    moodClear.hidden = selectedMood === null;
    updateSaveState();
  }

  function renderSelectedTags() {
    selectedTags.replaceChildren();
    for (const tagId of selectedTagIds) {
      const tag = tagsById.get(tagId);
      if (!tag) {
        continue;
      }
      selectedTags.append(
        button(`${tag.name}　×`, {
          className: 'chip selected-tag',
          attributes: { 'aria-label': `${tag.name}を外す` },
          on: {
            click: () => {
              selectedTagIds.delete(tagId);
              renderSelectedTags();
              markDraftDirty();
            },
          },
        }),
      );
    }
    selectedTags.append(
      button('＋ タグを追加', {
        className: 'tag-add-button',
        on: {
          click: (event) => openTagSheet(event.currentTarget),
        },
      }),
    );
  }

  async function saveDraftNow() {
    if (draftTimer) {
      clearTimeout(draftTimer);
      draftTimer = null;
    }
    if (!draftCoordinator.hasUnsavedChanges()) {
      await draftCoordinator.drain();
      return;
    }

    const fields = getFields();
    draftStatus.textContent = '下書きを保存中…';
    try {
      const result = await draftCoordinator.save(fields);
      if (result.hasUnsavedChanges) {
        draftStatus.textContent = '下書きに未保存の変更があります';
      } else {
        draftStatus.textContent = hasMeaningfulDraft(fields)
          ? '下書き保存済み'
          : '';
      }
    } catch (error) {
      draftStatus.textContent = `下書きを保存できませんでした: ${error.message}`;
      throw error;
    }
  }

  function queueDraftSave() {
    if (draftTimer) {
      clearTimeout(draftTimer);
    }
    draftStatus.textContent = '下書きに未保存の変更があります';
    draftTimer = setTimeout(() => {
      saveDraftNow().catch((error) => {
        showToast(`下書きを保存できませんでした: ${error.message}`, { error: true });
      });
    }, DRAFT_SAVE_DELAY);
  }

  function markDraftDirty() {
    draftCoordinator.markEdited();
    updateSaveState();
    queueDraftSave();
  }

  async function handleClose() {
    const releaseEditor = freezeEditor();
    try {
      await saveDraftNow();
      context.router.back('/timeline');
    } catch (error) {
      releaseEditor();
      showToast(`画面を閉じる前に下書きを保存できませんでした: ${error.message}`, {
        error: true,
      });
    }
  }

  async function handleSave() {
    if (saving) {
      return;
    }
    saving = true;
    updateSaveState();
    const releaseEditor = freezeEditor();
    try {
      if (draftTimer) {
        clearTimeout(draftTimer);
        draftTimer = null;
      }
      await draftCoordinator.drain();
      const saved = existing
        ? await context.services.records.update(existing.id, getFields())
        : await context.services.records.create(getFields());
      await context.services.drafts.delete(id);
      draftCoordinator.markPersisted();
      showToast('記録を保存しました。');
      if (existing) {
        context.router.back(`/record/${encodeURIComponent(saved.id)}`);
      } else {
        context.router.navigate(`/record/${encodeURIComponent(saved.id)}`, {
          replace: true,
        });
      }
    } catch (error) {
      saving = false;
      releaseEditor();
      updateSaveState();
      showToast(`記録を保存できませんでした: ${error.message}`, { error: true });
    }
  }

  function closeTagSheet() {
    if (!activeSheet) {
      return;
    }
    activeSheet.remove();
    activeSheet = null;
    tagSheetTrigger?.focus();
    tagSheetTrigger = null;
  }

  function openTagSheet(trigger) {
    closeTagSheet();
    tagSheetTrigger = trigger;
    const backdrop = element('div', {
      className: 'sheet-backdrop',
      on: { click: closeTagSheet },
    });
    const sheet = element('section', {
      className: 'bottom-sheet',
      attributes: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'tag-sheet-title',
      },
    });
    const handle = element('div', { className: 'sheet-handle', attributes: { 'aria-hidden': 'true' } });
    const closeButton = button('閉じる', {
      className: 'top-bar-action',
      on: { click: closeTagSheet },
    });
    const doneButton = button('完了', {
      className: 'top-bar-action',
      on: { click: closeTagSheet },
    });
    const header = element('header', { className: 'sheet-header' }, [
      closeButton,
      element('h2', { text: 'タグを追加', attributes: { id: 'tag-sheet-title' } }),
      doneButton,
    ]);
    const body = element('div', { className: 'sheet-body' });
    const list = element('div', { className: 'tag-list' });

    function renderChoices() {
      list.replaceChildren();
      for (const tag of tags) {
        list.append(
          button('', {
            className: 'tag-choice',
            attributes: {
              'aria-label': tag.name,
              'aria-pressed': String(selectedTagIds.has(tag.id)),
            },
            on: {
              click: (event) => {
                if (selectedTagIds.has(tag.id)) {
                  selectedTagIds.delete(tag.id);
                } else {
                  selectedTagIds.add(tag.id);
                }
                event.currentTarget.setAttribute(
                  'aria-pressed',
                  String(selectedTagIds.has(tag.id)),
                );
                event.currentTarget.lastElementChild.textContent = selectedTagIds.has(tag.id)
                  ? '✓'
                  : '';
                renderSelectedTags();
                markDraftDirty();
              },
            },
          }, [
            element('span', { text: tag.name }),
            element('span', { text: selectedTagIds.has(tag.id) ? '✓' : '' }),
          ]),
        );
      }
      if (tags.length === 0) {
        list.append(element('p', { text: 'タグはまだありません。' }));
      }
    }

    const newTagInput = element('input', {
      className: 'field',
      attributes: {
        type: 'text',
        maxlength: '100',
        placeholder: '新しいタグ名',
        'aria-label': '新しいタグ名',
      },
    });
    const addTagButton = button('作成', {
      on: {
        click: async () => {
          addTagButton.disabled = true;
          try {
            const tag = await context.services.tags.create(newTagInput.value);
            tags = await context.services.tags.listActive();
            tagsById = new Map(tags.map((item) => [item.id, item]));
            selectedTagIds.add(tag.id);
            newTagInput.value = '';
            renderChoices();
            renderSelectedTags();
            markDraftDirty();
            newTagInput.focus();
          } catch (error) {
            showToast(`タグを作成できませんでした: ${error.message}`, { error: true });
          } finally {
            addTagButton.disabled = false;
          }
        },
      },
    });
    const newTagRow = element('div', { className: 'new-tag-row' }, [
      newTagInput,
      addTagButton,
    ]);
    renderChoices();
    body.append(list, newTagRow);
    sheet.append(handle, header, body);
    activeSheet = element('div', {}, [backdrop, sheet]);
    document.body.append(activeSheet);
    queueMicrotask(() => newTagInput.focus());
  }

  const closeButtonConfig = { label: '閉じる', onClick: handleClose };
  const saveButtonConfig = { label: '保存', onClick: handleSave };
  const topBar = createTopBar({
    title: existing ? '記録を編集' : '新しい記録',
    left: closeButtonConfig,
    right: saveButtonConfig,
  });
  const saveButton = topBar.lastElementChild;
  const content = element('main', { className: 'editor-content' });
  const titleToggle = button('＋ タイトルを付ける', {
    className: 'text-button optional-title-toggle',
    on: {
      click: () => {
        titleVisible = true;
        titleToggle.hidden = true;
        titleInput.hidden = false;
        titleInput.focus();
        markDraftDirty();
      },
    },
  });
  titleToggle.hidden = titleVisible;

  datetimeInput.addEventListener('change', markDraftDirty);
  titleInput.addEventListener('input', markDraftDirty);
  bodyInput.addEventListener('input', markDraftDirty);
  bodyInput.addEventListener('compositionstart', () => {
    isComposing = true;
  });
  bodyInput.addEventListener('compositionend', () => {
    isComposing = false;
  });
  moodClear.addEventListener('click', () => {
    selectedMood = null;
    renderMoods();
    markDraftDirty();
  });

  if (storedDraft) {
    const restored = element('div', { className: 'draft-panel' }, [
      element('span', { text: '保存していた下書きを復元しました。' }),
      button('破棄', {
        className: 'text-button danger-button',
        on: {
          click: async () => {
            const releaseEditor = freezeEditor();
            try {
              if (draftTimer) {
                clearTimeout(draftTimer);
                draftTimer = null;
              }
              await draftCoordinator.drain();
              await context.services.drafts.delete(id);
              await context.refresh();
            } catch (error) {
              releaseEditor();
              showToast(`下書きを破棄できませんでした: ${error.message}`, { error: true });
            }
          },
        },
      }),
    ]);
    content.append(restored);
  }

  content.append(
    datetimeInput,
    titleToggle,
    titleInput,
    element('label', {
      className: 'field-label',
      text: '本文',
      attributes: { for: 'record-body' },
    }),
  );
  bodyInput.id = 'record-body';
  content.append(
    bodyInput,
    element('span', { className: 'field-label', text: '調子（任意）' }),
    moodPicker,
    moodClear,
    selectedTags,
    draftStatus,
  );
  screen.append(topBar, content);

  renderMoods();
  renderSelectedTags();
  updateSaveState();

  const handleKeyDown = (event) => {
    if (
      event.key === 'Enter' &&
      event.ctrlKey &&
      !isComposing &&
      !event.isComposing &&
      !saveButton.disabled
    ) {
      event.preventDefault();
      handleSave();
    }
    if (event.key === 'Escape' && activeSheet && !event.isComposing) {
      event.preventDefault();
      closeTagSheet();
    }
  };
  const handleVisibilityChange = () => {
    if (
      document.visibilityState === 'hidden' &&
      draftCoordinator.hasUnsavedChanges()
    ) {
      saveDraftNow().catch((error) => {
        console.error('下書きの退避に失敗しました。', error);
      });
    }
  };
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return {
    element: screen,
    async beforeAppUpdate() {
      const releaseEditor = freezeEditor();
      try {
        await saveDraftNow();
      } catch (error) {
        releaseEditor();
        throw error;
      }
    },
    afterRender() {
      bodyInput.focus();
    },
    cleanup() {
      if (draftTimer) {
        clearTimeout(draftTimer);
      }
      closeTagSheet();
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    },
  };
}
