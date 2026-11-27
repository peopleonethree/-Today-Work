// 极简静态服务器：只服务本工作区的 assets/，仅监听本机回环地址。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../assets/', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.bin': 'application/octet-stream',
};

// 固定端口 = 固定源，浏览器的 localStorage 才能跨次运行保留。
// 端口被占用时自动往后找，并提示数据源已变化。
export async function startServer(first = 18765) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/index.html';
      const file = normalize(join(ROOT, rel));
      if (!file.startsWith(normalize(ROOT).replace(/[\\/]$/, '') + sep) && file !== ROOT) {
        res.writeHead(403).end();
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    }
  });
  const tryListen = (port, left) => new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' && left > 0) {
        resolve(tryListen(port + 1, left - 1));
      } else reject(err);
    });
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port,
        url: `http://127.0.0.1:${port}/index.html`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
  return tryListen(first, 20);
}
