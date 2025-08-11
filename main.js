/* Ro-Ro Dispatcher — Mobile Optimized (Seaspan Fleet)
   Touch support, responsive canvas, bottom-sheet upgrades.
*/
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const BASE_W = 1100, BASE_H = 720;
  let scale = 1;

  function resizeCanvas(){
    const deviceScale = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(320, rect.width || window.innerWidth - 24);
    const cssH = Math.max(240, rect.height || (window.innerHeight * 0.62));
    scale = Math.min(cssW/BASE_W, cssH/BASE_H);
    const pxW = Math.floor(BASE_W * scale * deviceScale);
    const pxH = Math.floor(BASE_H * scale * deviceScale);
    canvas.width = pxW; canvas.height = pxH;
    canvas.style.width = Math.floor(BASE_W*scale)+"px";
    canvas.style.height = Math.floor(BASE_H*scale)+"px";
    ctx.setTransform(deviceScale*scale,0,0,deviceScale*scale,0,0);
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  function toLogical(clientX, clientY){
    const r = canvas.getBoundingClientRect();
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale, clientX, clientY };
  }

  const TN = ["Delta","Surrey","Nanaimo","Victoria"];
  const positions = { Delta:{x:210,y:520}, Surrey:{x:420,y:520}, Nanaimo:{x:720,y:260}, Victoria:{x:360,y:180} };
  const ROUTES = [["Delta","Nanaimo"],["Delta","Victoria"],["Surrey","Nanaimo"],["Surrey","Victoria"]];

  let level=null, sim=null, running=false, lastTs=0, toastTimer=0;

  const levelSelect=document.getElementById('levelSelect');
  const cashEl=document.getElementById('cash'), clockEl=document.getElementById('clock'), avgWaitEl=document.getElementById('avgWait'), deliveredEl=document.getElementById('delivered'), goalTextEl=document.getElementById('goalText');
  const startBtn=document.getElementById('startBtn'), pauseBtn=document.getElementById('pauseBtn'), resetBtn=document.getElementById('resetBtn');
  const fleetDiv=document.getElementById('fleet');

  window.LEVELS.forEach((lv,i)=>{ const o=document.createElement('option'); o.value=i; o.textContent=`${lv.id}. ${lv.name}`; levelSelect.appendChild(o); });

  function newSim(cfg){
    const sim = { t:0, duration: cfg.minutes*60, cash: cfg.startCash, delivered:0, waitTotals:0, waitCount:0,
      terminals:{}, vessels:[], demandBase: cfg.demand.slice(), volatility: cfg.volatility, goal: cfg.goal };
    TN.forEach((name,idx)=>{ sim.terminals[name]={name,queue:[],berths:cfg.terminals.berths[idx],yard:cfg.terminals.yards[idx],shunts:cfg.terminals.shunts[idx],crews:cfg.terminals.crews[idx],busy:0,stats:{arrivals:0,blocked:0}}; });
    cfg.vessels.forEach((v,i)=>{ sim.vessels.push({id:i,name:v.name,cap:v.cap,speed:v.speed,loadRate:v.loadRate,where:"Delta",state:"idle",eta:0,route:["Delta","Nanaimo"],cargo:[],color:pickColor(i)}); });
    return sim;
  }
  function pickColor(i){ const p=['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899']; return p[i%p.length]; }

  function reset(){ level=window.LEVELS[+levelSelect.value]; sim=newSim(level); running=false; lastTs=0; updateHUD(); render(); buildFleetCards(); goalTextEl.textContent = `${level.goal.delivered} delivered, avg wait ≤ ${level.goal.maxAvgWait} min in ${level.minutes} min`; }
  function start(){ running=true; } function pause(){ running=false; }

  function spawnDemand(dt){
    TN.forEach((name,idx)=>{
      const base=level.demand[idx], osc=1 + level.volatility*Math.sin(sim.t/30 + idx);
      const expected = (base*osc/60) * dt;
      let arrivals=0, p=expected; while(p>0){ if(Math.random()<p) arrivals++; p-=1; }
      const term=sim.terminals[name];
      for(let i=0;i<arrivals;i++){
        if (term.queue.length < term.yard){ term.queue.push({created:sim.t,id:Math.random().toString(36).slice(2,8)}); term.stats.arrivals++; }
        else { term.stats.blocked++; sim.cash -= 50; showToast(`Yard full at ${name}`,'lose'); }
      }
    });
  }

  function timeStep(dt){
    spawnDemand(dt);
    sim.vessels.forEach(v=>{
      if (v.state==='sailing'){ v.eta-=dt; if(v.eta<=0){ v.where=v.route[1]; tryStartUnloading(v); } }
      else if (v.state==='loading' || v.state==='unloading'){ v.eta-=dt; if(v.eta<=0){ const t=sim.terminals[v.where]; t.busy=Math.max(0,t.busy-1); if(v.state==='loading'){ v.state='sailing'; v.eta=travelTime(v); } else { v.state='idle'; } } }
      else if (v.state==='idle'){ if (v.route[0]===v.where) tryStartLoading(v); }
    });
    sim.t+=dt; updateHUD(); checkEnd();
  }

  function tryStartLoading(v){
    const origin=sim.terminals[v.where]; if(origin.busy>=origin.berths) return; if(origin.queue.length===0) return;
    origin.busy++; v.state='loading'; const loadCount=Math.min(v.cap, origin.queue.length);
    const picked=origin.queue.splice(0,loadCount); v.cargo=picked.map(t=>({...t,from:v.where,to:v.route[1]}));
    const base=6, eff=origin.shunts*0.8 + origin.crews*0.2; const per=Math.max(2.8, base/Math.max(1,eff)); v.eta=8 + per*loadCount;
    v.route=[v.where, v.route[1]];
  }
  function tryStartUnloading(v){
    const term=sim.terminals[v.where]; if (term.busy>=term.berths){ v.state='idle'; return false; } term.busy++; v.state='unloading';
    const c=v.cargo.length; v.cargo.forEach(t=>{ const w=(sim.t-t.created)/60; sim.waitTotals+=w; sim.waitCount++; });
    sim.delivered+=c; sim.cash += c*35;
    const base=5.2, eff=term.shunts*0.8 + term.crews*0.2; const per=Math.max(2.5, base/Math.max(1,eff)); v.eta=6 + per*c; v.cargo=[]; return true;
  }

  function updateHUD(){ cashEl.textContent=Math.floor(sim.cash).toLocaleString(); clockEl.textContent=fmt(sim.t)+" / "+fmt(sim.duration); const avg=sim.waitCount?(sim.waitTotals/sim.waitCount):0; avgWaitEl.textContent=avg.toFixed(1); deliveredEl.textContent=sim.delivered; }
  function fmt(t){ t=Math.max(0,Math.floor(t)); const m=String(Math.floor(t/60)).padStart(2,'0'); const s=String(t%60).padStart(2,'0'); return `${m}:${s}`; }
  function distance(a,b){ const dx=b.x-a.x, dy=b.y-a.y; return Math.hypot(dx,dy); }
  function travelTime(v){ const A=positions[v.route[0]],B=positions[v.route[1]]; return distance(A,B)/(80*v.speed); }

  function render(){ ctx.clearRect(0,0,BASE_W,BASE_H); drawMap(); drawQueues(); drawVessels(); }
  function drawMap(){
    ctx.lineWidth=6; ROUTES.forEach(([a,b])=>{ const A=positions[a],B=positions[b]; ctx.strokeStyle='#c7d9ff'; ctx.beginPath(); ctx.moveTo(A.x,A.y); ctx.lineTo(B.x,B.y); ctx.stroke(); });
    TN.forEach(name=>{ const p=positions[name]; roundRect(ctx,p.x-34,p.y-22,68,44,12,true,true); ctx.fillStyle='#111827'; ctx.textAlign='center'; ctx.font='14px system-ui'; ctx.fillText(name, p.x, p.y-28); const t=sim.terminals[name]; ctx.font='12px system-ui'; ctx.fillStyle='#334155'; ctx.fillText(`Q:${t.queue.length}/${t.yard}  Berths:${t.busy}/${t.berths}`, p.x, p.y+40); });
  }
  function drawQueues(){ TN.forEach(name=>{ const p=positions[name], t=sim.terminals[name], n=Math.min(16,t.queue.length); for(let i=0;i<n;i++){ const row=Math.floor(i/8), col=i%8; const x=p.x-32+col*8, y=p.y+10+row*10; drawTrailerIcon(x,y); } }); }
  function drawVessels(){
    sim.vessels.forEach(v=>{
      let x,y; if(v.state==='sailing'){ const A=positions[v.route[0]],B=positions[v.route[1]]; const prog=Math.max(0,Math.min(1,1 - v.eta/Math.max(0.01, travelTime(v)))); x=A.x+(B.x-A.x)*prog; y=A.y+(B.y-A.y)*prog; } else { const p=positions[v.where]; const ang=(v.id*2*Math.PI/(sim.vessels.length)); x=p.x+Math.cos(ang)*46; y=p.y+Math.sin(ang)*30; }
      drawBoatIcon(x,y,v.color); ctx.font='11px system-ui'; ctx.textAlign='center'; ctx.fillStyle='#0f172a'; ctx.fillText(`${v.name} (${v.cargo.length}/${v.cap})`, x, y-16); if(v.state!=='idle'){ ctx.fillText((v.state==='sailing'?'⛴️':(v.state==='loading'?'📦':'⬇️')) + " " + Math.ceil(v.eta)+"s", x, y+16); }
    });
  }
  function drawTrailerIcon(x,y){ ctx.fillStyle='#fff'; ctx.strokeStyle='#0f172a'; ctx.lineWidth=1.5; roundRect(ctx,x,y,12,7,2,true,true); ctx.beginPath(); ctx.arc(x+3,y+8,1.5,0,Math.PI*2); ctx.fillStyle='#0f172a'; ctx.fill(); ctx.beginPath(); ctx.arc(x+9,y+8,1.5,0,Math.PI*2); ctx.fill(); }
  function drawBoatIcon(x,y,color){ ctx.save(); ctx.translate(x,y); ctx.fillStyle=color; ctx.strokeStyle='#0f172a'; ctx.lineWidth=1.6; roundRect(ctx,-16,-8,32,16,6,true,true); ctx.fillStyle='#fff'; roundRect(ctx,-6,-10,12,8,3,true,true); ctx.restore(); }
  function roundRect(ctx,x,y,w,h,r,fill,stroke){ if(typeof r==='number'){ r={tl:r,tr:r,br:r,bl:r}; } ctx.beginPath(); ctx.moveTo(x+r.tl,y); ctx.lineTo(x+w-r.tr,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r.tr); ctx.lineTo(x+w,y+h-r.br); ctx.quadraticCurveTo(x+w,y+h,x+w-r.br,y+h); ctx.lineTo(x+r.bl,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r.bl); ctx.lineTo(x,y+r.tl); ctx.quadraticCurveTo(x,y,x+r.tl,y); if(fill)ctx.fill(); if(stroke)ctx.stroke(); }

  // Interaction
  let drag=null;
  function startDrag(mx,my){ const hit=hitVessel(mx,my); if(hit){ drag={id:hit.id,over:null}; document.body.style.cursor='grabbing'; } else { const t=hitTerminal(mx,my); if(t) openUpgrades(t); else closeUpgrades(); } }
  function moveDrag(mx,my){ if(!drag) return; drag.over = hitTerminal(mx,my); }
  function endDrag(mx,my){ if(!drag) return; const t=drag.over; if(t){ const v=sim.vessels.find(v=>v.id===drag.id); if(v.where===t.name){ const options=TN.filter(n=>n!==t.name); const dest=options.sort((a,b)=>distance(positions[t.name],positions[b]) - distance(positions[t.name],positions[a]))[0]; v.route=[t.name,dest]; showToast(`${v.name} now running ${v.route[0]} → ${v.route[1]}`);} else { const origin=v.where; v.route=[origin,t.name]; showToast(`${v.name} reassigned ${origin} → ${t.name}`);} } document.body.style.cursor='default'; drag=null; }

  canvas.addEventListener('mousedown', e=>{ const m=toLogical(e.clientX,e.clientY); startDrag(m.x,m.y); });
  window.addEventListener('mousemove', e=>{ if(!drag) return; const m=toLogical(e.clientX,e.clientY); moveDrag(m.x,m.y); });
  window.addEventListener('mouseup', e=>{ const m=toLogical(e.clientX,e.clientY); endDrag(m.x,m.y); });

  canvas.addEventListener('touchstart', e=>{ const t=e.changedTouches[0]; const m=toLogical(t.clientX,t.clientY); startDrag(m.x,m.y); e.preventDefault(); }, {passive:false});
  window.addEventListener('touchmove', e=>{ if(!drag) return; const t=e.changedTouches[0]; const m=toLogical(t.clientX,t.clientY); moveDrag(m.x,m.y); e.preventDefault(); }, {passive:false});
  window.addEventListener('touchend', e=>{ const t=e.changedTouches[0]; if(!t) return; const m=toLogical(t.clientX,t.clientY); endDrag(m.x,m.y); e.preventDefault(); }, {passive:false});

  function hitVessel(x,y){ for(const v of sim.vessels){ let vx,vy; if(v.state==='sailing'){ const A=positions[v.route[0]],B=positions[v.route[1]]; const prog=Math.max(0,Math.min(1,1 - v.eta/Math.max(0.01, travelTime(v)))); vx=A.x+(B.x-A.x)*prog; vy=A.y+(B.y-A.y)*prog; } else { const p=positions[v.where]; const ang=(v.id*2*Math.PI/(sim.vessels.length)); vx=p.x+Math.cos(ang)*46; vy=p.y+Math.sin(ang)*30; } if(Math.hypot(x-vx,y-vy)<20) return v; } return null; }
  function hitTerminal(x,y){ for(const name of TN){ const p=positions[name]; if(Math.abs(x-p.x)<44 && Math.abs(y-p.y)<32) return sim.terminals[name]; } return null; }

  function openUpgrades(term){
    closeUpgrades(); const panel=document.createElement('div'); panel.className='upgradePanel';
    panel.innerHTML=`<h3>${term.name} Upgrades</h3>
      <div>Berths: ${term.berths} | Yard: ${term.yard} | Shunts: ${term.shunts} | Crews: ${term.crews}</div>
      <div class="grid">
        <button data-k="berths" data-cost="4000">+1 Berth ($4,000)</button>
        <button data-k="yard" data-step="25" data-cost="1500">+25 Yard ($1,500)</button>
        <button data-k="shunts" data-cost="1200">+1 Shunt Truck ($1,200)</button>
        <button data-k="crews" data-cost="900">+1 Crew ($900)</button>
      </div>
      <div style="margin-top:8px;text-align:center"><button data-close="1">Close</button></div>`;
    document.body.appendChild(panel);
    panel.addEventListener('click', e=>{ const btn=e.target.closest('button'); if(!btn) return;
      if(btn.dataset.close){ closeUpgrades(); return; }
      const key=btn.dataset.k, cost=+btn.dataset.cost, step=+btn.dataset.step||1;
      if(sim.cash < cost){ showToast("Not enough cash.","lose"); return; }
      sim.cash-=cost; term[key]+=step; showToast(`${term.name}: ${key}+${step}`); updateHUD(); openUpgrades(term);
    });
  }
  function closeUpgrades(){ document.querySelectorAll('.upgradePanel').forEach(e=>e.remove()); }

  function showToast(msg, kind='info', ms=2200){ let div=document.querySelector('.toast'); if(!div){ div=document.createElement('div'); div.className='toast'; document.body.appendChild(div);} div.textContent=msg; div.classList.toggle('win',kind==='win'); div.classList.toggle('lose',kind==='lose'); const until=Date.now()+ms; setTimeout(()=>{ if(Date.now()>until) div.remove(); }, ms+120); }

  function buildFleetCards(){
    fleetDiv.innerHTML=""; sim.vessels.forEach(v=>{ const card=document.createElement('div'); card.className='vesselCard'; card.innerHTML=`<h4>${v.name}</h4>
      <div class="small">Cap ${v.cap} • Spd ${v.speed.toFixed(2)} • Load ${v.loadRate.toFixed(2)}</div>
      <div class="small">Route: <span class="route">${v.route[0]}→${v.route[1]}</span></div>
      <div><span class="badge">Drag on map to reassign</span></div>`;
      card.addEventListener('click', ()=>{ const others=TN.filter(n=>n!==v.where); const idx=others.indexOf(v.route[1]); const next=others[(idx+1)%others.length]; v.route=[v.where,next]; card.querySelector('.route').textContent=v.route[0]+"→"+v.route[1]; showToast(`${v.name} refit to ${v.route[0]} → ${v.route[1]}`); });
      fleetDiv.appendChild(card);
    });
  }

  function frame(ts){ if(!lastTs) lastTs=ts; const dt=Math.min(0.1,(ts-lastTs)/1000); lastTs=ts; if(running) timeStep(dt); render(); requestAnimationFrame(frame); }
  startBtn.addEventListener('click', start); pauseBtn.addEventListener('click', pause); resetBtn.addEventListener('click', reset);
  reset(); requestAnimationFrame(frame);
})();