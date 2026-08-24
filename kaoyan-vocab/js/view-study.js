/* ===== view-study.js 背单词 · 7天无痛组块三步法 =====
 * 新词流程：泛看(建立印象) → 快测(测试效应) → 补漏(只处理答错词)
 * 复习流程：闪卡评分(FSRS-lite调度)
 * 每 30 张卡自动插入休息屏，防止疲劳 */
"use strict";

let ses=null;
const GROUP=10;         // 每组词数(短时记忆 7±2)
const BREAK_EVERY=30;   // 每完成 30 张卡休息一次

function todayNewCount(){
  const t0=new Date(todayStr()+'T00:00:00').getTime();
  return Object.values(S.words).filter(st=>st.t>=t0).length;
}

function renderStudy(){
  if(ses&&ses.phase!=='done') renderSes(); else renderStudyHome();
}

function renderStudyHome(){
  const q=planQuota(), due=dueList().length;
  const remainNew=Math.max(0,q-todayNewCount());
  const allDone=due===0&&remainNew===0&&learnedCount()>=TOTAL;

  $('#view').innerHTML=`
  <div class="card study-empty">
    <div class="big">${allDone?'🎉':'📚'}</div>
    ${allDone
      ? `<h2 style="margin:8px 0 4px">全部 ${TOTAL} 词已学完！</h2><p class="muted" style="margin:0 0 18px">太强了！建议每天「巩固复习」或自测保持记忆。</p>
         <button class="btn primary lg" onclick="startSession('rev')">🔁 巩固复习</button>
         <button class="btn ghost" onclick="doExtra(50)">🎲 随机抽50词再练</button>`
      : `<h2 style="margin:8px 0 4px">Day ${Math.min(dayIndex(),PLAN_DAYS)} · 今日任务</h2>
         <p class="muted" style="margin:0 0 18px">新词剩余 <b style="color:var(--accent)">${remainNew}</b> 个 · 待复习 <b style="color:var(--good)">${due}</b> 个</p>
         <button class="btn primary lg" onclick="startSession('all')">▶ 开始今日学习</button>
         <div style="margin-top:12px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
           <button class="btn ghost" onclick="startSession('new')" ${remainNew?'':'disabled'}>只学新词</button>
           <button class="btn ghost" onclick="startSession('rev')" ${due?'':'disabled'}>只复习到期</button>
           <button class="btn ghost" onclick="doExtra(30)">随机加练30词</button>
         </div>`}
    <p class="muted" style="font-size:12.5px;margin-top:22px">新词用「组块三步法」：① 泛看建立印象 → ② 快测激活回忆 → ③ 只补答错的词。每组 ${GROUP} 词，零压力推进。</p>
    <p class="kbd-hint"><kbd>空格</kbd> 下一词/翻面 · <kbd>1-4</kbd> 选答案 · <kbd>1/2/3</kbd> 评分 · <kbd>Esc</kbd> 结束</p>
  </div>`;
}

function startSession(mode){        // mode: all | new | rev
  const parts=[];
  if(mode!=='new'){ const d=dueList(); if(d.length) parts.push({type:'rev',items:d.map(x=>x.wo)}); }
  if(mode!=='rev'){
    const n=mode==='new'?planQuota():Math.max(0,planQuota()-todayNewCount());
    const nw=newQueue(n);
    for(let i=0;i<nw.length;i+=GROUP) parts.push({type:'new',items:nw.slice(i,i+GROUP)});
  }
  if(!parts.length){ toast('没有可学的词'); return; }
  ses={parts,pi:0,phase:'',done:0,sinceBreak:0,
       stats:{nw:0,rv:0,again:0,good:0,hard:0},t0:Date.now(),
       rng:mulberry32(Date.now()%2147483647)};
  initPart(0); renderSes();
}

function initPart(pi){
  ses.pi=pi;
  const p=ses.parts[pi];
  if(p.type==='rev'){ ses.phase='rev'; ses.idx=0; ses.flipped=false; }
  else { ses.phase='preview'; ses.pIdx=0; ses.qIdx=0; p.wrong=[]; ses.qOpts=null; ses.qPick=-1; ses.patchIdx=0; ses.patchFlipped=false; }
}

function renderSes(){
  if(!ses) return;
  if(ses.break){ renderBreak(); return; }
  const p=ses.parts[ses.pi];
  if(p.type==='rev') renderRev();
  else if(ses.phase==='preview') renderPreview();
  else if(ses.phase==='quiz') renderGroupQuiz();
  else if(ses.phase==='patch') renderPatch();
  else finishPart();
}

