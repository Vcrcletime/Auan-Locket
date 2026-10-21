import { firebaseConfig } from './firebase-config.js';

if(!document.querySelector('#cvPill') || !document.querySelector('#rx') || !document.querySelector('#btnGroup') || !window.Nav){
  if(window.toast) window.toast('index.html เป็นเวอร์ชันเก่า ให้อัปโหลดทับด้วยไฟล์ล่าสุด');
  throw new Error('index.html is outdated');
}
const V = '10.12.2', B = `https://www.gstatic.com/firebasejs/${V}/`;
const configured = !!firebaseConfig.apiKey && !/^YOUR/i.test(firebaseConfig.apiKey);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast = m => window.toast && window.toast(m);
const rescale = () => window.scaleSvgs && window.scaleSvgs();

let A, F, auth, db;
let me = null, meDoc = null, friendships = {}, groups = {}, people = {};
let blocks = {}, unsubB = null;
let unsubF = null, unsubG = null, unsubM = null, curFid = null, curType = 'dm', msgs = [], firstRender = true;
const Nav = window.Nav;

const errMsg = e => ({
  'permission-denied': 'ถูกปฏิเสธสิทธิ์ ตรวจสอบว่า Publish Firestore Rules แล้ว',
  'unavailable': 'เชื่อมต่อ Firestore ไม่ได้ ตรวจสอบว่าสร้าง Database แล้ว',
  'not-found': 'ยังไม่ได้สร้าง Firestore Database'
}[e.code] || ('ผิดพลาด: ' + (e.code || e.message)));
const norm = v => String(v || '').trim().toLowerCase().replace(/^@/, '');
const fidOf = (a, b) => [a, b].sort().join('_');
const other = f => f.members.find(x => x !== me.uid);
const accepted = () => Object.values(friendships).filter(f => f.status === 'accepted');
const msOf = t => (t && t.toMillis) ? t.toMillis() : 0;
function fmtTime(ms){
  if(!ms) return '';
  const d = new Date(ms), n = new Date(), p = x => String(x).padStart(2,'0');
  return d.toDateString() === n.toDateString() ? `${p(d.getHours())}:${p(d.getMinutes())}` : `${d.getDate()}/${d.getMonth()+1}`;
}
function avHTML(p, cls = ''){
  const av = p && p.avatar, name = (p && p.name) || '?';
  const ini = window.initials ? window.initials(name) : name[0];
  return `<div class="av ${cls}" style="${av ? `background-image:url('${av}')` : ''}">${av ? '' : esc(ini)}</div>`;
}
const chatSvg = '<svg width="56" height="56" viewBox="0 0 24 24" fill="#333"><path d="M12 3C6.5 3 2 6.6 2 11c0 2.4 1.3 4.5 3.4 6L5 21l4-2c1 .3 2 .4 3 .4 5.5 0 10-3.6 10-8S17.5 3 12 3z"/></svg>';
const emptyHTML = (t, d, extra = '') => `<div class="empty">${chatSvg}<b>${t}</b><span>${d}</span>${extra}</div>`;

async function shrink(blob, max = 1080){
  // always center-crop to 1:1
  const bmp = await createImageBitmap(blob);
  const s0 = Math.min(bmp.width, bmp.height), sx = (bmp.width - s0) / 2, sy = (bmp.height - s0) / 2;
  const out = Math.min(max, s0);
  const cv = document.createElement('canvas'); cv.width = cv.height = out;
  cv.getContext('2d').drawImage(bmp, sx, sy, s0, s0, 0, 0, out, out);
  return cv.toDataURL('image/jpeg', .74);
}

/* ---------- init ---------- */
async function init(){
  if(!configured){ renderAll(); return; }
  try{
    const [appm, authm, fsm] = await Promise.all([import(B + 'firebase-app.js'), import(B + 'firebase-auth.js'), import(B + 'firebase-firestore.js')]);
    A = authm; F = fsm;
    const app = appm.initializeApp(firebaseConfig);
    auth = A.getAuth(app); db = F.getFirestore(app);
    A.onAuthStateChanged(auth, onUser);
  }catch(e){ toast('โหลด Firebase ไม่ได้ ตรวจสอบอินเทอร์เน็ต'); renderAll(); }
}
function buildStatic(){
  $('#fsBody').innerHTML = `
    <div class="addrow"><input id="fsInput" placeholder="ค้นหาด้วยชื่อผู้ใช้" autocapitalize="none" autocomplete="off"><button class="minibtn" data-act="addfriend">เพิ่ม</button></div>
    <div class="tip"><div><b>เพิ่มด้วยชื่อผู้ใช้</b><small id="fsMe">เข้าสู่ระบบก่อนเพื่อเพิ่มเพื่อน</small></div></div>
    <div id="fsResults"></div>
    <div id="fsList"></div>`;
}
async function onUser(u){
  cleanup(); me = u; meDoc = null;
  if(!u){ renderAll(); return; }
  try{
    const s = await F.getDoc(F.doc(db, 'users', u.uid));
    meDoc = s.exists() ? s.data() : null;
    const st = window.getSettings();
    if(st.name === 'Auan' && u.displayName) window.setProfile({ name: u.displayName });
    if(!meDoc || !meDoc.username) await claimUsername();
    await syncProfile();
    listenFriendships(); listenBlocks(); listenGroups();
  }catch(e){ toast(errMsg(e)); }
  renderAll();
}
function cleanup(){
  if(unsubF) unsubF(); if(unsubM) unsubM(); if(unsubB) unsubB(); if(unsubG) unsubG(); unsubF = unsubM = unsubB = unsubG = null;
  friendships = {}; groups = {}; blocks = {}; people = {}; curFid = null;
  $('#p-convo').classList.remove('on'); document.body.classList.remove('hidenav');
}
async function syncProfile(){
  if(!me) return; const st = window.getSettings();
  await F.setDoc(F.doc(db, 'users', me.uid), { name: st.name, avatar: st.avatar || '' }, { merge: true });
  meDoc = { ...(meDoc || {}), name: st.name, avatar: st.avatar || '' };
}
window.onProfileChanged = () => { if(me) syncProfile().catch(()=>{}); };

