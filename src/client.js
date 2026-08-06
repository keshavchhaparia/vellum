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

async function isAlive(port) {
  try {
    const res = await httpJson(port, 'GET', '/health');
    return !!res.ok;
  } catch {
    return false;
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Returns the port of a live vellum daemon, spawning one (detached,
 * survives this CLI process exiting) if none is reachable.
 */
async function ensureDaemon() {
  const info = readDaemonInfo();
  if (info && (await isAlive(info.port))) {
    return info.port;
  }

  const daemonEntry = path.join(__dirname, '..', 'bin', 'vellum.js');
  const child = spawn(process.execPath, [daemonEntry, '--__daemon'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await sleep(150);
    const freshInfo = readDaemonInfo();
    if (freshInfo && (await isAlive(freshInfo.port))) {
      return freshInfo.port;
    }
  }
  throw new Error('timed out waiting for the vellum daemon to start');
}

async function request(method, urlPath, body) {
  const port = await ensureDaemon();
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
};
