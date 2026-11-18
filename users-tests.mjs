import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('./index.js', import.meta.url), 'utf8');
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const sqlite = new DatabaseSync(':memory:');
const wrap = (sql, params = []) => ({
  bind(...values) { return wrap(sql, values); },
  async first() { return sqlite.prepare(sql).get(...params) || null; },
  async all() { return { results: sqlite.prepare(sql).all(...params) }; },
  async run() { return sqlite.prepare(sql).run(...params); }
});
const DB = { prepare: sql => wrap(sql), async batch(statements) {
  sqlite.exec('BEGIN');
  try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
  catch (error) { sqlite.exec('ROLLBACK'); throw error; }
} };
const env = { DB, APP_PASSWORD: 'existing-system-secret-2026' };
const origin = 'https://test.example';
const api = (path, method = 'GET', body, cookie = '', extra = {}) => worker.fetch(new Request(`${origin}${path}`, {
  method, headers: { Origin: origin, Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra },
  ...(body ? { body: JSON.stringify(body) } : {})
}), env);
const login = (username, password) => worker.fetch(new Request(`${origin}/login`, {
  method: 'POST', headers: { Origin: 'null', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ username, password })
}), env);
const cookieOf = response => response.headers.get('set-cookie').split(';')[0];
const account = (name, login, role = 'operator') => ({ name, login, role, password: 'Strong-test-password-2026' });

assert.equal((await api('/api/me')).status, 401);
let response = await login('', env.APP_PASSWORD);
assert.equal(response.status, 303);
const sharedCookie = cookieOf(response);
assert.equal((await (await api('/api/me', 'GET', null, sharedCookie)).json()).needsSetup, true);
response = await api('/api/users', 'POST', account('Weber', 'weber', 'admin'), sharedCookie);
assert.equal(response.status, 403);
response = await api('/api/users', 'POST', { ...account('Weber', 'weber', 'admin'), setupPassword: env.APP_PASSWORD }, sharedCookie);
assert.equal(response.status, 201);
let adminCookie = cookieOf(response);
const admin = (await response.json()).user;
assert.equal((await api('/api/me', 'GET', null, sharedCookie)).status, 401);
assert.equal((await login('', env.APP_PASSWORD)).status, 401);
response = await api('/api/users', 'POST', account('Alice', 'alice'), adminCookie);
assert.equal(response.status, 201);
const operator = (await response.json()).user;
assert.equal((await api('/api/users', 'POST', account('Outra', 'ALICE'), adminCookie)).status, 409);
assert.equal((await api('/api/users', 'POST', account('Terceira pessoa', 'terceira'), adminCookie)).status, 201);
assert.equal((await api('/api/users', 'POST', account('Quarta pessoa', 'quarta'), adminCookie)).status, 409);
const directory = await (await api('/api/users', 'GET', null, adminCookie)).json();
assert.equal(directory.users.length, 3);
assert.equal(JSON.stringify(directory).includes('password_hash'), false);
assert.equal((await login('alice', 'wrong')).status, 401);
response = await login('alice', 'Strong-test-password-2026');
assert.equal(response.status, 303);
const operatorCookie = cookieOf(response);
assert.equal((await api('/api/users', 'GET', null, operatorCookie)).status, 403);
assert.equal((await api('/api/users', 'POST', account('Intruso', 'intruso', 'admin'), operatorCookie)).status, 403);
assert.equal((await api('/api/users', 'POST', account('Intruso', 'intruso'), adminCookie, { Origin: 'https://other.example' })).status, 403);
const state = { version: 15, employees: [], entries: [], advances: [{ id: 'vale-1', value: 30, createdBy: { name: 'Forjado' } }], updatedAt: new Date().toISOString() };
assert.equal((await api('/api/state', 'PUT', { state, baseRevision: 0 }, operatorCookie)).status, 200);
let cloud = await (await api('/api/state', 'GET', null, adminCookie)).json();
assert.equal(cloud.state.advances[0].createdBy.name, 'Alice');
assert.equal((await api('/api/state', 'PUT', { state, baseRevision: 0 }, adminCookie)).status, 409);
cloud.state.advances[0].createdBy.name = 'Forjado';
cloud.state.advances[0].value = 35;
assert.equal((await api('/api/state', 'PUT', { state: cloud.state, baseRevision: cloud.revision }, adminCookie)).status, 200);
cloud = await (await api('/api/state', 'GET', null, adminCookie)).json();
assert.equal(cloud.state.advances[0].createdBy.name, 'Alice');
assert.equal(cloud.state.advances[0].updatedBy.name, 'Weber');
response = await api('/api/users', 'PATCH', { ...operator, active: false }, adminCookie);
assert.equal(response.status, 200);
assert.equal((await api('/api/me', 'GET', null, operatorCookie)).status, 401);
assert.equal((await login('alice', 'Strong-test-password-2026')).status, 401);
assert.equal((await api('/api/users', 'PATCH', { ...admin, active: false }, adminCookie)).status, 400);
response = await api('/api/users', 'PATCH', { ...admin, password: 'New-strong-password-2026' }, adminCookie);
assert.equal(response.status, 200);
const previousCookie = adminCookie;
adminCookie = cookieOf(response);
assert.equal((await api('/api/me', 'GET', null, previousCookie)).status, 401);
assert.equal((await api('/api/me', 'GET', null, adminCookie)).status, 200);
assert.equal((await login('weber', 'Strong-test-password-2026')).status, 401);
assert.equal((await login('weber', 'New-strong-password-2026')).status, 303);
assert.equal((await api('/logout', 'POST', null, adminCookie, { Origin: 'null', 'Sec-Fetch-Site': 'cross-site' })).status, 403);
assert.equal((await api('/logout', 'POST', null, adminCookie, { Origin: 'https://other.example', 'Sec-Fetch-Site': 'same-origin' })).status, 403);
assert.equal((await api('/logout', 'POST', null, adminCookie, { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' })).status, 303);
assert.equal((await api('/api/me', 'GET', null, adminCookie)).status, 401);
assert.equal(sqlite.prepare('SELECT password_hash FROM access_users WHERE login = ?').get('weber').password_hash.includes('New-strong-password'), false);
console.log('Usuários: cadastro, limite de três, login, permissões, autoria, conflitos, sessão, troca de senha e saída passaram.');
sqlite.close();