async function claimUsername(){
  let msg = 'ตั้งชื่อผู้ใช้ (a-z, 0-9, _ . ยาว 3-20 ตัว) เพื่อให้เพื่อนค้นหาคุณได้';
  for(;;){
    const v = prompt(msg); if(v === null) return;
    const n = v.trim().toLowerCase().replace(/^@/, '');
    if(!/^[a-z0-9_.]{3,20}$/.test(n)){ msg = 'ชื่อไม่ถูกต้อง ลองใหม่ (a-z, 0-9, _ . ยาว 3-20 ตัว)'; continue; }
    try{
      const st = window.getSettings();
      await F.runTransaction(db, async t => {
        const r = F.doc(db, 'usernames', n), s = await t.get(r);
        if(s.exists()) throw new Error('taken');
        t.set(r, { uid: me.uid });
        t.set(F.doc(db, 'users', me.uid), { username: n, name: st.name, avatar: st.avatar || '' }, { merge: true });
      });
      meDoc = { ...(meDoc || {}), username: n }; return;
    }catch(e){ msg = e.message === 'taken' ? 'ชื่อนี้ถูกใช้แล้ว ลองชื่ออื่น' : 'บันทึกไม่สำเร็จ: ' + (e.code || e.message); }
  }
}

/* ---------- friends ---------- */
async function loadPerson(uid){
  if(people[uid]) return people[uid];
  try{ const s = await F.getDoc(F.doc(db, 'users', uid)); people[uid] = s.exists() ? s.data() : { name: 'ผู้ใช้' }; }
  catch(e){ people[uid] = { name: 'ผู้ใช้' }; }
  return people[uid];
}
function listenFriendships(){
  unsubF = F.onSnapshot(F.query(F.collection(db, 'friendships'), F.where('members', 'array-contains', me.uid)), async snap => {
    friendships = {};
    snap.forEach(d => friendships[d.id] = { id: d.id, ...d.data() });
    await Promise.all(Object.values(friendships).map(f => loadPerson(other(f))));
    if(curFid && curType === 'dm' && !friendships[curFid]){ closeConvo(); toast('บทสนทนานี้ไม่มีแล้ว'); }
    renderAll();
  }, () => toast('โหลดรายชื่อเพื่อนไม่ได้'));
}
function listenGroups(){
  unsubG = F.onSnapshot(F.query(F.collection(db, 'groups'), F.where('members', 'array-contains', me.uid)), async snap => {
    groups = {};
    snap.forEach(d => groups[d.id] = { id: d.id, ...d.data() });
    await Promise.all(Object.values(groups).flatMap(g => g.members.map(loadPerson)));
    if(curFid && curType === 'g' && !groups[curFid]){ closeConvo(); toast('กลุ่มนี้ไม่มีแล้ว'); }
    renderAll();
  }, () => {});
}
async function sendRequest(uid){
  if(!me){ toast('เข้าสู่ระบบก่อน'); return; }
  if(uid === me.uid){ toast('นี่คือชื่อของคุณเอง'); return; }
  if(blocks[uid]){ toast('คุณบล็อกผู้ใช้นี้อยู่ ปลดบล็อกก่อนถึงจะเพิ่มได้'); return; }
  const id = fidOf(me.uid, uid), ex = friendships[id];
  if(ex){
    if(ex.status === 'pending' && ex.from !== me.uid){ await F.updateDoc(F.doc(db, 'friendships', id), { status: 'accepted' }); toast('เขาส่งคำขอมาอยู่แล้ว รับเป็นเพื่อนให้แล้ว'); return; }
    toast(ex.status === 'accepted' ? 'เป็นเพื่อนกันแล้ว' : 'ส่งคำขอไปแล้ว รอเขาตอบรับ'); return;
  }
  try{
    await F.setDoc(F.doc(db, 'friendships', id), { members: [me.uid, uid].sort(), from: me.uid, status: 'pending' });
    $('#fsInput').value = ''; $('#fsResults').innerHTML = '';
    toast('ส่งคำขอแล้ว รอเขากดรับเป็นเพื่อน');
  }catch(e){ toast(e.code === 'permission-denied' ? 'ส่งคำขอไม่ได้ (ผู้ใช้อาจไม่รับคำขอ หรือยังไม่ได้ Publish Rules ล่าสุด)' : errMsg(e)); }
}
async function searchUsers(n){
  const box = $('#fsResults');
  if(!me || n.length < 2){ box.innerHTML = ''; return; }
  try{
    const snap = await F.getDocs(F.query(F.collection(db, 'users'), F.where('username', '>=', n), F.where('username', '<=', n + '\uf8ff'), F.limit(8)));
    const res = []; snap.forEach(d => { if(d.id !== me.uid && !blocks[d.id] && d.data().username) res.push({ uid: d.id, ...d.data() }); });
    if(!res.length){ box.innerHTML = '<p>ไม่พบผู้ใช้ชื่อนี้<br>เพื่อนต้องเข้าสู่ระบบและตั้งชื่อผู้ใช้ก่อนถึงจะค้นเจอ</p>'; return; }
    box.innerHTML = '<div class="fh">ผลการค้นหา</div>' + res.map(u => {
      const ex = friendships[fidOf(me.uid, u.uid)];
      const act = ex ? `<small class="muted">${ex.status === 'accepted' ? 'เป็นเพื่อนแล้ว' : 'รอตอบรับ'}</small>` : `<button class="minibtn" data-act="addto" data-uid="${u.uid}">เพิ่ม</button>`;
      return `<div class="frow">${avHTML(u)}<div class="ftxt"><b>${esc(u.name || '')}</b><small>@${esc(u.username)}</small></div>${act}</div>`;
    }).join('');
  }catch(e){ box.innerHTML = `<p>${esc(errMsg(e))}</p>`; }
}
async function addFriend(){
  if(!me){ toast('เข้าสู่ระบบก่อน'); return; }
  const n = norm($('#fsInput').value); if(!n){ toast('พิมพ์ชื่อผู้ใช้ของเพื่อนก่อน'); return; }
  try{
    const us = await F.getDoc(F.doc(db, 'usernames', n));
    if(us.exists()){ await sendRequest(us.data().uid); return; }
    await searchUsers(n);
    if(!$('#fsResults').querySelector('[data-act="addto"]')) toast('ไม่พบชื่อผู้ใช้นี้');
  }catch(e){ toast(errMsg(e)); }
}
let searchT;
function renderFriends(){
  const el = $('#fsList'); if(!el) return;
  $('#fsMe').textContent = meDoc && meDoc.username ? `เพื่อนค้นหาคุณได้ด้วย @${meDoc.username}` : (me ? 'ยังไม่ได้ตั้งชื่อผู้ใช้' : 'เข้าสู่ระบบก่อนเพื่อเพิ่มเพื่อน');
  if(!configured){ el.innerHTML = '<p>ยังไม่ได้ตั้งค่า Firebase</p>'; return; }
  if(!me){ el.innerHTML = '<div style="text-align:center;padding-top:30px"><button class="btn" data-act="login">เข้าสู่ระบบด้วย Google</button></div>'; return; }
  const all = Object.values(friendships);
  const btn = (label, act, attrs, cls = '') => `<button class="minibtn s ${cls}" data-act="${act}" ${attrs}>${label}</button>`;
  const row = (p, btns, two) => `<div class="frow ${two ? 'two' : ''}">${avHTML(p)}<div class="ftxt"><b>${esc(p.name || '')}</b><small>@${esc(p.username || '')}</small></div><div class="fbtns">${btns}</div></div>`;
  const inc = all.filter(f => f.status === 'pending' && f.from !== me.uid);
  const out = all.filter(f => f.status === 'pending' && f.from === me.uid);
  const fr = all.filter(f => f.status === 'accepted');
  let h = '';
  if(!(meDoc && meDoc.username)) h += '<div class="frow"><div class="ftxt"><b>ยังไม่ได้ตั้งชื่อผู้ใช้</b><small>เพื่อนจะค้นหาคุณไม่เจอ</small></div><div class="fbtns"><button class="minibtn s" data-act="setname">ตั้งชื่อ</button></div></div>';
  if(inc.length) h += `<div class="fh">คำขอเป็นเพื่อน (${inc.length})</div><small class="muted">ถ้าไม่กดรับ เขาจะส่งรูปหรือแช็ตหาคุณไม่ได้</small>` +
    inc.map(f => { const u = other(f); return row(people[u] || {}, btn('รับเป็นเพื่อน', 'accept', `data-id="${f.id}"`) + btn('ปฏิเสธ', 'remove', `data-id="${f.id}"`, 'g') + btn('บล็อก', 'block', `data-uid="${u}"`, 'r'), true); }).join('');
  h += `<div class="fh">เพื่อนของคุณ (${fr.length})</div>` + (fr.length ?
    fr.map(f => { const u = other(f); return row(people[u] || {}, btn('ลบเพื่อน', 'remove', `data-id="${f.id}" data-confirm="1"`, 'g') + btn('บล็อก', 'block', `data-uid="${u}"`, 'r'), true); }).join('') :
    '<small class="muted">ยังไม่มีเพื่อน</small>');
  if(out.length) h += `<div class="fh">รอเขาตอบรับ</div>` + out.map(f => row(people[other(f)] || {}, btn('ยกเลิก', 'remove', `data-id="${f.id}"`, 'g'))).join('');
  const bl = Object.keys(blocks);
  if(bl.length) h += `<div class="fh">ผู้ใช้ที่บล็อก (${bl.length})</div>` + bl.map(u => row(people[u] || {}, btn('ปลดบล็อก', 'unblock', `data-uid="${u}"`, 'g'))).join('');
  el.innerHTML = h;
}

