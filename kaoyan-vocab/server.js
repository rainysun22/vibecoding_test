/* ===== server.js：静态文件服务 + 学习进度数据库(SQLite) API =====
 * 启动：node server.js   (默认端口 8080)
 * API：
 *   GET    /api/progress?device=xxx   → {ok:true, state:{...}|null}
 *   POST   /api/progress?device=xxx   → 保存进度(body 为状态 JSON)
 *   DELETE /api/progress?device=xxx   → 清除该设备进度
 */
"use strict";
const http = require('http'), fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const DB_PATH = path.join(ROOT, 'data', 'progress.db');
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS progress(
  device     TEXT PRIMARY KEY,
  state      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png', '.ico': 'image/x-icon'
};

function send(res, code, body, type){
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function sendJSON(res, code, obj){ send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8'); }
function readBody(req){
  return new Promise((resolve, reject)=>{
    let b=''; req.on('data', c=>{ b+=c; if(b.length>5e6) req.destroy(); });
    req.on('end', ()=>resolve(b)); req.on('error', reject);
  });
}

const server = http.createServer(async (req, res)=>{
  const u = new URL(req.url, 'http://localhost');

  /* ---- 进度 API ---- */
  if(u.pathname.startsWith('/api/')){
    const device = (u.searchParams.get('device') || '').slice(0, 64);
    if(!device) return sendJSON(res, 400, { ok:false, error:'missing device' });

    if(u.pathname === '/api/progress'){
      if(req.method === 'GET'){
        const row = db.prepare('SELECT state FROM progress WHERE device=?').get(device);
        return sendJSON(res, 200, { ok:true, state: row ? JSON.parse(row.state) : null });
      }
      if(req.method === 'POST' || req.method === 'PUT'){
        try{
          const state = JSON.parse(await readBody(req));
          if(!state || state.version !== 1 || typeof state.words !== 'object') throw new Error('bad state');
          db.prepare(`INSERT INTO progress(device,state,updated_at) VALUES(?,?,?)
            ON CONFLICT(device) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at`)
            .run(device, JSON.stringify(state), Date.now());
          return sendJSON(res, 200, { ok:true });
        }catch(e){ return sendJSON(res, 400, { ok:false, error:'invalid payload' }); }
      }
      if(req.method === 'DELETE'){
        db.prepare('DELETE FROM progress WHERE device=?').run(device);
        return sendJSON(res, 200, { ok:true });
      }
    }
    return sendJSON(res, 404, { ok:false, error:'not found' });
  }

  /* ---- 静态文件 ---- */
  let p = decodeURIComponent(u.pathname);
  if(p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if(!file.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data)=>{
    if(err) return send(res, 404, 'Not Found');
    send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
});

server.listen(PORT, ()=>console.log(`kaoyan-vocab server → http://localhost:${PORT}  (SQLite: ${DB_PATH})`));
