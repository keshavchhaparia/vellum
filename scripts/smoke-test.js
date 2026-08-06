#!/usr/bin/env node
'use strict';

// End-to-end smoke test that exercises the daemon exactly the way the CLI
// and the browser toolbar do, without popping an actual browser window.

const assert = require('assert');
const path = require('path');
const http = require('http');
const client = require('../src/client');
const { exportArtifact } = require('../src/exportArtifact');

function rawRequest(port, method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const exampleFile = path.join(__dirname, '..', 'examples', 'example.html');

  console.log('1. ensureDaemon() spawns a fresh background daemon...');
  const port = await client.ensureDaemon();
  assert.ok(port > 0, 'daemon should report a port');
  console.log('   ok, daemon on port', port);

  console.log('2. open a session for the example artifact...');
  const openResult = await client.request('POST', '/session/open', { htmlPath: exampleFile });
  assert.ok(openResult.sessionId, 'expected a sessionId');
  console.log('   ok, sessionId =', openResult.sessionId, 'url =', openResult.url);

  console.log('3. GET the rendered view and confirm the toolbar got injected...');
  const view = await rawRequest(port, 'GET', `/view/${openResult.sessionId}`);
  assert.strictEqual(view.status, 200);
  assert.ok(view.body.includes('toolbar.js'), 'expected injected toolbar script tag');
  assert.ok(view.body.includes('Vellum demo artifact'), 'expected original artifact content preserved');
  console.log('   ok, artifact served with toolbar injected');

  console.log('4. GET the toolbar.js asset itself...');
  const toolbarJs = await rawRequest(port, 'GET', `/view/${openResult.sessionId}/toolbar.js`);
  assert.strictEqual(toolbarJs.status, 200);
  assert.ok(toolbarJs.body.includes('vellum-bar'));
  console.log('   ok, toolbar script served');

  console.log('5. simulate the browser posting queued feedback...');
  await client.request('POST', `/session/${openResult.sessionId}/feedback`, {
    type: 'review',
    message: 'Looks good, tighten the card spacing',
    annotations: [{ selector: '.card:nth-of-type(1)', label: 'First card', note: 'Reduce padding' }],
  });
  console.log('   ok');

  console.log('6. poll should return that feedback immediately, not time out...');
  const params = new URLSearchParams({ timeoutMs: '2000' });
  const pollResult = await client.request('GET', `/session/${openResult.sessionId}/poll?${params.toString()}`);
  assert.strictEqual(pollResult.status, 'ok');
  assert.strictEqual(pollResult.items.length, 1);
  assert.strictEqual(pollResult.items[0].message, 'Looks good, tighten the card spacing');
  assert.strictEqual(pollResult.items[0].annotations[0].note, 'Reduce padding');
  console.log('   ok, feedback round-tripped:', JSON.stringify(pollResult.items[0]));

  console.log('7. poll with nothing queued should time out cleanly (fast timeout)...');
  const emptyParams = new URLSearchParams({ timeoutMs: '500' });
  const timeoutResult = await client.request('GET', `/session/${openResult.sessionId}/poll?${emptyParams.toString()}`);
  assert.strictEqual(timeoutResult.status, 'timeout');
  console.log('   ok, timed out as expected');

  console.log('8. agent-reply message set via poll query param is fetchable by the browser...');
  const replyParams = new URLSearchParams({ timeoutMs: '300', agentReply: 'Built the layout, take a look' });
  await client.request('GET', `/session/${openResult.sessionId}/poll?${replyParams.toString()}`);
  const agentReply = await client.request('GET', `/session/${openResult.sessionId}/agent-reply`);
  assert.strictEqual(agentReply.message, 'Built the layout, take a look');
  console.log('   ok, agent reply visible to browser poller');

  console.log('9. end the session...');
  await client.request('POST', `/session/${openResult.sessionId}/end`, {});
  const status = await client.request('GET', `/session/${openResult.sessionId}/status`);
  assert.strictEqual(status.ended, true);
  console.log('   ok, session ended');

  console.log('10. reopening without --reopen after an agent-initiated end is allowed...');
  const reopened = await client.request('POST', '/session/open', { htmlPath: exampleFile });
  assert.strictEqual(reopened.sessionId, openResult.sessionId);
  const statusAfterReopen = await client.request('GET', `/session/${reopened.sessionId}/status`);
  assert.strictEqual(statusAfterReopen.ended, false);
  console.log('   ok (agent-side end is not a hard lock, matches design doc)');

  console.log('10b. a browser-initiated end DOES require --reopen...');
  await client.request('POST', `/session/${openResult.sessionId}/end`, { fromBrowser: true });
  let refused = false;
  try {
    await client.request('POST', '/session/open', { htmlPath: exampleFile });
  } catch (err) {
    refused = err.statusCode === 409;
  }
  assert.ok(refused, 'expected 409 when reopening a browser-ended session without reopen:true');
  const forcedReopen = await client.request('POST', '/session/open', { htmlPath: exampleFile, reopen: true });
  assert.strictEqual(forcedReopen.sessionId, openResult.sessionId);
  console.log('   ok, refused plain reopen and honored explicit --reopen');

  console.log('11. export produces a portable file...');
  const dest = exportArtifact(exampleFile);
  const fs = require('fs');
  assert.ok(fs.existsSync(dest));
  fs.unlinkSync(dest);
  console.log('   ok, exported and cleaned up:', dest);

  console.log('12. stop the daemon...');
  const stopResult = await client.stopDaemon();
  assert.strictEqual(stopResult.wasRunning, true);
  console.log('   ok');

  console.log('\nALL SMOKE TESTS PASSED');
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err);
  process.exitCode = 1;
});