/* ---------- block / remove ---------- */
function listenBlocks(){
  unsubB = F.onSnapshot(F.query(F.collection(db, 'blocks'), F.where('blocker', '==', me.uid)), async snap => {
    blocks = {}; snap.forEach(d => blocks[d.data().blocked] = d.id);
    await Promise.all(Object.keys(blocks).map(loadPerson));
    renderAll();
  }, () => {});
}
async function wipeMessages(fid){
  const snap = await F.getDocs(F.collection(db, 'friendships', fid, 'messages'));
  let batch = F.writeBatch(db), n = 0;
  for(const d of snap.docs){
    batch.delete(d.ref); n++;
    if(n === 400){ await batch.commit(); batch = F.writeBatch(db); n = 0; }
  }
  if(n) await batch.commit();
}
async function removeFriendship(id, ask){
  const f = friendships[id]; if(!f) return;
  if(ask && !confirm('ลบเพื่อนคนนี้? ประวัติแช็ตจะถูกลบทั้งสองฝั่ง')) return;
  if(f.status === 'accepted'){ try{ await wipeMessages(id); }catch(e){} }
  await F.deleteDoc(F.doc(db, 'friendships', id));
}
async function blockUser(uid, skip){
  if(!skip && !confirm('บล็อกผู้ใช้นี้?\n• ลบออกจากเพื่อนและลบประวัติแช็ต\n• เขาจะส่งคำขอหรือข้อความหาคุณไม่ได้')) return;
  const id = fidOf(me.uid, uid);
  await F.setDoc(F.doc(db, 'blocks', me.uid + '_' + uid), { blocker: me.uid, blocked: uid, ts: F.serverTimestamp() });
  if(friendships[id]) await removeFriendship(id, false);
  toast('บล็อกแล้ว');
}

