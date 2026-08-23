/* Node 模拟测试：加载全部 JS，模拟组块三步法流程 */
"use strict";
const fs=require('fs'), path=require('path'), vm=require('vm');

/* ---- DOM/环境桩 ---- */
function stubEl(){
  return { innerHTML:'', textContent:'', style:{}, dataset:{}, classList:{add(){},remove(){},toggle(){},contains(){return false}},
    addEventListener(){}, removeEventListener(){}, appendChild(){}, querySelector(){return null}, querySelectorAll(){return []},
    onclick:null, matches(){return false} };
}
const els=new Map();
function getEl(key){ if(!els.has(key)) els.set(key,stubEl()); return els.get(key); }
const doc={
  querySelector:(s)=>getEl('q:'+s),
  querySelectorAll:(s)=>{
    if(String(s).includes('.opt')) return [0,1,2,3].map(()=>stubEl());   // 快测选项按钮
    return [];
  },
  documentElement:{ dataset:{} },
  addEventListener(){},
  createElement:()=>stubEl(),
};
const storage={};
const setTimeoutQ=[];
const sandbox={
  console, Date, Math, JSON,
  setTimeout:(fn)=>{ setTimeoutQ.push(fn); return 0; }, clearTimeout(){},
  localStorage:{ getItem:k=>storage[k]||null, setItem:(k,v)=>{storage[k]=String(v)}, removeItem:k=>{delete storage[k]} },
  location:{ hash:'#/study', reload(){} },
  navigator:{ sendBeacon(){return true} },
  fetch:()=>Promise.resolve({ok:false}),
  document:doc,
  SpeechSynthesisUtterance:function(){}, speechSynthesis:{getVoices:()=>[],cancel(){},speak(){}},
  URLSearchParams, Blob:function(){},
  addEventListener(){},
};
sandbox.window=sandbox; sandbox.globalThis=sandbox; sandbox.scrollTo=()=>{};
const ctx=vm.createContext(sandbox);

/* ---- 依序加载脚本(与 index.html 一致) ---- */
const ROOT='/workspace/kaoyan-vocab';
const files=[];
for(let i=1;i<=16;i++) files.push(`js/data${i}.js`);
files.push('js/core.js','js/view-dash.js','js/view-study.js','js/view-browse.js','js/view-quiz.js','js/view-settings.js');
for(const f of files){
  vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'),ctx,{filename:f});
}

function flush(){ setTimeoutQ.splice(0).forEach(fn=>{ try{fn()}catch(e){ console.error('timeout回调出错:',e.message); } }); }

setTimeout(()=>{
  try{
    vm.runInContext('boot()',ctx);
    setTimeout(()=>{
      try{
        /* 开新词会话 → 泛看10词 */
        vm.runInContext("startSession('new')",ctx);
        for(let i=0;i<12;i++){
          const ph=vm.runInContext('ses?ses.phase:"end"',ctx);
          if(ph!=='preview') break;
          vm.runInContext('pvNext()',ctx);
        }
        console.log('泛看完: phase='+vm.runInContext('ses.phase',ctx));

        /* 快测：逐题点击并 flush timeout */
        for(let n=0;n<15;n++){
          const ph=vm.runInContext('ses?ses.phase:"end"',ctx);
          if(ph!=='quiz') break;
          const before=vm.runInContext('JSON.stringify({qIdx:ses.qIdx,qPick:ses.qPick,qAns:ses.qAns,opts:ses.qOpts?ses.qOpts.length:null})',ctx);
          vm.runInContext('gqAnswer('+(n%4)+')',ctx);
          flush();
          const after=vm.runInContext('JSON.stringify({qIdx:ses.qIdx,qPick:ses.qPick,phase:ses.phase})',ctx);
          if(n===0){ console.log('首题点击: before='+before+' after='+after); }
        }
        const qState=vm.runInContext('JSON.stringify({phase:ses.phase,pi:ses.pi,parts:ses.parts.length,wrong:ses.parts[ses.pi].wrong.map(w=>w.w)})',ctx);
        console.log('快测完: '+qState);

        /* 补漏：翻面+评分 */
        for(let n=0;n<15;n++){
          const ph=vm.runInContext('ses?ses.phase:"end"',ctx);
          if(ph!=='patch') break;
          vm.runInContext('flashFlip()',ctx);
          vm.runInContext('flashGrade("good")',ctx);
          flush();
        }
        console.log('补漏完: phase='+vm.runInContext('ses?ses.phase:"end"',ctx));
        console.log('\n== 模拟全流程通过 ==');
        process.exit(0);
      }catch(e){
        console.error('!! 流程出错:',e.message); console.error(e.stack.split('\n').slice(0,8).join('\n')); process.exit(1);
      }
    },30);
  }catch(e){
    console.error('!! boot出错:',e.message); console.error(e.stack.split('\n').slice(0,8).join('\n')); process.exit(1);
  }
},30);
