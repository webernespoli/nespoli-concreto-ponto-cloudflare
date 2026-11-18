import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./worker.js", import.meta.url), "utf8");
const worker = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const builtSource = await readFile(new URL("./index.js", import.meta.url), "utf8");
const builtWorker = await import(`data:text/javascript;base64,${Buffer.from(builtSource).toString("base64")}`);

class MemoryDB {
  constructor() { this.row = null; }
  prepare(sql) {
    const db = this;
    return {
      bind(...values) {
        return {
          async run() {
            if (/CREATE TABLE/i.test(sql)) return { success: true };
            throw new Error(`SQL inesperado em run: ${sql}`);
          },
          async first() {
            if (/SELECT payload/i.test(sql)) return db.row;
            if (/INSERT INTO app_state/i.test(sql)) {
              const [, payload, updatedAt, baseRevision] = values;
              if (db.row && db.row.revision !== baseRevision) return null;
              db.row = { payload, revision: db.row ? db.row.revision + 1 : 1, updated_at: updatedAt };
              return { revision: db.row.revision, updated_at: db.row.updated_at };
            }
            throw new Error(`SQL inesperado em first: ${sql}`);
          }
        };
      },
      async run() {
        if (/CREATE TABLE/i.test(sql)) return { success: true };
        throw new Error(`SQL inesperado em run: ${sql}`);
      }
    };
  }
}

const env = { DB: new MemoryDB(), APP_PASSWORD: "senha-de-teste-forte" };
const emptyResponse = await worker.handleApi(new Request("http://local/api/state"), env);
assert.equal(emptyResponse.status, 200);
assert.deepEqual(await emptyResponse.json(), { state: null, revision: 0, updatedAt: null });

const state = { version: 2, employees: [], entries: [], advances: [], updatedAt: "2026-09-16T13:00:00.000Z" };
const saveResponse = await worker.handleApi(new Request("http://local/api/state", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ state, baseRevision: 0 })
}), env);
assert.equal(saveResponse.status, 200);
assert.equal((await saveResponse.json()).revision, 1);

const savedResponse = await worker.handleApi(new Request("http://local/api/state"), env);
assert.deepEqual(await savedResponse.json(), { state, revision: 1, updatedAt: state.updatedAt });

const conflictResponse = await worker.handleApi(new Request("http://local/api/state", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ state: { ...state, updatedAt: "2026-09-16T13:01:00.000Z" }, baseRevision: 0 })
}), env);
assert.equal(conflictResponse.status, 409);
assert.equal((await conflictResponse.json()).revision, 1);

const staticPage = builtWorker.serveStatic(new Request("http://local/"), "/");
assert.equal(staticPage.status, 200);
assert.match(await staticPage.text(), /usersDialog/);
await import("./users-tests.mjs");
console.log("Todos os testes de sincronização e acesso privado passaram.");
