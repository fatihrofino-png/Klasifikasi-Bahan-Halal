// api/_lib/common.js — pembantu bersama handler: bentuk respons JSON yang
// konsisten (api_design) + pemetaan error ke pesan aman (tidak ada stack trace,
// nama tabel, atau potongan kunci di respons produksi).
'use strict';

const { CONFIG } = require('./config');

function ok(body, status = 200) {
  return { status, body: { ok: true, ...body } };
}

function fail(status, error, message) {
  return { status, body: { ok: false, error, message } };
}

function errDaftarDulu() {
  return fail(401, 'daftar_dulu', CONFIG.MSG_DAFTAR_DULU);
}

function errBelumDikonfigurasi() {
  return fail(503, 'belum_dikonfigurasi', CONFIG.MSG_BELUM_DIKONFIGURASI);
}

function errKuotaHabis() {
  return fail(429, 'kuota_habis', CONFIG.QUOTA_EXCEEDED_MESSAGE);
}

function errLlmGagal() {
  return fail(502, 'llm_gagal', CONFIG.MSG_LLM_GAGAL);
}

// Terjemahkan error yang dilempar lib/handler ke respons aman.
function mapError(e) {
  if (e && e.code === 'bukan_pdf') return fail(400, 'bukan_pdf', CONFIG.MSG_FILE_BUKAN_PDF);
  if (e && e.code === 'terlalu_besar') return fail(413, 'terlalu_besar', CONFIG.MSG_FILE_TERLALU_BESAR);
  if (e && e.code === 'gagal_ekstrak') return fail(400, 'gagal_ekstrak', e.message);
  if (e && e.status === 401 && e.error === 'daftar_dulu') return errDaftarDulu();
  if (e && e.status === 503 && e.error === 'belum_dikonfigurasi') return errBelumDikonfigurasi();
  if (e && e.status === 502) return errLlmGagal();
  return errLlmGagal();
}

function methodNotAllowed() {
  return fail(405, 'method_tidak_diizinkan', 'Metode tidak diizinkan.');
}

// Gabung sitasi LLM + sitasi korpus yang benar-benar dipakai sebagai konteks.
// Aturan: sitasi korpus bersifat otoritatif (nama/nomor/tahun/tautan dari data).
// Sitasi LLM HANYA dipakai bila tautannya URL http(s) valid; sitasi LLM tanpa
// tautan/tahun (LLM sering mengisi "-" atau null) dibuang — kalau tidak,
// respons menampilkan sitasi rusak seperti {tahun:null, tautan:"-"}.
function gabungSitasi(sitasiLlm, potonganKorpus) {
  const { sitasiDariHasil } = require('./corpus');
  const seen = new Set();
  const out = [];
  const push = (s) => {
    const nomor = String(s.nomor || '');
    const tahun = s.tahun || null;
    const pasal = s.pasal || '';
    const tautan = s.tautan || '';
    if (!nomor) return;
    const k = `${nomor}|${tahun}|${pasal}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ nama: s.nama || '', nomor, tahun, pasal, tautan });
  };
  for (const h of (potonganKorpus || []).slice(0, 3)) push(sitasiDariHasil(h));
  for (const s of (sitasiLlm || [])) {
    if (!s || typeof s.tautan !== 'string' || !/^https?:\/\//.test(s.tautan)) continue;
    push(s);
  }
  return out;
}

module.exports = { ok, fail, errDaftarDulu, errBelumDikonfigurasi, errKuotaHabis, errLlmGagal, mapError, methodNotAllowed, gabungSitasi };
