#!/usr/bin/env node
'use strict';

const path = require('path');

function usage() {
  console.log(`vellum — local, in-browser artifact review, zero external services

Usage:
  vellum <html-file> [--reopen] [--lan]  Open (or resume) a review session
      --lan                                also bind on your LAN so another
                                            device on the same Wi-Fi/network
                                            can open the review URL. No auth —
                                            only use this on a trusted network.
  vellum poll <html-file> [options]     Long-poll for feedback
      --agent-reply "<message>"           show a message in the browser first
      --timeout <seconds>                  poll timeout (default 55)
  vellum end <html-file>                End a session
  vellum export <html-file> [--out <path>]  Write a portable, inlined single-file copy
  vellum stop                            Shut down the background daemon
  vellum --help                          Show this help
`);
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv[0] === '--__daemon') {
    const { startDaemon } = require('../src/daemon');
    const { writeDaemonInfo } = require('../src/client');
    const lan = argv.includes('--lan');
    startDaemon({
      host: lan ? 'lan' : '127.0.0.1',
      onListening(port) {
        writeDaemonInfo({ port, pid: process.pid });
      },
    });
    return; // keep process alive; server + idle timer hold the event loop
  }

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    usage();
    return;
  }

  const cmd = argv[0];
  const client = require('../src/client');

  if (cmd === 'stop') {
    const result = await client.stopDaemon();
    console.log(result.wasRunning ? 'Stopped the vellum daemon.' : 'No vellum daemon was running.');
    return;
  }

  if (cmd === 'poll') {
    const file = argv[1];
    if (!file) return fail('vellum poll <html-file> [--agent-reply "..."] [--timeout <seconds>]');
    const agentReplyIdx = argv.indexOf('--agent-reply');
    const agentReply = agentReplyIdx !== -1 ? argv[agentReplyIdx + 1] : undefined;
    const timeoutIdx = argv.indexOf('--timeout');
    const timeoutSec = timeoutIdx !== -1 ? Number(argv[timeoutIdx + 1]) : 55;

    const abs = path.resolve(file);
    const openResult = await client.request('POST', '/session/open', { htmlPath: abs });
    const params = new URLSearchParams();
    params.set('timeoutMs', String(Math.max(1, timeoutSec) * 1000));
    if (agentReply) params.set('agentReply', agentReply);
    const result = await client.request('GET', `/session/${openResult.sessionId}/poll?${params.toString()}`);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (cmd === 'end') {
    const file = argv[1];
    if (!file) return fail('vellum end <html-file>');
    const abs = path.resolve(file);
    const openResult = await client.request('POST', '/session/open', { htmlPath: abs, reopen: true });
    await client.request('POST', `/session/${openResult.sessionId}/end`, {});
    console.log('Session ended:', abs);
    return;
  }

  if (cmd === 'export') {
    const file = argv[1];
    if (!file) return fail('vellum export <html-file> [--out <path>]');
    const outIdx = argv.indexOf('--out');
    const out = outIdx !== -1 ? argv[outIdx + 1] : undefined;
    const { exportArtifact } = require('../src/exportArtifact');
    const dest = exportArtifact(file, out);
    console.log('Exported portable artifact to:', dest);
    return;
  }

  // default: open/resume a session for the given file
  const file = cmd;
  const reopen = argv.includes('--reopen');
  const lan = argv.includes('--lan');
  const abs = path.resolve(file);

  let openResult;
  try {
    openResult = await client.request('POST', '/session/open', { htmlPath: abs, reopen }, { lan });
  } catch (err) {
    if (err.statusCode === 409) {
      console.error(err.body.error);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  if (lan) {
    console.log('⚠ LAN mode: this session is reachable by anyone on your current network.');
    console.log('  There is no login/password — only use this on a network you trust.');
  }

  const { openUrl } = require('../src/openUrl');
  openUrl(openResult.url);
  console.log('Review session open:', openResult.url);
  if (lan) console.log('Share that URL with the other device — same Wi-Fi/network required.');
  console.log('Now run: vellum poll ' + JSON.stringify(file));
}

function fail(msg) {
  console.error(msg);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('vellum error:', err.message);
  process.exitCode = 1;
});
