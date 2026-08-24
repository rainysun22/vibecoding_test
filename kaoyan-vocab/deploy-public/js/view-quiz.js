/* ===== view-quiz.js 自测(选择题) ===== */
"use strict";

let quiz=null;   // {qs:[{wo,opts,type,ans}], idx, right, wrong:[], answering}

function renderQuiz(){
  if(quiz){ renderQuizQ(); return; }
  const learned=learnedCount();
  $('#view').innerHTML=`
  <div class="card" style="max-width:560px;margin:0 auto;text-align:center">
    <div style="font-size:52px">📝</div>
    <h2 style="margin:6px 0 6px">自测查漏</h2>
    <p class="muted" style="margin:0 0 18px;font-size:13.5px">已学 ${learnedCount()} / ${TOTAL} 词。答错的词会自动加入今天的复习队列。${learned<8?'（已学词太少，将自动从全词库出题）':''}</p>
    <div class="toolbar" style="justify-content:center">
      <select id="qscope">
        <option value="learned"${learned<8?'':' selected'}>已学单词</option>
        <option value="all"${learned<8?' selected':''}>全词库</option>
      </select>
      <select id="qtype">
        <option value="mix">混合题型</option>
        <option value="w2m">看词选义</option>
        <option value="m2w">看义选词</option>
      </select>
      <select id="qcount">
        <option value="10">10 题</option>
        <option value="20" selected>20 题</option>
        <option value="30">30 题</option>
        <option value="50">50 题</option>
      </select>
    </div>
    <button class="btn primary lg" onclick="startQuiz()">开始自测 ▶</button>
    <p class="kbd-hint">可用键盘 <kbd>1</kbd>–<kbd>4</kbd> 选择答案</p>
  </div>`;
}

function startQuiz(){
  const scope=$('#qscope').value, type=$('#qtype').value, n=+$('#qcount').value;
  let pool = scope==='learned' ? ORDER.filter(wo=>S.words[wo.w.toLowerCase()]) : ORDER.slice();
  if(pool.length<8) pool=ORDER.slice();
  const r=mulberry32(Date.now()%2147483647);
  for(let i=pool.length-1;i>0;i--){ const j=Math.floor(r()*(i+1)); [pool[i],pool[j]]=[pool[j],pool[i]]; }
  const qs=pool.slice(0,n).map(wo=>{
    const t = type==='mix' ? (r()<.55?'w2m':'m2w') : type;
    const ds=[];                                  // 干扰项
    while(ds.length<3){ const c=pool[Math.floor(r()*pool.length)]; if(c!==wo&&!ds.includes(c)) ds.push(c); }
    const opts=[wo,...ds].map(x=>t==='w2m'?x.m:x.w);
    const order=[0,1,2,3]; for(let i=3;i>0;i--){ const j=Math.floor(r()*(i+1)); [order[i],order[j]]=[order[j],order[i]]; }
    return {wo, t, opts:order.map(i=>opts[i]), ans:order.indexOf(0)};
  });
  quiz={qs, idx:0, right:0, wrong:[], answering:true};
  renderQuizQ();
}

function renderQuizQ(){
  const q=quiz.qs[quiz.idx];
  const prompt=q.t==='w2m' ? esc(q.wo.w) : esc(q.wo.m);
  $('#view').innerHTML=`
  <div class="quiz-top">
    <span>第 ${quiz.idx+1} / ${quiz.qs.length} 题</span>
    <span>✅ ${quiz.right} · ❌ ${quiz.wrong.length}</span>
  </div>
  <div class="progress" style="margin-bottom:20px"><i style="width:${quiz.idx/quiz.qs.length*100}%"></i></div>
  <div class="card" style="max-width:640px;margin:0 auto">
    ${q.t==='w2m'?`<p class="muted" style="text-align:center;font-size:13px;margin:0 0 6px">这个词是什么意思？<button class="f-speak" onclick="speak('${esc(q.wo.w)}')">🔊</button></p>`
                 :`<p class="muted" style="text-align:center;font-size:13px;margin:0 0 6px">选出对应的单词</p>`}
    <div class="quiz-q ${q.t==='m2w'?'small':''}">${prompt}</div>
    <div class="opts" id="qopts">
      ${q.opts.map((o,i)=>`<button class="opt" onclick="answerQuiz(${i})">${i+1}. ${esc(o)}</button>`).join('')}
    </div>
  </div>`;
  keyHandlers.length=0;
  keyHandlers.push(e=>{ const k=+e.key; if(k>=1&&k<=4) answerQuiz(k-1); });
}

function answerQuiz(i){
  if(!quiz||!quiz.answering) return;
  quiz.answering=false;
  const q=quiz.qs[quiz.idx];
  const btns=$$('#qopts .opt');
  btns[q.ans].classList.add('right');
  if(i===q.ans){ quiz.right++; }
  else{
    if(btns[i]) btns[i].classList.add('wrong');
    quiz.wrong.push(q.wo);
    const k=q.wo.w.toLowerCase();                  // 错词 → 进入复习队列
    const st=S.words[k]||{s:0,d:0,w:0,r:0,t:Date.now()};
    st.w++; st.s=Math.min(st.s,1); st.d=Date.now()-1; S.words[k]=st; save();
  }
  setTimeout(()=>{ quiz.idx++; quiz.answering=true;
    if(quiz.idx>=quiz.qs.length) quizEnd(); else renderQuizQ(); }, i===q.ans?450:1100);
}

function quizEnd(){
  const r=quiz; quiz=null;
  const score=Math.round(r.right/r.qs.length*100);
  const emo=score>=90?'🏆':score>=70?'👍':'💪';
  openModal(`
    <h2 style="text-align:center">${emo} 得分 ${score} 分</h2>
    <p class="muted" style="text-align:center;margin:0 0 14px">答对 ${r.right} / ${r.qs.length} · 错词已加入今日复习队列</p>
    ${r.wrong.length?`<h3 style="font-size:15px">❌ 错词回顾</h3>
    <div class="wronglist">
      ${r.wrong.map(wo=>`<div class="wrow" onclick="closeModal();wordDetail('${esc(wo.w)}')">
        <span class="w">${esc(wo.w)}</span><span class="m">${esc(wo.m)}</span></div>`).join('')}
    </div>`:'<p style="text-align:center">全对，太厉害了！🎉</p>'}
    <div class="modal-actions" style="justify-content:center">
      <button class="btn primary" onclick="closeModal();go('study')">去复习错词</button>
      <button class="btn ghost" onclick="closeModal();renderQuiz()">再测一轮</button>
      <button class="btn ghost" onclick="closeModal()">关闭</button>
    </div>`);
}
window.renderQuiz=renderQuiz; window.startQuiz=startQuiz; window.answerQuiz=answerQuiz;
