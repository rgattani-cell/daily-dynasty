/* Daily Dynasty — client-side UI and transparent league scoring. No fake players. */
'use strict';
const iconMap = {krillion:'🦑',plain:'✈️',factmap:'📍',farflung:'🗺️',perceptle:'👁️',globle:'🌐',wonderhop:'🚀'};
const el = id => document.getElementById(id);
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const todayET = () => new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const num = n => Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
const pctText = n => n === null ? 'Not ranked yet' : `${n}th percentile`;
const W_MODES = ['sky','abyss','past','future'];
let user = null, users = [], scores = [], games = [], authMode = 'login', view = 'dashboard', selectedProfile = null;

async function api(path, options={}) {
  const response = await fetch('/api'+path, {
    credentials: 'same-origin',
    ...options,
    headers: {'Content-Type':'application/json','X-Daily-Dynasty':'1',...(options.headers||{})},
  });
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error('Server unavailable. Please try again.'); }
  if (!response.ok) throw new Error(payload.detail || payload.error || 'Something went wrong.');
  return payload;
}
function toast(message) {
  const target=el('toast');
  target.textContent=message;target.style.display='block';
  clearTimeout(window.toastTime);
  window.toastTime=setTimeout(()=>target.style.display='none',3200);
}
function avatar(p, cls='avatar') {
  return p?.avatar
    ? `<img class="${cls}" src="${escapeHtml(p.avatar)}" alt="${escapeHtml(p.name)} profile image" loading="lazy">`
    : `<div class="${cls} empty" aria-label="Default player avatar">${escapeHtml((p?.name||'?').slice(0,2).toUpperCase())}</div>`;
}
function setAuthMode(mode) {
  authMode=mode;
  el('loginTab').classList.toggle('active',mode==='login');
  el('registerTab').classList.toggle('active',mode==='register');
  el('authSubmit').textContent=mode==='login'?'ENTER THE ARENA →':'CREATE MY PLAYER →';
  el('inviteWrap').classList.toggle('hidden',mode==='login');
  el('authError').textContent='';
  el('authPassword').autocomplete=mode==='login'?'current-password':'new-password';
}
el('authForm').addEventListener('submit', async e => {
  e.preventDefault();el('authError').textContent='';
  const button=el('authSubmit');button.disabled=true;
  try {
    await api(authMode==='login'?'/login':'/register', {
      method:'POST',
      body:JSON.stringify({name:el('authName').value,password:el('authPassword').value,invite:el('authInvite').value}),
    });
    el('authPassword').value='';await init();
  } catch(err) { el('authError').textContent=err.message; }
  finally {button.disabled=false;}
});

async function init() {
  try {
    const m=await api('/me');
    if (!m.user) { user=null;el('loginScreen').classList.remove('hidden');el('app').classList.add('hidden');return; }
    user=m.user;
    const data=await api('/standings');users=data.users;scores=data.scores;games=data.games;
    el('loginScreen').classList.add('hidden');el('app').classList.remove('hidden');
    el('navAvatar').innerHTML=avatar(user);el('navName').textContent=user.name;
    const d = new Date(todayET()+'T12:00:00');
    el('todayLabel').textContent=d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}).toUpperCase();
    el('boardGame').innerHTML='<option value="overall">Overall League Points</option>'+games.map(g=>`<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
    el('scoreGame').innerHTML=games.map(g=>`<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
    selectedProfile=user.id;
    showView(view);
  } catch(err) {toast(err.message);}
}
function showView(which) {
  view=which;
  if (which==='profile' && !selectedProfile) selectedProfile=user.id;
  document.querySelectorAll('.view').forEach(n=>n.classList.toggle('active',n.id===which));
  document.querySelectorAll('[data-nav]').forEach(n=>n.classList.toggle('active',n.dataset.nav===which));
  if (which==='dashboard') renderDashboard();
  if (which==='leaderboard') renderBoards();
  if (which==='profile') renderProfile();
  window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}
