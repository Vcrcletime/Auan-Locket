import { firebaseConfig } from './firebase-config.js';

const V = '10.12.2', B = `https://www.gstatic.com/firebasejs/${V}/`;
const configured = !!firebaseConfig.apiKey && !/^YOUR/i.test(firebaseConfig.apiKey);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast = m => window.toast && window.toast(m);
const rescale = () => window.scaleSvgs && window.scaleSvgs();

let A, F, auth, db;
let me = null, meDoc = null, friendships = {}, people = {};
let unsubF = null, unsubM = null, curFid = null, msgs = [], firstRender = true;
const selected = new Set();

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

async function shrink(blob, max = 720){
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', .72);
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
    listenFriendships();
  }catch(e){ toast('เชื่อมต่อฐานข้อมูลไม่ได้ ตรวจสอบ Firestore rules'); }
  renderAll();
}
function cleanup(){
  if(unsubF) unsubF(); if(unsubM) unsubM(); unsubF = unsubM = null;
  friendships = {}; people = {}; curFid = null;
  $('#p-convo').classList.remove('on');
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
    renderAll();
  }, () => toast('โหลดรายชื่อเพื่อนไม่ได้'));
}
async function addFriend(){
  if(!me){ toast('เข้าสู่ระบบก่อน'); return; }
  const inp = $('#fsInput'), n = inp.value.trim().toLowerCase().replace(/^@/, '');
  if(!n) return;
  try{
    const us = await F.getDoc(F.doc(db, 'usernames', n));
    if(!us.exists()){ toast('ไม่พบผู้ใช้นี้'); return; }
    const uid = us.data().uid;
    if(uid === me.uid){ toast('นี่คือชื่อของคุณเอง'); return; }
    const id = fidOf(me.uid, uid), ex = friendships[id];
    if(ex){ toast(ex.status === 'accepted' ? 'เป็นเพื่อนกันแล้ว' : 'มีคำขอค้างอยู่แล้ว'); return; }
    await F.setDoc(F.doc(db, 'friendships', id), { members: [me.uid, uid].sort(), from: me.uid, status: 'pending' });
    inp.value = ''; toast('ส่งคำขอเป็นเพื่อนแล้ว');
  }catch(e){ toast('ส่งคำขอไม่ได้ (อาจมีคำขออยู่แล้ว)'); }
}
function renderFriends(){
  const el = $('#fsList'); if(!el) return;
  $('#fsMe').textContent = meDoc && meDoc.username ? `เพื่อนค้นหาคุณได้ด้วย @${meDoc.username}` : (me ? 'ยังไม่ได้ตั้งชื่อผู้ใช้' : 'เข้าสู่ระบบก่อนเพื่อเพิ่มเพื่อน');
  if(!configured){ el.innerHTML = '<p>ยังไม่ได้ตั้งค่า Firebase</p>'; return; }
  if(!me){ el.innerHTML = '<div style="text-align:center;padding-top:30px"><button class="btn" data-act="login">เข้าสู่ระบบด้วย Google</button></div>'; return; }
  const all = Object.values(friendships);
  const row = (f, btns) => { const p = people[other(f)] || {}; return `<div class="frow">${avHTML(p)}<div class="ftxt"><b>${esc(p.name || '')}</b><small>@${esc(p.username || '')}</small></div>${btns}</div>`; };
  const inc = all.filter(f => f.status === 'pending' && f.from !== me.uid);
  const out = all.filter(f => f.status === 'pending' && f.from === me.uid);
  const fr = all.filter(f => f.status === 'accepted');
  let h = '';
  if(inc.length) h += `<div class="fh">คำขอเป็นเพื่อน (${inc.length})</div>` + inc.map(f => row(f, `<button class="minibtn" data-act="accept" data-id="${f.id}">รับ</button><button class="minibtn g" data-act="remove" data-id="${f.id}">ลบ</button>`)).join('');
  h += `<div class="fh">เพื่อนของคุณ (${fr.length})</div>` + (fr.length ? fr.map(f => row(f, `<button class="minibtn g" data-act="remove" data-id="${f.id}" data-confirm="1">ลบ</button>`)).join('') : '<small class="muted">ยังไม่มีเพื่อน</small>');
  if(out.length) h += `<div class="fh">คำขอที่ส่งแล้ว</div>` + out.map(f => row(f, `<button class="minibtn g" data-act="remove" data-id="${f.id}">ยกเลิก</button>`)).join('');
  el.innerHTML = h;
}

/* ---------- chat list ---------- */
function renderChat(){
  const el = $('#chatBody'); if(!el) return;
  if(!configured){ el.innerHTML = emptyHTML('ยังไม่ได้ตั้งค่า Firebase', 'เปิดไฟล์ firebase-config.js แล้วใส่ค่าจากโปรเจกต์ Firebase ของคุณ'); return; }
  if(!me){ el.innerHTML = emptyHTML('เข้าสู่ระบบเพื่อแช็ตกับเพื่อน', 'ใช้บัญชี Google ของคุณ', '<button class="btn" data-act="login">เข้าสู่ระบบด้วย Google</button>'); return; }
  const inc = Object.values(friendships).filter(f => f.status === 'pending' && f.from !== me.uid).length;
  const list = accepted().sort((a, b) => msOf(b.last && b.last.ts) - msOf(a.last && a.last.ts));
  let h = inc ? `<div class="crow reqrow" data-act="openreq"><div class="av ring" style="font-size:60px">+</div><div class="txt"><b>คำขอเป็นเพื่อน</b><small>มี ${inc} คำขอรอคุณอยู่</small></div></div>` : '';
  h += list.map(f => { const p = people[other(f)] || {}, l = f.last;
    return `<div class="crow" data-act="openconv" data-id="${f.id}">${avHTML(p)}<div class="txt"><b>${esc(p.name || '')}</b><small>${l ? (l.from === me.uid ? 'คุณ: ' : '') + esc(l.text || '') : 'ยังไม่มีข้อความ'}</small></div><time>${l ? fmtTime(msOf(l.ts)) : ''}</time></div>`; }).join('');
  el.innerHTML = h || emptyHTML('ยังไม่มีแช็ต', 'กดปุ่มดินสอสีชมพูเพื่อเพิ่มเพื่อน');
}

