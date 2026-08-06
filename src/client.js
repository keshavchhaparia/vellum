'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const CONFIG_DIR = path.join(os.homedir(), '.vellum');
const DAEMON_INFO_PATH = path.join(CONFIG_DIR, 'daemon.json');

function readDaemonInfo() {
  try {
    return JSON.parse(fs.readFileSync(DAEMON_INFO_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function writeDaemonInfo(info) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(DAEMON_INFO_PATH, JSON.stringify(info));
}

function httpJson(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: urlPath,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : undefined,
        timeout: 60 * 1000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch (e) {
            return reject(new Error('daemon returned non-JSON response: ' + raw.slice(0, 200)));
          }
          if (res.statusCode >= 400) {
            const err = new Error(parsed.error || `daemon responded ${res.statusCode}`);
            err.statusCode = res.statusCode;
            err.body = parsed;
            return reject(err);
          }
          resolve(parsed);
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('request to daemon timed out')));
    if (payload) req.write(payload);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Talk to the daemon's own /health, which is the source of truth for its
 * current bind mode (loopback-only vs LAN) — never trust a possibly-stale
 * local file for that. Returns null if nothing is listening. */
async function getHealth(port) {
  try {
    const res = await httpJson(port, 'GET', '/health');
    return res && res.ok ? res : null;
  } catch {
    return null;
  }
}

async function isAlive(port) {
  return !!(await getHealth(port));
}

function spawnDaemon({ lan } = {}) {
  const daemonEntry = path.join(__dirname, '..', 'bin', 'vellum.js');
  const args = [daemonEntry, '--__daemon'];
  if (lan) args.push('--lan');
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

async function waitForDaemon({ lan } = {}, deadlineMs = 8000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    await sleep(150);
    const info = readDaemonInfo();
    if (!info) continue;
    const health = await getHealth(info.port);
    if (health && (!lan || health.lan)) {
      return { port: info.port, lan: !!health.lan, displayHost: health.displayHost || '127.0.0.1' };
    }
  }
  throw new Error('timed out waiting for the vellum daemon to start');
}

/**
 * Returns { port, lan, displayHost } for a live vellum daemon that
 * satisfies the request. Spawns one (detached, survives this CLI process
 * exiting) if none is reachable. If a daemon is already running in
 * loopback-only mode but LAN access was requested, it is restarted in LAN
 * mode — going the other direction (LAN -> loopback) is never done
 * automatically, since that would silently cut off anyone already
 * connected from another device.
 */
async function ensureDaemon({ lan = false } = {}) {
  const info = readDaemonInfo();
  if (info) {
    const health = await getHealth(info.port);
    if (health) {
      if (!lan || health.lan) {
        return { port: info.port, lan: !!health.lan, displayHost: health.displayHost || '127.0.0.1' };
      }
      // Loopback-only, but this call needs LAN reach: restart with --lan.
      await stopDaemon();
      await sleep(250);
    }
  }
  spawnDaemon({ lan });
  return waitForDaemon({ lan });
}

async function request(method, urlPath, body, opts) {
  const { port } = await ensureDaemon(opts);
  return httpJson(port, method, urlPath, body);
}

async function stopDaemon() {
  const info = readDaemonInfo();
  if (!info || !(await isAlive(info.port))) return { ok: true, wasRunning: false };
  await httpJson(info.port, 'POST', '/shutdown');
  return { ok: true, wasRunning: true };
}

module.exports = {
  CONFIG_DIR,
  DAEMON_INFO_PATH,
  readDaemonInfo,
  writeDaemonInfo,
  ensureDaemon,
  request,
  stopDaemon,
  isAlive,
  getHealth,
};
