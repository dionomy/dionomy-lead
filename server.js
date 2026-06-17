import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(rootDir, "public");
const dataDir = join(rootDir, "data");
const dbPath = process.env.DB_PATH || join(dataDir, "leads.sqlite");
const port = Number(process.env.PORT || 3000);

if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    business_name TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '',
    memo TEXT NOT NULL DEFAULT '',
    reply_status TEXT NOT NULL DEFAULT '미확인',
    reply_info TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const selectAll = db.prepare(`
  SELECT id, business_name, contact, region, memo, reply_status, reply_info, owner, created_at, updated_at
  FROM leads
  ORDER BY created_at DESC
`);
const selectById = db.prepare(`
  SELECT id, business_name, contact, region, memo, reply_status, reply_info, owner, created_at, updated_at
  FROM leads
  WHERE id = ?
`);
const insertLead = db.prepare(`
  INSERT INTO leads (
    id, business_name, contact, region, memo, reply_status, reply_info, owner, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateLead = db.prepare(`
  UPDATE leads
  SET business_name = ?, contact = ?, region = ?, memo = ?, reply_status = ?, reply_info = ?, owner = ?, updated_at = ?
  WHERE id = ?
`);
const deleteLead = db.prepare("DELETE FROM leads WHERE id = ?");
const deleteAllLeads = db.prepare("DELETE FROM leads");

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "서버 오류가 발생했습니다." });
  }
});

server.listen(port, () => {
  console.log(`http://localhost:${port}`);
  console.log(`DB: ${dbPath}`);
});

async function handleApi(req, res, url) {
  if (url.pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/leads" && req.method === "GET") {
    sendJson(res, 200, selectAll.all().map(toClientLead));
    return;
  }

  if (url.pathname === "/api/leads" && req.method === "POST") {
    const lead = createDbLead(await readJson(req));
    insertLead.run(
      lead.id,
      lead.businessName,
      lead.contact,
      lead.region,
      lead.memo,
      lead.replyStatus,
      lead.replyInfo,
      lead.owner,
      lead.createdAt,
      lead.updatedAt
    );
    sendJson(res, 201, lead);
    return;
  }

  if (url.pathname === "/api/leads/bulk" && req.method === "POST") {
    const body = await readJson(req);
    const items = Array.isArray(body.leads) ? body.leads : [];
    const saved = [];
    const insertMany = db.transaction((leads) => {
      for (const item of leads) {
        const lead = createDbLead(item);
        insertLead.run(
          lead.id,
          lead.businessName,
          lead.contact,
          lead.region,
          lead.memo,
          lead.replyStatus,
          lead.replyInfo,
          lead.owner,
          lead.createdAt,
          lead.updatedAt
        );
        saved.push(lead);
      }
    });
    insertMany(items);
    sendJson(res, 201, saved);
    return;
  }

  if (url.pathname === "/api/leads" && req.method === "DELETE") {
    deleteAllLeads.run();
    res.writeHead(204).end();
    return;
  }

  const match = url.pathname.match(/^\/api\/leads\/([^/]+)$/);
  if (match && req.method === "PATCH") {
    const id = decodeURIComponent(match[1]);
    const existing = selectById.get(id);
    if (!existing) {
      sendJson(res, 404, { error: "리드를 찾을 수 없습니다." });
      return;
    }
    const current = toClientLead(existing);
    const next = normalizeLead({ ...current, ...(await readJson(req)) });
    updateLead.run(
      next.businessName,
      next.contact,
      next.region,
      next.memo,
      next.replyStatus,
      next.replyInfo,
      next.owner,
      new Date().toISOString(),
      id
    );
    sendJson(res, 200, toClientLead(selectById.get(id)));
    return;
  }

  if (match && req.method === "DELETE") {
    const id = decodeURIComponent(match[1]);
    const result = deleteLead.run(id);
    if (result.changes === 0) {
      sendJson(res, 404, { error: "리드를 찾을 수 없습니다." });
      return;
    }
    res.writeHead(204).end();
    return;
  }

  sendJson(res, 404, { error: "요청 경로를 찾을 수 없습니다." });
}

async function serveStatic(res, pathname) {
  const safePath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const requestedPath = safePath === "/" ? "/index.html" : safePath;
  const filePath = join(publicDir, requestedPath);

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "접근할 수 없습니다." });
    return;
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream"
    });
    res.end(data);
  } catch {
    const fallback = await readFile(join(publicDir, "index.html"));
    res.writeHead(200, { "Content-Type": mimeTypes[".html"] });
    res.end(fallback);
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("JSON 형식이 올바르지 않습니다.");
  }
}

function createDbLead(input) {
  const now = new Date().toISOString();
  return {
    id: typeof input.id === "string" && input.id ? input.id : randomUUID(),
    ...normalizeLead(input),
    createdAt: now,
    updatedAt: now
  };
}

function normalizeLead(input = {}) {
  return {
    businessName: asText(input.businessName),
    contact: asText(input.contact),
    region: asText(input.region),
    memo: asText(input.memo),
    replyStatus: asText(input.replyStatus) || "미확인",
    replyInfo: asText(input.replyInfo),
    owner: asText(input.owner)
  };
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toClientLead(row) {
  return {
    id: row.id,
    businessName: row.business_name,
    contact: row.contact,
    region: row.region,
    memo: row.memo,
    replyStatus: row.reply_status,
    replyInfo: row.reply_info,
    owner: row.owner,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