/* ---- 第一步 · 泛看 ---- */
function renderPreview(){
  const p=ses.parts[ses.pi], n=p.items.length, i=ses.pIdx, wo=p.items[i];
  const star=S.starred.includes(wo.w);
  $('#view').innerHTML=`
  <div class="study-head">
    <span class="chip">① 泛看 ${i+1}/${n}</span>
    <div class="progress"><i style="width:${i/n*100}%"></i></div>
    <button class="btn ghost" onclick="endSession()">结束 ✕</button>
  </div>
  <p class="phase-tag">👀 先扫一眼混个脸熟 · 不用刻意记</p>
  <div class="flashwrap">
    <div class="pv-card" onclick="pvNext()">
      <div class="pv-word">${esc(wo.w)}</div>
      <button class="f-speak" onclick="event.stopPropagation();speak('${esc(wo.w)}')">🔊 发音</button>
      <div class="pv-mean">${esc(wo.m)}</div>
      <button class="f-speak" onclick="event.stopPropagation();starToggle('${esc(wo.w)}')">${star?'★':'☆'} 生词本</button>
    </div>
  </div>
  <div class="pv-actions">
    <button class="btn ghost" onclick="pvPrev()" ${i===0?'disabled':''}>← 上一词</button>
    <button class="btn ghost" onclick="pvAllKnown()">✅ 这组我都会</button>
    <button class="btn primary lg" onclick="pvNext()">下一词 →</button>
  </div>
  <p class="kbd-hint">点击卡片 / <kbd>空格</kbd> 下一词 · <kbd>←</kbd> 上一词</p>`;
  if(S.autoSpeak) speak(wo.w);
  keyHandlers.length=0;
  keyHandlers.push(e=>{ if(e.code==='Space'){e.preventDefault();pvNext();} else if(e.code==='ArrowLeft'){e.preventDefault();pvPrev();} else if(e.key==='Escape') endSession(); });
}
function pvNext(){
  const p=ses.parts[ses.pi];
  ses.pIdx++;
  if(ses.pIdx>=p.items.length){ ses.phase='quiz'; ses.qIdx=0; ses.qOpts=null; ses.qPick=-1; }
  renderSes();
}
function pvPrev(){
  if(!ses||ses.phase!=='preview'||ses.pIdx<=0) return;
  ses.pIdx--; renderSes();
}
function pvAllKnown(){
  const p=ses.parts[ses.pi]; let c=0;
  p.items.forEach(wo=>{ if(!S.words[wo.w.toLowerCase()]){ markEasy(wo); c++; } });
  ses.stats.nw+=c; ses.done+=c; ses.sinceBreak+=c;
  toast(c?`已标记 ${c} 词为掌握`:'本组本来就已掌握');
  finishPart();
}

/* ---- 第二步 · 快测(看词选义) ---- */
function renderGroupQuiz(){
  const p=ses.parts[ses.pi], i=ses.qIdx, wo=p.items[i];
  if(!ses.qOpts){                       // 生成本题选项
    const ds=[]; const r=ses.rng;
    while(ds.length<3){ const c=WORDS[Math.floor(r()*WORDS.length)];
      if(c!==wo && !ds.includes(c) && c.m!==wo.m) ds.push(c); }
    const opts=[wo,...ds], order=[0,1,2,3];
    for(let k=3;k>0;k--){ const j=Math.floor(r()*(k+1)); [order[k],order[j]]=[order[j],order[k]]; }
    ses.qOpts=order.map(x=>opts[x]); ses.qAns=order.indexOf(0);
  }
  $('#view').innerHTML=`
  <div class="study-head">
    <span class="chip">② 快测 ${i+1}/${p.items.length}</span>
    <div class="progress"><i style="width:${i/p.items.length*100}%"></i></div>
    <button class="btn ghost" onclick="endSession()">结束 ✕</button>
  </div>
  <p class="phase-tag">⚡ 凭印象选一个 · 猜错也没关系</p>
  <div class="card quizbox">
    <div class="quiz-q">${esc(wo.w)} <button class="f-speak" onclick="speak('${esc(wo.w)}')">🔊</button></div>
    <div class="opts" id="gopts">
      ${ses.qOpts.map((o,k)=>`<button class="opt" onclick="gqAnswer(${k})">${k+1}. ${esc(o.m)}</button>`).join('')}
    </div>
  </div>
  <p class="kbd-hint">可用键盘 <kbd>1</kbd>–<kbd>4</kbd> 选择</p>`;
  keyHandlers.length=0;
  keyHandlers.push(e=>{ const k=+e.key; if(k>=1&&k<=4) gqAnswer(k-1); else if(e.key==='Escape') endSession(); });
}
function gqAnswer(i){
  if(!ses||ses.phase!=='quiz'||ses.qPick>=0) return;
  ses.qPick=i;
  const p=ses.parts[ses.pi], wo=p.items[ses.qIdx];
  const btns=$$('#gopts .opt');
  if(btns[ses.qAns]) btns[ses.qAns].classList.add('right');
  if(i===ses.qAns){ grade(wo,'good'); ses.stats.good++; ses.stats.nw++; }
  else{ if(btns[i]) btns[i].classList.add('wrong'); p.wrong.push(wo); }
  ses.done++; ses.sinceBreak++;
  setTimeout(()=>{
    ses.qPick=-1; ses.qOpts=null; ses.qIdx++;
    if(ses.qIdx>=p.items.length){
      if(p.wrong.length){ ses.phase='patch'; ses.patchIdx=0; ses.patchFlipped=false; }
      else finishPart();
    }
    renderSes();
  }, i===ses.qAns?420:1000);
}

