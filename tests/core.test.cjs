'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ext = path.join(__dirname, '..', 'chrome-extension-crx');
require(path.join(ext, 'core.js'));
const c = globalThis.AISliding;

test('normalizes common base and full endpoint URLs, without doubling the suffix', () => {
  assert.equal(c.normalizeEndpoint('https://api.openai.com/'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(c.normalizeEndpoint('https://models.example/gateway/v1/'), 'https://models.example/gateway/v1/chat/completions');
  assert.equal(c.normalizeEndpoint('http://localhost:11434/v1/chat/completions'), 'http://localhost:11434/v1/chat/completions');
  assert.equal(c.normalizeEndpoint('http://127.0.0.1:11434/v1/'), 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(c.hostPattern('http://[::1]:8443/v1'), 'http://[::1]/*');
  assert.equal(c.hostPattern('https://models.example:9443/v1'), 'https://models.example/*');
});

test('rejects credential URLs, non-loopback HTTP, query strings and invalid schemes', () => {
  for (const bad of ['http://models.example/v1', 'http://localhost.example/v1',
    'file:///tmp/v1', 'https://user:pass@host.test/v1', 'https://host.test/v1?key=123',
    'https://host.test/v1#credentials', 'https://host.test/ has space', 'https://host.test\\evil']) {
    assert.throws(() => c.normalizeEndpoint(bad), c.UserError);
  }
});

test('preserves legacy custom model, avoids assigning a model to a first-time install', () => {
  const s = c.legacySettings({ apiKey: 'test-key', model: 'custom', customModel: 'provider/model', targetLanguage: '韩语' });
  assert.equal(s.model, 'provider/model');
  assert.equal(s.targetLanguage, '韩语');
  assert.equal(c.legacySettings({}).model, '');
  assert.equal(c.legacySettings({apiKey: 'test-key'}).model, 'gpt-4o-mini');
  assert.equal(c.legacySettings({model: 'custom'}).model, '');
});

test('zero-key local settings, bounded inputs and explicit action/result contract', () => {
  const s = c.cleanSettings({model:'custom', apiEndpoint:'http://localhost:11434/v1', translatePrompt:'翻译即可'});
  assert.equal(s.model, 'custom');
  assert.equal(s.apiKey, '');
  assert.throws(() => c.cleanSettings({model:'a',apiKey:'bad\nheader'}), c.UserError);
  assert.throws(() => c.cleanSettings({model:'z'.repeat(201)}), c.UserError);
  assert.throws(() => c.messagesFor('explain', 'x'.repeat(8001), s), c.UserError);
  assert.throws(() => c.messagesFor('paste', 'hi', s), c.UserError);
  const messages = c.messagesFor('translate', 'selected text', s);
  assert.match(messages[0].content, /^翻译即可/);
  assert.deepEqual(messages[1], {role:'user', content:'selected text'});
  assert.match(c.messagesFor('explain','hi',s)[0].content, /解释助手/);
  assert.deepEqual(c.messagesFor('test','ignored',s), [{role:'user',content:'Reply with OK.'}]);
});

function worker({legacy = {}, grant = true} = {}) {
  const local = {}, sync = {...legacy}, calls = [], access = [];
  let handler, onInstall, response;
  const area = (data, name) => ({
    setAccessLevel: async options => { access.push([name, options.accessLevel]); },
    get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => Object.hasOwn(data,k)).map(k => [k,data[k]])),
    set: async values => { Object.assign(data, values); },
    remove: async key => { delete data[key]; },
  });
  const popup = 'chrome-extension://test/popup.html';
  const context = vm.createContext({URL, Error, TypeError, AbortController, TextDecoder, setTimeout, clearTimeout,
    chrome:{
      storage:{ local: area(local,'local'), sync: area(sync,'sync') },
      permissions:{contains: async () => grant},
      runtime:{id:'test',getURL:()=>popup,onInstalled:{addListener:f=>{onInstall=f;}},
        onMessage:{addListener:f=>{handler=f;}}}
    },
    fetch: async (url, params) => {
      calls.push({url, params});
      return response?.() ?? Response.json({choices:[{message:{content:' <img src=x> '}}]});
    },
    importScripts: file => vm.runInContext(fs.readFileSync(path.join(ext,file),'utf8'),context)
  });
  vm.runInContext(fs.readFileSync(path.join(ext,'background.js'),'utf8'),context);
  onInstall();
  const send = (message, where = 'popup') => new Promise(resolve => {
    const sender = where==='popup' ? {id:'test',url:popup} :
      {id:'test',url:'https://local.example/',frameId:where==='iframe'?1:0,tab:{id:12}};
    if (handler(message,sender,resolve)!==true) resolve(undefined);
  });
  return {local,sync,calls,access,send,setResponse(fn){response=fn;}};
}

test('MV3 worker migrates key once, gates key/config from content, and requests only after action', async () => {
  const w = worker({legacy:{apiKey:'local-key',apiEndpoint:'https://model.example/v1',model:'custom',customModel:'dev/model'}});
  const cfg = await w.send({type:'ais:settings:get'});
  assert.equal(cfg.settings.model,'dev/model');
  assert.equal(cfg.settings.apiKey,'local-key');
  assert.equal(w.local.settingsV2.apiKey,'local-key');
  assert.equal(w.sync.apiKey,undefined);
  assert.equal(w.access.length,2);
  assert.equal(w.calls.length,0);
  assert.equal(await w.send({type:'ais:settings:get'},'content'),undefined);
  assert.equal(await w.send({type:'ais:settings:save'},'content'),undefined);
  assert.equal(await w.send({type:'ais:process',action:'translate',text:'hi'},'iframe'),undefined);
  assert.equal((await w.send({type:'ais:process',action:'test',text:'hi'},'content')).ok,false);
  const unapproved = await w.send({type:'ais:process',action:'translate',text:'a selection'},'content');
  assert.equal(unapproved.ok,false);
  assert.match(unapproved.error,/保存模型接口/);
  assert.equal(w.calls.length,0);
  assert.equal((await w.send({type:'ais:settings:save',settings:cfg.settings})).ok,true);
  const result = await w.send({type:'ais:process',action:'translate',text:'a selection'},'content');
  assert.equal(result.result,'<img src=x>'); // UI renders this as literal text.
  assert.equal(w.calls[0].url,'https://model.example/v1/chat/completions');
  const request = w.calls[0].params;
  assert.equal(request.headers.Authorization,'Bearer local-key');
  assert.equal(request.redirect,'error');
  assert.equal(request.credentials,'omit');
  assert.equal(JSON.parse(request.body).messages[1].content,'a selection');
  assert.equal((await w.send({type:'ais:test',text:'private selection'})).ok,true);
  assert.equal(JSON.parse(w.calls[1].params.body).messages[0].content,'Reply with OK.');
});

test('worker blocks unapproved hosts and never echoes untrusted provider errors', async () => {
  const legacy = {apiKey:'local-key',apiEndpoint:'https://model.example/v1',model:'demo'};
  const blocked = worker({legacy, grant:false});
  assert.equal((await blocked.send({type:'ais:settings:save',settings:legacy})).ok,false);
  assert.equal((await blocked.send({type:'ais:test'})).ok,false);
  assert.equal(blocked.calls.length,0);
  const w = worker({legacy});
  assert.equal((await w.send({type:'ais:settings:save',settings:legacy})).ok,true);
  w.setResponse(() => Response.json({error:{message:'injected <img> local-key'}},{status:401}));
  const r = await w.send({type:'ais:process',action:'explain',text:'hello'},'content');
  assert.equal(r.ok,false);
  assert.match(r.error,/HTTP 401/);
  assert.doesNotMatch(r.error,/local-key|<img>/);
  w.setResponse(() => new Response('not json'));
  assert.match((await w.send({type:'ais:test'})).error,/JSON/);
});

test('manifest references existing files and declares no web-accessible scripts', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ext,'manifest.json'),'utf8'));
  assert.equal(m.manifest_version,3);
  assert.equal(m.version,'1.2.0');
  assert.ok(!m.web_accessible_resources);
  for (const f of [m.background.service_worker,m.action.default_popup,...m.content_scripts.flatMap(s=>[...s.js,...s.css]),...Object.values(m.icons)]) {
    assert.ok(fs.existsSync(path.join(ext,f)),f);
  }
});
