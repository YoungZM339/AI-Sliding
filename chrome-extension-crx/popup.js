'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('settingsForm');
  const fieldset = document.getElementById('settingsFields');
  const saveButton = document.getElementById('saveSettings');
  const testButton = document.getElementById('testConnection');
  const keyToggle = document.getElementById('showKey');
  const status = document.getElementById('statusMessage');
  const fields = Object.fromEntries(
    ['apiKey', 'apiEndpoint', 'model', 'targetLanguage', 'translatePrompt', 'explainPrompt']
      .map((name) => [name, document.getElementById(name)])
  );
  const limits = {
    apiEndpoint: 2048, model: 200, apiKey: 2048, targetLanguage: 80,
    translatePrompt: 4000, explainPrompt: 4000,
  };
  const core = globalThis.AISliding;
  let saved = null;
  let busy = true;

  function announce(message, kind = '') {
    status.dataset.kind = kind;
    status.textContent = message;
  }

  function serviceError(result, fallback, key) {
    if (typeof result?.error !== 'string') return fallback;
    const message = (key ? result.error.split(key).join('••••') : result.error).trim();
    return message ? message.slice(0, 280) : fallback;
  }

  function readFields() {
    return Object.fromEntries(
      Object.entries(fields).map(([name, field]) => [name, field.value.trim()])
    );
  }

  function isDirty() {
    const draft = readFields();
    return saved && Object.keys(fields).some((name) => draft[name] !== saved[name]);
  }

  function canTest() {
    if (!saved?.model || !saved.apiEndpoint || isDirty()) return false;
    try {
      return Boolean(core.hostPattern(core.normalizeEndpoint(saved.apiEndpoint)));
    } catch {
      return false;
    }
  }

  function updateControls() {
    fieldset.disabled = busy || !saved;
    saveButton.disabled = busy || !saved;
    testButton.disabled = busy || !canTest();
  }

  function hideKey() {
    fields.apiKey.type = 'password';
    keyToggle.setAttribute('aria-pressed', 'false');
  }

  function populate(settings) {
    for (const [name, field] of Object.entries(fields)) {
      let value = typeof settings[name] === 'string' ? settings[name] : core.DEFAULTS[name] ?? '';
      // Only fall back to the legacy field when both old fields are present.
      // A modern service may have an actual model ID of "custom".
      if (name === 'model' && value === 'custom' && typeof settings.customModel === 'string') {
        value = settings.customModel;
      }
      if (name === 'targetLanguage' && value && !Array.from(field.options).some((option) => option.value === value)) {
        field.add(new Option(value, value));
      }
      field.value = value;
    }
    saved = readFields();
    hideKey();
  }

  function invalid(field, message) {
    field.setAttribute('aria-invalid', 'true');
    const advanced = field.closest('details');
    if (advanced) advanced.open = true;
    field.focus();
    announce(message, 'error');
  }

  keyToggle.addEventListener('click', () => {
    const reveal = fields.apiKey.type === 'password';
    fields.apiKey.type = reveal ? 'text' : 'password';
    keyToggle.setAttribute('aria-pressed', String(reveal));
  });

  form.addEventListener('input', (event) => {
    event.target.removeAttribute('aria-invalid');
    updateControls();
    if (isDirty()) announce('设置有未保存的修改。保存后可测试连接。');
    else announce('');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!saved || busy) return;

    const draft = readFields();
    for (const [name, limit] of Object.entries(limits)) {
      if (draft[name].length > limit) {
        invalid(fields[name], `${fields[name].labels[0].textContent}不能超过 ${limit} 个字符。`);
        return;
      }
    }
    let permissionPattern;
    try {
      if (!draft.apiEndpoint) throw new Error();
      draft.apiEndpoint = core.normalizeEndpoint(draft.apiEndpoint);
      permissionPattern = core.hostPattern(draft.apiEndpoint);
      if (!permissionPattern) throw new Error();
    } catch {
      invalid(fields.apiEndpoint, '请输入有效的 HTTPS API 地址，或本机回环 HTTP 地址。');
      return;
    }
    if (!draft.model) {
      invalid(fields.model, '请填写服务商提供的模型 ID。');
      return;
    }
    if (/[^\x21-\x7e]/.test(draft.apiKey)) {
      invalid(fields.apiKey, 'API 密钥不能包含空格或控制字符。');
      return;
    }
    for (const name of ['targetLanguage', 'translatePrompt', 'explainPrompt']) {
      if (!draft[name]) draft[name] = core.DEFAULTS[name];
    }

    busy = true;
    hideKey();
    updateControls();
    announce('正在保存设置…');
    try {
      // Must run directly in the submit gesture, before any asynchronous read.
      const granted = await chrome.permissions.request({ origins: [permissionPattern] });
      if (!granted) {
        announce('未授权访问此 API 地址，修改没有保存。', 'error');
        return;
      }
      const result = await chrome.runtime.sendMessage({ type: 'ais:settings:save', settings: draft });
      if (!result?.ok) {
        announce(serviceError(result, '设置未保存，请重试。', draft.apiKey), 'error');
        return;
      }
      populate(result.settings ?? draft);
      announce('设置已保存。', 'success');
    } catch {
      announce('无法保存设置，请重试。', 'error');
    } finally {
      busy = false;
      updateControls();
      if (document.activeElement === document.body) saveButton.focus();
    }
  });

  testButton.addEventListener('click', async () => {
    if (busy || !canTest()) return;
    busy = true;
    hideKey();
    updateControls();
    announce('正在使用已保存的设置测试连接…');
    try {
      const result = await chrome.runtime.sendMessage({ type: 'ais:test' });
      if (result?.ok) announce('连接成功，模型已响应。', 'success');
      else announce(serviceError(result, '连接测试未通过。', saved.apiKey), 'error');
    } catch {
      announce('无法完成连接测试，请重试。', 'error');
    } finally {
      busy = false;
      updateControls();
      if (document.activeElement === document.body) testButton.focus();
    }
  });

  async function initialize() {
    try {
      if (!core) throw new Error();
      const result = await chrome.runtime.sendMessage({ type: 'ais:settings:get' });
      if (!result?.ok || !result.settings) throw new Error();
      populate(result.settings);
      announce(saved.model ? '' : '填好模型 ID 后，保存设置即可测试连接。');
    } catch {
      announce('无法读取设置。请关闭并重新打开设置页。', 'error');
    } finally {
      busy = false;
      updateControls();
    }
  }

  void initialize();
});
