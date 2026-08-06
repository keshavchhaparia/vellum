'use strict';

const os = require('os');

/** Best-effort LAN-facing IPv4 address, or null if none found. */
function getLanIp() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        candidates.push({ name, address: iface.address });
      }
    }
  }
  if (candidates.length === 0) return null;
  // Prefer common Wi-Fi/Ethernet interface names when there's a choice.
  const preferred = candidates.find((c) => /^(en0|eth0|wlan0)$/.test(c.name));
  return (preferred || candidates[0]).address;
}

module.exports = { getLanIp };
