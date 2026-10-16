// Authoritative multiplayer server with zones (outside grounds + chapel interior).
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000, TICK = 50, WALK = 120, RUN = 190; // px/sec
const ZONES = require('./zones');
const hit = (z, x, y) => x < 10 || y < 0 || x > z.w - 10 || y > z.h - 2 ||
  z.walls.some(([a, b, w, h]) => x + 10 > a && x - 10 < a + w && y > b && y - 6 < b + h); // feet box
const players = new Map(); let nextId = 1;

const mime = { '.html': 'text/html', '.png': 'image/png', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const root = path.join(__dirname, 'public'), f = path.join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
const wss = new WebSocketServer({ server });
const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify(m));

wss.on('connection', ws => {
  const id = nextId++, z = ZONES.outside;
  const p = { id, zone: 'outside', name: 'Guest' + id, x: z.spawn[0] + Math.random() * 30 - 15, y: z.spawn[1], dx: 0, dy: 0, run: false, atk: 0, atkUntil: 0, atkN: 0, color: Math.floor(Math.random() * 0xffffff), dir: 'down' };
  players.set(id, p); ws.pid = id;
  send(ws, { t: 'welcome', id, zone: p.zone });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'input') { p.dx = Math.sign(+m.dx || 0); p.dy = Math.sign(+m.dy || 0); p.run = !!m.run; }
    else if (m.t === 'attack' && Date.now() > p.atkUntil) { p.atkN = p.atkN % 2 + 1; p.atk = p.atkN; p.atkUntil = Date.now() + 450; }
    else if (m.t === 'name') p.name = String(m.name).replace(/[<>]/g, '').slice(0, 16) || p.name;
    else if (m.t === 'chat') wss.clients.forEach(c => players.get(c.pid)?.zone === p.zone && send(c, { t: 'chat', id, name: p.name, text: String(m.text).slice(0, 120) }));
  });
  ws.on('close', () => players.delete(id));
});

setInterval(() => {
  const dt = TICK / 1000;
  for (const p of players.values()) {
    const z = ZONES[p.zone];
    if (Date.now() > p.atkUntil) p.atk = 0;
    if (p.dx || p.dy) {
      const sp = p.run ? RUN : WALK, len = Math.hypot(p.dx, p.dy), vx = p.dx / len * sp * dt, vy = p.dy / len * sp * dt;
      if (!hit(z, p.x + vx, p.y)) p.x += vx;       // axis-separated = slide along walls
      if (!hit(z, p.x, p.y + vy)) p.y += vy;
      p.dir = Math.abs(p.dx) >= Math.abs(p.dy) && p.dx ? (p.dx > 0 ? 'right' : 'left') : (p.dy > 0 ? 'down' : 'up');
    }
    for (const e of z.exits) { const [a, b, w, h] = e.rect;   // zone transition
      if (p.x > a && p.x < a + w && p.y > b && p.y < b + h) {
        const to = ZONES[e.to], s = e.spawn || to.spawn;
        p.zone = e.to; p.x = s[0]; p.y = s[1]; p.dx = p.dy = 0; break; } }
  }
  for (const ws of wss.clients) {
    const me = players.get(ws.pid); if (!me) continue;
    send(ws, { t: 'state', zone: me.zone, p: [...players.values()].filter(q => q.zone === me.zone)
      .map(({ id, name, x, y, dir, dx, dy, run, atk }) => ({ id, name, x: Math.round(x), y: Math.round(y), dir, run, atk, mv: !!(dx || dy) })) });
  }
}, TICK);

server.listen(PORT, () => console.log('Castle online at http://localhost:' + PORT));