function weekStart() {
  const d=new Date(todayET()+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-6);
  return d.toISOString().slice(0,10);
}
function relevant(period='all') {
  return scores.filter(s=>period==='all'||(period==='today'?s.day===todayET():s.day>=weekStart()));
}

/* Game-specific player percentiles are calculated from players' period average scores.
 * Single-player games have NO percentile; a provisional rating uses game max instead.
 * Overall season standings use daily placement points, not raw totals in unrelated units.
 * One daily game entry = up to 100 league points, missing entry = zero. */
function calc(period='all') {
  const selected=relevant(period), averages={};
  for (const p of users) {
    averages[p.id]={};
    for (const g of games) {
      const vals=selected.filter(s=>s.user_id===p.id&&s.game===g.id);
      if(vals.length) averages[p.id][g.id]={avg:vals.reduce((a,s)=>a+s.score,0)/vals.length,count:vals.length,best:g.direction==='low'?Math.min(...vals.map(x=>x.score)):Math.max(...vals.map(x=>x.score))};
    }
  }
  const daily={};
  for(const s of selected) {
    const k=s.day+':'+s.game;
    (daily[k]??=[]).push(s);
  }
  const leaguePoints=Object.fromEntries(users.map(p=>[p.id,0]));
  for (const entries of Object.values(daily)) {
    const g=games.find(x=>x.id===entries[0].game);
    if(!g)continue;
    const ranked=[...entries].sort((a,b)=>g.direction==='low'?a.score-b.score:b.score-a.score);
    for(const entry of entries) {
      const placement=ranked.filter(x=>g.direction==='low'?x.score<entry.score:x.score>entry.score).length;
      const points=ranked.length===1?75:100-65*placement/(ranked.length-1);
      leaguePoints[entry.user_id]+=Math.round(points);
    }
  }
  const result={};
  for(const p of users) {
    const skills={};
    for(const g of games) {
      const e=averages[p.id][g.id];if(!e)continue;
      const rivals=users.filter(r=>averages[r.id][g.id]);
      const above=rivals.filter(r=>(averages[r.id][g.id].avg-e.avg)*(g.direction==='low'?-1:1)>0).length;
      const below=rivals.filter(r=>(e.avg-averages[r.id][g.id].avg)*(g.direction==='low'?-1:1)>0).length;
      const ties=rivals.length-above-below;
      const percentile=rivals.length>1?Math.round(100*(below+(ties-1)/2)/(rivals.length-1)):null;
      const normalized=g.direction==='low'?(g.max-e.avg)/(g.max-g.min||1):(e.avg-g.min)/(g.max-g.min||1);
      const rating=Math.round(65+34*(percentile===null?Math.min(1,Math.max(0,normalized)):percentile/100));
      skills[g.id]={...e,pct:percentile,ovr:rating,rank:above+1,competitors:rivals.length};
    }
    const allSkills=Object.values(skills);
    const compared=allSkills.filter(s=>s.pct!==null);
    const percentile=compared.length?Math.round(compared.reduce((sum,s)=>sum+s.pct,0)/compared.length):null;
    const ovr=allSkills.length?Math.round(allSkills.reduce((sum,s)=>sum+s.ovr,0)/allSkills.length):null;
    const entries=selected.filter(s=>s.user_id===p.id);
    result[p.id]={...p,skills,pct:percentile,ovr,provisional:compared.length===0,leaguePoints:leaguePoints[p.id],gamesPlayed:entries.length,gamesCovered:allSkills.length,daysPlayed:new Set(entries.map(s=>s.day)).size};
  }
  return result;
}
function sorted(mode='overall',period='all') {
  const players=Object.values(calc(period));
  return players.filter(p=>mode==='overall'?p.gamesPlayed>0:!!p.skills[mode]).sort((a,b)=>{
    if(mode==='overall') return b.leaguePoints-a.leaguePoints||b.gamesCovered-a.gamesCovered||b.gamesPlayed-a.gamesPlayed||b.ovr-a.ovr;
    const g=games.find(x=>x.id===mode);
    return (g.direction==='low'?a.skills[mode].avg-b.skills[mode].avg:b.skills[mode].avg-a.skills[mode].avg)||b.skills[mode].count-a.skills[mode].count;
  });
}
function streakFor(playerId) {
  const active=new Set(scores.filter(s=>s.user_id===playerId).map(s=>s.day));
  let d=new Date(todayET()+'T12:00:00Z');
  if(!active.has(todayET()))d.setUTCDate(d.getUTCDate()-1);
  let streak=0;
  while(active.has(d.toISOString().slice(0,10))) {streak++;d.setUTCDate(d.getUTCDate()-1);}
  return streak;
}
function gameLabel(g) {return g.direction==='low'?'LOWER IS BETTER':'HIGHER IS BETTER';}
function renderDashboard() {
  const my=scores.filter(x=>x.user_id===user.id),today=my.filter(x=>x.day===todayET());
  const ranked=sorted(),me=calc()[user.id],rank=ranked.findIndex(x=>x.id===user.id);
  el('statsStrip').innerHTML=`<div class="stat"><small>MY OVERALL RATING</small><strong class="accent">${me.ovr??'—'} <span style="font-size:15px;color:#737791">OVR</span></strong></div><div class="stat"><small>LEAGUE RANK</small><strong>${rank<0?'—':'#'+(rank+1)} <span style="font-size:15px;color:#737791">/ ${ranked.length}</span></strong></div><div class="stat"><small>TODAY'S GAMES</small><strong>${today.length} <span style="font-size:15px;color:#737791">/ 7</span></strong></div><div class="stat"><small>DAILY STREAK</small><strong>${streakFor(user.id)} <span style="font-size:15px;color:#737791">🔥 DAYS</span></strong></div>`;
  el('completedCount').textContent=`${today.length} / 7 LOGGED`;
  el('gameGrid').innerHTML=games.map(g=>{
    const s=today.find(x=>x.game===g.id);
    return `<div class="game"><div class="gameleft"><div class="gameicon">${iconMap[g.id]}</div><div><h3>${g.name}</h3><p>${gameLabel(g)} · ${g.unit}${g.max?' · MAX '+num(g.max):''}</p><a href="${escapeHtml(g.url)}" target="_blank" rel="noopener noreferrer">PLAY GAME ↗</a></div></div><div class="scorebox">${s?`<strong>${num(s.score)}</strong><small>${g.unit} ✓</small>`:'<small>NOT LOGGED</small>'}<button onclick="openScore('${g.id}')">${s?'EDIT':'LOG +'} </button></div></div>`;
  }).join('');
  el('shortBoard').innerHTML=ranked.length?ranked.slice(0,5).map((p,i)=>playerRow(p,i,'overall')).join(''):'<div class="emptyblock">No scores yet. Be the first player on the board.</div>';
  el('miniCard').innerHTML=card(me);
}
function playerRow(p,i,mode,big=false) {
  const skill=mode==='overall'?null:p.skills[mode];
  const sub=mode==='overall'?`${p.gamesCovered}/7 games · ${p.daysPlayed} days played`:`${skill.count} entries · ${pctText(skill.pct)}`;
  const trailing=mode==='overall'?`${num(p.leaguePoints)}`:`${num(skill.avg)}`;
  const label=mode==='overall'?'LEAGUE POINTS':`${games.find(g=>g.id===mode)?.unit} AVG`;
  return `<div class="boardrow ${big?'boardbig':''}" role="button" tabindex="0" onclick="openProfile(${p.id})" onkeydown="if(event.key==='Enter')openProfile(${p.id})"><span class="rank ${i===0?'gold':''}">${i===0?'♛':String(i+1).padStart(2,'0')}</span><div class="player-mini">${avatar(p)}<div><strong>${escapeHtml(p.name)} ${p.id===user.id?'<span style="color:var(--lime);font-size:9px">YOU</span>':''}</strong><small>${escapeHtml(sub)}</small></div></div><div class="ovrbadge">${mode==='overall'?p.ovr:skill.ovr}<small>OVR</small></div><div class="pts">${trailing}<small>${label}</small></div></div>`;
}
function topSkill(p) {
  return Object.entries(p.skills).sort((a,b)=>
    (b[1].pct??(b[1].ovr-65)/.34)-(a[1].pct??(a[1].ovr-65)/.34)
  )[0];
}
function archetype(p) {
  const top=topSkill(p);
  if(!top)return 'UNRANKED ROOKIE';
  if(p.gamesCovered===7 && p.ovr>=90)return 'THE ALL-ROUNDER';
  return ({krillion:'KRILLION KING',plain:'SKY CAPTAIN',factmap:'PINPOINT NAVIGATOR',farflung:'WORLD EXPLORER',perceptle:'PERCEPTLE PRODIGY',globle:'GLOBLE SNIPER',wonderhop:'HOP LEGEND'})[top[0]];
}
function card(p) {
  const top=topSkill(p);
  const ordered=Object.entries(p.skills).sort((a,b)=>b[1].ovr-a[1].ovr).slice(0,5);
  const title=archetype(p);
  return `<div class="cardtop">${avatar(p)}<div><h3>${escapeHtml(p.name)}</h3><p>${title}</p><span class="tag">${p.ovr===null?'NEW RECRUIT':p.ovr>=92?'💎 DIAMOND':p.ovr>=83?'🥇 GOLD':p.ovr>=75?'🥈 SILVER':'🥉 BRONZE'}</span></div><div class="ovrbadge">${p.ovr??'—'}<small>OVR</small></div></div><div class="profile-stats"><div><strong>${p.pct===null?'—':p.pct+'%'}</strong><small>LEAGUE PCTL</small></div><div><strong>${p.gamesCovered}/7</strong><small>GAMES</small></div><div><strong>${num(p.leaguePoints)}</strong><small>LEAGUE PTS</small></div></div><div class="ratings">${ordered.length?ordered.map(([id,s])=>`<div class="ratingrow"><span>${escapeHtml(games.find(g=>g.id===id)?.name)}</span><div class="bar"><span style="width:${s.ovr}%"></span></div><span style="text-align:right">${s.ovr}</span></div>`).join(''):'<p class="muted" style="font-size:12px">Log your first score to unlock your attributes.</p>'}</div><div class="tags">${top?`<span class="tag">👑 ${escapeHtml(title)}</span>`:''}${p.gamesCovered===7?'<span class="tag">⚡ ALL-ROUNDER</span>':''}${p.gamesPlayed>=30?'<span class="tag">🔥 GRINDER</span>':''}${streakFor(p.id)>=3?'<span class="tag">🔥 ON A STREAK</span>':''}</div><button class="outline full" onclick="openProfile(${p.id})">VIEW FULL PLAYER CARD →</button>`;
}
function renderBoards() {
  const mode=el('boardGame').value,period=el('boardPeriod').value,players=sorted(mode,period);
  el('bigBoard').innerHTML=players.length?players.map((p,i)=>playerRow(p,i,mode,true)).join(''):'<div class="emptyblock">No results yet. Be the first to put points on the board.</div>';
}
function openProfile(id) {selectedProfile=id;showView('profile');}
function renderProfile() {
  const p=calc()[selectedProfile]||calc()[user.id],self=p.id===user.id;
  el('settingsPanel').classList.toggle('hidden',!self);
  if(self) el('newPlayerName').value=user.name;
  el('profileHero').innerHTML=`<div style="display:flex;justify-content:space-between;align-items:start">${avatar(p)}<div class="ovrbadge">${p.ovr??'—'}<small>OVR</small></div></div><h2>${escapeHtml(p.name)}</h2><p>${escapeHtml(archetype(p))} · ${p.pct===null?'NO LEAGUE PERCENTILE YET':`${p.pct}TH LEAGUE PERCENTILE`}</p><div class="tags"><span class="tag">🏆 ${num(p.leaguePoints)} LEAGUE POINTS</span>${p.gamesCovered===7?'<span class="tag">⚡ ALL-ROUNDER</span>':''}${p.gamesPlayed>=30?'<span class="tag">30 CLUB</span>':''}${streakFor(p.id)>=3?'<span class="tag">🔥 STREAK</span>':''}</div>${self?'<label class="btn upload">CHANGE PROFILE PICTURE<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onchange="uploadAvatar(this)"></label>':'<div class="muted" style="font-size:11px;margin-top:30px">RIVAL PLAYER CARD</div>'}<button class="outline full" onclick="sharePlayer(${p.id})" style="margin-top:12px">COPY PLAYER CARD STATS ↗</button>`;
  el('profileRatings').innerHTML=games.map(g=>{
    const skill=p.skills[g.id];
    return `<div style="display:grid;grid-template-columns:105px 1fr 100px;gap:11px;align-items:center;margin:15px 0"><div style="font-weight:800;font-size:12px">${iconMap[g.id]} ${g.name}</div><div><div class="bar" style="height:9px"><span style="width:${skill?skill.ovr:0}%"></span></div><div class="muted" style="font-size:10px;margin-top:5px">${skill?`Avg ${num(skill.avg)} ${g.unit} · ${pctText(skill.pct)}${skill.pct===null?' (provisional)':''}`:'No score yet'}</div></div><div style="font:900 27px 'Barlow Condensed';text-align:right;color:${skill?'var(--lime)':'#777'}">${skill?skill.ovr:'—'} <small style="font:700 9px 'DM Sans';color:#888">OVR</small></div></div>`;
  }).join('');
  const history=scores.filter(s=>s.user_id===p.id).sort((a,b)=>b.day.localeCompare(a.day)).slice(0,50);
  el('history').innerHTML=history.length?history.map(s=>`<div class="historyrow"><span class="muted">${escapeHtml(s.day)}</span><span>${iconMap[s.game]} <b>${escapeHtml(games.find(g=>g.id===s.game)?.name||s.game)}</b><small class="muted" style="display:block">${escapeHtml(s.notes||'Daily result')}</small></span><strong>${num(s.score)} <small class="muted">${games.find(g=>g.id===s.game)?.unit??''}</small></strong></div>`).join(''):'<div class="emptyblock">No results to show yet.</div>';
}
async function sharePlayer(id) {
  const p=calc()[id];
  const lines=[`🏆 DAILY DYNASTY · ${p.name}`,`${archetype(p)} · ${p.ovr??'—'} OVR`,`${p.leaguePoints} league points · ${p.gamesCovered}/7 games`,...games.filter(g=>p.skills[g.id]).map(g=>`${g.name}: ${num(p.skills[g.id].avg)} ${g.unit} average (${pctText(p.skills[g.id].pct)})`)];
  try {await navigator.clipboard.writeText(lines.join('\n'));toast('PLAYER STATS COPIED 📋');}
  catch {toast('Could not copy stats. Try HTTPS or a supported browser.');}
}
async function savePlayerName() {
  const name=el('newPlayerName').value.trim();
  try {await api('/profile',{method:'PATCH',body:JSON.stringify({name})});user.name=name;await refresh();el('navName').textContent=name;el('navAvatar').innerHTML=avatar(user);toast('PLAYER NAME UPDATED ✓');}
  catch(e) {toast(e.message);}
}
function openScore(gameId) {
  el('scoreModal').classList.add('open');el('scoreGame').value=gameId;
  el('scoreDate').value=todayET();el('scoreDate').max=todayET();
  el('scoreError').textContent='';fillScore();updateScoreHint();
  el('scoreValue').focus();
}
function fillScore() {
  const saved=scores.find(s=>s.user_id===user.id&&s.game===el('scoreGame').value&&s.day===el('scoreDate').value);
  el('scoreValue').value=saved?.score??'';
  el('scoreNotes').value=saved?.notes??'';
  const breakdown=saved?.breakdown;
  for(const mode of W_MODES) el('wh'+mode[0].toUpperCase()+mode.slice(1)).value=breakdown?.[mode]??'';
}
el('scoreDate').addEventListener('change',fillScore);
el('scoreGame').addEventListener('change',()=>{fillScore();updateScoreHint();});
function updateScoreHint() {
  const g=games.find(x=>x.id===el('scoreGame').value);if(!g)return;
  el('scoreModalTitle').textContent='LOG '+g.name.toUpperCase();
  el('scoreModalHint').textContent=`${g.direction==='low'?'Fewer guesses wins.':'Higher scores win.'} Maximum: ${num(g.max)} ${g.unit}. One score per game per day; you can edit it later.`;
  el('scoreLabel').textContent=g.id==='globle'?'NUMBER OF GUESSES':`FINAL SCORE (${g.unit})`;
  el('scoreValue').max=g.max;el('scoreValue').min=g.min;el('scoreValue').step=g.id==='globle'?'1':'any';
  el('wonderhopFields').classList.toggle('hidden',g.id!=='wonderhop');
}
function closeModal() {el('scoreModal').classList.remove('open');}
el('scoreModal').addEventListener('click',e=>{if(e.target===el('scoreModal'))closeModal();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
el('scoreForm').addEventListener('submit',async e=>{
  e.preventDefault();el('scoreError').textContent='';
  const game=el('scoreGame').value;
  const body={game,day:el('scoreDate').value,score:Number(el('scoreValue').value),notes:el('scoreNotes').value};
  if (game==='wonderhop') {
    const fields=W_MODES.map(mode=>el('wh'+mode[0].toUpperCase()+mode.slice(1)).value);
    if(fields.some(v=>v!=='')) {
      if(fields.some(v=>v==='')) {el('scoreError').textContent='Enter all four Wonderhop mode scores, or leave them all blank.';return;}
      body.breakdown=Object.fromEntries(W_MODES.map((mode,i)=>[mode,Number(fields[i])]));
    }
  }
  try {await api('/scores',{method:'POST',body:JSON.stringify(body)});closeModal();await refresh();toast('SCORE SAVED! YOUR DYNASTY GROWS ⚡');}
  catch(err){el('scoreError').textContent=err.message;}
});
async function refresh() {
  const data=await api('/standings');users=data.users;scores=data.scores;games=data.games;showView(view);
}
async function uploadAvatar(input) {
  const file=input.files?.[0];if(!file)return;
  if(file.size>2*1024*1024){toast('Photo must be under 2 MB');input.value='';return;}
  try {
    const fd=new FormData();fd.append('avatar',file);
    const response=await fetch('/api/avatar',{method:'POST',credentials:'same-origin',headers:{'X-Daily-Dynasty':'1'},body:fd});
    const data=await response.json();if(!response.ok)throw Error(data.detail||'Could not upload image.');
    user.avatar=data.avatar;await refresh();el('navAvatar').innerHTML=avatar(user);toast('PROFILE PICTURE UPDATED ✓');
  } catch(err){toast(err.message);}input.value='';
}
async function logout() {
  try{await api('/logout',{method:'POST'});}catch{};
  user=null;view='dashboard';el('loginScreen').classList.remove('hidden');el('app').classList.add('hidden');el('authPassword').value='';
}
window.addEventListener('focus',()=>{if(user)refresh().catch(()=>{});});
init();
