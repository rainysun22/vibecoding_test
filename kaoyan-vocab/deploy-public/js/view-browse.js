/* ===== view-browse.js 词库浏览 ===== */
"use strict";

const browseState={q:'', letter:'', status:'', limit:120};

function renderBrowse(){
  const letters=[''];
  for(let i=0;i<26;i++) letters.push(String.fromCharCode(65+i));
  $('#view').innerHTML=`
  <div class="toolbar">
    <input type="text" id="bsearch" placeholder="搜索单词或释义，如 abandon / 放弃" value="${esc(browseState.q)}">
    <select id="bstatus">
      <option value="">全部状态</option>
      <option value="new"${browseState.status==='new'?' selected':''}>未学</option>
      <option value="learn"${browseState.status==='learn'?' selected':''}>学习中</option>
      <option value="master"${browseState.status==='master'?' selected':''}>已掌握</option>
      <option value="star"${browseState.status==='star'?' selected':''}>⭐生词本</option>
    </select>
  </div>
  <div class="letters" id="bletters">
    ${letters.map(l=>`<button data-l="${l}" class="${browseState.letter===l?'active':''}">${l||'ALL'}</button>`).join('')}
  </div>
  <div id="blist"></div>`;

  $('#bsearch').addEventListener('input',e=>{ browseState.q=e.target.value.trim().toLowerCase(); browseState.limit=120; renderBrowseList(); });
  $('#bstatus').addEventListener('change',e=>{ browseState.status=e.target.value; browseState.limit=120; renderBrowseList(); });
  $$('#bletters button').forEach(b=>b.onclick=()=>{ browseState.letter=b.dataset.l; browseState.limit=120;
    $$('#bletters button').forEach(x=>x.classList.toggle('active',x===b)); renderBrowseList(); });
  renderBrowseList();
}

function browseFiltered(){
  const {q,letter,status}=browseState;
  return WORDS.filter(wo=>{
    if(letter && wo.w[0].toUpperCase()!==letter) return false;
    if(status==='star'){ if(!S.starred.includes(wo.w)) return false; }
    else if(status && statusOf(wo.w)!==status) return false;
    if(q && !(wo.w.toLowerCase().includes(q)||wo.m.toLowerCase().includes(q))) return false;
    return true;
  });
}

function renderBrowseList(){
  const list=browseFiltered();
  const shown=list.slice(0,browseState.limit);
  $('#blist').innerHTML=`
  <p class="muted" style="font-size:13px;margin:0 0 10px">共 ${list.length} 词${browseState.q||browseState.letter||browseState.status?'（已筛选）':''}，点击任意词查看详情</p>
  <div class="wordlist">
    ${shown.map(wo=>{ const st=statusOf(wo.w);
      return `<div class="wrow" onclick="wordDetail('${esc(wo.w)}')">
        <span class="w">${esc(wo.w)}</span>
        <span class="m">${esc(wo.m)}</span>
        ${S.starred.includes(wo.w)?'<span title="生词本">⭐</span>':''}
        ${st==='new'?'<span class="badge new">未学</span>':st==='learn'?'<span class="badge learn">学习中</span>':'<span class="badge master">已掌握</span>'}
      </div>`; }).join('')}
  </div>
  ${list.length>browseState.limit?`<div class="loadmore"><button class="btn ghost" onclick="browseState.limit+=200;renderBrowseList()">加载更多（剩 ${list.length-browseState.limit} 词）</button></div>`:''}
  ${!list.length?'<div class="card" style="text-align:center;color:var(--muted)">没有匹配的词</div>':''}`;
}

function wordDetail(word){
  const wo=BYWORD.get(word.toLowerCase()); if(!wo) return;
  const st=wstate(wo.w), star=S.starred.includes(wo.w);
  openModal(`
    <div class="wd-word">${esc(wo.w)} <button class="f-speak" onclick="speak('${esc(wo.w)}')">🔊</button></div>
    <div class="wd-mean">${esc(wo.m)}</div>
    ${st?`<p class="muted" style="font-size:13px;margin:0 0 12px">记忆稳定度 ${(st.S||0).toFixed(1)} 天 · 难度 ${(st.D||5).toFixed(1)}/10 · 记对 ${st.r} 次 · 记错 ${st.w} 次 · 下次复习 ${new Date(st.d).toLocaleString()}</p>`:'<p class="muted" style="font-size:13px;margin:0 0 12px">尚未学习</p>'}
    <div class="wd-actions">
      <button class="btn ghost" onclick="starToggle('${esc(wo.w)}');wordDetail('${esc(wo.w)}')">${star?'★ 移出生词本':'☆ 加入生词本'}</button>
      ${st?`<button class="btn ghost" onclick="markMaster('${esc(wo.w)}')">✅ 标记已掌握</button>
            <button class="btn danger" onclick="resetWord('${esc(wo.w)}')">↺ 重置进度</button>`
          :`<button class="btn primary" onclick="markMaster('${esc(wo.w)}')">✅ 我已会，标记掌握</button>`}
    </div>
    <div class="modal-actions"><button class="btn ghost" onclick="closeModal()">关闭</button></div>`);
}

function markMaster(word){
  const k=word.toLowerCase();
  S.words[k]={S:30,D:3,d:Date.now()+365*DAY_MS,w:S.words[k]?S.words[k].w:0,r:S.words[k]?S.words[k].r:0,t:S.words[k]?S.words[k].t:Date.now()};
  save(); toast('✅ 已标记为掌握'); wordDetail(word); if(curView==='browse') renderBrowseList();
}
function resetWord(word){
  delete S.words[word.toLowerCase()]; save(); toast('已重置该词'); closeModal(); if(curView==='browse') renderBrowseList();
}
window.renderBrowse=renderBrowse; window.wordDetail=wordDetail; window.markMaster=markMaster;
window.resetWord=resetWord; window.browseState=browseState; window.renderBrowseList=renderBrowseList;
