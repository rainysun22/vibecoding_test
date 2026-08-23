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

/* ---------- 记忆算法(7天高效模式) ----------
 * 当天内多轮重复(10分钟/1小时/4小时) + 跨天间隔(1/2/4/7天)，s=1..7 级
 * 「认识」升级进入下一间隔；「模糊」降级重来；「不认识」10分钟后重现 */
const INTERVALS=[10,60,240,1440,2880,5760,10080];   // 分钟
function wstate(w){ return S.words[w.toLowerCase()]; }
function statusOf(w){ const st=wstate(w); if(!st) return 'new'; return st.s>=5?'master':'learn'; }
function dueTs(st){ return st.d<=Date.now(); }
function dueList(){                 // 待复习(未到烂熟)
  const now=Date.now(), out=[];
  for(const [k,st] of Object.entries(S.words)){
    if(st.s<7 && st.d<=now){ const wo=BYWORD.get(k); if(wo) out.push({wo,st}); }
  }
  out.sort((a,b)=>a.st.d-b.st.d); return out;
}
function newQueue(n){               // 下一批新词(按学习序)
  const out=[]; for(const wo of ORDER){ if(!S.words[wo.w.toLowerCase()]){ out.push(wo); if(out.length>=n) break; } }
  return out;
}
function learnedCount(){ return Object.keys(S.words).length; }
function masteredCount(){ return Object.values(S.words).filter(s=>s.s>=5).length; }
function dayIndex(){ return Math.max(1, daysBetween(S.startDate, todayStr())+1); }
function planQuota(){ return S.dailyNew || Math.ceil(TOTAL/PLAN_DAYS); }

/* 记录动作 */
function bumpHistory(field){ const k=todayStr(); const h=S.history[k]=S.history[k]||{new:0,rev:0,again:0,ms:0}; h[field]=(h[field]||0)+1; }
function grade(wo, g){             // g: again|hard|good
  const k=wo.w.toLowerCase(); let st=S.words[k];
  if(!st){ st=S.words[k]={s:0,d:0,w:0,r:0,t:Date.now()}; bumpHistory('new'); }
  else bumpHistory('rev');
  if(g==='again'){ st.w++; st.s=1; st.d=Date.now()+INTERVALS[0]*60000; bumpHistory('again'); }
  else if(g==='hard'){ st.s=Math.max(1,st.s-1); st.d=Date.now()+INTERVALS[st.s-1]*60000; }
  else { st.s=Math.min(7,st.s+1); st.r++; st.d=Date.now()+INTERVALS[st.s-1]*60000; }
  save(); return st;
}
function extraReview(n){           // 额外巩固：随机抽已学词重置到期
  const pool=ORDER.filter(wo=>S.words[wo.w.toLowerCase()]);
  const r=mulberry32(Date.now()%2147483647); let c=0;
  for(let i=pool.length-1;i>0;i--){ const j=Math.floor(r()*(i+1)); [pool[i],pool[j]]=[pool[j],pool[i]]; }
  pool.slice(0,n).forEach(wo=>{ const st=S.words[wo.w.toLowerCase()]; if(st){ st.d=Date.now()-1; if(st.s>2)st.s=2; } });
  save(); return Math.min(n,pool.length);
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
  $$('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===curView));
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
  $('#obText').innerHTML=`词库共 <b>${TOTAL}</b> 词（考研英语一大纲词汇），按 <b>${per} 词/天 × ${PLAN_DAYS} 天</b> 自动分配。每天需要「新词学习 + 到期复习」两个环节，全部完成即达成目标。`;
  $('#onboard').classList.remove('hidden');
  $('#obStart').onclick=()=>{ S.onboarded=true; S.startDate=todayStr(); S.dailyNew=per; save(); $('#onboard').classList.add('hidden'); go('study'); };
  $('#obSkip').onclick=()=>{ S.onboarded=true; save(); $('#onboard').classList.add('hidden'); };
}

/* ---------- 启动(由最后载入的 view-settings.js 调用 boot) ---------- */
/* 顶栏导航 */
$('#nav').addEventListener('click',e=>{
  const b=e.target.closest('button[data-view]'); if(b) go(b.dataset.view);
});

async function boot(){
  const sv=await serverLoad();                 // 数据库进度优先
  if(sv) S=sv; else { const lc=localLoad(); if(lc) S=lc; }
  $('#totalBadge').textContent=`大纲词汇 ${TOTAL} 词 · Day ${Math.min(dayIndex(),PLAN_DAYS)}/${PLAN_DAYS}`;
  applyTheme();
  if(!S.onboarded) showOnboard();
  if(!location.hash) location.hash='#/dash';
  route();
}
