// api/analyze.js — POST /api/analyze (Tiket 12a/12b/12c/12d).
// Mode upload: raw bytes PDF (?mode=upload). Mode teks: JSON {mode:"text", text}.
// Alur: auth -> validasi input -> retrieval korpus -> cek kuota (SEBELUM LLM)
// -> LLM ekstrak bahan+CAS -> klasifikasi LOKAL (LLM tidak mengklasifikasi)
// -> aturan RSHLN -> respons JSON. File hanya in-memory, dibuang setelah pakai.
'use strict';

const { CONFIG } = require('./_lib/config');
const { extractPdf } = require('./_lib/extract');
const { retrieve, loadCorpus } = require('./_lib/corpus');
const { classifyIngredient, loadLookup } = require('./_lib/classify');
const { generateJson } = require('./_lib/llm');
const { buildAnalyzePrompt } = require('./_lib/prompt');
const { verifyAuth } = require('./_lib/auth');
const { getSupabase, checkQuota, logUsage } = require('./_lib/quota');
const { logEvent, logSecurity } = require('./_lib/log');
const common = require('./_lib/common');

async function handle(ctx) {
  if (ctx.method !== 'POST') return common.methodNotAllowed();
  let user;
  try {
    user = await verifyAuth(ctx, getSupabase());
  } catch (e) { return common.mapError(e); }

  // --- 1. Ambil + validasi input (sebelum kuota & LLM) ---
  let teks = '';
  try {
    if (ctx.query && ctx.query.mode === 'upload') {
      const { text, chars } = await extractPdf(ctx.rawBody);
      teks = text;
      logEvent('analyze.file_diekstrak', { chars, user_id: user.id });
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
    return common.fail(400, 'teks_kosong', 'Tidak ada teks yang dapat dianalisis dari dokumen ini.');
  }

  // --- 2. Grounding korpus (lokal, tanpa LLM) ---
  const korpus = loadCorpus();
  const potongan = retrieve(teks.slice(0, 4000), 5, korpus);

  // --- 3. Kuota SEBELUM LLM ---
  let kuota;
  try {
    kuota = await checkQuota({ userId: user.id, jenis: 'analyze' });
  } catch {
    return common.fail(502, 'kuota_gagal', 'Gagal memeriksa kuota. Silakan coba lagi.');
  }
  if (!kuota.configured) return common.errBelumDikonfigurasi();
  if (!kuota.boleh) {
    logSecurity('kuota_habis', { jenis: 'analyze', user_id: user.id });
    return common.errKuotaHabis();
  }

  // --- 4. LLM: HANYA ekstrak bahan + CAS + titik kritis + rekomendasi ---
  let hasil;
  let provider = null;
  try {
    const lookup = loadLookup();
    const prompt = buildAnalyzePrompt({ teks: teks.slice(0, 20000), potonganKorpus: potongan, ringkasan: lookup.ringkasan });
    const r = await generateJson(prompt);
    provider = r.provider;
    hasil = r.parsed;
  } catch (e) {
    await logUsage({ userId: user.id, jenis: 'analyze', provider, berhasil: false });
    return common.mapError(e);
  } finally {
    // File/teks user dibuang dari memori setelah dipakai.
    teks = '';
    ctx.rawBody = null;
    logEvent('analyze.file_dihapus', { user_id: user.id });
  }

  // --- 5. Klasifikasi LOKAL (menimpa apa pun yang LLM klaim) ---
  const bahan = [];
  const bahanTidakDikenali = [...(hasil.bahan_tidak_dikenali || [])];
  for (const b of hasil.bahan || []) {
    const klas = classifyIngredient({ nama: b.nama, cas: b.cas });
    if (klas.tak_dikenali && !b.cas) {
      bahanTidakDikenali.push({ nama: b.nama, alasan: 'Nama tidak ada di lampiran 301/387 dan tidak ada CAS yang cocok.' });
      continue;
    }
    bahan.push({
      nama: b.nama,
      cas: b.cas || klas.cas_lampiran || null,
      cas_sumber: b.cas_sumber || (b.cas ? 'dokumen' : (klas.cas_lampiran ? 'lampiran' : 'tidak tercantum')),
      status: klas.status,
      dasar_hukum: klas.dasar_hukum,
      kategori: klas.kategori || '',
      kelompok: klas.kelompok || '',
      jenis_produk: klas.jenis_produk || null,
      asal: b.asal || null,
      titik_kritis: b.titik_kritis || 'belum terverifikasi',
      rekomendasi_aksi: Array.isArray(b.rekomendasi_aksi) ? b.rekomendasi_aksi : [],
    });
  }

  // --- 6. Aturan kondisional RSHLN (§11.5): luar negeri + ada yang Wajib ---
  const manufakturLuar = !!hasil.manufaktur_luar_negeri;
  const adaWajib = bahan.some((b) => b.status === 'Wajib');
  const rshln = manufakturLuar && adaWajib;

  // --- 7. Sitasi: korpus otoritatif + sitasi LLM yang tautannya valid ---
  const sitasi = common.gabungSitasi(hasil.sitasi, potongan);

  await logUsage({ userId: user.id, jenis: 'analyze', provider, berhasil: true });
  logEvent('analyze.selesai', {
    user_id: user.id, provider, jumlah_bahan: bahan.length,
    ada_wajib: adaWajib, rshln,
    kuota_sisa_pengguna: kuota.sisa_pengguna, kuota_sisa_global: kuota.sisa_global,
  });

  return common.ok({
    provider,
    bahan,
    bahan_tidak_dikenali: bahanTidakDikenali,
    inkonsistensi: Array.isArray(hasil.inkonsistensi) ? hasil.inkonsistensi : [],
    manufaktur_luar_negeri: manufakturLuar,
    rshln,
    rshln_catatan: rshln
      ? 'Bahan Wajib dari manufaktur luar negeri memerlukan Sertifikat Halal Luar Negeri, yang harus diregistrasi ke BPJPH melalui RSHLN (Registrasi Sertifikat Halal Luar Negeri). Periksa penerbit sertifikat di daftar 126 Lembaga Halal Luar Negeri di website ini.'
      : null,
    sitasi,
    kuota_sisa: { per_pengguna: kuota.sisa_pengguna, global: kuota.sisa_global },
  });
}

// Adapter Vercel (Node.js Serverless Function): baca raw stream apa adanya.
// Tidak ada body parser framework — raw bytes PDF dibaca langsung dari stream.
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
