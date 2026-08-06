'use strict';

/**
 * The vellum daemon: a plain Node `http` server that binds ONLY to
 * 127.0.0.1, holds session + feedback state in memory, and serves the
 * artifact HTML with a small annotation toolbar injected before </body>.
 *
 * Deliberately zero runtime dependencies and zero outbound network calls.
 * Everything here talks to localhost only.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { injectToolbar } = require('./inject');

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // self-stop after 30 min with nothing to do
const IDLE_CHECK_INTERVAL_MS = 60 * 1000;
const MAX_POLL_MS = 55 * 1000; // long-poll ceiling; client can ask for less

/** filePath (absolute) -> session */
const sessions = new Map();
/** sessionId -> filePath (absolute), for reverse lookup */
const sessionIdToPath = new Map();

let lastActivity = Date.now();

function touch() {
  lastActivity = Date.now();
}

function makeSessionId() {
  return crypto.randomBytes(8).toString('hex');
}

function getOrCreateSession(absHtmlPath) {
  let session = sessions.get(absHtmlPath);
  if (session) return session;
  session = {
    id: makeSessionId(),
    htmlPath: absHtmlPath,
    ended: false,
    endedFromBrowser: false,
    feedbackQueue: [],
    waiters: [], // { resolve, timer }
    agentReply: null,
    agentReplySeq: 0,
    createdAt: Date.now(),
  };
  sessions.set(absHtmlPath, session);
  sessionIdToPath.set(session.id, absHtmlPath);
  return session;
}

function getSessionById(id) {
  const p = sessionIdToPath.get(id);
  if (!p) return null;
  return sessions.get(p) || null;
}

function pushFeedback(session, item) {
  session.feedbackQueue.push(item);
  touch();
  const waiters = session.waiters;
  session.waiters = [];
  for (const w of waiters) {
    clearTimeout(w.timer);
    w.resolve({ status: 'ok', items: drainQueue(session) });
  }
}

function drainQueue(session) {
  const items = session.feedbackQueue;
  session.feedbackQueue = [];
  return items;
}

function waitForFeedback(session, timeoutMs) {
  return new Promise((resolve) => {
    if (session.ended) {
      resolve({ status: 'ended', items: drainQueue(session) });
      return;
    }
    if (session.feedbackQueue.length > 0) {
      resolve({ status: 'ok', items: drainQueue(session) });
      return;
    }
    const timer = setTimeout(() => {
      session.waiters = session.waiters.filter((w) => w.resolve !== resolve);
      resolve({ status: 'timeout', items: [] });
    }, Math.min(timeoutMs, MAX_POLL_MS));
    session.waiters.push({ resolve, timer });
  });
}

function endSession(session, { fromBrowser = false } = {}) {
  session.ended = true;
  session.endedFromBrowser = fromBrowser;
  touch();
  const waiters = session.waiters;
  session.waiters = [];
  for (const w of waiters) {
    clearTimeout(w.timer);
    w.resolve({ status: 'ended', items: drainQueue(session) });
  }
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };
  return map[ext] || 'application/octet-stream';
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 5 * 1024 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/** Serve a sibling asset next to the session's html file. Path-traversal safe. */
function serveAsset(session, assetRelPath, res) {
  const baseDir = path.dirname(session.htmlPath);
  const target = path.normalize(path.join(baseDir, decodeURIComponent(assetRelPath)));
  if (!target.startsWith(baseDir + path.sep) && target !== baseDir) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  fs.readFile(target, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypeFor(target), 'Content-Length': data.length });
    res.end(data);
  });
}

