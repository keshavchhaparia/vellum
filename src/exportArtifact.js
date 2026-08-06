'use strict';

const fs = require('fs');
const path = require('path');

const DATA_URI_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.css': 'text/css',
  '.js': 'application/javascript',
};

function isLocalRef(ref) {
  if (!ref) return false;
  if (/^https?:\/\//i.test(ref)) return false;
  if (/^data:/i.test(ref)) return false;
  if (ref.startsWith('//')) return false;
  if (ref.startsWith('/')) return false; // root-absolute paths aren't valid for a portable file anyway
  return true;
}

function toDataUri(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  const mime = DATA_URI_MIME[ext] || 'application/octet-stream';
  const buf = fs.readFileSync(absPath);
  const isText = mime.startsWith('text/') || mime === 'application/javascript' || mime === 'image/svg+xml';
  const encoded = isText ? encodeURIComponent(buf.toString('utf8')) : buf.toString('base64');
  const prefix = isText ? `data:${mime},` : `data:${mime};base64,`;
  return prefix + encoded;
}

/**
 * Rewrites local (relative, non-remote) src="..."/href="...' references to
 * inline data: URIs so the exported HTML is a single portable file.
 * Remote (http(s)://, //cdn) references are intentionally left untouched —
 * a portable export still needs network for those, same tradeoff Lavish
 * documents for its own export command.
 */
function inlineLocalAssets(html, baseDir) {
  return html.replace(
    /((?:src|href)\s*=\s*)(["'])([^"']+)\2/gi,
    (full, prefix, quote, ref) => {
      if (!isLocalRef(ref)) return full;
      const abs = path.normalize(path.join(baseDir, ref));
      if (!abs.startsWith(baseDir)) return full; // refuse to read outside baseDir
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return full;
      try {
        const dataUri = toDataUri(abs);
        return `${prefix}${quote}${dataUri}${quote}`;
      } catch {
        return full;
      }
    }
  );
}

function exportArtifact(htmlPath, outPath) {
  const absHtml = path.resolve(htmlPath);
  const html = fs.readFileSync(absHtml, 'utf8');
  const baseDir = path.dirname(absHtml);
  const inlined = inlineLocalAssets(html, baseDir);
  const dest = outPath
    ? path.resolve(outPath)
    : path.join(baseDir, path.basename(absHtml, path.extname(absHtml)) + '.export.html');
  fs.writeFileSync(dest, inlined, 'utf8');
  return dest;
}

module.exports = { exportArtifact, inlineLocalAssets };
