// Included in the Worker by build-worker.mjs. Credentials stay exclusively in D1.
const authSchemas = new WeakMap();
const sessionCookieName = "nespoli_user_session";
const userLimit = 3;

async function ensureAuthSchema(db) {
  if (!authSchemas.has(db)) {
    const ready = db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS access_users (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, login TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL, salt TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin','operator')),
        active INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS access_sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
        user_revision INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS access_login_limits (
        key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL
      )`)
    ]).catch((error) => { authSchemas.delete(db); throw error; });
    authSchemas.set(db, ready);
  }
  await authSchemas.get(db);
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function tokenHash(value) {
  return hex(await crypto.subtle.digest("SHA-256", textEncoder.encode(value)));
}

async function passwordHash(password, salt, pepper) {
  const pepperKey = await crypto.subtle.importKey("raw", textEncoder.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const secretPassword = await crypto.subtle.sign("HMAC", pepperKey, textEncoder.encode(password));
  const key = await crypto.subtle.importKey("raw", secretPassword, "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: textEncoder.encode(salt), iterations: 100000 }, key, 256));
}

function publicUser(user) {
  return { id: user.id, name: user.name, login: user.login, role: user.role, active: Boolean(user.active), revision: Number(user.revision) };
}

async function userCount(db) {
  return Number((await db.prepare("SELECT COUNT(*) AS total FROM access_users").first()).total);
}

async function currentUser(request, env) {
  const token = getCookie(request, sessionCookieName);
  if (token) {
    const user = await env.DB.prepare(`SELECT u.* FROM access_sessions s
      JOIN access_users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1 AND u.revision = s.user_revision`)
      .bind(await tokenHash(token), Date.now()).first();
    if (user) return publicUser(user);
  }
  // Shared access is available only until the first administrator is created.
  if (await userCount(env.DB) === 0 && await hasValidSession(request, env.APP_PASSWORD)) {
    return { id: "setup", name: "Configuração inicial", role: "setup", login: "", active: true };
  }
  return null;
}

async function startUserSession(db, user) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await db.prepare("DELETE FROM access_sessions WHERE expires_at <= ?").bind(Date.now()).run();
  await db.prepare("INSERT INTO access_sessions (token_hash, user_id, expires_at, user_revision) VALUES (?, ?, ?, ?)")
    .bind(await tokenHash(token), user.id, Date.now() + SESSION_TTL_SECONDS * 1000, user.revision).run();
  return `${sessionCookieName}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

async function allowLogin(request, db) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = await tokenHash(ip);
  const now = Date.now();
  await db.prepare("DELETE FROM access_login_limits WHERE expires_at <= ?").bind(now).run();
  const limit = await db.prepare(`INSERT INTO access_login_limits (key, attempts, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET attempts = access_login_limits.attempts + 1 RETURNING attempts`)
    .bind(key, now + 15 * 60 * 1000).first();
  return Number(limit.attempts) <= 20;
}

async function individualLogin(request, env) {
  const configured = await userCount(env.DB) > 0;
  if (request.method === "GET") return html(loginPage("", configured));
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (Number(request.headers.get("content-length")) > 4096) return json({ error: "Conteúdo muito grande." }, 413);
  if (!await allowLogin(request, env.DB)) return html(loginPage("Muitas tentativas. Aguarde 15 minutos e tente novamente.", configured), 429);
  if (!configured) return handleLogin(request, env);
  const form = await request.formData();
  const login = String(form.get("username") || "").trim().toLowerCase().slice(0, 64);
  const password = String(form.get("password") || "");
  const user = await env.DB.prepare("SELECT * FROM access_users WHERE login = ? AND active = 1").bind(login).first();
  const candidate = await passwordHash(password.slice(0, 128), user?.salt || "unknown-user-salt", env.APP_PASSWORD);
  if (!user || password.length > 128 || !secureEqual(candidate, user.password_hash)) {
    return html(loginPage("Usuário ou senha incorretos.", true), 401);
  }
  const cookie = await startUserSession(env.DB, user);
  return new Response(null, { status: 303, headers: { Location: "/", "Set-Cookie": cookie, "Cache-Control": "no-store" } });
}

async function manageUsers(request, env, actor) {
  if (!["admin", "setup"].includes(actor.role)) return json({ error: "Somente o administrador pode gerenciar usuários." }, 403);
  if (request.method === "GET") {
    const rows = await env.DB.prepare("SELECT id, name, login, role, active, revision FROM access_users ORDER BY created_at, id").all();
    return json({ users: rows.results.map(publicUser), limit: userLimit });
  }
  if (!["POST", "PATCH"].includes(request.method)) return json({ error: "Método não permitido." }, 405);
  if (Number(request.headers.get("content-length")) > 8192) return json({ error: "Conteúdo muito grande." }, 413);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Conteúdo inválido." }, 400); }
  const name = String(body.name || "").trim();
  const login = String(body.login || "").trim().toLowerCase();
  const password = String(body.password || "");
  const role = actor.role === "setup" ? "admin" : body.role;
  if (!name || name.length > 100 || !/^[a-z0-9._-]{3,40}$/.test(login) || !["admin", "operator"].includes(role)) {
    return json({ error: "Informe nome, login de 3 a 40 caracteres (letras, números, ponto, traço) e perfil." }, 400);
  }
  if ((request.method === "POST" || password) && (password.length < 10 || password.length > 128)) {
    return json({ error: "A senha deve ter de 10 a 128 caracteres." }, 400);
  }
  if (actor.role === "setup" && !secureEqual(body.setupPassword, env.APP_PASSWORD)) {
    return json({ error: "Confirme a senha atual do sistema para criar o primeiro administrador." }, 403);
  }
  const now = new Date().toISOString();
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = password ? await passwordHash(password, salt, env.APP_PASSWORD) : null;
  try {
    if (request.method === "POST") {
      const id = crypto.randomUUID();
      const limit = actor.role === "setup" ? 0 : userLimit - 1;
      const created = await env.DB.prepare(`INSERT INTO access_users
        (id, name, login, password_hash, salt, role, active, revision, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, 1, 1, ?, ? WHERE (SELECT COUNT(*) FROM access_users) <= ? RETURNING *`)
        .bind(id, name, login, hash, salt, role, now, now, limit).first();
      if (!created) return json({ error: actor.role === "setup" ? "O administrador já foi criado. Entre com seu usuário." : "Os três usuários já estão cadastrados. Edite um cadastro existente." }, 409);
      const headers = actor.role === "setup" ? { "Set-Cookie": await startUserSession(env.DB, created) } : {};
      const response = json({ user: publicUser(created) }, 201);
      for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      return response;
    }
    const active = body.active === false ? 0 : 1;
    const id = String(body.id || "");
    const revision = Number(body.revision);
    if (id === actor.id && (!active || role !== "admin")) return json({ error: "Mantenha seu próprio acesso de administrador ativo." }, 400);
    const updated = await env.DB.prepare(`UPDATE access_users SET name = ?, login = ?, role = ?, active = ?,
      password_hash = COALESCE(?, password_hash), salt = CASE WHEN ? IS NULL THEN salt ELSE ? END,
      revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?
      AND (role != 'admin' OR (? = 'admin' AND ? = 1) OR
        (SELECT COUNT(*) FROM access_users WHERE role = 'admin' AND active = 1 AND id != ?) > 0)
      RETURNING *`)
      .bind(name, login, role, active, hash, hash, salt, now, id, revision, role, active, id).first();
    if (!updated) return json({ error: "Cadastro alterado em outro aparelho ou último administrador. Atualize a lista." }, 409);
    const response = json({ user: publicUser(updated) });
    if (id === actor.id) response.headers.set("Set-Cookie", await startUserSession(env.DB, updated));
    return response;
  } catch (error) {
    if (/unique/i.test(String(error.message))) return json({ error: "Este login já está em uso." }, 409);
    throw error;
  }
}

function stampRecordAuthors(nextState, previousState, actor) {
  const author = { id: actor.id, name: actor.name, login: actor.login };
  for (const key of ["employees", "entries", "advances"]) {
    const previous = new Map((previousState?.[key] || []).map((record) => [record.id, record]));
    nextState[key] = nextState[key].map((record) => {
      const old = previous.get(record.id);
      const { createdBy, updatedBy, ...content } = record;
      const { createdBy: oldCreator, updatedBy: oldEditor, ...oldContent } = old || {};
      if (old && JSON.stringify(content) === JSON.stringify(oldContent)) return { ...content, ...(oldCreator ? { createdBy: oldCreator } : {}), ...(oldEditor ? { updatedBy: oldEditor } : {}) };
      return { ...content, ...(oldCreator ? { createdBy: oldCreator } : old ? {} : { createdBy: author }), updatedBy: author };
    });
  }
}
