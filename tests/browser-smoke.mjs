import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extension = join(repo, 'chrome-extension-crx');
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background.service_worker, 'background.js');
const localGrant = 'http://127.0.0.1/*';
assert.ok(manifest.optional_host_permissions.includes(localGrant));
const plainAnswer = '<strong>模型返回的纯文本</strong>';
const selectionText = 'Sonar sample selected for the smoke test.';
const requests = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let statusCode = 200;
let responseDelay = 0;
let redirectHits = 0;
const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/') {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    return response.end(`<!doctype html><meta charset=utf-8><title>AI-Sliding local test fixture</title>
      <p id="sample" style="margin:70px 50px;width:max-content;font:22px monospace">${selectionText}</p>
      <label>Private input <input id="private" type="password" value="private fixture text"></label>`);
  }
  if (request.url === '/redirect-target') {
    redirectHits++;
    response.writeHead(204).end();
    return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end();
    return;
  }
  let raw = '';
  for await (const part of request) raw += part;
  requests.push({ payload: JSON.parse(raw), auth: request.headers.authorization });
  if (responseDelay) await pause(responseDelay);
  if (statusCode === 307) {
    response.writeHead(307, { location: '/redirect-target' }).end();
    return;
  }
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(statusCode === 200
    ? { choices: [{ message: { content: plainAnswer } }] }
    : { error: { message: 'fixture-provider-detail' } }));
});
server.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const base = `http://127.0.0.1:${server.address().port}`;
const fixtureEndpoint = base + '/v1';

function assertSentRequest(index, text) {
  const { payload, auth } = requests[index];
  assert.equal(payload.model, 'local-smoke-model');
  assert.equal(payload.stream, false);
  assert.equal(payload.messages.at(-1).content, text);
  assert.equal(payload.messages.at(-1).role, 'user');
  assert.equal(auth, 'Bearer smoke-test-key');
}

async function workerOnly() {
  const sync = { model: 'custom', customModel: 'legacy-smoke-model', apiKey: 'legacy-test-key' };
  const local = {};
  const get = (store, keys) => Object.fromEntries(
    (Array.isArray(keys) ? keys : [keys]).filter(key => key in store).map(key => [key, store[key]])
  );
  const scopedStore = store => ({
    setAccessLevel: async ({ accessLevel }) => assert.equal(accessLevel, 'TRUSTED_CONTEXTS'),
    get: async keys => get(store, keys),
    set: async value => Object.assign(store, value),
    remove: async key => { delete store[key]; },
  });
  let listen;
  let permitted = false;
  const popup = { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/popup.html' };
  const content = { id: popup.id, tab: { id: 2 }, frameId: 0, url: base + '/' };
  const chrome = {
    permissions: {
      contains: async ({ origins }) => permitted && origins.length === 1 && origins[0] === localGrant,
    },
    storage: { sync: scopedStore(sync), local: scopedStore(local) },
    runtime: {
      id: popup.id,
      getURL: path => `chrome-extension://test-extension-id/${path}`,
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: handler => { listen = handler; } },
    },
  };
  const core = await readFile(join(extension, 'core.js'), 'utf8');
  const worker = await readFile(join(extension, 'background.js'), 'utf8');
  const context = createContext({
    chrome, URL, fetch, AbortController, TextDecoder, setTimeout, clearTimeout,
    importScripts: name => {
      assert.equal(name, 'core.js');
      runInContext(core, context, { filename: name });
    },
  });
  runInContext(worker, context, { filename: 'background.js' });
  const send = (message, sender = popup) => new Promise(resolve => {
    if (!listen(message, sender, resolve)) resolve(undefined);
  });

  const before = await send({type: 'ais:settings:get'});
  assert.equal(before.settings.model, 'legacy-smoke-model');
  assert.equal(before.settings.apiKey, 'legacy-test-key');
  assert.ok(!('apiKey' in sync));
  assert.equal(await send({type: 'ais:settings:get'}, content), undefined);
  assert.equal(await send({type: 'ais:process', action: 'translate', text: selectionText}, { ...content, frameId: 4 }), undefined);
  const settings = { apiEndpoint: fixtureEndpoint, model: 'local-smoke-model', apiKey: 'smoke-test-key', targetLanguage: '英语' };
  assert.equal((await send({ type: 'ais:settings:save', settings })).ok, false, 'unapproved host must not be saved');
  permitted = true;
  assert.equal((await send({ type: 'ais:settings:save', settings })).ok, true);
  assert.equal((await send({ type: 'ais:test' })).ok, true);
  assertSentRequest(0, 'Reply with OK.');

  for (const [offset, action, word] of [[1, 'translate', /翻译/], [2, 'explain', /解释/]]) {
    const result = await send({ type: 'ais:process', action, text: selectionText }, content);
    assert.equal(result.ok, true);
    assert.equal(result.result, plainAnswer);
    assertSentRequest(offset, selectionText);
    assert.match(requests[offset].payload.messages[0].content, word);
  }
  assert.equal((await send({ type: 'ais:process', action: 'translate', text: 'a'.repeat(8001) }, content)).ok, false);
  assert.equal(requests.length, 3);
  statusCode = 429;
  const error = await send({ type: 'ais:process', action: 'explain', text: selectionText }, content);
  assert.equal(error.ok, false);
  assert.match(error.error, /429/);
  assert.doesNotMatch(error.error, /fixture-provider-detail/);
  statusCode = 307;
  const redirect = await send({ type: 'ais:process', action: 'translate', text: selectionText }, content);
  assert.equal(redirect.ok, false);
  assert.equal(redirectHits, 0, 'configured server must not redirect the selection or key elsewhere');
  console.log('MV3 worker logic with simulated Chrome APIs + a real loopback HTTP mock: OK (not a browser test).');
}

