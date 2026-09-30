const { chromium } = require('playwright');
const fs = require('node:fs');
(async () => {
 const browser = await chromium.launch();
 const page = await browser.newPage({viewport:{width:518,height:722}, recordVideo:{dir:'artifacts/your-turn-bot-repro'}});
 await page.goto('http://127.0.0.1:4173');
 await page.waitForFunction(()=>window.__spine?.enabled);
 await page.addStyleTag({content:'#ov-onboarding,#app-loading{display:none!important}'});
 await page.evaluate(async()=>{
  const s=window.__spine; await s.ensureDictionaryLoaded(); s.bootOfflineBot({difficulty:0});
  window.repro={events:[],overlaps:[],frames:[]};
  const snap=()=>({at:performance.now(),slot:s.activeGame.session.state.currentTurnSlot,score:s.activeGame.session.state.scores[1],shown:document.querySelector('#is-sv2').textContent,flash:document.querySelector('#is-sb1').classList.contains('your-turn-cue'),active:document.querySelector('#is-sb1').classList.contains('act-cell'),chips:[...document.querySelectorAll('.scoring-float-label')].map(el=>({text:el.textContent,opacity:getComputedStyle(el).opacity,rect:el.getBoundingClientRect().toJSON()})),timer:document.querySelector('#turn-timer-value').textContent});
  for(const type of [s.EV.MOVE_CONFIRMED,s.EV.MOVE_SCORE_COMMITTED,s.EV.TURN_CHANGED,s.EV.TURN_PRESENTATION_READY,s.EV.BOOST_ACTIVATED,'bonus/resolved','bonus/award-acknowledged']) s.bus.on(type,p=>repro.events.push({type,p,...snap()}));
  window.reproSampler=setInterval(()=>{const f=snap();repro.frames.push(f);if(f.flash&&f.chips.some(c=>+c.opacity>.05))repro.overlaps.push(f)},20);
  let stalled=false;
  s.bus.on(s.EV.MOVE_CONFIRMED,p=>{if(p.slot===1&&!stalled){stalled=true;setTimeout(()=>{const end=performance.now()+1800;while(performance.now()<end){}},80)}});
 });
 for(let i=0;i<1;i++){
  await page.evaluate(()=>window.__spine.activeGame.controller.passTurn?.());
  // Dispatch a real pass if the controller has no passTurn helper.
  await page.evaluate(()=>{const s=window.__spine;if(s.activeGame.session.state.currentTurnSlot===0)s.activeGame.session.dispatch({type:'cmd/PASS_TURN'})});
  const end=Date.now()+14000;
  while(Date.now()<end){
   const x=await page.evaluate(()=>({local:window.__spine.activeGame.session.state.currentTurnSlot===0,modal:!!document.querySelector('.bonus-award-positioner'),ready:repro.events.filter(e=>e.type==='evt/TURN_PRESENTATION_READY'&&e.p.currentTurnSlot===0).length,overlaps:repro.overlaps.length}));
   if(x.overlaps) await page.screenshot({path:'artifacts/your-turn-bot-repro-overlap.png'});
   if(x.modal) await page.locator('.bonus-award-positioner button').last().click();
   if(x.ready>i)break;
   await page.waitForTimeout(100);
  }
  await page.waitForTimeout(850);
 }
 const trace=await page.evaluate(()=>{clearInterval(reproSampler);return repro});
 fs.writeFileSync('artifacts/your-turn-bot-repro.json',JSON.stringify(trace,null,2));
 console.log(JSON.stringify({overlaps:trace.overlaps.length,events:trace.events.map(e=>({type:e.type,at:e.at,score:e.p.score,slot:e.p.slot,ready:e.p.currentTurnSlot,flash:e.flash,chips:e.chips.length}))}));
 await page.close(); await browser.close(); process.exit(0);
})();
