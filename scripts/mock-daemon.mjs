#!/usr/bin/env node
// A tiny stand-in for the Open Design daemon's project API, so the "daemon"
// source can be developed and tested without the full monorepo:
//
//   node scripts/mock-daemon.mjs <folder> [--port 7457] [--id my-project]
//   OD_DAEMON_URL=http://127.0.0.1:7457 npm run dev
//   open http://127.0.0.1:5178/?source=daemon&project=my-project
//
// Implements the subset of the daemon contract the preview uses:
//   GET    /api/projects                              → { projects: [{ id, name, updatedAt }] }
//   GET    /api/projects/:id/files                    → { files: ProjectFile[] }
//   POST   /api/projects/:id/files                    ← { name, content[, encoding: 'base64'] } → { file }
//   GET    /api/projects/:id/raw/<path>               → file bytes
//   GET    /api/projects/:id/events                   → SSE: `ready`, `file-changed`, `comment-changed`
//   GET    /api/projects/:id/conversations            → { conversations }
//   POST   /api/projects/:id/conversations            → { conversation }
//   GET    /api/projects/:id/conversations/:cid/comments              → { comments }
//   POST   /api/projects/:id/conversations/:cid/comments              ← PreviewCommentUpsertRequest → { comment }
//   PATCH  /api/projects/:id/conversations/:cid/comments/:commentId   ← { status } → { comment }
//   PATCH  /api/projects/:id/conversations/:cid/comments/:commentId/reorder ← { sortKey } → { comment }
//   DELETE /api/projects/:id/conversations/:cid/comments/:commentId   → { ok: true }
// File kinds/MIME types follow apps/daemon/src/projects.ts (kindFor/mimeFor);
// comment rows follow apps/daemon/src/db.ts upsertPreviewComment (permanent
// per-file pinSeq = MAX+1, sortKey defaults to creation time). Conversations
// and comments persist in <folder>/.od-mock/ (dot folders are not listed).

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const folder = path.resolve(args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? '.');
const port = Number(flag('port', process.env.PORT ?? 7457));
const projectId = flag('id', path.basename(folder));
const stateDir = path.join(folder, '.od-mock');
const stateFile = path.join(stateDir, 'state.json');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.otf': 'font/otf',
};
const mimeFor = (name) => MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
function kindFor(name) {
  if (name.endsWith('.sketch.json')) return 'sketch';
  const ext = path.extname(name).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.svg') return 'sketch';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'].includes(ext)) return path.basename(name).startsWith('sketch-') ? 'sketch' : 'image';
  if (['.mp4', '.mov', '.webm'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.m4a'].includes(ext)) return 'audio';
  if (['.md', '.txt'].includes(ext)) return 'text';
  if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.css', '.py'].includes(ext)) return 'code';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'document';
  if (ext === '.pptx') return 'presentation';
  if (ext === '.xlsx') return 'spreadsheet';
  return 'binary';
}

function fileEntry(rel) {
  const stat = fs.statSync(path.join(folder, rel));
  return { name: rel, path: rel, type: 'file', size: stat.size, mtime: Math.round(stat.mtimeMs), kind: kindFor(rel), mime: mimeFor(rel) };
}

function listFiles() {
  const files = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(folder, rel), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'manifest.json') continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(childRel);
      else files.push(fileEntry(childRel));
    }
  };
  walk('');
  return files;
}

