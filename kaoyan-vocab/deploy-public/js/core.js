/* ===== core.js：数据解析 / 状态存储 / 记忆算法 / 路由 ===== */
"use strict";

/* ---------- 工具 ---------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const DAY_MS = 86400000;
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function todayStr(ts){ const d = new Date(ts || Date.now()); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function daysBetween(a,b){ return Math.floor((new Date(b+'T00:00:00') - new Date(a+'T00:00:00'))/DAY_MS); }
function fmtSec(ms){ const s=Math.round(ms/1000); return s<60? s+'秒' : Math.floor(s/60)+'分'+(s%60? (s%60)+'秒':''); }
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.remove('hidden'); clearTimeout(toast._h); toast._h=setTimeout(()=>t.classList.add('hidden'),2200); }

/* ---------- 词库解析(去重) + 固定随机序(每日词块难度均衡) ---------- */
const WORDS = (()=>{            // 字母序全表
  const seen=new Set(), out=[];
  (window.RAW_WORDS||[]).forEach(e=>{
    const i=e.indexOf('|'); if(i<1) return;
    const w=e.slice(0,i).trim(), m=e.slice(i+1).trim();
    const k=w.toLowerCase(); if(!w||!m||seen.has(k)) return;
    seen.add(k); out.push({w,m});
  });
  out.sort((a,b)=>a.w.toLowerCase()<b.w.toLowerCase()?-1:1);
  return out;
})();
const ORDER = (()=>{            // 固定洗牌 → 学习顺序(混合字母/难度)
  const r=mulberry32(20260823), a=WORDS.map(x=>x);
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(r()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
})();
const BYWORD = new Map(WORDS.map(x=>[x.w.toLowerCase(),x]));
const TOTAL = WORDS.length;
const PLAN_DAYS = 7;

/* ---------- 状态(云端数据库优先，localStorage 兜底) ---------- */
const SKEY='kaoYanVocab.v1', DEVICE_KEY='kaoYanVocab.device';
function defaultState(){
  return { version:1, startDate:todayStr(), dailyNew:Math.ceil(TOTAL/PLAN_DAYS),
    autoSpeak:false, dark:false, onboarded:false, words:{}, history:{}, starred:[] };
}
function deviceId(){          // 设备标识(存 localStorage)，作为数据库主键
  let d=localStorage.getItem(DEVICE_KEY);
  if(!d){ d='dev-'+Date.now().toString(36)+Math.random().toString(36).slice(2,10); localStorage.setItem(DEVICE_KEY,d); }
  return d;
}
function localLoad(){ try{ const s=JSON.parse(localStorage.getItem(SKEY)); if(s&&s.version===1) return s; }catch(e){} return null; }
async function serverLoad(){
  try{
    const r=await fetch('/api/progress?device='+encodeURIComponent(deviceId()));
    if(r.ok){ const j=await r.json(); if(j&&j.ok&&j.state&&j.state.version===1) return j.state; }
  }catch(e){}
  return null;
}
let S = localLoad() || defaultState();
let saveTimer=null, pushTimer=null;
function save(){              // 双写：localStorage 兜底 + 云端数据库
  clearTimeout(saveTimer); saveTimer=setTimeout(()=>{ try{ localStorage.setItem(SKEY, JSON.stringify(S)); }catch(e){} },150);
  clearTimeout(pushTimer); pushTimer=setTimeout(pushState,700);
}
function pushState(){
  try{
    fetch('/api/progress?device='+encodeURIComponent(deviceId()),
      { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(S), keepalive:true }).catch(()=>{});
  }catch(e){}
}
window.addEventListener('pagehide',()=>{    // 关页兜底
  try{ navigator.sendBeacon('/api/progress?device='+encodeURIComponent(deviceId()),
    new Blob([JSON.stringify(S)],{type:'application/json'})); }catch(e){}
});

/* ---------- 记忆算法(7天无痛 · FSRS-lite + 组块三步法) ----------
 * 调研依据：FSRS(DSR记忆三变量模型,比SM-2少~25%复习量) + 测试效应(主动回忆优于被动重读)
 *          + 短时记忆7±2组块 + 先认后拼(再认比拼写认知负荷低)
 * 每词状态：S=稳定度(天,R降到90%所需时间) D=难度(1-10)
 * 目标留存率 0.85 → 下次间隔 I = S × ln(.85)/ln(.9) ≈ 1.54S
 * 答对 S 按难度加权增长(简单词长得快) 答错 S 缩至40%并于10分钟后重现 */
const TARGET_R=0.85, RET_FACTOR=Math.log(TARGET_R)/Math.log(0.9);   // ≈1.54
function stabilityGrowth(D){ return Math.min(3, Math.max(1.3, 3.2-0.22*D)); }
function wstate(w){ return S.words[w.toLowerCase()]; }
function statusOf(w){ const st=wstate(w); if(!st) return 'new'; return st.S>=7?'master':'learn'; }
function dueTs(st){ return st.d<=Date.now(); }
function dueList(){                 // 待复习(稳定度不足15天的到期词)
  const now=Date.now(), out=[];
  for(const [k,st] of Object.entries(S.words)){
    if(st.S<15 && st.d<=now){ const wo=BYWORD.get(k); if(wo) out.push({wo,st}); }
  }
  out.sort((a,b)=>a.st.d-b.st.d); return out;
}
function newQueue(n){               // 下一批新词(按学习序)
  const out=[]; for(const wo of ORDER){ if(!S.words[wo.w.toLowerCase()]){ out.push(wo); if(out.length>=n) break; } }
  return out;
}
function learnedCount(){ return Object.keys(S.words).length; }
function masteredCount(){ return Object.values(S.words).filter(s=>s.S>=7).length; }
function dayIndex(){ return Math.max(1, daysBetween(S.startDate, todayStr())+1); }
function planQuota(){ return S.dailyNew || Math.ceil(TOTAL/PLAN_DAYS); }

/* 记录动作 */
function bumpHistory(field){ const k=todayStr(); const h=S.history[k]=S.history[k]||{new:0,rev:0,again:0,ms:0}; h[field]=(h[field]||0)+1; }
function grade(wo, g){             // g: again|hard|good
  const k=wo.w.toLowerCase(); let st=S.words[k];
  if(!st){ st=S.words[k]={S:0.6,D:5,d:0,w:0,r:0,t:Date.now()}; bumpHistory('new'); }
  else bumpHistory('rev');
  if(g==='again'){ st.w++; st.D=Math.min(10,st.D+1); st.S=Math.max(0.35,st.S*0.4); st.d=Date.now()+10*60000; bumpHistory('again'); }
  else if(g==='hard'){ st.D=Math.min(10,Math.max(1,st.D+0.3)); st.S=Math.max(0.4,st.S*1.2);
    st.d=Date.now()+Math.max(20*60000, st.S*RET_FACTOR*DAY_MS); }
  else { st.r++; st.D=Math.max(1,st.D-0.15); st.S=st.S*stabilityGrowth(st.D);
    st.d=Date.now()+Math.min(60, st.S*RET_FACTOR)*DAY_MS; }
  save(); return st;
}
function markEasy(wo){            // 「我会了」：直接进入高稳定度
  const k=wo.w.toLowerCase();
  if(!S.words[k]){ S.words[k]={S:12,D:3,d:Date.now()+45*DAY_MS,w:0,r:1,t:Date.now()}; bumpHistory('new'); save(); }
}
function extraReview(n){           // 额外巩固：随机抽已学词重置到期
  const pool=ORDER.filter(wo=>S.words[wo.w.toLowerCase()]);
  const r=mulberry32(Date.now()%2147483647);
  for(let i=pool.length-1;i>0;i--){ const j=Math.floor(r()*(i+1)); [pool[i],pool[j]]=[pool[j],pool[i]]; }
  pool.slice(0,n).forEach(wo=>{ const st=S.words[wo.w.toLowerCase()]; if(st){ st.d=Date.now()-1; st.S=Math.min(st.S,1); } });
  save(); return Math.min(n,pool.length);
}
/* 旧版进度迁移：等级制{s} → 稳定度制{S,D} */
function migrateState(st){
  if(!st||!st.words) return st;
  for(const k in st.words){
    const w=st.words[k];
    if(w.S===undefined){
      const lv=w.s||0;
      w.S= lv<=1?0.05 : lv===2?0.1 : lv===3?1 : lv===4?2 : lv===5?4 : lv===6?7 : 10;
      w.D=Math.min(10,Math.max(1,5+(w.w||0)-(w.r||0)/2));
      delete w.s;
    }
  }
  return st;
}

/* ---------- 发音 ---------- */
function speak(word){
  try{
    if(!('speechSynthesis' in window)) return;
    const u=new SpeechSynthesisUtterance(word); u.lang='en-US'; u.rate=.95;
    const v=speechSynthesis.getVoices().find(v=>/en[-_]US/i.test(v.lang));
    if(v) u.voice=v; speechSynthesis.cancel(); speechSynthesis.speak(u);
  }catch(e){}
}

/* ---------- 路由(视图函数由后载脚本定义，惰性解析) ---------- */
const VIEW_FN={dash:'renderDash',study:'renderStudy',browse:'renderBrowse',quiz:'renderQuiz',settings:'renderSettings'};
let curView='dash';
function go(v){ location.hash='#/'+v; }
function route(){
  const h=(location.hash.replace(/^#\//,'')||'dash');
  curView = (VIEW_FN[h] && typeof window[VIEW_FN[h]]==='function') ? h : 'dash';
  $$('#nav button,#tabbar button').forEach(b=>b.classList.toggle('active',b.dataset.view===curView));
  const host=$('#view'); host.className='';
  host.classList.add('fade-in');
  setTimeout(()=>host.classList.remove('fade-in'),260);
  keyHandlers.length=0;
  window[VIEW_FN[curView]]();
  window.scrollTo(0,0);
}
window.addEventListener('hashchange',route);

/* 全局键盘分发：各视图注册 handler */
const keyHandlers=[];
window.addEventListener('keydown',e=>{
  if(e.target.matches('input,textarea,select')) return;
  for(const h of keyHandlers){ if(h(e)!==false) return; }
});

/* ---------- 弹窗 ---------- */
function openModal(html){
  const root=$('#modalRoot');
  root.innerHTML=`<div class="overlay"><div class="modal">${html}</div></div>`;
  root.querySelector('.overlay').addEventListener('click',e=>{ if(e.target.classList.contains('overlay')) closeModal(); });
  return root.querySelector('.modal');
}
function closeModal(){ $('#modalRoot').innerHTML=''; }

/* ---------- 主题 / 顶栏 ---------- */
function applyTheme(){ document.documentElement.dataset.theme=S.dark?'dark':'light'; $('#themeToggle').textContent=S.dark?'☀️':'🌙'; }
$('#themeToggle').addEventListener('click',()=>{ S.dark=!S.dark; save(); applyTheme(); });

/* ---------- 引导 ---------- */
function showOnboard(){
  const per=Math.ceil(TOTAL/PLAN_DAYS);
  $('#obText').innerHTML=`词库共 <b>${TOTAL}</b> 词（考研英语一大纲词汇），按 <b>${per} 词/天 × ${PLAN_DAYS} 天</b> 自动分配。新词用「组块三步法」学：泛看 → 快测 → 补漏，每组 10 词、全程只需点击；到期复习由 FSRS 智能调度，越熟的词出现越少。`;
  $('#onboard').classList.remove('hidden');
  $('#obStart').onclick=()=>{ S.onboarded=true; S.startDate=todayStr(); S.dailyNew=per; save(); $('#onboard').classList.add('hidden'); go('study'); };
  $('#obSkip').onclick=()=>{ S.onboarded=true; save(); $('#onboard').classList.add('hidden'); };
}

/* ---------- 启动(由最后载入的 view-settings.js 调用 boot) ---------- */
/* 顶栏/底部Tab导航 */
function bindNav(el){ el.addEventListener('click',e=>{ const b=e.target.closest('button[data-view]'); if(b) go(b.dataset.view); }); }
$$('#nav,#tabbar').forEach(bindNav);

async function boot(){
  const sv=await serverLoad();                 // 数据库进度优先
  if(sv) S=migrateState(sv); else { const lc=localLoad(); if(lc) S=migrateState(lc); }
  $('#totalBadge').textContent=`大纲词汇 ${TOTAL} 词 · Day ${Math.min(dayIndex(),PLAN_DAYS)}/${PLAN_DAYS}`;
  applyTheme();
  if(!S.onboarded) showOnboard();
  if(!location.hash) location.hash='#/dash';
  route();
}
