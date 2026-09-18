// netlify/functions/ecosip.js
// Backend untuk website member ECOSIP.
// Semua data member disimpan permanen di Netlify Blobs (bukan di memori function,
// yang selalu hilang karena Netlify Functions itu "stateless").
// Login kasir memakai cookie HttpOnly yang ditandatangani (HMAC), jadi tidak perlu
// tabel sesi terpisah dan tidak bisa dipalsukan dari browser.

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const COOKIE_NAME = 'ecosip_kasir_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 jam kerja

function membersStore() {
  return getStore('ecosip-members');
}

function getSecret() {
  // Wajib diisi di Environment Variables Netlify (lihat panduan deploy).
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET belum diatur di Environment Variables.');
  return secret;
}

function sign(value) {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('hex');
}

function makeSessionToken() {
  const payload = `kasir.${Date.now() + SESSION_TTL_MS}`;
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

function verifySessionToken(token) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const sig = parts[2];
  const expected = sign(payload);
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expectedBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;
  const expiry = Number(parts[1]);
  return Date.now() < expiry;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function cookieHeaderSet(token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function cookieHeaderClear() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function isKasirAuthed(event) {
  const cookies = parseCookies(event.headers.cookie || event.headers.Cookie);
  return verifySessionToken(cookies[COOKIE_NAME]);
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[^0-9]/g, '');
}

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function newMember(nama, hp) {
  return { nama, hp, saldo: 0, riwayat: [] };
}

function formatTanggal() {
  return new Date().toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Ambil daftar akun kasir dari env var.
// Format env var CASHIER_ACCOUNTS (disarankan): "username1:password1,username2:password2"
// Kalau hanya CASHIER_USERNAME / CASHIER_PASSWORD yang diisi, itu tetap didukung (1 akun).
function getCashierAccounts() {
  const raw = process.env.CASHIER_ACCOUNTS;
  const accounts = {};
  if (raw) {
    raw.split(',').forEach(pair => {
      const [u, p] = pair.split(':');
      if (u && p) accounts[u.trim()] = p.trim();
    });
  }
  if (process.env.CASHIER_USERNAME && process.env.CASHIER_PASSWORD) {
    accounts[process.env.CASHIER_USERNAME.trim()] = process.env.CASHIER_PASSWORD.trim();
  }
  return accounts;
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Permintaan tidak valid.' });
  }

  const { action } = body;
  const store = membersStore();

  try {
    switch (action) {
      case 'register': {
        const nama = String(body.name || '').trim();
        const hp = normalizePhone(body.phone);
        if (!nama || hp.length < 9) {
          return json(400, { error: 'Nama dan No. HP yang valid wajib diisi.' });
        }
        const existing = await store.get(`member:${hp}`, { type: 'json' });
        if (existing) {
          return json(409, { error: 'No. HP ini sudah terdaftar. Silakan masuk.' });
        }
        const member = newMember(nama, hp);
        await store.setJSON(`member:${hp}`, member);
        return json(200, { member });
      }

      case 'login': {
        const hp = normalizePhone(body.phone);
        const member = await store.get(`member:${hp}`, { type: 'json' });
        if (!member) {
          return json(404, { error: 'No. HP belum terdaftar. Silakan daftar dulu.' });
        }
        return json(200, { member });
      }

      case 'get': {
        const hp = normalizePhone(body.phone);
        const member = await store.get(`member:${hp}`, { type: 'json' });
        if (!member) return json(404, { error: 'Member tidak ditemukan.' });
        return json(200, { member });
      }

      case 'profile': {
        const hp = normalizePhone(body.phone);
        const member = await store.get(`member:${hp}`, { type: 'json' });
        if (!member) return json(404, { error: 'Member tidak ditemukan.' });
        const namaBaru = String(body.name || '').trim();
        if (namaBaru) member.nama = namaBaru;
        await store.setJSON(`member:${hp}`, member);
        return json(200, { member });
      }

      case 'redeem': {
        const hp = normalizePhone(body.phone);
        const member = await store.get(`member:${hp}`, { type: 'json' });
        if (!member) return json(404, { error: 'Member tidak ditemukan.' });
        const cost = Number(body.cost) || 0;
        if (member.saldo < cost) return json(400, { error: 'Coin tidak cukup untuk reward ini.' });
        member.saldo -= cost;
        member.riwayat.push({ tanggal: formatTanggal(), keterangan: `Tukar: ${body.reward}`, coin: -cost });
        await store.setJSON(`member:${hp}`, member);
        return json(200, { member });
      }

      // ---------- KASIR (perlu login) ----------
      case 'cashierLogin': {
        const { username, password } = body;
        const accounts = getCashierAccounts();
        if (Object.keys(accounts).length === 0) {
          return json(500, { error: 'Akun kasir belum dikonfigurasi di server (Environment Variables).' });
        }
        const validUser = Object.prototype.hasOwnProperty.call(accounts, username);
        const passOk = validUser && safeEqual(accounts[username], password || '');
        if (!validUser || !passOk) {
          return json(401, { error: 'Username atau password salah.' });
        }
        const token = makeSessionToken();
        return json(200, { ok: true }, { 'Set-Cookie': cookieHeaderSet(token) });
      }

      case 'cashierLogout': {
        return json(200, { ok: true }, { 'Set-Cookie': cookieHeaderClear() });
      }

      case 'cashierStatus': {
        return json(200, { authenticated: isKasirAuthed(event) });
      }

      case 'find': {
        if (!isKasirAuthed(event)) return json(401, { error: 'Sesi kasir habis, silakan masuk lagi.' });
        const hp = normalizePhone(body.phone);
        const member = await store.get(`member:${hp}`, { type: 'json' });
        if (!member) return json(404, { error: 'Member dengan No. HP ini belum terdaftar.' });
        return json(200, { member });
      }

      case 'purchase': {
        if (!isKasirAuthed(event)) return json(401, { error: 'Sesi kasir habis, silakan masuk lagi.' });
        const hp = normalizePhone(body.phone);
        const member = await store.get(`member:${hp}`, { type: 'json' });
        if (!member) return json(404, { error: 'Member tidak ditemukan.' });
        const amount = Number(body.amount) || 0;
        if (amount <= 0) return json(400, { error: 'Nominal pembelian tidak valid.' });
        const earned = Math.floor(amount / 1000);
        member.saldo += earned;
        member.riwayat.push({ tanggal: formatTanggal(), keterangan: `Pembelian Rp${amount.toLocaleString('id-ID')}`, coin: earned });
        await store.setJSON(`member:${hp}`, member);
        return json(200, { member, earned });
      }

      default:
        return json(400, { error: 'Aksi tidak dikenali.' });
    }
  } catch (err) {
    console.error('ECOSIP function error:', err);
    return json(500, { error: 'Layanan sedang bermasalah. Silakan coba lagi.' });
  }
};