/** Same rule as the daemon's sanitizePath: keep slashes, refuse escapes. */
function safeRel(name) {
  const rel = String(name ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join('/');
  if (!rel || rel.split('/').some((seg) => seg.startsWith('.'))) return null;
  return rel;
}

// --- persisted state ---------------------------------------------------------
let state = { conversations: [], comments: [] };
try {
  state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) };
} catch {
  /* fresh */
}
function persist() {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

// --- events ------------------------------------------------------------------
const clients = new Set();
const broadcast = (event, data) => {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(frame);
};
let watchTimer = null;
const pending = new Map();
try {
  fs.watch(folder, { recursive: true }, (event, filename) => {
    if (!filename || filename.split(path.sep).some((s) => s.startsWith('.'))) return;
    const rel = filename.split(path.sep).join('/');
    pending.set(rel, fs.existsSync(path.join(folder, rel)) ? (event === 'rename' ? 'add' : 'change') : 'unlink');
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      for (const [p, kind] of pending) broadcast('file-changed', { type: 'file-changed', path: p, kind });
      pending.clear();
    }, 120);
  });
} catch (err) {
  console.warn('[mock-daemon] fs.watch unavailable, no live events:', err.message);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function upsertComment(cid, body) {
  const target = body.target ?? {};
  const now = Date.now();
  const existing = body.id ? state.comments.find((c) => c.id === body.id) : null;
  const fields = {
    filePath: String(target.filePath ?? existing?.filePath ?? ''),
    elementId: String(target.elementId ?? existing?.elementId ?? ''),
    selector: String(target.selector ?? existing?.selector ?? ''),
    label: String(target.label ?? existing?.label ?? ''),
    text: String(target.text ?? existing?.text ?? ''),
    position: target.position ?? existing?.position ?? { x: 0, y: 0, width: 0, height: 0 },
    htmlHint: String(target.htmlHint ?? existing?.htmlHint ?? ''),
    style: target.style ?? existing?.style,
    selectionKind: target.selectionKind ?? existing?.selectionKind ?? 'element',
    memberCount: target.memberCount ?? existing?.memberCount,
    podMembers: target.podMembers ?? existing?.podMembers,
    ...(typeof target.slideIndex === 'number' ? { slideIndex: target.slideIndex } : {}),
    note: String(body.note ?? ''),
    attachments: Array.isArray(body.attachments) ? body.attachments : undefined,
  };
  if (existing) {
    Object.assign(existing, fields, { updatedAt: now });
    return existing;
  }
  const pinSeq = state.comments.filter((c) => c.filePath === fields.filePath).reduce((max, c) => Math.max(max, c.pinSeq ?? 0), 0) + 1;
  const comment = { id: crypto.randomUUID(), projectId, conversationId: cid, ...fields, status: 'open', createdAt: now, updatedAt: now, pinSeq, sortKey: now };
  state.comments.push(comment);
  return comment;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  const send = (status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') return send(204, '');
  if (url.pathname === '/api/health') return send(200, { ok: true });
  if (url.pathname === '/api/projects') {
    return send(200, { projects: [{ id: projectId, name: path.basename(folder), updatedAt: Date.now(), kind: 'prototype' }] });
  }
  const prefix = `/api/projects/${encodeURIComponent(projectId)}`;
  if (!url.pathname.startsWith(prefix)) return send(404, { error: { code: 'NOT_FOUND', message: 'unknown project' } });
  const rest = url.pathname.slice(prefix.length);
  try {
    if (rest === '/files' && req.method === 'GET') return send(200, { files: listFiles() });
    if (rest === '/files' && req.method === 'POST') {
      const body = await readBody(req);
      const rel = safeRel(body.name);
      if (!rel || typeof body.content !== 'string') return send(400, { error: { code: 'BAD_REQUEST', message: 'name and content are required' } });
      const abs = path.join(folder, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body.encoding === 'base64' ? Buffer.from(body.content, 'base64') : body.content);
      return send(200, { file: fileEntry(rel) });
    }
    if (rest === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write(`event: ready\ndata: ${JSON.stringify({ projectId })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return undefined;
    }
    if (rest.startsWith('/raw/')) {
      const rel = decodeURIComponent(rest.slice('/raw/'.length));
      const abs = path.resolve(folder, rel);
      if (!abs.startsWith(folder + path.sep)) return send(400, { error: { code: 'BAD_REQUEST', message: 'path escapes project dir' } });
      if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return send(404, { error: { code: 'NOT_FOUND', message: rel } });
      return send(200, fs.readFileSync(abs), mimeFor(abs));
    }
    if (rest === '/conversations' && req.method === 'GET') return send(200, { conversations: state.conversations });
    if (rest === '/conversations' && req.method === 'POST') {
      const body = await readBody(req);
      const now = Date.now();
      const conversation = { id: crypto.randomUUID(), projectId, title: String(body.title ?? 'Conversation'), createdAt: now, updatedAt: now };
      state.conversations.push(conversation);
      persist();
      return send(200, { conversation });
    }
    const commentsMatch = rest.match(/^\/conversations\/([^/]+)\/comments(?:\/([^/]+)(\/reorder)?)?$/);
    if (commentsMatch) {
      const cid = decodeURIComponent(commentsMatch[1]);
      if (!state.conversations.some((c) => c.id === cid)) return send(404, { error: 'conversation not found' });
      const commentId = commentsMatch[2] ? decodeURIComponent(commentsMatch[2]) : null;
      if (!commentId && req.method === 'GET') return send(200, { comments: state.comments });
      if (!commentId && req.method === 'POST') {
        const comment = upsertComment(cid, await readBody(req));
        persist();
        return send(200, { comment });
      }
      const comment = state.comments.find((c) => c.id === commentId);
      if (!comment) return send(404, { error: 'comment not found' });
      if (req.method === 'DELETE') {
        state.comments = state.comments.filter((c) => c.id !== commentId);
        persist();
        return send(200, { ok: true });
      }
      if (req.method === 'PATCH') {
        const body = await readBody(req);
        if (commentsMatch[3]) {
          if (!Number.isFinite(body.sortKey)) return send(400, { error: 'sortKey must be a finite number' });
          comment.sortKey = body.sortKey;
        } else {
          comment.status = String(body.status ?? comment.status);
        }
        comment.updatedAt = Date.now();
        persist();
        return send(200, { comment });
      }
    }
    return send(404, { error: { code: 'NOT_FOUND', message: rest } });
  } catch (err) {
    return send(400, { error: { code: 'BAD_REQUEST', message: String(err?.message ?? err) } });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-daemon] serving ${folder} as project "${projectId}" on http://127.0.0.1:${port}`);
});