/* ---------- chat list ---------- */
const PEOPLE_SVG = '<svg width="30" height="30" viewBox="0 0 24 24" fill="#fff"><circle cx="9" cy="8" r="3.6"/><path d="M2 19c0-3.5 3-5.6 7-5.6s7 2.1 7 5.6z"/><circle cx="17" cy="9" r="2.8"/><path d="M17.5 13.4c2.6.2 4.5 1.8 4.5 4.6h-4c0-1.9-.2-3.4-.5-4.6z"/></svg>';
const groupAv = (cls = '') => `<div class="av gav ${cls}">${PEOPLE_SVG}</div>`;
const lastKey = i => i.last ? (msOf(i.last.ts) || Date.now()) : 0;
function renderChat(){
  const el = $('#chatBody'); if(!el) return;
  if(!configured){ el.innerHTML = emptyHTML('ยังไม่ได้ตั้งค่า Firebase', 'เปิดไฟล์ firebase-config.js แล้วใส่ค่าจากโปรเจกต์ Firebase ของคุณ'); return; }
  if(!me){ el.innerHTML = emptyHTML('เข้าสู่ระบบเพื่อแช็ตกับเพื่อน', 'ใช้บัญชี Google ของคุณ', '<button class="btn" data-act="login">เข้าสู่ระบบด้วย Google</button>'); return; }
  const inc = Object.values(friendships).filter(f => f.status === 'pending' && f.from !== me.uid).length;
  const items = [
    ...accepted().map(f => { const p = people[other(f)] || {}; return { type: 'dm', id: f.id, last: f.last, name: p.name || '', av: avHTML(p) }; }),
    ...Object.values(groups).map(g => ({ type: 'g', id: g.id, last: g.last, name: g.name, av: groupAv() }))
  ].sort((x, y) => lastKey(y) - lastKey(x));
  let h = inc ? `<div class="crow reqrow" data-act="openreq"><div class="av ring" style="font-size:60px">+</div><div class="txt"><b>คำขอเป็นเพื่อน</b><small>มี ${inc} คำขอรอคุณอยู่</small></div></div>` : '';
  h += items.map(i => { const l = i.last;
    const pre = !l ? '' : (l.from === me.uid ? 'คุณ: ' : (i.type === 'g' && l.name ? esc(l.name) + ': ' : ''));
    return `<div class="crow" data-act="openconv" data-id="${i.id}" data-type="${i.type}">${i.av}<div class="txt"><b>${esc(i.name)}</b><small>${l ? pre + esc(l.text || '') : 'ยังไม่มีข้อความ'}</small></div><time>${l ? fmtTime(msOf(l.ts)) : ''}</time></div>`; }).join('');
  el.innerHTML = h || emptyHTML('ยังไม่มีแช็ต', 'กดปุ่มดินสอสีชมพูเพื่อเพิ่มเพื่อน');
  rescale();
}

