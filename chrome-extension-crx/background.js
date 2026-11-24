'use strict';
importScripts('core.js');

const core = globalThis.AISliding;
const settingsKey = 'settingsV2';
const legacyKeys = [...Object.keys(core.DEFAULTS), 'customModel'];
const popupUrl = chrome.runtime.getURL('popup.html');
const workingTabs = new Set();
let settingsReady;

function initSettings() {
  if (!settingsReady) settingsReady = (async () => {
    await Promise.all([
      chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}),
      chrome.storage.sync.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'})
    ]);
    const current = await chrome.storage.local.get(settingsKey);
    const saved = await chrome.storage.sync.get(legacyKeys);
    if (!current[settingsKey]) {
      await chrome.storage.local.set({[settingsKey]: core.legacySettings(saved)});
    }
    // Remove the old synced secret only after local storage successfully holds settings.
    if (Object.hasOwn(saved, 'apiKey')) await chrome.storage.sync.remove('apiKey');
  })().catch(error => {
    settingsReady = undefined;
    throw error;
  });
  return settingsReady;
}

chrome.runtime.onInstalled.addListener(() => { void initSettings().catch(() => {}); });

async function readSettings() {
  await initSettings();
  const saved = await chrome.storage.local.get(settingsKey);
  return { ...core.DEFAULTS, ...saved[settingsKey] };
}

async function readJSON(resp) {
  if (!resp.body) throw new core.UserError('服务没有返回有效结果。');
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let json = '', bytes = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1024 * 1024) {
        void reader.cancel().catch(() => {});
        throw new core.UserError('服务响应过长，请缩小选区。');
      }
      json += decoder.decode(value, {stream: true});
    }
    json += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try { return JSON.parse(json); }
  catch { throw new core.UserError('接口没有返回预期的 JSON。请检查地址。'); }
}

async function request(action, text) {
  const s = core.cleanSettings(await readSettings());
  const messages = core.messagesFor(action, text, s);
  if (!await chrome.permissions.contains({origins: [core.hostPattern(s.apiEndpoint)]})) {
    throw new core.UserError('尚未授权访问模型服务。请打开扩展设置并保存以授权。');
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 25000);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (s.apiKey) headers.Authorization = `Bearer ${s.apiKey}`;
    let resp;
    try {
      resp = await fetch(s.apiEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: s.model, messages, stream: false }),
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: abort.signal
      });
    } catch {
      throw new core.UserError('无法连接模型服务，请检查地址、网络以及接口是否发生跳转。');
    }
    if (!resp.ok) {
      void resp.body?.cancel().catch(() => {});
      throw new core.UserError(core.httpError(resp.status));
    }
    const data = await readJSON(resp);
    const result = data?.choices?.[0]?.message?.content;
    if (typeof result !== 'string' || !result.trim()) {
      throw new core.UserError('服务未返回文本。请检查模型是否支持 Chat Completions。');
    }
    return result.trim();
  } catch (error) {
    if (abort.signal.aborted) throw new core.UserError('模型服务响应超时，请重试或缩小选区。');
    if (error instanceof TypeError) throw new core.UserError('读取模型响应失败，请重试。');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isContentSender(sender) {
  return Number.isInteger(sender.tab?.id) && sender.frameId === 0 &&
    /^https?:\/\//i.test(sender.url || '');
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== 'string') return;
  const fromPopup = sender.url === popupUrl;
  const type = message.type;
  if (!(fromPopup && ['ais:settings:get', 'ais:settings:save', 'ais:test'].includes(type)) &&
      !(type === 'ais:process' && isContentSender(sender))) return;

  (async () => {
    if (type === 'ais:settings:get') return {ok: true, settings: await readSettings()};
    if (type === 'ais:settings:save') {
      const settings = core.cleanSettings(message.settings);
      if (!await chrome.permissions.contains({origins: [core.hostPattern(settings.apiEndpoint)]})) {
        throw new core.UserError('未授予接口访问权限，未保存设置。');
      }
      await initSettings();
      await chrome.storage.local.set({[settingsKey]: settings});
      return {ok: true, settings};
    }
    const key = fromPopup ? 'test' : sender.tab.id;
    if (workingTabs.has(key) || workingTabs.size >= 4) {
      throw new core.UserError('已有请求正在处理，请稍后重试。');
    }
    workingTabs.add(key);
    try {
      if (fromPopup) {
        await request('test');
        return {ok: true};
      }
      if (!['translate', 'explain'].includes(message.action)) throw new core.UserError('未知操作。');
      return {ok: true, result: await request(message.action, message.text)};
    } finally {
      workingTabs.delete(key);
    }
  })().then(reply, error => {
    reply({ok: false, error: error instanceof core.UserError ? error.message :
      '暂时无法完成操作，请重新打开设置后重试。'});
  });
  return true;
});