function createServer() {
  const server = http.createServer(async (req, res) => {
    touch();
    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
    } catch {
      sendJson(res, 400, { error: 'bad request' });
      return;
    }
    const parts = url.pathname.split('/').filter(Boolean);

    try {
      // GET /health
      if (req.method === 'GET' && parts.length === 1 && parts[0] === 'health') {
        sendJson(res, 200, { ok: true, pid: process.pid, sessions: sessions.size });
        return;
      }

      // POST /session/open  { htmlPath }
      if (req.method === 'POST' && parts.length === 2 && parts[0] === 'session' && parts[1] === 'open') {
        const body = await readBody(req);
        if (!body.htmlPath) return sendJson(res, 400, { error: 'htmlPath required' });
        const abs = path.resolve(body.htmlPath);
        if (!fs.existsSync(abs)) return sendJson(res, 404, { error: 'file not found: ' + abs });
        const session = getOrCreateSession(abs);
        if (session.ended) {
          if (session.endedFromBrowser && !body.reopen) {
            return sendJson(res, 409, {
              error: 'session was ended from the browser; pass reopen to resume',
              sessionId: session.id,
            });
          }
          // Agent-initiated ends resume on a plain open; browser-initiated
          // ends only resume when the caller explicitly asked to reopen.
          session.ended = false;
          session.endedFromBrowser = false;
        }
        return sendJson(res, 200, {
          sessionId: session.id,
          url: `http://127.0.0.1:${server.__port}/view/${session.id}`,
        });
      }

      // GET /view/:sessionId
      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'view') {
        const session = getSessionById(parts[1]);
        if (!session) return sendJson(res, 404, { error: 'unknown session' });
        let html;
        try {
          html = fs.readFileSync(session.htmlPath, 'utf8');
        } catch {
          return sendJson(res, 404, { error: 'artifact file missing on disk' });
        }
        const injected = injectToolbar(html, { sessionId: session.id });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(injected);
        return;
      }

      // GET /view/:sessionId/toolbar.js
      if (
        req.method === 'GET' &&
        parts.length === 3 &&
        parts[0] === 'view' &&
        parts[2] === 'toolbar.js'
      ) {
        const session = getSessionById(parts[1]);
        if (!session) return sendJson(res, 404, { error: 'unknown session' });
        const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'toolbar.js'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(js);
        return;
      }

      // GET /view/:sessionId/assets/<relpath>
      if (
        req.method === 'GET' &&
        parts.length >= 3 &&
        parts[0] === 'view' &&
        parts[2] === 'assets'
      ) {
        const session = getSessionById(parts[1]);
        if (!session) return sendJson(res, 404, { error: 'unknown session' });
        const relPath = parts.slice(3).join('/');
        serveAsset(session, relPath, res);
        return;
      }

      // POST /session/:id/feedback  { type, message?, items? }
      if (req.method === 'POST' && parts.length === 3 && parts[0] === 'session' && parts[2] === 'feedback') {
        const session = getSessionById(parts[1]);
        if (!session) return sendJson(res, 404, { error: 'unknown session' });
        const body = await readBody(req);
        pushFeedback(session, {
          type: body.type || 'message',
          message: body.message || '',
          annotations: Array.isArray(body.annotations) ? body.annotations : [],
          at: Date.now(),
        });
        return sendJson(res, 200, { ok: true });
      }

      // GET /session/:id/poll?timeoutMs=&agentReply=
      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'session' && parts[2] === 'poll') {
        const session = getSessionById(parts[1]);
        if (!session) return sendJson(res, 404, { error: 'unknown session' });
        const agentReply = url.searchParams.get('agentReply');
        if (agentReply) {
          session.agentReply = agentReply;
          session.agentReplySeq += 1;
        }
        const timeoutMs = Number(url.searchParams.get('timeoutMs')) || MAX_POLL_MS;
        const result = await waitForFeedback(session, timeoutMs);
        return sendJson(res, 200, result);
      }

      // GET /session/:id/agent-reply?since=
      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'session' && parts[2] === 'agent-reply') {
        const session = getSessionById(parts[1]);
        if (!session) return sendJson(res, 404, { error: 'unknown session' });
        return sendJson(res, 200, {
          ended: session.ended,
          seq: session.agentReplySeq,
          message: session.agentReply,
        });
      }

      // GET /session/:id/status
      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'session' && parts[2] === 'status') {
        const session = getSessionById(parts[1]);
        if (!session) return sendJson(res, 404, { error: 'unknown session' });
        return sendJson(res, 200, { ended: session.ended, id: session.id });
      }

      // POST /session/:id/end  { fromBrowser? }
      if (req.method === 'POST' && parts.length === 3 && parts[0] === 'session' && parts[2] === 'end') {
        const session = getSessionById(parts[1]);
        if (!session) return sendJson(res, 404, { error: 'unknown session' });
        const body = await readBody(req).catch(() => ({}));
        endSession(session, { fromBrowser: !!body.fromBrowser });
        return sendJson(res, 200, { ok: true });
      }

      // POST /shutdown
      if (req.method === 'POST' && parts.length === 1 && parts[0] === 'shutdown') {
        sendJson(res, 200, { ok: true });
        setTimeout(() => process.exit(0), 50);
        return;
      }

      sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      sendJson(res, 500, { error: String((err && err.message) || err) });
    }
  });

  return server;
}

function startDaemon({ preferredPort = 51797, onListening } = {}) {
  const server = createServer();
  server.listen(preferredPort, '127.0.0.1', () => {
    server.__port = server.address().port;
    if (onListening) onListening(server.__port);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      // Fall back to an OS-assigned free port.
      server.listen(0, '127.0.0.1', () => {
        server.__port = server.address().port;
        if (onListening) onListening(server.__port);
      });
    } else {
      throw err;
    }
  });

  // Idle self-stop: nothing to babysit, no point burning a background process.
  const idleTimer = setInterval(() => {
    if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
      clearInterval(idleTimer);
      server.close(() => process.exit(0));
    }
  }, IDLE_CHECK_INTERVAL_MS);
  idleTimer.unref?.();

  return server;
}

module.exports = { startDaemon, createServer };