async function until(predicate, label, ms = 7000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const result = await predicate();
    if (result) return result;
    await pause(70);
  }
  assert.fail(`Timed out: ${label}`);
}

async function browserTest() {
  const { chromium } = createRequire(import.meta.url)('playwright');
  const tempDir = await mkdtemp(join(tmpdir(), 'ai-sliding-smoke-'));
  let pristine;
  let browser;
  function start(profile, path) {
    const executablePath = process.env.CHROMIUM_PATH;
    return chromium.launchPersistentContext(join(tempDir, profile), {
      channel: 'chromium', executablePath,
      headless: true,
      args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`, '--disable-crash-reporter'],
    });
  }
  async function findWorker(context) {
    const isWorker = w => /^chrome-extension:\/\/[^/]+\/background\.js$/.test(w.url());
    return context.serviceWorkers().find(isWorker)
      ?? context.waitForEvent('serviceworker', { predicate: isWorker, timeout: 8000 });
  }
  try {
    // Check load/registration against the untouched production manifest first.
    pristine = await start('pristine-profile', extension);
    const pristineWorker = await findWorker(pristine);
    const untouched = await pristineWorker.evaluate(() => chrome.runtime.getManifest().manifest_version);
    assert.equal(untouched, 3);
    const noDefaultGrant = await pristineWorker.evaluate(origin => chrome.permissions.contains({ origins: [origin] }), localGrant);
    assert.equal(noDefaultGrant, false);
    await pristine.close();
    pristine = undefined;

    // Grant only the loopback fixture in a temporary manifest copy. This does not exercise
    // the native Chrome permission dialog, which a headless context cannot reliably click.
    const fixture = join(tempDir, 'unpacked');
    await cp(extension, fixture, { recursive: true });
    await writeFile(join(fixture, 'manifest.json'), JSON.stringify({
      ...manifest, host_permissions: [localGrant],
    }));
    browser = await start('fixture-profile', fixture);
    const worker = await findWorker(browser);
    const popup = await browser.newPage();
    await popup.goto(new URL('popup.html', worker.url()).href);
    await popup.locator('#apiEndpoint').fill(fixtureEndpoint);
    await popup.locator('#model').fill('local-smoke-model');
    await popup.locator('#apiKey').fill('smoke-test-key');
    assert.equal(await popup.locator('#apiKey').getAttribute('type'), 'password');
    await popup.locator('#saveSettings').click();
    await until(async () => /设置已保存/.test(await popup.locator('#statusMessage').textContent()), 'saved popup settings');
    await popup.locator('#testConnection').click();
    await until(async () => /连接成功/.test(await popup.locator('#statusMessage').textContent()), 'popup test connection');
    assertSentRequest(0, 'Reply with OK.');
    await popup.close();

    const page = await browser.newPage();
    await page.goto(base + '/');
    const cdp = await browser.newCDPSession(page);
    await cdp.send('DOM.enable');
    async function shadowNode(selector) {
      const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      function find(node) {
        if (node.nodeName === 'AIS-SELECTION-UI') return node.shadowRoots?.[0];
        for (const child of node.children ?? []) {
          const match = find(child);
          if (match) return match;
        }
      }
      const shadow = find(root);
      if (!shadow) return undefined;
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: shadow.nodeId, selector });
      return nodeId || undefined;
    }
    async function shadowText(selector) {
      const nodeId = await shadowNode(selector);
      if (!nodeId) return undefined;
      const { object } = await cdp.send('DOM.resolveNode', { nodeId });
      try {
        const { result } = await cdp.send('Runtime.callFunctionOn', {
          objectId: object.objectId, functionDeclaration: 'function () { return this.textContent; }', returnByValue: true,
        });
        return result.value;
      } finally {
        await cdp.send('Runtime.releaseObject', { objectId: object.objectId });
      }
    }
    async function shadowClick(selector) {
      const box = await until(async () => {
        const nodeId = await shadowNode(selector);
        if (!nodeId) return false;
        try {
          return (await cdp.send('DOM.getBoxModel', { nodeId })).model.content;
        } catch (error) {
          if (/could not compute box model/i.test(String(error))) return false;
          throw error;
        }
      }, selector);
      await page.mouse.click((box[0] + box[4]) / 2, (box[1] + box[5]) / 2);
    }
    async function selectLine() {
      const sample = await page.locator('#sample').boundingBox();
      await page.mouse.click(sample.x + sample.width / 2, sample.y + sample.height / 2, { clickCount: 3 });
      await until(async () => (await page.evaluate(() => window.getSelection()?.toString().trim())) === selectionText, 'trusted triple-click selection');
      await until(() => page.locator('ais-selection-ui').isVisible(), 'inline selection toolbar');
    }

    await selectLine();
    await shadowClick('.tools button:first-of-type');
    await until(async () => await shadowText('.result') === plainAnswer, 'translation renders');
    assertSentRequest(1, selectionText);
    assert.match(requests[1].payload.messages[0].content, /翻译/);
    assert.equal(await shadowNode('.result strong'), undefined, 'answer must not be rendered as markup');
    await page.keyboard.press('Escape');
    await until(async () => !(await page.locator('ais-selection-ui').isVisible()), 'Escape closes result');

    await selectLine();
    await page.keyboard.press('Alt+Shift+s');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await until(async () => await shadowText('.result') === plainAnswer, 'keyboard explanation renders');
    assertSentRequest(2, selectionText);
    assert.match(requests[2].payload.messages[0].content, /解释/);
    await page.keyboard.press('Escape');

    statusCode = 429;
    await selectLine();
    await shadowClick('.tools button:first-of-type');
    const failure = await until(async () => await shadowText('.status.failure'), 'provider failure displayed');
    assert.doesNotMatch(failure, /fixture-provider-detail/);
    assert.equal(requests.length, 4);
    await page.keyboard.press('Escape');

    statusCode = 200;
    responseDelay = 350;
    await selectLine();
    await shadowClick('.tools button:first-of-type');
    await until(() => requests.length === 5, 'in-flight request');
    await page.keyboard.press('Escape');
    await pause(550);
    assert.equal(await page.locator('ais-selection-ui').isVisible(), false, 'stale result must not reopen the popup');

    await page.locator('#private').click();
    await page.keyboard.press('Control+a');
    await pause(150);
    assert.equal(await page.locator('ais-selection-ui').isVisible(), false, 'private input selection should not offer actions');
    assert.equal(requests.length, 5);
    console.log('Chromium MV3 smoke test: OK (fixture-local origin pregranted, native permission prompt not exercised).');
  } finally {
    await pristine?.close();
    await browser?.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

try {
  if (process.argv.includes('--worker-only')) await workerOnly();
  else await browserTest();
} finally {
  await new Promise(resolve => server.close(resolve));
}
