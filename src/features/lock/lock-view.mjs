import { button, element } from '../../ui/dom.mjs';

function seconds(milliseconds) {
  return Math.max(1, Math.ceil(milliseconds / 1000));
}

export async function renderLockView(pinService, options) {
  let recoveryMode = false;
  let submitting = false;
  let deviceSubmitting = false;
  let countdownTimer = null;
  const config = await pinService.getConfig();
  const deviceConfig = config?.deviceAuth?.enabled
    ? config.deviceAuth
    : null;
  const deviceAvailability = deviceConfig && options.deviceAuth
    ? await options.deviceAuth.getAvailability()
    : null;
  const screen = element('main', { className: 'lock-screen' });
  const mark = element('div', {
    className: 'app-mark',
    text: 'ここ',
    attributes: { 'aria-hidden': 'true' },
  });
  const title = element('h1', { text: 'ここログはロックされています' });
  const description = element('p', {
    text: deviceConfig
      ? '端末認証または6桁のPINで解除してください'
      : '6桁のPINを入力してください',
  });
  const input = element('input', {
    className: 'field lock-input',
    attributes: {
      type: 'password',
      inputmode: 'numeric',
      maxlength: '6',
      autocomplete: 'off',
      'aria-label': '6桁のPIN',
    },
  });
  const status = element('p', {
    className: 'lock-status',
    attributes: { role: 'alert' },
  });
  const submit = button('ロック解除', { className: 'lock-submit' });
  const switchMode = button('PINを忘れた場合', {
    className: 'text-button',
  });
  const note = element('p', {
    className: 'lock-note',
    text: 'このロックは覗き見防止です。保存データ自体を暗号化する機能ではありません。',
  });
  const deviceButton = deviceConfig
    ? button('端末認証で解除', {
        className: 'lock-device-submit',
      })
    : null;
  const deviceStatus = deviceConfig
    ? element('p', {
        className: 'lock-device-status',
        text: deviceAvailability?.message || '',
      })
    : null;
  const deviceGroup = deviceConfig
    ? element('section', {
        className: 'lock-device-group',
        attributes: { 'aria-label': '端末認証' },
      }, [
        deviceButton,
        deviceStatus,
        element('div', {
          className: 'lock-separator',
          attributes: { 'aria-hidden': 'true' },
        }, [
          element('span', { text: 'またはPIN' }),
        ]),
      ])
    : null;
  if (deviceButton && !deviceAvailability?.available) {
    deviceButton.disabled = true;
  }

  function setLockedWait(waitMs) {
    if (countdownTimer) {
      clearInterval(countdownTimer);
    }
    const deadline = Date.now() + waitMs;
    const update = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        status.textContent = 'もう一度入力できます。';
        input.disabled = false;
        submit.disabled = false;
        input.focus();
        return;
      }
      status.textContent = `試行回数が多いため、あと${seconds(remaining)}秒お待ちください。`;
      input.disabled = true;
      submit.disabled = true;
    };
    update();
    countdownTimer = setInterval(update, 500);
  }

  async function verify() {
    if (submitting || deviceSubmitting) {
      return;
    }
    submitting = true;
    submit.disabled = true;
    status.textContent = '確認しています…';
    try {
      const result = recoveryMode
        ? await pinService.recover(input.value)
        : await pinService.verifyPin(input.value);
      if (result.success) {
        status.textContent = recoveryMode
          ? '復旧コードを確認しました。PIN設定を解除します。'
          : 'ロックを解除しました。';
        options.onUnlock();
        return;
      }
      input.value = '';
      if (result.locked) {
        setLockedWait(result.waitMs);
      } else {
        status.textContent = recoveryMode
          ? '復旧コードが違います。'
          : 'PINが違います。';
        input.focus();
      }
    } catch (error) {
      status.textContent = error.message;
      input.focus();
    } finally {
      submitting = false;
      if (!input.disabled) {
        submit.disabled = false;
      }
    }
  }

  async function verifyDevice() {
    if (
      submitting ||
      deviceSubmitting ||
      !deviceAvailability?.available ||
      !options.deviceAuth
    ) {
      return;
    }
    deviceSubmitting = true;
    deviceButton.disabled = true;
    submit.disabled = true;
    input.disabled = true;
    deviceStatus.textContent = 'iPhoneで本人確認してください…';
    status.textContent = '';
    try {
      await options.deviceAuth.authenticate();
      deviceStatus.textContent = '端末認証でロックを解除しました。';
      options.onUnlock();
    } catch (error) {
      deviceStatus.textContent = `${error.message} PINでも解除できます。`;
      if (!countdownTimer) {
        input.disabled = false;
        submit.disabled = false;
      }
      deviceButton.disabled = false;
      deviceButton.focus();
    } finally {
      deviceSubmitting = false;
    }
  }

  submit.addEventListener('click', verify);
  deviceButton?.addEventListener('click', verifyDevice);
  input.addEventListener('input', () => {
    if (!recoveryMode) {
      input.value = input.value.replace(/\D/gu, '').slice(0, 6);
      if (input.value.length === 6) {
        verify();
      }
    }
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      verify();
    }
  });
  switchMode.addEventListener('click', () => {
    recoveryMode = !recoveryMode;
    input.value = '';
    input.type = recoveryMode ? 'text' : 'password';
    input.maxLength = recoveryMode ? 39 : 6;
    input.inputMode = recoveryMode ? 'text' : 'numeric';
    input.setAttribute(
      'aria-label',
      recoveryMode ? '復旧コード' : '6桁のPIN',
    );
    description.textContent = recoveryMode
      ? '保存しておいた復旧コードを入力してください'
      : deviceConfig
        ? '端末認証または6桁のPINで解除してください'
        : '6桁のPINを入力してください';
    submit.textContent = recoveryMode ? '復旧コードで解除' : 'ロック解除';
    switchMode.textContent = recoveryMode ? 'PIN入力へ戻る' : 'PINを忘れた場合';
    if (deviceGroup) {
      deviceGroup.hidden = recoveryMode;
    }
    status.textContent = '';
    input.focus();
  });

  screen.append(mark, title, description);
  if (deviceGroup) {
    screen.append(deviceGroup);
  }
  screen.append(input, status, submit, switchMode, note);
  if (config?.lockedUntil && Date.parse(config.lockedUntil) > Date.now()) {
    setLockedWait(Date.parse(config.lockedUntil) - Date.now());
  }

  return {
    element: screen,
    afterRender() {
      if (deviceButton && !deviceButton.disabled) {
        deviceButton.focus();
      } else if (!input.disabled) {
        input.focus();
      }
    },
    cleanup() {
      if (countdownTimer) {
        clearInterval(countdownTimer);
      }
    },
  };
}
