/* ===== view-study.js 背单词(闪卡+艾宾浩斯) ===== */
"use strict";

let ses=null;   // {queue:[{wo,isNew}], idx, flipped, stats:{nw,rv,again,good,hard}, t0, ms}

function buildQueue(mode){        // mode: all | rev | new
  const q=[];
  if(mode!=='new') dueList().forEach(d=>q.push({wo:d.wo}));
  if(mode!=='rev'){
    const todayStart=new Date(todayStr()+'T00:00:00').getTime();
    const newToday=Object.values(S.words).filter(st=>st.t>=todayStart).length;
    const remain=Math.max(0, planQuota()-newToday);
    newQueue(mode==='new'?planQuota():remain).forEach(wo=>q.push({wo}));
  }
  return q;
}

function renderStudy(){
  if(ses && ses.idx<ses.queue.length){ renderCard(); return; }
  renderStudyHome();
}

function renderStudyHome(){
  const q=planQuota(), due=dueList().length;
  const todayStart=new Date(todayStr()+'T00:00:00').getTime();
  const newToday=Object.values(S.words).filter(st=>st.t>=todayStart).length;
  const remainNew=Math.max(0,q-newToday);
  const allDone=due===0&&remainNew===0&&learnedCount()>=TOTAL;

  $('#view').innerHTML=`
  <div class="card study-empty">
    <div class="big">${allDone?'🎉':'📚'}</div>
    ${allDone
      ? `<h2 style="margin:8px 0 4px">全部 ${TOTAL} 词已学完！</h2><p class="muted" style="margin:0 0 18px">太强了！建议每天来「巩固复习」或做自测保持记忆。</p>
         <button class="btn primary lg" onclick="startSession('rev')">🔁 巩固复习</button>
         <button class="btn ghost" onclick="doExtra(50)">🎲 随机抽50词再练</button>`
      : `<h2 style="margin:8px 0 4px">Day ${Math.min(dayIndex(),PLAN_DAYS)} · 今日任务</h2>
         <p class="muted" style="margin:0 0 18px">新词剩余 <b style="color:var(--accent)">${remainNew}</b> 个 · 待复习 <b style="color:var(--good)">${due}</b> 个</p>
         <button class="btn primary lg" onclick="startSession('all')">▶ 开始今日学习（复习+新词）</button>
         <div style="margin-top:12px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
           <button class="btn ghost" onclick="startSession('rev')" ${due?'':'disabled'}>只复习到期</button>
           <button class="btn ghost" onclick="startSession('new')" ${remainNew?'':'disabled'}>只学新词</button>
           <button class="btn ghost" onclick="doExtra(30)">随机加练30词</button>
         </div>`}
    <p class="kbd-hint"><kbd>空格</kbd> 翻面 · <kbd>1</kbd> 不认识 · <kbd>2</kbd> 模糊 · <kbd>3</kbd> 认识 · <kbd>Esc</kbd> 结束</p>
  </div>`;
}

function startSession(mode){
  const queue=buildQueue(mode);
  if(!queue.length){ toast('没有可学的词'); return; }
  ses={queue, idx:0, flipped:false, t0:Date.now(), stats:{nw:0,rv:0,again:0,good:0,hard:0}};
  renderCard();
}

function doExtra(n){ const c=extraReview(n); if(c) startSession('rev'); else toast('还没有已学过的词'); }

function starToggle(word){
  const i=S.starred.indexOf(word);
  if(i>=0) S.starred.splice(i,1); else S.starred.push(word);
  save(); toast(i>=0?'已移出生词本':'⭐ 已加入生词本');
  const b=$('#starBtn'); if(b) b.textContent=(i>=0?'☆':'★');
}

