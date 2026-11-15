// api/_lib/quota.js — penghitung kuota freemium (Tiket 11b + tambahan kontrak RPC).
// PRODUKSI: WAJIB memakai RPC atomik public.cek_dan_catat_kuota (satu transaksi,
// anti-race; tanggal dihitung dalam zona America/Los_Angeles di dalam RPC).
// JANGAN PERNAH menulis tabel kuota_pengguna / kuota_global langsung.
// RPC dipanggil SEBELUM LLM (D2): p_provider=null karena provider baru
// diketahui setelah panggilan LLM; setelah LLM selesai, logUsage() menyisipkan
// SATU baris log_pemakaian dengan provider sebenarnya — itu tabel LOG, bukan
// tabel kuota, jadi tidak melanggar larangan di atas.
// HARNESS LOKAL (tanpa Supabase): counter file via env FASE2_QUOTA_FILE.
// Tanpa Supabase DAN tanpa file lokal -> {configured:false}; handler menjawab 503.
'use strict';

const fs = require('node:fs');
const { CONFIG } = require('./config');
const { logEvent } = require('./log');

let _supabase = null;
let _supabaseTried = false;

function getSupabase() {
  if (_supabaseTried) return _supabase;
  _supabaseTried = true;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const { createClient } = require('@supabase/supabase-js');
    _supabase = createClient(url, key, { auth: { persistSession: false } });
  } catch {
    _supabase = null;
  }
  return _supabase;
}

// Tanggal "hari ini" dalam zona waktu Pasifik (reset tengah malam Pasifik).
function todayPacific() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CONFIG.QUOTA_RESET_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// --- Counter file lokal (HANYA harness tes; JANGAN dipakai di Vercel) ---
function readLocalCounter(file) {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (d.tanggal !== todayPacific()) return { tanggal: todayPacific(), global: 0, users: {}, log: [] };
    return { tanggal: d.tanggal, global: d.global || 0, users: d.users || {}, log: d.log || [] };
  } catch { return { tanggal: todayPacific(), global: 0, users: {}, log: [] }; }
}
function writeLocalCounter(file, data) {
  fs.writeFileSync(file, JSON.stringify(data), 'utf8');
}

async function checkQuota({ userId, jenis, supabase }) {
  const sb = supabase === undefined ? getSupabase() : supabase;
  if (sb) {
    const { data, error } = await sb.rpc('cek_dan_catat_kuota', {
      p_user_id: userId,
      p_jenis: jenis,
      p_provider: null,
      p_berhasil: true,
      p_batas_pengguna: CONFIG.QUOTA_PER_USER_PER_DAY,
      p_batas_global: CONFIG.QUOTA_GLOBAL_PER_DAY,
    });
    if (error) {
      logEvent('kuota.rpc_gagal', { jenis, berhasil: false });
      throw new Error('Gagal memeriksa kuota.');
    }
    return {
      boleh: !!data.boleh,
      sisa_pengguna: data.sisa_pengguna,
      sisa_global: data.sisa_global,
      configured: true,
    };
  }
  const file = process.env.FASE2_QUOTA_FILE;
  if (file) {
    const c = readLocalCounter(file);
    const usedUser = c.users[userId] || 0;
    if (c.global >= CONFIG.QUOTA_GLOBAL_PER_DAY || usedUser >= CONFIG.QUOTA_PER_USER_PER_DAY) {
      return {
        boleh: false,
        sisa_pengguna: Math.max(CONFIG.QUOTA_PER_USER_PER_DAY - usedUser, 0),
        sisa_global: Math.max(CONFIG.QUOTA_GLOBAL_PER_DAY - c.global, 0),
        configured: true,
      };
    }
    c.global += 1;
    c.users[userId] = usedUser + 1;
    writeLocalCounter(file, c);
    return {
      boleh: true,
      sisa_pengguna: CONFIG.QUOTA_PER_USER_PER_DAY - c.users[userId],
      sisa_global: CONFIG.QUOTA_GLOBAL_PER_DAY - c.global,
      configured: true,
    };
  }
  return { configured: false, boleh: false, sisa_pengguna: 0, sisa_global: 0 };
}

async function logUsage({ userId, jenis, provider, berhasil, supabase }) {
  const sb = supabase === undefined ? getSupabase() : supabase;
  try {
    if (sb) {
      await sb.from('log_pemakaian').insert({
        user_id: userId, jenis, provider: provider || null, berhasil: !!berhasil,
      });
      return;
    }
    const file = process.env.FASE2_QUOTA_FILE;
    if (file) {
      const c = readLocalCounter(file);
      c.log.push({ ts: new Date().toISOString(), user_id: userId, jenis, provider, berhasil: !!berhasil });
      writeLocalCounter(file, c);
    }
  } catch {
    // Log tidak boleh menggagalkan respons user.
    logEvent('kuota.log_gagal', { jenis });
  }
}

module.exports = { getSupabase, checkQuota, logUsage, todayPacific };