/* ---------- conversation ---------- */
function openConvo(fid){
  const f = friendships[fid]; if(!f) return;
  curFid = fid; firstRender = true; msgs = [];
  const p = people[other(f)] || {};
  $('#cvHead').innerHTML = avHTML(p) + `<b>${esc(p.name || '')}</b>`;
  $('#msgs').innerHTML = '';
  $('#p-convo').classList.add('on'); document.body.classList.add('hidenav');
  if(unsubM) unsubM();
  unsubM = F.onSnapshot(F.query(F.collection(db, 'friendships', fid, 'messages'), F.orderBy('ts', 'asc'), F.limitToLast(100)), snap => {
    msgs = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderMsgs();
  }, () => toast('โหลดข้อความไม่ได้'));
}
function closeConvo(){
  if(unsubM) unsubM(); unsubM = null; curFid = null;
  $('#p-convo').classList.remove('on'); document.body.classList.remove('hidenav');
}
function renderMsgs(){
  const el = $('#msgs');
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 250;
  el.innerHTML = msgs.map(m => {
    const mine = m.from === me.uid;
    if(m.kind === 'photo') return `<div class="bub photo ${mine ? 'me' : ''}"><img src="${m.img}" alt="">${m.text ? `<div class="capt">${esc(m.text)}</div>` : ''}</div>`;
    return `<div class="bub ${mine ? 'me' : ''}">${esc(m.text)}</div>`;
  }).join('');
  if(firstRender || nearBottom){ el.scrollTop = el.scrollHeight; firstRender = false; }
}
async function post(fid, data, preview){
  await F.addDoc(F.collection(db, 'friendships', fid, 'messages'), { from: me.uid, ts: F.serverTimestamp(), ...data });
  await F.updateDoc(F.doc(db, 'friendships', fid), { last: { text: preview, from: me.uid, ts: F.serverTimestamp() } });
}
async function sendText(){
  const i = $('#cvInput'), t = i.value.trim(); if(!t || !curFid) return;
  i.value = '';
  try{ await post(curFid, { kind: 'text', text: t }, t.slice(0, 80)); }catch(e){ toast('ส่งไม่สำเร็จ'); i.value = t; }
}
$('#cvSend').onclick = sendText;
$('#cvInput').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); sendText(); } });
$('#cvBack').onclick = closeConvo;
$('#cvPhoto').onclick = () => $('#cvPick').click();
$('#cvPick').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if(!f || !curFid) return;
  try{ await post(curFid, { kind: 'photo', img: await shrink(f), text: '' }, '📷 รูปภาพ'); }catch(err){ toast('ส่งรูปไม่สำเร็จ'); }
};

/* ---------- send photo from camera ---------- */
window.onPreviewOpen = () => {
  selected.clear();
  const el = $('#pvFriends'); if(!el) return;
  if(!me || !accepted().length){ el.innerHTML = ''; return; }
  el.innerHTML = accepted().map(f => { const p = people[other(f)] || {};
    return `<button class="pf" data-fid="${f.id}">${avHTML(p)}<span>${esc(p.name || '')}</span></button>`; }).join('');
};
$('#pvFriends').addEventListener('click', e => {
  const b = e.target.closest('.pf'); if(!b) return;
  const id = b.dataset.fid;
  if(selected.has(id)){ selected.delete(id); b.classList.remove('on'); } else { selected.add(id); b.classList.add('on'); }
});
window.onPhotoSaved = async (p, cap) => {
  if(!me || !selected.size || !p) return false;
  const img = await shrink(p.blob);
  await Promise.all([...selected].map(fid => post(fid, { kind: 'photo', img, text: cap || '' }, '📷 รูปภาพ')));
  selected.clear(); return true;
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
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act]'); if(!t) return;
  const act = t.dataset.act, id = t.dataset.id;
  if(!configured && act !== 'noop'){ toast('ต้องตั้งค่า firebase-config.js ก่อน'); return; }
  try{
    if(act === 'login') await signIn();
    else if(act === 'logout'){ if(confirm('ออกจากระบบ?')) await A.signOut(auth); }
    else if(act === 'setname'){ await claimUsername(); await syncProfile(); renderAll(); }
    else if(act === 'addfriend') await addFriend();
    else if(act === 'accept') await F.updateDoc(F.doc(db, 'friendships', id), { status: 'accepted' });
    else if(act === 'remove'){ if(t.dataset.confirm && !confirm('ลบเพื่อนคนนี้?')) return; await F.deleteDoc(F.doc(db, 'friendships', id)); }
    else if(act === 'openconv') openConvo(id);
    else if(act === 'openreq') $('#sheetBg').classList.add('on');
  }catch(err){ toast('ทำรายการไม่สำเร็จ: ' + (err.code || err.message)); }
});
$('#btnCompose').onclick = () => $('#sheetBg').classList.add('on');
$('#fsInput').addEventListener('keydown', e => { if(e.key === 'Enter') addFriend(); });

init();