function renderCard(){
  const item=ses.queue[ses.idx], wo=item.wo;
  const st=S.words[wo.w.toLowerCase()];
  const star=S.starred.includes(wo.w);
  const total=ses.queue.length, done=ses.idx;
  $('#view').innerHTML=`
  <div class="study-head">
    <span class="chip">${done+1} / ${total}</span>
    <div class="progress"><i style="width:${done/total*100}%"></i></div>
    <button class="btn ghost" onclick="endSession()">结束 ✕</button>
  </div>
  <div class="flashwrap">
    <div class="flashcard ${ses.flipped?'flipped':''}" id="fcard" onclick="flipCard()">
      <div class="face front">
        <div class="f-word">${esc(wo.w)}</div>
        <div class="f-sub">
          <button class="f-speak" onclick="event.stopPropagation();speak('${esc(wo.w)}')">🔊 发音</button>
          <button class="f-speak" id="starBtn" onclick="event.stopPropagation();starToggle('${esc(wo.w)}')">${star?'★':'☆'} 生词本</button>
        </div>
        <div class="f-tip">${st?`第 ${total-done} 张 · 复习卡（记对${st.r}次/记错${st.w}次）`:'新词 · 点击卡片或按空格查看释义'}</div>
      </div>
      <div class="face back">
        <div>
          <div class="f-word" style="font-size:30px">${esc(wo.w)}</div>
          <div class="f-mean">${esc(wo.m)}</div>
        </div>
      </div>
    </div>
  </div>
  <div class="grade" id="gradeBtns" style="${ses.flipped?'':'visibility:hidden'}">
    <button class="btn danger" onclick="gradeCard('again')">😢 不认识 <kbd>1</kbd></button>
    <button class="btn warn" onclick="gradeCard('hard')">🤔 模糊 <kbd>2</kbd></button>
    <button class="btn good" onclick="gradeCard('good')">😀 认识 <kbd>3</kbd></button>
  </div>
  <p class="kbd-hint">按 <kbd>空格</kbd> 翻面，再按 <kbd>1/2/3</kbd> 评分。「不认识」的词会在本轮末尾再次出现。</p>`;

  if(S.autoSpeak) speak(wo.w);
  keyHandlers.length=0;
  keyHandlers.push(e=>{
    if(e.code==='Space'){ e.preventDefault(); flipCard(); return; }
    if(!ses||ses.idx>=ses.queue.length) return;
    if(e.key==='1') gradeCard('again');
    else if(e.key==='2') gradeCard('hard');
    else if(e.key==='3') gradeCard('good');
    else if(e.key==='Escape') endSession();
  });
}

function flipCard(){
  if(!ses||ses.idx>=ses.queue.length) return;
  ses.flipped=!ses.flipped;
  const c=$('#fcard'); if(c) c.classList.toggle('flipped',ses.flipped);
  const g=$('#gradeBtns'); if(g) g.style.visibility=ses.flipped?'visible':'hidden';
  if(ses.flipped&&S.autoSpeak) speak(ses.queue[ses.idx].wo.w);
}

function gradeCard(g){
  if(!ses||!ses.flipped){ if(!ses.flipped) flipCard(); return; }
  const item=ses.queue[ses.idx], wo=item.wo;
  const isNew=!S.words[wo.w.toLowerCase()];
  grade(wo,g);
  if(isNew) ses.stats.nw++; else ses.stats.rv++;
  ses.stats[g==='again'?'again':g==='hard'?'hard':'good']++;
  if(g==='again') ses.queue.push({wo});        // 本轮末尾重出
  ses.flipped=false; ses.idx++;
  if(ses.idx>=ses.queue.length) endSession(true);
  else renderCard();
}

function endSession(finished){
  if(!ses) return;
  const ms=Date.now()-ses.t0;
  const k=todayStr(); const h=S.history[k]=S.history[k]||{new:0,rev:0,again:0,ms:0};
  h.ms=(h.ms||0)+ms; save();
  const st=ses.stats; ses=null;
  if(!finished&&st.nw+st.rv===0){ go('study'); return; }
  const mins=Math.round(ms/60000);
  $('#view').innerHTML=`
  <div class="card session-done">
    <div class="big">${finished?'✅':'⏸'}</div>
    <h2 style="margin:6px 0 4px">${finished?'本轮完成！':'已结束本轮'}</h2>
    <p class="muted" style="margin:0">用时约 ${mins?mins+' 分钟':'不到1分钟'} · 坚持就是胜利</p>
    <div class="summary-grid">
      <div class="statcard accent"><b>${st.nw}</b><span>新学</span></div>
      <div class="statcard"><b>${st.rv}</b><span>复习</span></div>
      <div class="statcard bad"><b>${st.again}</b><span>不熟(将重现)</span></div>
      <div class="statcard good"><b>${st.good+st.hard}</b><span>记对/模糊</span></div>
    </div>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <button class="btn primary lg" onclick="go('dash')">查看进度</button>
      <button class="btn ghost" onclick="renderStudyHome()">继续学习</button>
      <button class="btn ghost" onclick="go('quiz')">去自测</button>
    </div>
  </div>`;
  keyHandlers.length=0;
  keyHandlers.push(e=>{ if(e.key==='Enter'){ renderStudyHome(); } });
}
window.renderStudy=renderStudy; window.startSession=startSession; window.flipCard=flipCard;
window.gradeCard=gradeCard; window.endSession=endSession; window.renderStudyHome=renderStudyHome;
window.doExtra=doExtra; window.starToggle=starToggle;
