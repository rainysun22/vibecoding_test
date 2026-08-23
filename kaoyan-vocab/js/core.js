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
const PLAN_DAYS = 14;

/* ---------- 状态 ---------- */
const SKEY='kaoYanVocab.v1';
function defaultState(){
  return { version:1, startDate:todayStr(), dailyNew:Math.ceil(TOTAL/PLAN_DAYS),
    autoSpeak:false, dark:false, onboarded:false, words:{}, history:{}, starred:[] };
}
let S;
function load(){ try{ const s=JSON.parse(localStorage.getItem(SKEY)); if(s&&s.version===1) return s; }catch(e){} return null; }
S = load() || defaultState();
let saveTimer=null;
function save(){ clearTimeout(saveTimer); saveTimer=setTimeout(()=>{ try{ localStorage.setItem(SKEY, JSON.stringify(S)); }catch(e){ toast('⚠️ 保存失败：本地存储空间不足'); } },150); }

/* ---------- 记忆算法(艾宾浩斯：1/2/4/7/15天) ---------- */
const INTERVALS=[0,1,2,4,7,15];      // s=1..5 级对应间隔
function wstate(w){ return S.words[w.toLowerCase()]; }
function statusOf(w){ const st=wstate(w); if(!st) return 'new'; return st.s>=4?'master':'learn'; }
function dueTs(st){ return st.d<=Date.now(); }
function dueList(){                 // 待复习(未到烂熟)
  const now=Date.now(), out=[];
  for(const [k,st] of Object.entries(S.words)){
    if(st.s<6 && st.d<=now){ const wo=BYWORD.get(k); if(wo) out.push({wo,st}); }
  }
  out.sort((a,b)=>a.st.d-b.st.d); return out;
}
function newQueue(n){               // 下一批新词(按学习序)
  const out=[]; for(const wo of ORDER){ if(!S.words[wo.w.toLowerCase()]){ out.push(wo); if(out.length>=n) break; } }
  return out;
}
function learnedCount(){ return Object.keys(S.words).length; }
function masteredCount(){ return Object.values(S.words).filter(s=>s.s>=4).length; }
function dayIndex(){ return Math.max(1, daysBetween(S.startDate, todayStr())+1); }
function planQuota(){ return S.dailyNew || Math.ceil(TOTAL/PLAN_DAYS); }

/* 记录动作 */
function bumpHistory(field){ const k=todayStr(); const h=S.history[k]=S.history[k]||{new:0,rev:0,again:0,ms:0}; h[field]=(h[field]||0)+1; }
function grade(wo, g){             // g: again|hard|good
  const k=wo.w.toLowerCase(); let st=S.words[k];
  if(!st){ st=S.words[k]={s:0,d:0,w:0,r:0,t:Date.now()}; bumpHistory('new'); }
  else bumpHistory('rev');
  if(g==='again'){ st.w++; st.s=0; st.d=Date.now()-1; bumpHistory('again'); }
  else if(g==='hard'){ st.s=Math.max(1,st.s); st.d=Date.now()+INTERVALS[1]*DAY_MS; }
  else { st.s=Math.min(6,st.s+1); st.r++; st.d=Date.now()+INTERVALS[Math.min(st.s,5)]*DAY_MS; }
  save(); return st;
}
function extraReview(n){           // 额外巩固：随机抽已学词重置到期
  const pool=ORDER.filter(wo=>S.words[wo.w.toLowerCase()]);
  const r=mulberry32(Date.now()%2147483647); let c=0;
  for(let i=pool.length-1;i>0;i--){ const j=Math.floor(r()*(i+1)); [pool[i],pool[j]]=[pool[j],pool[i]]; }
  pool.slice(0,n).forEach(wo=>{ const st=S.words[wo.w.toLowerCase()]; if(st){ st.d=Date.now()-1; if(st.s>3)st.s=3; } });
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

function boot(){
  $('#totalBadge').textContent=`大纲词汇 ${TOTAL} 词 · Day ${Math.min(dayIndex(),PLAN_DAYS)}/${PLAN_DAYS}`;
  applyTheme();
  if(!S.onboarded) showOnboard();
  if(!location.hash) location.hash='#/dash';
  route();
}
