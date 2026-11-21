// Serves game/ over HTTP and runs the raw WebSocket lobby on the same port, no dependencies.
// Palmetto Heat — tiny static server + WebSocket lobby for local playtesting.
// Serves game/ on http://localhost:8080 (or --port <n>) and, on the same
// port, a multiplayer lobby at ws://localhost:8080: no accounts, no deps,
// just positions and chat for the ?mp=1 mode. The WebSocket half is raw
// Node: HTTP upgrade, Sec-WebSocket-Accept, masked text frames in,
// unmasked text frames out, a 5 Hz broadcast of every driver's snapshot.
//   node serve.ts [--port 8080]
// Open http://localhost:8080/?mp=1 in two tabs to drive together.
// Round 4: the lobby and the static files share one port, no accounts, no deps.

import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./game', import.meta.url)));
const argv = process.argv.slice(2);
const portFlag = argv.indexOf('--port');
const wanted = portFlag === -1 ? 8080 : Number(argv[portFlag + 1]);
const port = Number.isInteger(wanted) && wanted > 0 && wanted < 65536 ? wanted : 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
};

// ---- WebSocket lobby -------------------------------------------------------
// One client per socket. Each keeps its last snapshot ({x, z, heading,
// inCar, char, stars}); the server broadcasts the whole list five times a
// second, plus chat and wave messages as they arrive. Idle sockets are
// dropped after 30 seconds without a frame.

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PLAYERS = 16;
const clients = new Map(); // socket -> { id, x, z, heading, inCar, char, stars, lastSeen, buffer }
let nextPlayer = 1;

function wsAccept(key) {
  return createHash('sha1').update(key + WS_GUID).digest('base64');
}

// Build one unmasked text frame. Payloads here are small JSON, so the
// 126-byte extended length is the only extra case we need.
function wsFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    return null; // never happens for our messages; drop it instead of guessing
  }
  return Buffer.concat([header, payload]);
}

function wsSend(socket, text) {
  const frame = wsFrame(text);
  if (frame) socket.write(frame);
}

function wsBroadcast(text) {
  for (const socket of clients.keys()) wsSend(socket, text);
}

function lobbyList() {
  return [...clients.values()].map((c) => ({
    id: c.id, x: c.x, z: c.z, heading: c.heading,
    inCar: c.inCar, char: c.char, stars: c.stars,
  }));
}

function handleLobbyMessage(socket, client, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'hello') {
    client.char = msg.char === 'jason' ? 'jason' : 'lucia';
    wsSend(socket, JSON.stringify({ t: 'welcome', id: client.id, count: clients.size }));
    wsBroadcast(JSON.stringify({ t: 'chat', from: 'lobby', text: `${client.id} joined the streets.` }));
  } else if (msg.t === 'pos') {
    client.x = Number(msg.x) || 0;
    client.z = Number(msg.z) || 0;
    client.heading = Number(msg.heading) || 0;
    client.inCar = !!msg.inCar;
    client.char = msg.char === 'jason' ? 'jason' : 'lucia';
    client.stars = Math.max(0, Math.min(5, Number(msg.stars) || 0));
  } else if (msg.t === 'chat' && typeof msg.text === 'string' && msg.text.trim()) {
    wsBroadcast(JSON.stringify({ t: 'chat', from: client.id, text: msg.text.slice(0, 140) }));
  } else if (msg.t === 'wave') {
    wsBroadcast(JSON.stringify({ t: 'wave', from: client.id }));
  }
}

// Parse masked client frames out of the socket's buffer. Handles text,
// close and ping; anything malformed closes the socket.
function wsFeed(socket, client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  client.lastSeen = Date.now();
  for (;;) {
    const buf = client.buffer;
    if (buf.length < 2) return;
    const fin = (buf[0] & 0x80) !== 0;
    const op = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (buf.length < 4) return;
      len = buf.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (buf.length < 10) return;
      const hi = buf.readUInt32BE(2);
      const lo = buf.readUInt32BE(6);
      if (hi !== 0 || lo > 1048576) { socket.destroy(); return; }
      len = lo;
      off = 10;
    }
    if (!masked) { socket.destroy(); return; } // clients must mask
    if (buf.length < off + 4 + len) return;
    const mask = buf.subarray(off, off + 4);
    const payload = Buffer.alloc(len);
    for (let i = 0; i < len; i++) payload[i] = buf[off + 4 + i] ^ mask[i % 4];
    client.buffer = buf.subarray(off + 4 + len);
    if (!fin) { socket.destroy(); return; } // no fragmented messages here
    if (op === 8) { socket.end(); return; }
    if (op === 9) { socket.write(Buffer.from([0x8a, 0x00])); continue; } // pong
    if (op === 1) {
      try { handleLobbyMessage(socket, client, JSON.parse(payload.toString('utf8'))); }
      catch { /* a bad frame never breaks the lobby */ }
    }
  }
}

function wsDrop(socket, announce = true) {
  const client = clients.get(socket);
  if (!client) return;
  clients.delete(socket);
  if (announce) wsBroadcast(JSON.stringify({ t: 'bye', id: client.id }));
}

setInterval(() => {
  const now = Date.now();
  for (const [socket, client] of clients) {
    if (now - client.lastSeen > 30000) {
      wsDrop(socket);
      socket.destroy();
    }
  }
  if (clients.size > 0) {
    wsBroadcast(JSON.stringify({ t: 'players', list: lobbyList() }));
  }
}, 200).unref();

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400).end('bad request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = resolve(join(root, normalize(pathname)));
  if (file !== root && !file.startsWith(root + sep)) {
    response.writeHead(403).end('forbidden');
    return;
  }
  let size;
  try {
    const stats = statSync(file);
    if (!stats.isFile()) throw new Error('not a file');
    size = stats.size;
  } catch {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': size,
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(response);
});

server.on('upgrade', (request, socket) => {
  const key = request.headers['sec-websocket-key'];
  if (!key || clients.size >= MAX_PLAYERS) {
    socket.destroy();
    return;
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${wsAccept(key)}\r\n\r\n`,
  );
  const client = {
    id: `driver-${nextPlayer++}`,
    x: 0, z: 100, heading: Math.PI, inCar: false, char: 'lucia', stars: 0,
    lastSeen: Date.now(), buffer: Buffer.alloc(0),
  };
  clients.set(socket, client);
  console.log(`lobby: ${client.id} connected (${clients.size} online)`);
  socket.on('data', (chunk) => wsFeed(socket, client, chunk));
  socket.on('close', () => wsDrop(socket));
  socket.on('error', () => wsDrop(socket));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Palmetto Heat is on http://localhost:${port} (lobby ws://localhost:${port}, open ?mp=1)`);
});
