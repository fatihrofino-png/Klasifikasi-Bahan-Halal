// api/ask.js — POST /api/ask (Tiket 12g, PRD §11.7).
// Pertanyaan (maks 2.000 char) -> retrieval korpus -> bila korpus tidak memuat
// jawaban, jawab "tidak ditemukan di regulasi yang tersedia" TANPA memanggil
// LLM (hemat kuota, anti-karangan). Bila ada potongan relevan -> cek kuota
// (SEBELUM LLM) -> LLM jawab + sitasi.
'use strict';

const { CONFIG } = require('./_lib/config');
const { retrieve, loadCorpus, loadMeta, cariDokumenBelumMasuk } = require('./_lib/corpus');
const { generateJson } = require('./_lib/llm');
const { buildAskPrompt } = require('./_lib/prompt');
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

  const body = ctx.jsonBody || {};
  const question = String(body.question || '');
  if (!question.trim()) return common.fail(400, 'pertanyaan_kosong', CONFIG.MSG_PERTANYAAN_KOSONG);
  if (question.length > CONFIG.MAX_QUESTION_CHARS) {
    return common.fail(400, 'pertanyaan_terlalu_panjang', CONFIG.MSG_PERTANYAAN_TERLALU_PANJANG);
  }

  // Caveat dulu: bila pertanyaan menyebut regulasi yang terdaftar di JDIH
  // tetapi teks resminya belum tersedia di korpus (mis. Kepkaban 378/2026,
  // 370/2026, PP 40/2026), JANGAN jawab dari potongan regulasi lain yang
  // mirip (mis. 301/2026 yang sudah diubah 378/2026) — beri caveat spesifik
  // dan arahkan ke JDIH, tanpa memanggil LLM dan tanpa mengarang isi.
  const belumMasuk = cariDokumenBelumMasuk(question);
  if (belumMasuk.length) {
    logEvent('ask.dokumen_belum_masuk', { user_id: user.id, dokumen: belumMasuk[0].id });
    const d = belumMasuk[0];
    return common.ok({
      provider: null,
      jawaban: `${d.judul} sudah terdaftar di JDIH BPJPH, tetapi teks resminya belum tersedia di korpus kami sehingga isinya belum bisa dijawab dari regulasi. Silakan baca dokumen resminya di JDIH BPJPH${d.sumber_url ? ' (' + d.sumber_url + ')' : ''} atau tanyakan langsung ke BPJPH/LPH terdekat.`,
      sitasi: [],
      ditemukan: false,
      dokumen_belum_masuk: belumMasuk.map((x) => ({
        nama: x.judul, nomor: x.nomor, tahun: x.tahun, sumber_url: x.sumber_url || null,
      })),
      kuota_sisa: null, // kuota tidak terpakai: LLM tidak dipanggil
    });
  }

  // Retrieval dulu: tanpa potongan relevan, JANGAN panggil LLM.
  // Ambang relevansi (diukur ulang 16 Nov 2026, korpus v2): pertanyaan di
  // luar korpus skor teratas 8,5–22,5 ("rendang daging sapi" 22,49 —
  // 387/2026 memuat daftar produk daging); pertanyaan dalam korpus skor
  // teratas 31,6–88,9. Ambang 25 duduk di celah pemisah. Di bawah 25 ->
  // tidak ditemukan, tanpa memanggil LLM (hemat kuota + anti-karangan
  // dari potongan lemah).
  const potongan = retrieve(question, 5, loadCorpus());
  const MIN_SKOR_RELEVAN = 25;
  if (!potongan.length || potongan[0].skor < MIN_SKOR_RELEVAN) {
    logEvent('ask.tidak_ditemukan', { user_id: user.id });
    return common.ok({
      provider: null,
      jawaban: `${CONFIG.MSG_TIDAK_DITEMUKAN}. Silakan tanyakan langsung ke BPJPH atau Lembaga Pemeriksa Halal (LPH) terdekat, atau periksa dokumen resmi di JDIH BPJPH (https://jdih.halal.go.id).`,
      sitasi: [],
      ditemukan: false,
      kuota_sisa: null, // kuota tidak terpakai: LLM tidak dipanggil
    });
  }

  let kuota;
  try {
    kuota = await checkQuota({ userId: user.id, jenis: 'ask' });
  } catch {
    return common.fail(502, 'kuota_gagal', 'Gagal memeriksa kuota. Silakan coba lagi.');
  }
  if (!kuota.configured) return common.errBelumDikonfigurasi();
  if (!kuota.boleh) {
    logSecurity('kuota_habis', { jenis: 'ask', user_id: user.id });
    return common.errKuotaHabis();
  }

  let hasil;
  let provider = null;
  try {
    const meta = loadMeta();
    const r = await generateJson(buildAskPrompt({
      question,
      potonganKorpus: potongan,
      pembaruan: meta.pembaruan || [],
    }));
    provider = r.provider;
    hasil = r.parsed;
  } catch (e) {
    await logUsage({ userId: user.id, jenis: 'ask', provider, berhasil: false });
    return common.mapError(e);
  }

  // Sitasi: korpus otoritatif + sitasi LLM yang tautannya valid.
  const sitasi = common.gabungSitasi(hasil.sitasi, potongan);
  const ditemukan = !!hasil.ditemukan && sitasi.length > 0;
  await logUsage({ userId: user.id, jenis: 'ask', provider, berhasil: true });
  logEvent('ask.selesai', { user_id: user.id, provider, ditemukan });

  return common.ok({
    provider,
    jawaban: ditemukan ? hasil.jawaban : `${CONFIG.MSG_TIDAK_DITEMUKAN}. Silakan tanyakan langsung ke BPJPH atau Lembaga Pemeriksa Halal (LPH) terdekat.`,
    sitasi: ditemukan ? sitasi : [],
    ditemukan,
    kuota_sisa: { per_pengguna: kuota.sisa_pengguna, global: kuota.sisa_global },
  });
}

async function vercelHandler(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const rawBody = Buffer.concat(chunks);
  const ctx = {
    method: req.method,
    headers: req.headers || {},
    query: {},
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
