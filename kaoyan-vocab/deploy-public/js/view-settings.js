/* ===== view-settings.js 设置 + 启动 ===== */
"use strict";

function renderSettings(){
  const size=(localStorage.getItem(SKEY)||'').length;
  $('#view').innerHTML=`
  <div class="grid2">
    <div class="card">
      <h2 class="sect">🎯 学习计划</h2>
      <label class="muted" style="font-size:13px">每日新词数（词库共 ${TOTAL} 词，${PLAN_DAYS}天需 ≥ ${Math.ceil(TOTAL/PLAN_DAYS)} 词/天）</label>
      <div class="toolbar" style="margin:8px 0 16px">
        <input type="number" id="setDaily" min="10" max="2000" value="${planQuota()}" style="width:120px">
        <button class="btn primary" onclick="savePlan()">保存</button>
        <button class="btn ghost" onclick="$('#setDaily').value=${Math.ceil(TOTAL/PLAN_DAYS)}">恢复推荐值(${Math.ceil(TOTAL/PLAN_DAYS)})</button>
      </div>
      <label class="muted" style="font-size:13px">冲刺开始日期（Day 1）</label>
      <div class="toolbar" style="margin:8px 0 4px">
        <input type="date" id="setStart" value="${S.startDate}">
        <button class="btn primary" onclick="saveStart()">保存</button>
      </div>
      <p class="muted" style="font-size:12px;margin:8px 0 0">当前为 Day ${dayIndex()}。修改每日词量不会影响已学进度，只影响每天安排的新词数。</p>
    </div>
    <div class="card">
      <h2 class="sect">⚙️ 偏好</h2>
      <label style="display:flex;align-items:center;gap:10px;margin-bottom:14px;cursor:pointer">
        <input type="checkbox" id="setSpeak" ${S.autoSpeak?'checked':''}> 翻看卡片时自动发音（需浏览器语音支持）
      </label>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
        <input type="checkbox" id="setDark" ${S.dark?'checked':''}> 深色模式
      </label>
      <div class="toolbar" style="margin-top:18px">
        <button class="btn ghost" onclick="resetToday()">↺ 清空今日学习记录(重学今天)</button>
      </div>
      <p class="muted" style="font-size:12px;margin:8px 0 0">「清空今日」会删除今天首次学习的词的进度，今天的复习任务重新开始；不影响之前的进度。</p>
    </div>
    <div class="card">
      <h2 class="sect">💾 数据</h2>
      <p class="muted" style="font-size:13px;margin-top:0">进度实时保存到<b>服务器数据库(SQLite)</b>，同时在本浏览器留有备份（${(size/1024).toFixed(1)} KB）。清浏览器缓存不会丢进度。</p>
      <p class="muted" style="font-size:12px;margin:0 0 8px">当前设备号：${deviceId()}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
        <button class="btn primary" onclick="exportData()">⬇ 导出进度</button>
        <label class="btn ghost" style="cursor:pointer">⬆ 导入进度<input type="file" id="impFile" accept=".json" style="display:none"></label>
        <button class="btn danger" onclick="resetAll()">🗑 清空全部进度</button>
      </div>
    </div>
    <div class="card">
      <h2 class="sect">ℹ️ 关于</h2>
      <p class="muted" style="font-size:13.5px;margin-top:0">
        本站词库覆盖考研英语一大纲词汇 <b>${TOTAL}</b> 词，采用「<b>组块三步法 + FSRS-lite 调度</b>」：
        新词按每组 10 词「泛看→快测→补漏」推进（利用测试效应与再认记忆，认知负荷低）；
        每词维护稳定度 S 与难度 D，答对后间隔按 1.54×S 增长（目标留存率 85%），答错 10 分钟后重现；
        越熟的词出现越少，难点词自动加密复习。目标节奏：每天 ${planQuota()} 个新词 + 到期复习，<b>${PLAN_DAYS} 天无痛完成</b>。
      </p>
    </div>
  </div>`;

  $('#setSpeak').onchange=e=>{ S.autoSpeak=e.target.checked; save(); toast('已保存'); };
  $('#setDark').onchange=e=>{ S.dark=e.target.checked; save(); applyTheme(); };
  $('#impFile').onchange=e=>{
    const f=e.target.files[0]; if(!f) return;
    const rd=new FileReader();
    rd.onload=()=>{ try{
        const s=JSON.parse(rd.result);
        if(!s||s.version!==1||!s.words) throw 0;
        S=s; save(); toast('导入成功'); go('dash'); route();
      }catch(err){ toast('导入失败：文件格式不正确'); } };
    rd.readAsText(f);
  };
}

function savePlan(){
  const v=Math.max(10,Math.min(2000,+$('#setDaily').value||0));
  S.dailyNew=v; save(); toast('已保存每日新词数：'+v); renderSettings();
}
function saveStart(){
  const v=$('#setStart').value; if(!v){ toast('日期无效'); return; }
  S.startDate=v; save(); toast('已保存开始日期'); renderSettings();
}
function resetToday(){
  if(!confirm('确定清空今天的学习记录并重学今天的词吗？')) return;
  const t0=new Date(todayStr()+'T00:00:00').getTime();
  for(const [k,st] of Object.entries(S.words)) if(st.t>=t0) delete S.words[k];
  delete S.history[todayStr()];
  save(); toast('已清空今日记录'); route();
}
function exportData(){
  const blob=new Blob([JSON.stringify(S)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='kaoyan-vocab-progress-'+todayStr()+'.json';
  a.click(); URL.revokeObjectURL(a.href);
  toast('已导出进度文件');
}
function resetAll(){
  if(!confirm('确定清空全部学习进度吗？此操作不可恢复（建议先导出备份）')) return;
  if(!confirm('再次确认：真的要全部重来吗？')) return;
  try{ fetch('/api/progress?device='+encodeURIComponent(deviceId()),{method:'DELETE'}); }catch(e){}
  localStorage.removeItem(SKEY); location.reload();
}
window.renderSettings=renderSettings; window.savePlan=savePlan; window.saveStart=saveStart;
window.resetToday=resetToday; window.exportData=exportData; window.resetAll=resetAll;

/* ===== 启动(最后载入的脚本) ===== */
boot();
