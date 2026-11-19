const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('app.js', 'utf8');
const take = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const saved = new Map();
let blocked = false;
const context = vm.createContext({
  console: { warn() {} }, structuredClone, Date, JSON,
  localStorage: {
    getItem(key) { if (blocked) throw Error('Storage denied'); return saved.get(key) || null; },
    setItem(key, value) { if (blocked) throw Error('Quota exceeded'); saved.set(key, value); },
    removeItem(key) { if (blocked) throw Error('Storage denied'); saved.delete(key); }
  },
  document: { createElement: () => ({}), createTextNode: text => ({ textContent: text }) },
  dom: { saveStatus: { replaceChildren(...children) { this.children = children; } } }
});
vm.runInContext(`const STORAGE_KEY = 'test'; let state = { entries: [], employees: [], advances: [] }; let localStorageAvailable = true; let syncedState;\n${take('  function rememberSyncedState(', '\n  const dom =')}\n${take('  function persistLocalState(', '\n  function hasBusinessData(')}\n${take('  function setSaveStatus(', '\n  function scheduleCloudSave(')}`, context);
vm.runInContext('persistLocalState();', context);
assert.ok(saved.has('test'));
vm.runInContext('state.entries.push({id:"entry"}); persistLocalState();', context);
assert.equal(JSON.parse(saved.get('test_checkpoints')).length, 1);
blocked = true;
vm.runInContext('persistLocalState(); rememberSyncedState(state); setSaveStatus("offline", "Salvo neste aparelho");', context);
assert.equal(vm.runInContext('localStorageAvailable', context), false);
assert.match(context.dom.saveStatus.children[1].textContent, /Salvamento pendente/);
blocked = false;
vm.runInContext('persistLocalState(); setSaveStatus("synced", "<img src=x onerror=alert(1)>");', context);
assert.equal(context.dom.saveStatus.children[1].textContent, ' <img src=x onerror=alert(1)>');
assert.equal(vm.runInContext('localStorageAvailable', context), true);
console.log('Armazenamento: falta de espaço não interrompe o fluxo; aviso correto e mensagens sem HTML.');