/* ---- 第三步 · 补漏(答错的词走闪卡) / 复习闪卡 ---- */
function renderPatch(){
  const p=ses.parts[ses.pi], wo=p.wrong[ses.patchIdx];
  renderFlash(wo,'③ 补漏',ses.patchIdx,p.wrong.length,ses.patchFlipped);
}
function renderRev(){
  const p=ses.parts[ses.pi], wo=p.items[ses.idx];
  renderFlash(wo,'复习',ses.idx,p.items.length,ses.flipped);
}
function renderFlash(wo,tag,idx,total,flipped){
  ses._flash={wo,tag};
  const st=S.words[wo.w.toLowerCase()];
  const star=S.starred.includes(wo.w);
  $('#view').innerHTML=`
  <div class="study-head">
    <span class="chip">${tag} ${idx+1}/${total}</span>
    <div class="progress"><i style="width:${idx/total*100}%"></i></div>
    <button class="btn ghost" onclick="endSession()">结束 ✕</button>
  </div>
  <p class="phase-tag">${tag==='复习'?'🔁 先回想意思，再翻面核对':'🎯 刚才答错的词，加深一下印象'}</p>
  <div class="flashwrap">
    <div class="flashcard ${flipped?'flipped':''}" id="fcard" onclick="flashFlip()">
      <div class="face front">
        <div class="f-word">${esc(wo.w)}</div>
        <div class="f-sub">
          <button class="f-speak" onclick="event.stopPropagation();speak('${esc(wo.w)}')">🔊 发音</button>
          <button class="f-speak" onclick="event.stopPropagation();starToggle('${esc(wo.w)}')">${star?'★':'☆'} 生词本</button>
        </div>
        <div class="f-tip">${st?`复习卡 · 记对${st.r}次/记错${st.w}次`:'先想一想意思，再点卡片看答案'}</div>
      </div>
      <div class="face back">
        <div>
          <div class="f-word" style="font-size:30px">${esc(wo.w)}</div>
          <div class="f-mean">${esc(wo.m)}</div>
        </div>
      </div>
    </div>
  </div>
  <div class="grade" id="gradeBtns" style="${flipped?'':'visibility:hidden'}">
    <button class="btn danger" onclick="flashGrade('again')">😢 不认识</button>
    <button class="btn warn" onclick="flashGrade('hard')">🤔 模糊</button>
    <button class="btn good" onclick="flashGrade('good')">😀 认识</button>
  </div>
  <p class="kbd-hint">按 <kbd>空格</kbd> 翻面 · <kbd>1/2/3</kbd> 评分</p>`;
  if(flipped&&S.autoSpeak) speak(wo.w);
  keyHandlers.length=0;
  keyHandlers.push(e=>{
    if(e.code==='Space'){ e.preventDefault(); flashFlip(); return; }
    if(e.key==='1') flashGrade('again');
    else if(e.key==='2') flashGrade('hard');
    else if(e.key==='3') flashGrade('good');
    else if(e.key==='Escape') endSession();
  });
}
function flashFlip(){
  const isPatch=ses.phase==='patch';
  const fl=isPatch?ses.patchFlipped:ses.flipped;
  if(isPatch) ses.patchFlipped=!fl; else ses.flipped=!fl;
  const c=$('#fcard'); if(c) c.classList.toggle('flipped',!fl);
  const g=$('#gradeBtns'); if(g) g.style.visibility=!fl?'visible':'hidden';
  if(!fl&&S.autoSpeak&&ses._flash) speak(ses._flash.wo.w);
}
function flashGrade(g){
  if(!ses||!ses._flash) return;
  const isPatch=ses.phase==='patch';
  const fl=isPatch?ses.patchFlipped:ses.flipped;
  if(!fl){ flashFlip(); return; }
  const wo=ses._flash.wo;
  const isNew=!S.words[wo.w.toLowerCase()];
  grade(wo,g);
  if(isNew) ses.stats.nw++; else ses.stats.rv++;
  ses.stats[g==='again'?'again':g==='hard'?'hard':'good']++;
  ses.done++; ses.sinceBreak++;
  if(g==='again'){                              // 答错 → 本轮末尾重现
    if(isPatch) ses.parts[ses.pi].wrong.push(wo);
    else ses.parts[ses.pi].items.push(wo);
  }
  if(isPatch){
    ses.patchIdx++; ses.patchFlipped=false;
    if(ses.patchIdx>=ses.parts[ses.pi].wrong.length) finishPart(); else renderSes();
  }else{
    ses.idx++; ses.flipped=false;
    if(ses.idx>=ses.parts[ses.pi].items.length) finishPart(); else renderSes();
  }
}

