/* ===== view-dash.js 仪表盘 ===== */
"use strict";

function streakDays(){
  let n=0; let d=new Date();
  const has=k=>{ const h=S.history[k]; return h&&(h.new+h.rev)>0; };
  if(!has(todayStr())) d=new Date(d.getTime()-DAY_MS); // 今天还没学则从昨天数
  while(has(todayStr(d.getTime()))){ n++; d=new Date(d.getTime()-DAY_MS); }
  return n;
}

function renderDash(){
  const q=planQuota(), day=dayIndex(), total=TOTAL;
  const learned=learnedCount(), mastered=masteredCount();
  const due=dueList().length;
  const todayStart=new Date(todayStr()+'T00:00:00').getTime();
  const newToday=Object.values(S.words).filter(st=>st.t>=todayStart).length;
  const h=S.history[todayStr()]||{};
  const pct=Math.round(learned/total*100), ringC=2*Math.PI*62;
  const remain=Math.max(0,PLAN_DAYS-day+1);
  const st=streakDays();

  /* 7天计划表 */
  let planRows='';
  for(let i=1;i<=PLAN_DAYS;i++){
    const a=(i-1)*q+1, b=Math.min(i*q,total);
    let done=0; for(let j=a-1;j<b;j++){ if(S.words[ORDER[j].w.toLowerCase()]) done++; }
    const rev=[i-1,i-2,i-4].filter(L=>L>=1).length*q;
    let cls='', tag= done>=b-a+1 ? '✅ 已完成' : (done>0?'进行中':'待开始');
    if(i===day) cls='today-row', tag='🔥 今天';
    else if(done>=b-a+1) cls='done-row';
    planRows+=`<tr class="${cls}"><td>Day ${i}</td><td>第 ${a}–${b} 词</td><td>约 ${rev} 题</td><td>${tag}</td></tr>`;
  }

  /* 近7天活跃柱状 */
  let bars=''; let maxv=1; const days=[];
  for(let i=6;i>=0;i--){ const ts=Date.now()-i*DAY_MS; const k=todayStr(ts); const hh=S.history[k]||{new:0,rev:0}; days.push({k,hh}); maxv=Math.max(maxv,hh.new+hh.rev); }
  days.forEach(d=>{ const hn=d.hh.new/maxv*100, hr=d.hh.rev/maxv*100;
    bars+=`<div class="bar" title="${d.k}：新学${d.hh.new} / 复习${d.hh.rev}"><i style="height:${hn}%"></i><i class="rev" style="height:${hr}%"></i><span>${d.k.slice(5).replace('-','/')}</span></div>`; });

  $('#view').innerHTML=`
  <div class="card hero" style="margin-bottom:16px">
    <div class="ring">
      <svg width="150" height="150"><circle cx="75" cy="75" r="62" fill="none" stroke="var(--line)" stroke-width="12"/>
      <circle cx="75" cy="75" r="62" fill="none" stroke="var(--accent)" stroke-width="12" stroke-linecap="round"
        stroke-dasharray="${ringC}" stroke-dashoffset="${ringC*(1-pct/100)}"/></svg>
      <div class="val"><b>${pct}%</b><span>${learned}/${total} 词</span></div>
    </div>
    <div style="flex:1;min-width:240px">
      <h2 style="margin:0 0 4px">${day<=PLAN_DAYS?`🔥 冲刺 Day ${day} / ${PLAN_DAYS}`:'🎓 巩固期（7天计划已完成）'}</h2>
      <p class="muted" style="margin:0 0 14px">${day<=PLAN_DAYS?`剩余 ${remain} 天 · 每日目标 ${q} 个新词 + 到期复习`:'继续复习巩固，防止遗忘'}</p>
      <div class="grid3">
        <div class="statcard good"><b>${mastered}</b><span>已掌握(稳定≥7天)</span></div>
        <div class="statcard warn"><b>${due}</b><span>当前待复习</span></div>
        <div class="statcard accent"><b>${st}</b><span>连续打卡(天)</span></div>
      </div>
    </div>
  </div>

  <div class="grid2" style="margin-bottom:16px">
    <div class="card today-box">
      <h3>📌 今日任务</h3>
      <div class="rowline"><span>新词学习</span><span><b style="color:var(--accent)">${newToday}</b> / ${q}</span></div>
      <div class="progress"><i style="width:${Math.min(100,newToday/q*100)}%"></i></div>
      <div class="rowline" style="margin-top:12px"><span>到期复习</span><span><b style="color:var(--good)">${h.rev||0}</b> 已过 / ${due+(h.rev||0)} 总计</span></div>
      <div class="progress"><i class="green" style="width:${(due+(h.rev||0))?Math.min(100,(h.rev||0)/(due+(h.rev||0))*100):0}%"></i></div>
      <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn primary lg" onclick="go('study')">▶ 开始学习</button>
        <button class="btn ghost" onclick="go('quiz')">📝 自测查漏</button>
      </div>
    </div>
    <div class="card">
      <h3 style="margin:2px 0 10px;font-size:15.5px">📈 近7天学习量</h3>
      <div class="bars">${bars}</div>
      <p class="muted" style="font-size:12px;margin:8px 0 0">■ 蓝色=新学 · 绿色=复习</p>
    </div>
  </div>

  <div class="card">
    <h2 class="sect">🗓️ 7天冲刺计划</h2>
    <div style="overflow:auto">
    <table class="plan">
      <tr><th>天</th><th>新词范围</th><th>预计复习量</th><th>状态</th></tr>
      ${planRows}
    </table>
    </div>
    <p class="muted" style="font-size:12.5px;margin:10px 0 0">* 新词用组块三步法(泛看→快测→补漏)；复习由 FSRS-lite 调度：越熟的词间隔越长(目标留存率85%)，答错的词10分钟后重现。进度保存在服务器数据库。</p>
  </div>`;
}
window.renderDash=renderDash;