/* ---------- conversation ---------- */
const MON = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const QUICK = ['😍','🫶','💕','🤣','💛'];
const p2 = n => String(n).padStart(2, '0');
const msgMs = m => msOf(m.ts) || Date.now();
const fmtDivider = ms => { const d = new Date(ms); return `${d.getDate()} ${MON[d.getMonth()]} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
function rel(ms){
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if(s < 60) return 'now'; if(s < 3600) return Math.floor(s / 60) + 'm'; if(s < 86400) return Math.floor(s / 3600) + 'h';
  if(s < 604800) return Math.floor(s / 86400) + 'd'; return Math.floor(s / 604800) + 'w';
}
const msgsEl = $('#msgs');
const seenMsgs = new Set(), seenRx = new Set();
let convoReady = false;
const colName = t => t === 'g' ? 'groups' : 'friendships';
const msgCol = (t, id) => F.collection(db, colName(t), id, 'messages');
const chatDoc = (t, id) => F.doc(db, colName(t), id);
const whoIs = uid => uid === me.uid ? { name: 'คุณ', avatar: window.getSettings().avatar } : (people[uid] || {});

function openConvo(id, type = 'dm'){
  const chat = type === 'g' ? groups[id] : friendships[id]; if(!chat) return;
  curFid = id; curType = type; firstRender = true; msgs = []; seenMsgs.clear(); seenRx.clear(); convoReady = false;
  if(type === 'g') $('#cvHead').innerHTML = groupAv() + `<div><b>${esc(chat.name)}</b><small>${chat.members.length} คน</small></div>`;
  else { const p = people[other(chat)] || {}; $('#cvHead').innerHTML = avHTML(p) + `<b>${esc(p.name || '')}</b>`; }
  $('#cvBlock').style.display = type === 'g' ? 'none' : '';
  $('#cvLeave').style.display = type === 'g' ? '' : 'none';
  $('#chead').style.removeProperty('--hbg');
  msgsEl.innerHTML = '';
  $('#p-convo').classList.add('on'); document.body.classList.add('hidenav');
  Nav.open('convo', closeConvoUI); rescale();
  if(unsubM) unsubM();
  unsubM = F.onSnapshot(F.query(msgCol(type, id), F.orderBy('ts', 'asc'), F.limitToLast(100)), snap => {
    msgs = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderMsgs();
  }, () => toast('โหลดข้อความไม่ได้'));
}
function closeConvoUI(){
  if(unsubM) unsubM(); unsubM = null; curFid = null;
  $('#p-convo').classList.remove('on'); document.body.classList.remove('hidenav');
}
function closeConvo(){ if(Nav.has('convo')) Nav.close('convo'); else closeConvoUI(); }
function reactHTML(m, anim){
  const spans = Object.entries(m.reactions || {}).filter(([, e]) => e).map(([u, e]) => {
    const k = `${m.id}|${u}|${e}`, pop = anim && !seenRx.has(k); seenRx.add(k);
    return `<span class="${pop ? 'pop' : ''}">${esc(e)}</span>`;
  });
  return spans.length ? `<div class="rx">${spans.join('')}</div>` : '';
}
function renderMsgs(){
  const isG = curType === 'g', chat = isG ? groups[curFid] : friendships[curFid]; if(!chat) return;
  const anim = convoReady;
  const nearBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 300;
  let prev = 0, prevFrom = null, h = '', lastImg = '';
  msgs.forEach(m => {
    const t = msgMs(m);
    if(!prev || t - prev > 3600000){ h += `<div class="tdiv">${fmtDivider(t)}</div>`; prevFrom = null; }
    prev = t;
    const mine = m.from === me.uid, rx = reactHTML(m, anim), w = whoIs(m.from);
    const nw = anim && !seenMsgs.has(m.id) ? ' new' : '';
    seenMsgs.add(m.id);
    const showName = isG && !mine && prevFrom !== m.from; prevFrom = m.from;
    if(m.kind === 'photo'){
      lastImg = m.img;
      h += `<div class="pwrap ${mine ? 'me' : ''}${nw}" data-mid="${m.id}"><div class="pmsg"><div class="pimg"><img src="${m.img}" alt="" draggable="false"><div class="pchip">${avHTML(w)}<b>${esc(mine ? 'คุณ' : (w.name || ''))}</b><i>${rel(t)}</i></div>${m.text ? `<div class="pcap">${esc(m.text)}</div>` : ''}</div></div>${rx}</div>`;
    } else {
      h += `<div class="mrow ${mine ? 'me' : ''}${nw}" data-mid="${m.id}">${mine ? '' : avHTML(w)}<div class="mcol">${showName ? `<div class="sname">${esc(w.name || '')}</div>` : ''}<div class="bub ${mine ? 'me' : ''}">${esc(m.text)}</div>${rx}</div></div>`;
    }
  });
  msgsEl.innerHTML = h;
  if(lastImg) $('#chead').style.setProperty('--hbg', `url('${lastImg}')`);
  if(firstRender || nearBottom){ msgsEl.scrollTop = msgsEl.scrollHeight; if(msgs.length) firstRender = false; }
  convoReady = true;
}

/* write a message + update the chat preview */
async function post(type, id, data, preview){
  await F.addDoc(msgCol(type, id), { from: me.uid, ts: F.serverTimestamp(), ...data });
  const last = { text: preview, from: me.uid, ts: F.serverTimestamp() };
  if(type === 'g') last.name = window.getSettings().name;
  await F.updateDoc(chatDoc(type, id), { last });
}

/* send text / quick emoji */
async function sendVal(t){
  t = (t || '').trim(); if(!t || !curFid) return;
  try{ await post(curType, curFid, { kind: 'text', text: t }, t.slice(0, 80)); }catch(e){ toast('ส่งไม่สำเร็จ: ' + errMsg(e)); }
}
const cvInput = $('#cvInput'), cvPill = $('#cvPill');
const syncTyping = () => cvPill.classList.toggle('typing', cvInput.value.trim().length > 0);
cvInput.addEventListener('input', syncTyping);
cvInput.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); $('#cvSend').click(); } });
$('#cvSend').onclick = async () => { const t = cvInput.value; cvInput.value = ''; syncTyping(); await sendVal(t); };
$('#cvQuick').onclick = e => {
  const q = e.target.closest('[data-q]'); if(q){ sendVal(q.dataset.q); return; }
  if(e.target.closest('#cvEmoji')) openPicker(em => { cvInput.value += em; syncTyping(); cvInput.focus(); });
};
$('#cvBack').onclick = closeConvo;
$('#cvBlock').onclick = async () => { const f = friendships[curFid]; if(f){ try{ await blockUser(other(f)); }catch(e){ toast(errMsg(e)); } } };
$('#cvLeave').onclick = async () => {
  const g = groups[curFid]; if(!g || !confirm(`ออกจากกลุ่ม "${g.name}"?`)) return;
  try{
    closeConvo();
    if(g.members.length <= 1) await F.deleteDoc(chatDoc('g', g.id));
    else await F.updateDoc(chatDoc('g', g.id), { members: F.arrayRemove(me.uid) });
    toast('ออกจากกลุ่มแล้ว');
  }catch(e){ toast(errMsg(e)); }
};

/* ---------- reactions + long-press menu ---------- */
let lpT = null, lpFired = false, lpPos = null, rxMsg = null, rxEl = null;
const findMsg = id => msgs.find(m => m.id === id);
msgsEl.addEventListener('pointerdown', e => {
  const t = e.target.closest('[data-mid]'); if(!t) return;
  lpFired = false; lpPos = { x: e.clientX, y: e.clientY };
  clearTimeout(lpT);
  lpT = setTimeout(() => { lpFired = true; if(navigator.vibrate) navigator.vibrate(15); openRx(t); }, 420);
});
msgsEl.addEventListener('pointermove', e => { if(lpPos && Math.hypot(e.clientX - lpPos.x, e.clientY - lpPos.y) > 10) clearTimeout(lpT); });
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => msgsEl.addEventListener(ev, () => clearTimeout(lpT)));
msgsEl.addEventListener('contextmenu', e => { e.preventDefault(); const t = e.target.closest('[data-mid]'); if(t && !lpFired) openRx(t); });
msgsEl.addEventListener('click', e => {
  if(lpFired){ lpFired = false; return; }
  const ph = e.target.closest('.pmsg'); if(!ph) return;
  const w = ph.closest('[data-mid]'), m = w && findMsg(w.dataset.mid); if(m) openLightbox(m.img);
});

function openRx(el){
  const m = findMsg(el.dataset.mid); if(!m) return;
  closeRxUI(); rxMsg = m; rxEl = el; el.classList.add('hl');
  const mine = m.from === me.uid, my = (m.reactions || {})[me.uid];
  const bar = $('#rxBar'), menu = $('#rxMenu');
  bar.innerHTML = QUICK.map(e => `<button data-e="${e}" class="${my === e ? 'on' : ''}">${e}</button>`).join('') + '<button data-e="+" aria-label="อีโมจิอื่น"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#aaa" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="13" r="8.5"/><path d="M7.5 14.5c1 1.6 2.2 2.3 3.5 2.3s2.5-.7 3.5-2.3"/><circle cx="8.5" cy="11" r=".6" fill="#aaa"/><circle cx="13.5" cy="11" r=".6" fill="#aaa"/><path d="M19 2.5v5M16.5 5h5"/></svg></button>';
  let items = '';
  if(m.kind !== 'photo' && m.text) items += '<button data-a="copy">คัดลอกข้อความ</button>';
  if(m.kind === 'photo') items += '<button data-a="save">บันทึกรูป</button>';
  if(!mine) items += '<button data-a="report" class="red">รายงาน</button>';
  menu.innerHTML = items; menu.style.display = items ? '' : 'none';
  $('#rx').classList.add('on'); Nav.open('rx', closeRxUI); rescale();
  const page = $('#p-convo').getBoundingClientRect(), r = el.getBoundingClientRect();
  const bw = bar.offsetWidth, bh = bar.offsetHeight, mh = items ? menu.offsetHeight : 0, mw = menu.offsetWidth, gap = 12;
  const total = bh + (mh ? gap + mh : 0);
  let top = r.bottom + gap;
  if(top + total > page.bottom - 16) top = r.top - gap - total;
  if(top < page.top + 16) top = Math.max(page.top + 16, page.bottom - 16 - total);
  const clamp = (v, w) => Math.min(Math.max(v, page.left + 12), page.right - w - 12);
  const left = mine ? r.right - bw : r.left;
  bar.style.top = (top - page.top) + 'px'; bar.style.left = (clamp(left, bw) - page.left) + 'px';
  if(mh){ menu.style.top = (top - page.top + bh + gap) + 'px'; menu.style.left = (clamp(mine ? r.right - mw : r.left, mw) - page.left) + 'px'; }
}
function closeRxUI(){ $('#rx').classList.remove('on'); if(rxEl) rxEl.classList.remove('hl'); rxEl = null; }
function closeRx(){ if(Nav.has('rx')) Nav.close('rx'); else closeRxUI(); }
async function react(m, emoji){
  if(!m || !curFid) return;
  const cur = (m.reactions || {})[me.uid];
  try{ await F.updateDoc(F.doc(db, colName(curType), curFid, 'messages', m.id), { ['reactions.' + me.uid]: cur === emoji ? F.deleteField() : emoji }); }
  catch(e){ toast(errMsg(e)); }
}
function saveDataUrl(url){ const a = document.createElement('a'); a.href = url; a.download = `auan-${Date.now()}.jpg`; document.body.appendChild(a); a.click(); a.remove(); }
async function reportMsg(m){
  if(!confirm('รายงานข้อความนี้ว่าไม่เหมาะสมหรือรบกวน?')) return;
  try{
    await F.addDoc(F.collection(db, 'reports'), { reporter: me.uid, reported: m.from, fid: curFid, chatType: curType, mid: m.id, kind: m.kind || 'text', text: (m.text || '').slice(0, 300), ts: F.serverTimestamp() });
    toast('ส่งรายงานแล้ว');
    if(confirm('ต้องการบล็อกผู้ใช้นี้ด้วยไหม?')) await blockUser(m.from, true);
  }catch(e){ toast(errMsg(e)); }
}
$('#rx').addEventListener('click', async e => {
  if(e.target.classList.contains('rxbg')){ closeRx(); return; }
  const m = rxMsg;
  const be = e.target.closest('[data-e]'), ba = e.target.closest('[data-a]');
  if(be){
    const em = be.dataset.e; closeRx();
    if(em === '+') openPicker(x => react(m, x)); else react(m, em);
  } else if(ba){
    const a = ba.dataset.a; closeRx();
    if(a === 'copy'){ try{ await navigator.clipboard.writeText(m.text); toast('คัดลอกแล้ว'); }catch(err){ toast('คัดลอกไม่ได้'); } }
    else if(a === 'save') saveDataUrl(m.img);
    else if(a === 'report') await reportMsg(m);
  }
});

/* ---------- lightbox ---------- */
const closeLbUI = () => $('#lb').classList.remove('on');
const closeLb = () => Nav.has('lb') ? Nav.close('lb') : closeLbUI();
function openLightbox(src){ $('#lbImg').src = src; $('#lb').classList.add('on'); Nav.open('lb', closeLbUI); }
$('#lb').addEventListener('click', e => { if(!e.target.closest('#lbSave')) closeLb(); });
$('#lbSave').onclick = () => saveDataUrl($('#lbImg').src);

/* ---------- emoji picker ---------- */
let emoData = null, pickCb = null, emoCat = 'smile';
const TH = { 'หัวใจ': 'heart', 'รัก': 'heart', 'ยิ้ม': 'smil', 'หัวเราะ': 'laugh', 'ขำ': 'joy', 'ร้องไห้': 'cry', 'โกรธ': 'angry', 'ไฟ': 'fire', 'แมว': 'cat', 'หมา': 'dog', 'สุนัข': 'dog', 'ดาว': 'star', 'ตา': 'eye', 'มือ': 'hand', 'จูบ': 'kiss', 'อาหาร': 'food', 'ขนม': 'cake', 'ดอกไม้': 'flower', 'เศร้า': 'sad', 'กลัว': 'fear', 'หลับ': 'sleep', 'ง่วง': 'sleep', 'เท่': 'sunglasses', 'ผี': 'ghost', 'ปาร์ตี้': 'party', 'เงิน': 'money', 'รถ': 'car', 'กิน': 'food', 'หมู': 'pig', 'หมี': 'bear', 'กระต่าย': 'rabbit', 'ลิง': 'monkey' };
const closeEmoUI = () => $('#emo').classList.remove('on');
const closeEmo = () => Nav.has('emo') ? Nav.close('emo') : closeEmoUI();
async function openPicker(cb){
  try{ if(!emoData) emoData = (await import('./emoji.js?v=7')).EMOJI; }catch(e){ toast('โหลดอีโมจิไม่ได้'); return; }
  pickCb = cb; $('#emoSearch').value = '';
  $('#emoTabs').innerHTML = emoData.cats.map(c => `<button data-c="${c.id}" aria-label="${c.title}">${c.icon}</button>`).join('');
  drawEmoji(emoCat); $('#emo').classList.add('on'); Nav.open('emo', closeEmoUI);
}
function drawEmoji(cat, q){
  const grid = $('#emoGrid'); let list, title;
  if(q){
    let t = q.toLowerCase().trim(); Object.keys(TH).forEach(k => { if(t.includes(k)) t = t.replace(k, TH[k]); });
    const words = t.split(/\s+/).filter(Boolean);
    list = Object.values(emoData.items).flat().filter(([e, n]) => words.every(w => n.includes(w) || e === w));
    title = `ผลการค้นหา (${list.length})`;
  } else { emoCat = cat; list = emoData.items[cat]; title = emoData.cats.find(c => c.id === cat).title; }
  $('#emoTitle').textContent = title;
  grid.innerHTML = list.length ? list.map(([e, n]) => `<button data-e="${e}" title="${n}">${e}</button>`).join('') : '<p>ไม่พบอีโมจิ ลองค้นหาเป็นภาษาอังกฤษ เช่น heart, cat</p>';
  grid.scrollTop = 0;
  $$('#emoTabs button').forEach(b => b.classList.toggle('on', !q && b.dataset.c === cat));
}
const $$ = s => document.querySelectorAll(s);
$('#emoTabs').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if(b){ $('#emoSearch').value = ''; drawEmoji(b.dataset.c); } });
$('#emoSearch').addEventListener('input', e => { const v = e.target.value; v.trim() ? drawEmoji(null, v) : drawEmoji(emoCat); });
$('#emoGrid').addEventListener('click', e => { const b = e.target.closest('[data-e]'); if(!b) return; const cb = pickCb; closeEmo(); if(cb) cb(b.dataset.e); });
$('.emobg').addEventListener('click', closeEmo);

/* ---------- create group ---------- */
const closeGrpUI = () => $('#grpBg').classList.remove('on');
const closeGrp = () => Nav.has('group') ? Nav.close('group') : closeGrpUI();
function openGroupSheet(){
  if(!me){ toast('เข้าสู่ระบบก่อน'); return; }
  const fr = accepted();
  if(!fr.length){ toast('ต้องมีเพื่อนก่อนถึงจะสร้างกลุ่มได้'); return; }
  const sel = new Set(), bg = $('#grpBg'), list = $('#grpList'), go = $('#grpGo'), nameEl = $('#grpName');
  nameEl.value = '';
  const check = () => { go.disabled = !(sel.size >= 1 && nameEl.value.trim()); go.textContent = sel.size ? `สร้างกลุ่ม (${sel.size + 1} คน)` : 'สร้างกลุ่ม'; };
  const draw = () => {
    list.innerHTML = fr.map(f => { const u = other(f), p = people[u] || {};
      return `<div class="srow ${sel.has(u) ? 'on' : ''}" data-uid="${u}">${avHTML(p)}<b>${esc(p.name || '')}</b><i class="chk"></i></div>`; }).join('');
    check();
  };
  list.onclick = e => { const r = e.target.closest('.srow'); if(!r) return; const u = r.dataset.uid; sel.has(u) ? sel.delete(u) : sel.add(u); draw(); };
  nameEl.oninput = check;
  $('#grpCancel').onclick = closeGrp;
  bg.onclick = e => { if(e.target === bg) closeGrp(); };
  go.onclick = async () => {
    const name = nameEl.value.trim().slice(0, 30), members = [me.uid, ...sel];
    go.disabled = true;
    try{
      const st = window.getSettings();
      const last = { text: 'สร้างกลุ่มแล้ว', from: me.uid, name: st.name, ts: F.serverTimestamp() };
      const ref = await F.addDoc(F.collection(db, 'groups'), { name, owner: me.uid, members, createdAt: F.serverTimestamp(), last });
      groups[ref.id] = { id: ref.id, name, owner: me.uid, members, last: null };
      closeGrp(); renderAll(); openConvo(ref.id, 'g');
    }catch(e){ toast('สร้างกลุ่มไม่สำเร็จ: ' + errMsg(e)); go.disabled = false; }
  };
  draw(); bg.classList.add('on'); Nav.open('group', closeGrpUI); rescale();
}
$('#btnGroup').onclick = openGroupSheet;

/* ---------- send photo: choose recipients (friends + groups) ---------- */
window.onPreviewOpen = () => {};
window.chooseRecipients = () => new Promise(resolve => {
  if(!me){ toast('เข้าสู่ระบบในแท็บแช็ตเพื่อส่งให้เพื่อน (บันทึกในเครื่องก่อน)'); resolve([]); return; }
  const targets = [
    ...accepted().map(f => ({ key: 'dm:' + f.id, av: avHTML(people[other(f)] || {}), name: (people[other(f)] || {}).name || '' })),
    ...Object.values(groups).map(g => ({ key: 'g:' + g.id, av: groupAv(), name: g.name + ' (กลุ่ม)' }))
  ];
  if(!targets.length){ toast('ยังไม่มีเพื่อน บันทึกในเครื่องอย่างเดียว'); resolve([]); return; }
  const sel = new Set(), bg = $('#sendBg'), list = $('#sendList'), go = $('#sendGo'), all = $('#sendAll');
  const draw = () => {
    list.innerHTML = targets.map(t => `<div class="srow ${sel.has(t.key) ? 'on' : ''}" data-key="${t.key}">${t.av}<b>${esc(t.name)}</b><i class="chk"></i></div>`).join('');
    all.classList.toggle('on', sel.size === targets.length);
    go.textContent = sel.size ? `ส่ง (${sel.size})` : 'ส่ง'; go.disabled = !sel.size; rescale();
  };
  let finished = false;
  const done = v => {
    if(finished) return; finished = true;
    bg.classList.remove('on'); list.onclick = all.onclick = go.onclick = $('#sendSkip').onclick = bg.onclick = null;
    resolve(v); if(Nav.has('send')) Nav.close('send');
  };
  list.onclick = e => { const r = e.target.closest('.srow'); if(!r) return; const k = r.dataset.key; sel.has(k) ? sel.delete(k) : sel.add(k); draw(); };
  all.onclick = () => { if(sel.size === targets.length) sel.clear(); else targets.forEach(t => sel.add(t.key)); draw(); };
  go.onclick = () => done([...sel]);
  $('#sendSkip').onclick = () => done([]);
  bg.onclick = e => { if(e.target === bg) done(null); };
  draw(); bg.classList.add('on'); Nav.open('send', () => done(null));
});
window.onPhotoSaved = async (p, cap, to) => {
  if(!me || !to || !to.length || !p) return false;
  const img = await shrink(p.blob);
  await Promise.all(to.map(k => { const i = k.indexOf(':'), t = k.slice(0, i), id = k.slice(i + 1); return post(t === 'g' ? 'g' : 'dm', id, { kind: 'photo', img, text: cap || '' }, '📷 รูปภาพ'); }));
  return true;
};

/* ---------- account ---------- */
async function signIn(){
  try{ await A.signInWithPopup(auth, new A.GoogleAuthProvider()); }
  catch(e){
    if(e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') A.signInWithRedirect(auth, new A.GoogleAuthProvider());
    else if(e.code === 'auth/unauthorized-domain') toast('ต้องเพิ่มโดเมน github.io ใน Firebase → Authentication → Settings → Authorized domains');
    else if(e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') toast('เข้าสู่ระบบไม่สำเร็จ: ' + (e.code || e.message));
  }
}
function renderAcct(){
  const el = $('#acct'); if(!el) return;
  if(!configured){ el.innerHTML = '<div style="flex:1"><b>บัญชี Auan</b><small>ยังไม่ได้ตั้งค่า Firebase</small></div>'; return; }
  if(!me){ el.innerHTML = '<div style="flex:1"><b>บัญชี Auan</b><small>เข้าสู่ระบบเพื่อเพิ่มเพื่อนและแช็ต</small></div><button class="minibtn" data-act="login">เข้าสู่ระบบ</button>'; return; }
  const u = meDoc && meDoc.username;
  el.innerHTML = `<div style="flex:1;min-width:0"><b>${esc(window.getSettings().name)}</b><small>${u ? '@' + esc(u) + ' · ' : ''}${esc(me.email || '')}</small></div>` + (u ? '' : '<button class="minibtn" data-act="setname">ตั้งชื่อ</button>') + '<button class="minibtn g" data-act="logout">ออก</button>';
}
function updatePill(){
  const n = me ? accepted().length : 0;
  $('#pillTxt').textContent = n ? `${n} เพื่อน` : 'ฉันคนเดียว';
}
function renderAll(){ renderChat(); renderFriends(); renderAcct(); updatePill(); }

/* ---------- events ---------- */
buildStatic();
$('#fsInput').addEventListener('input', e => { clearTimeout(searchT); const v = norm(e.target.value); searchT = setTimeout(() => searchUsers(v), 350); });
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act]'); if(!t) return;
  const act = t.dataset.act, id = t.dataset.id;
  if(!configured && act !== 'noop'){ toast('ต้องตั้งค่า firebase-config.js ก่อน'); return; }
  try{
    if(act === 'login') await signIn();
    else if(act === 'logout'){ if(confirm('ออกจากระบบ?')) await A.signOut(auth); }
    else if(act === 'setname'){ await claimUsername(); await syncProfile(); renderAll(); }
    else if(act === 'addfriend') await addFriend();
    else if(act === 'addto') await sendRequest(t.dataset.uid);
    else if(act === 'accept') await F.updateDoc(F.doc(db, 'friendships', id), { status: 'accepted' });
    else if(act === 'remove') await removeFriendship(id, !!t.dataset.confirm);
    else if(act === 'block') await blockUser(t.dataset.uid);
    else if(act === 'unblock'){ if(confirm('ปลดบล็อกผู้ใช้นี้?')) await F.deleteDoc(F.doc(db, 'blocks', me.uid + '_' + t.dataset.uid)); }
    else if(act === 'openconv') openConvo(id, t.dataset.type || 'dm');
    else if(act === 'openreq') window.openFriends();
  }catch(err){ toast('ทำรายการไม่สำเร็จ: ' + (err.code || err.message)); }
});
$('#btnCompose').onclick = () => window.openFriends();
$('#fsInput').addEventListener('keydown', e => { if(e.key === 'Enter') addFriend(); });

init();