/* ---- 休息屏 / 流程推进 ---- */
function finishPart(){
  if(!ses) return;
  if(ses.pi+1>=ses.parts.length){ endSession(true); return; }
  if(ses.sinceBreak>=BREAK_EVERY){ ses.break=true; ses.nextPi=ses.pi+1; renderBreak(); return; }
  initPart(ses.pi+1); renderSes();
}
function breakContinue(){
  ses.break=false; ses.sinceBreak=0;
  initPart(ses.nextPi); renderSes();
}
function renderBreak(){
  const ms=Date.now()-ses.t0;
  $('#view').innerHTML=`
  <div class="card session-done">
    <div class="big">☕</div>
    <h2 style="margin:6px 0 4px">休息一下！</h2>
    <p class="muted" style="margin:0 0 18px">已完成 <b style="color:var(--accent)">${ses.done}</b> 张卡 · 用时 ${fmtSec(ms)}<br>起来喝口水、看看远处，20 秒后继续效率更高</p>
    <button class="btn primary lg" onclick="breakContinue()">继续 ▶</button>
    <button class="btn ghost" onclick="endSession()">今天到此为止</button>
  </div>`;
  keyHandlers.length=0;
  keyHandlers.push(e=>{ if(e.key==='Enter') breakContinue(); });
}

function endSession(finished){
  if(!ses) return;
  const ms=Date.now()-ses.t0;
  const k=todayStr(); const h=S.history[k]=S.history[k]||{new:0,rev:0,again:0,ms:0};
  h.ms=(h.ms||0)+ms; save();
  const st=ses.stats; ses=null;
  if(!finished&&st.nw+st.rv===0){ go('study'); return; }
  $('#view').innerHTML=`
  <div class="card session-done">
    <div class="big">${finished?'✅':'⏸'}</div>
    <h2 style="margin:6px 0 4px">${finished?'本轮完成！':'已结束本轮'}</h2>
    <p class="muted" style="margin:0">用时约 ${Math.max(1,Math.round(ms/60000))} 分钟 · 坚持就是胜利</p>
    <div class="summary-grid">
      <div class="statcard accent"><b>${st.nw}</b><span>新学</span></div>
      <div class="statcard"><b>${st.rv}</b><span>复习</span></div>
      <div class="statcard bad"><b>${st.again}</b><span>不熟(将重现)</span></div>
      <div class="statcard good"><b>${st.good+st.hard}</b><span>记对/模糊</span></div>
    </div>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <button class="btn primary lg" onclick="renderStudyHome()">继续学习</button>
      <button class="btn ghost" onclick="go('dash')">查看进度</button>
      <button class="btn ghost" onclick="go('quiz')">去自测</button>
    </div>
  </div>`;
  keyHandlers.length=0;
  keyHandlers.push(e=>{ if(e.key==='Enter') renderStudyHome(); });
}

function doExtra(n){ const c=extraReview(n); if(c) startSession('rev'); else toast('还没有已学过的词'); }

function starToggle(word){
  const i=S.starred.indexOf(word);
  if(i>=0) S.starred.splice(i,1); else S.starred.push(word);
  save(); toast(i>=0?'已移出生词本':'⭐ 已加入生词本');
}
window.renderStudy=renderStudy; window.startSession=startSession; window.renderStudyHome=renderStudyHome;
window.pvNext=pvNext; window.pvPrev=pvPrev; window.pvAllKnown=pvAllKnown; window.gqAnswer=gqAnswer;
window.flashFlip=flashFlip; window.flashGrade=flashGrade; window.endSession=endSession;
window.breakContinue=breakContinue; window.doExtra=doExtra; window.starToggle=starToggle;
