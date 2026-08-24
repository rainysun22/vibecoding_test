/* ===== worker.js：考研词汇站 · 静态资源 + 进度API(D1) =====
 * /api/progress?device=xxx  GET→读取 POST→保存 DELETE→清除
 * 其余请求 → 静态资源(assets绑定) */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /* ---- 进度 API ---- */
    if (url.pathname.startsWith('/api/')) {
      const device = (url.searchParams.get('device') || '').slice(0, 64);
      if (!device) return json({ ok: false, error: 'missing device' }, 400);
      if (url.pathname !== '/api/progress') return json({ ok: false, error: 'not found' }, 404);

      if (request.method === 'GET') {
        const row = await env.DB.prepare('SELECT state FROM progress WHERE device=?').bind(device).first();
        return json({ ok: true, state: row ? JSON.parse(row.state) : null });
      }
      if (request.method === 'POST' || request.method === 'PUT') {
        try {
          const state = await request.json();
          if (!state || state.version !== 1 || typeof state.words !== 'object') throw new Error('bad');
          await env.DB.prepare(
            `INSERT INTO progress(device,state,updated_at) VALUES(?,?,?)
             ON CONFLICT(device) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at`
          ).bind(device, JSON.stringify(state), Date.now()).run();
          return json({ ok: true });
        } catch (e) { return json({ ok: false, error: 'invalid payload' }, 400); }
      }
      if (request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM progress WHERE device=?').bind(device).run();
        return json({ ok: true });
      }
      return json({ ok: false, error: 'method' }, 405);
    }

    /* ---- 静态资源 ---- */
    return env.ASSETS.fetch(request);
  }
};

function json(obj, code) {
  return new Response(JSON.stringify(obj), {
    status: code || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
