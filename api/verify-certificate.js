// api/verify-certificate.js — POST /api/verify-certificate (Tiket 12e).
// Ekstrak penerbit/lingkup/masa berlaku (LLM) -> cocokkan LOKAL ke lhln.json,
// nilai lingkup (pemetaan ID<->EN) + masa berlaku vs hari ini.
// MRA: "terverifikasi" bila penerbit cocok di daftar LHLN BPJPH
// (koreksi 15 Nov 2026, Rofik); bila tidak cocok, "belum terverifikasi".
'use strict';

const { CONFIG } = require('./_lib/config');
const { extractPdf } = require('./_lib/extract');
const { retrieve, loadCorpus } = require('./_lib/corpus');
const { generateJson } = require('./_lib/llm');
const { buildCertificatePrompt } = require('./_lib/prompt');
const { verifyAuth } = require('./_lib/auth');
const { getSupabase, checkQuota, logUsage } = require('./_lib/quota');
const { logEvent, logSecurity } = require('./_lib/log');
const {
  matchIssuer, mapScopeText, assessScope, assessExpiry, loadLhln, mraStatus,
} = require('./_lib/lhln');
const common = require('./_lib/common');

async function handle(ctx) {
  if (ctx.method !== 'POST') return common.methodNotAllowed();
  let user;
  try {
    user = await verifyAuth(ctx, getSupabase());
  } catch (e) { return common.mapError(e); }

  let teks = '';
  try {
    if (ctx.query && ctx.query.mode === 'upload') {
      const r = await extractPdf(ctx.rawBody);
      teks = r.text;
      logEvent('verify.file_diekstrak', { chars: r.chars, user_id: user.id });
    } else {
      const body = ctx.jsonBody || {};
      if (body.mode !== 'text') {
        return common.fail(400, 'mode_tidak_valid', 'Mode harus "upload" atau "text".');
      }
      teks = String(body.text || '');
      if (!teks.trim()) return common.fail(400, 'teks_kosong', CONFIG.MSG_TEKS_KOSONG);
      if (teks.length > CONFIG.MAX_TEXT_CHARS) {
        return common.fail(400, 'teks_terlalu_panjang', CONFIG.MSG_TEKS_TERLALU_PANJANG);
      }
    }
  } catch (e) { return common.mapError(e); }
  if (!teks.trim()) {
    return common.fail(400, 'teks_kosong', 'Tidak ada teks yang dapat dibaca dari sertifikat ini.');
  }

  const potongan = retrieve(teks.slice(0, 4000), 5, loadCorpus());

  let kuota;
  try {
    kuota = await checkQuota({ userId: user.id, jenis: 'verify-certificate' });
  } catch {
    return common.fail(502, 'kuota_gagal', 'Gagal memeriksa kuota. Silakan coba lagi.');
  }
  if (!kuota.configured) return common.errBelumDikonfigurasi();
  if (!kuota.boleh) {
    logSecurity('kuota_habis', { jenis: 'verify-certificate', user_id: user.id });
    return common.errKuotaHabis();
  }

  let hasil;
  let provider = null;
  try {
    const r = await generateJson(buildCertificatePrompt({ teks: teks.slice(0, 20000), potonganKorpus: potongan }));
    provider = r.provider;
    hasil = r.parsed;
  } catch (e) {
    await logUsage({ userId: user.id, jenis: 'verify-certificate', provider, berhasil: false });
    return common.mapError(e);
  } finally {
    teks = '';
    ctx.rawBody = null;
    logEvent('verify.file_dihapus', { user_id: user.id });
  }

  // --- Pemeriksaan LOKAL (bukan LLM) ---
  const lhln = loadLhln();
  const penerbit = hasil.penerbit
    ? matchIssuer(hasil.penerbit, lhln)
    : { cocok: false, nomor_urut: null, nama_di_daftar: null, nama_terdekat: null, skor_kemiripan: 0, catatan: 'Penerbit tidak terbaca dari dokumen.' };
  const lingkupSertifikat = mapScopeText(hasil.lingkup || '');
  // Bila penerbit tidak ada di daftar, lingkup tidak dapat dibandingkan.
  const lingkup = penerbit.cocok
    ? assessScope(lingkupSertifikat, penerbit.lingkup_daftar)
    : { penilaian: 'tidak dapat dinilai', sertifikat: lingkupSertifikat, daftar: [], alasan: 'Penerbit tidak ada di daftar 126 LHLN, sehingga lingkup tidak dapat dibandingkan.' };
  const masaSertifikat = assessExpiry(hasil.masa_berlaku);
  const masaLhln = penerbit.cocok ? assessExpiry(penerbit.masa_berlaku_lhln) : { penilaian: 'tidak dapat dinilai', tanggal: null };
  const masaBerlaku = {
    sertifikat: masaSertifikat,
    lhln: masaLhln,
    penilaian: masaSertifikat.penilaian,
  };

  let ringkasan;
  if (!penerbit.cocok || masaSertifikat.penilaian === 'kedaluwarsa' || !hasil.penerbit) {
    ringkasan = 'tidak dapat diverifikasi';
  } else if (lingkup.penilaian === 'sesuai' && masaSertifikat.penilaian === 'masih berlaku') {
    ringkasan = 'dapat diterima';
  } else {
    ringkasan = 'perlu pemeriksaan lanjut';
  }

  const sitasi = common.gabungSitasi(hasil.sitasi, potongan);

  await logUsage({ userId: user.id, jenis: 'verify-certificate', provider, berhasil: true });
  logEvent('verify.selesai', {
    user_id: user.id, provider,
    penerbit_cocok: penerbit.cocok, lingkup: lingkup.penilaian,
    masa_berlaku: masaSertifikat.penilaian, ringkasan,
  });

  return common.ok({
    provider,
    penerbit: {
      nama: hasil.penerbit || null,
      cocok: penerbit.cocok,
      nomor_urut: penerbit.nomor_urut,
      nama_di_daftar: penerbit.nama_di_daftar,
      nama_terdekat: penerbit.nama_terdekat,
      skor_kemiripan: penerbit.skor_kemiripan,
      catatan: penerbit.catatan || null,
    },
    mra: mraStatus(penerbit.cocok), // masuk daftar LHLN = sudah MRA (koreksi 15 Nov 2026)
    lingkup: {
      sertifikat: lingkup.sertifikat,
      daftar: lingkup.daftar,
      penilaian: lingkup.penilaian,
      alasan: lingkup.alasan || null,
    },
    masa_berlaku: masaBerlaku,
    nomor_sertifikat: hasil.nomor_sertifikat || null,
    nama_pemegang: hasil.nama_pemegang || null,
    ringkasan,
    sitasi,
    kuota_sisa: { per_pengguna: kuota.sisa_pengguna, global: kuota.sisa_global },
  });
}

async function vercelHandler(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const rawBody = Buffer.concat(chunks);
  const url = new URL(req.url, 'http://localhost');
  const ctx = {
    method: req.method,
    headers: req.headers || {},
    query: Object.fromEntries(url.searchParams.entries()),
    rawBody: rawBody.length ? rawBody : null,
    jsonBody: null,
    contentType: req.headers['content-type'] || '',
  };
  if (ctx.contentType.includes('application/json') && rawBody.length) {
    try { ctx.jsonBody = JSON.parse(rawBody.toString('utf8')); } catch { ctx.jsonBody = null; }
  }
  const r = await handle(ctx);
  res.status(r.status).json(r.body);
}

module.exports = { handle };
module.exports.default = vercelHandler;
