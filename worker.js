// Auan push relay — Cloudflare Worker (free plan, no credit card)
// Variables (Settings → Variables and Secrets):
//   FIREBASE_PROJECT_ID  (text)   e.g. auan-da695
//   VAPID_PUBLIC_KEY     (text)
//   VAPID_PRIVATE_KEY    (SECRET)
//   VAPID_SUBJECT        (text)   e.g. mailto:you@gmail.com
//   ALLOWED_ORIGIN       (text)   e.g. https://vcrcletime.github.io
//
// How it works: after a message is written, the sender's app calls POST /notify with its
// Firebase ID token. The Worker re-reads the chat + message from Firestore *using that token*
// (so Firestore rules prove the sender really is a member and really wrote the message),
// then sends a Web Push (VAPID + aes128gcm) to the other members' devices.

const enc = new TextEncoder();
const b64uToBytes = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while(s.length % 4) s += '='; const bin = atob(s); const u = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const bytesToB64u = b => { let s = ''; for(const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const concat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for(const x of a){ o.set(x, p); p += x.length; } return o; };

async function hkdf(salt, ikm, info, len){
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

// RFC 8291 (Web Push message encryption, aes128gcm)
async function encryptPayload(sub, payloadBytes){
  const uaPub = b64uToBytes(sub.keys.p256dh), auth = b64uToBytes(sub.keys.auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(payloadBytes, new Uint8Array([2]))));
  return concat(salt, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([asPub.length]), asPub, ct);
}

// RFC 8292 (VAPID)
async function vapidAuth(endpoint, env){
  const header = bytesToB64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:admin@example.com' })));
  const pub = b64uToBytes(env.VAPID_PUBLIC_KEY);
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: bytesToB64u(pub.slice(1, 33)), y: bytesToB64u(pub.slice(33, 65)), d: env.VAPID_PRIVATE_KEY, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(header + '.' + claims)));
  return `vapid t=${header}.${claims}.${bytesToB64u(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

async function sendPush(sub, payload, env){
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(payload)));
  const r = await fetch(sub.endpoint, { method: 'POST', headers: { Authorization: await vapidAuth(sub.endpoint, env), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '300', Urgency: 'high' }, body });
  return r.status;
}

// Firestore REST helpers (requests carry the caller's ID token, so Firestore rules apply)
function fv(v){
  if('stringValue' in v) return v.stringValue; if('integerValue' in v) return Number(v.integerValue); if('doubleValue' in v) return v.doubleValue;
  if('booleanValue' in v) return v.booleanValue; if('timestampValue' in v) return v.timestampValue; if('nullValue' in v) return null;
  if('arrayValue' in v) return (v.arrayValue.values || []).map(fv); if('mapValue' in v) return fmap(v.mapValue.fields || {}); return null;
}
const fmap = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fv(v)]));
async function getDoc(env, token, path){
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`, { headers: { Authorization: 'Bearer ' + token } });
  if(r.status === 404) return null;
  if(!r.ok){ const e = new Error('firestore ' + r.status); e.status = r.status; throw e; }
  return fmap((await r.json()).fields || {});
}
function jwtUid(token){
  try{ const p = JSON.parse(new TextDecoder().decode(b64uToBytes(token.split('.')[1]))); return p.user_id || p.sub || null; }catch(e){ return null; }
}
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const json = (o, status, cors) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...cors } });

async function notify(req, env, cors){
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if(!token) return json({ error: 'no token' }, 401, cors);
  let b; try{ b = await req.json(); }catch(e){ return json({ error: 'bad json' }, 400, cors); }
  const { type, id, mid } = b || {};
  const okId = s => typeof s === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(s);
  if(!['dm', 'g'].includes(type) || !okId(id) || !okId(mid)) return json({ error: 'bad request' }, 400, cors);
  const uid = jwtUid(token); if(!uid) return json({ error: 'bad token' }, 401, cors);
  const col = type === 'g' ? 'groups' : 'friendships';
  try{
    const chat = await getDoc(env, token, `${col}/${id}`);
    if(!chat || !Array.isArray(chat.members) || !chat.members.includes(uid)) return json({ error: 'not a member' }, 403, cors);
    if(type === 'dm' && chat.status !== 'accepted') return json({ error: 'not friends' }, 403, cors);
    const msg = await getDoc(env, token, `${col}/${id}/messages/${mid}`);
    if(!msg || msg.from !== uid) return json({ error: 'message not found' }, 403, cors);
    if(msg.ts && Date.now() - Date.parse(msg.ts) > 5 * 60 * 1000) return json({ error: 'too old' }, 410, cors);
    const sender = await getDoc(env, token, `users/${uid}`); const sname = clip((sender && sender.name) || 'เพื่อน', 40);
    const isPhoto = msg.kind === 'photo', text = clip(msg.text, 140);
    let title, body;
    if(type === 'g'){ title = clip(chat.name || 'กลุ่ม', 40); body = isPhoto ? `${sname} ส่งรูปภาพมา${text ? ': ' + text : ''}` : `${sname}: ${text}`; }
    else { title = sname; body = isPhoto ? `ส่งรูปภาพมา${text ? ': ' + text : ''}` : text; }
    const payload = { title, body, tag: `${type}:${id}`, chat: { type, id } };
    const recipients = chat.members.filter(m => m !== uid);
    const docs = await Promise.all(recipients.map(r => getDoc(env, token, `pushSubs/${r}`).catch(() => null)));
    const subs = docs.flatMap(d => (d && Array.isArray(d.subs) ? d.subs : [])).map(s => { try{ return JSON.parse(s); }catch(e){ return null; } }).filter(s => s && s.endpoint && s.keys);
    const results = await Promise.all(subs.map(s => sendPush(s, payload, env).catch(() => 0)));
    return json({ sent: results.filter(c => c >= 200 && c < 300).length, total: subs.length }, 200, cors);
  }catch(e){
    return json({ error: e.message || 'error' }, e.status === 401 || e.status === 403 ? 403 : 500, cors);
  }
}

export default {
  async fetch(req, env){
    const allow = env.ALLOWED_ORIGIN || '*';
    const cors = { 'Access-Control-Allow-Origin': allow, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
    if(req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if(req.method === 'GET') return new Response('Auan push relay OK', { headers: cors });
    const origin = req.headers.get('Origin');
    if(env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) return json({ error: 'origin' }, 403, cors);
    if(new URL(req.url).pathname !== '/notify' || req.method !== 'POST') return json({ error: 'not found' }, 404, cors);
    return notify(req, env, cors);
  }
};
