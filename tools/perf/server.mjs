// Static server for load measurements on ONE port (default 8181):
//   http://   -> HTTP/1.1, no compression, no cache headers (== python http.server dev profile)
//   https://  -> HTTP/2 + gzip + Cache-Control: max-age=$MAXAGE + ETag (== GitHub Pages-like)
// Usage: MAXAGE=600 node tools/perf/server.mjs [port] [--dist]
//   --dist serves dist/ (built by `npm run build`) instead of the repo root.
import http from 'node:http';
import http2 from 'node:http2';
import net from 'node:net';
import { readFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
const REPO = path.resolve(HERE, '..', '..');
const DIST = process.argv.includes('--dist');
const ROOT = DIST ? path.join(REPO, 'dist') : REPO;
const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || 8181);
const MAXAGE = Number(process.env.MAXAGE ?? 600);
if (!existsSync(ROOT)) {
  console.error(`${ROOT} not found${DIST ? ' - run npm run build first' : ''}`);
  process.exit(1);
}
const certDir = path.join(HERE, 'results', 'cert');
if (!existsSync(path.join(certDir, 'key.pem'))) {
  mkdirSync(certDir, { recursive: true });
  execSync(
    `openssl req -x509 -newkey rsa:2048 -nodes -keyout ${certDir}/key.pem -out ${certDir}/cert.pem -days 30 -subj /CN=127.0.0.1`,
    { stdio: 'ignore' }
  );
}
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};
const gzCache = new Map();
function resolve(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const abs = path.join(ROOT, p);
  // Dev-only server rooted at the repo: never serve dotfiles such as .dev.vars or .git.
  if (p.split('/').some((seg) => seg.startsWith('.'))) return null;
  if (!abs.startsWith(ROOT) || !existsSync(abs) || !statSync(abs).isFile()) return null;
  return abs;
}
function handler(compress) {
  return (req, res) => {
    const abs = resolve(req.url);
    if (!abs) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const st = statSync(abs);
    const etag = `"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`;
    const type = TYPES[path.extname(abs)] || 'application/octet-stream';
    const headers = { 'content-type': type };
    if (compress) {
      headers['cache-control'] = `max-age=${MAXAGE}`;
      headers.etag = etag;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, headers);
        res.end();
        return;
      }
    }
    let body = readFileSync(abs);
    if (
      compress &&
      /text|javascript|json|svg/.test(type) &&
      /gzip/.test(req.headers['accept-encoding'] || '')
    ) {
      if (!gzCache.has(abs)) gzCache.set(abs, gzipSync(body, { level: 6 }));
      body = gzCache.get(abs);
      headers['content-encoding'] = 'gzip';
    }
    headers['content-length'] = body.length;
    res.writeHead(200, headers);
    res.end(body);
  };
}
const plain = http.createServer(handler(false));
const secure = http2.createSecureServer(
  {
    key: readFileSync(path.join(certDir, 'key.pem')),
    cert: readFileSync(path.join(certDir, 'cert.pem')),
    allowHTTP1: true,
  },
  handler(true)
);
net
  .createServer((socket) => {
    socket.once('data', (buf) => {
      socket.pause();
      socket.unshift(buf);
      (buf[0] === 0x16 ? secure : plain).emit('connection', socket);
      process.nextTick(() => socket.resume());
    });
  })
  .listen(PORT, '127.0.0.1', () =>
    console.log(`perf server on ${PORT} (http=dev, https=h2+gzip max-age=${MAXAGE}) serving ${ROOT}`)
  );
