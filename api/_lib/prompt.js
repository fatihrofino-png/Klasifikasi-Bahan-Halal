// api/_lib/prompt.js — system prompt + skema JSON (Tiket 12c, 12e, 12g).
// Aturan keras: LLM HANYA mengekstrak nama bahan + CAS + penerbit/lingkup/
// masa berlaku. Klasifikasi dihitung LOKAL (classify.js). Setiap klaim
// faktual WAJIB punya sitasi dari korpus; bila tidak ada -> "tidak ditemukan
// di regulasi yang tersedia". Gliserin TIDAK ada di lampiran 301.
'use strict';

const { CONFIG } = require('./config');

const ATURAN_GROUNDING = [
  'Jawablah HANYA dari potongan regulasi dan ringkasan data yang diberikan di bawah.',
  'Pengetahuan umummu TIDAK boleh dipakai sebagai sumber fakta.',
  'Setiap klaim faktual WAJIB disertai sitasi (nama + nomor regulasi + pasal/lampiran).',
  'Bila suatu informasi tidak ada di potongan yang diberikan, tulis "belum terverifikasi" — JANGAN mengarang.',
  'Gliserin (glycerol, CAS 56-81-5) TIDAK ada di lampiran Kepkaban 301/2026 — jangan pernah mengklaimnya ada di positive list.',
  'Semua teks jawaban dalam Bahasa Indonesia.',
].join('\n');

function buildAnalyzePrompt({ teks, potonganKorpus, ringkasan }) {
  const korpus = (potonganKorpus || []).map((h, i) =>
    `[${i + 1}] ${h.jenis} Nomor ${h.nomor} Tahun ${h.tahun}${h.pasal ? ' — ' + h.pasal : ''}\n${h.potongan}`).join('\n\n');
  const sjph = (ringkasan.kriteria_sjph_20_2023 || []).map((k) => `- ${k.nama}: ${k.uraian}`).join('\n');
  const dikecualikan = (ringkasan.kriteria_dikecualikan_301 || []).map((k, i) => `${i + 1}. ${k}`).join('\n');
  return {
    system:
      'Kamu adalah asisten penyelia halal. Tugasmu HANYA mengekstrak bahan dan CAS dari dokumen/teks berikut, '
      + 'lalu menjelaskan titik kritis dan rekomendasi aksi berdasarkan kriteria SJPH. '
      + 'Kamu TIDAK menentukan klasifikasi (itu dihitung sistem dari lampiran resmi). '
      + 'Keluarkan HANYA JSON valid sesuai skema, tanpa teks lain.\n' + ATURAN_GROUNDING,
    user:
      `TEKS DOKUMEN:\n${teks}\n\n`
      + `RINGKASAN REGULASI (untuk titik kritis & rekomendasi):\n`
      + `5 kriteria SJPH (Kepkaban 20/2023):\n${sjph}\n\n`
      + `9 kriteria bahan dikecualikan (Kepkaban 301/2026):\n${dikecualikan}\n\n`
      + `Klasifikasi 301: ${ringkasan.klasifikasi_301.join('; ')}.\n`
      + `Kategori wajib 387: ${ringkasan.kategori_387.join(', ')}.\n\n`
      + `POTONGAN KORPUS RELEVAN:\n${korpus || '(tidak ada potongan relevan)'}\n\n`
      + 'TUGAS — kembalikan JSON dengan bentuk persis ini:\n'
      + '{\n'
      + '  "bahan": [{"nama": "...", "cas": "56-81-5 atau null", "cas_sumber": "dokumen|tidak tercantum",\n'
      + '    "asal": "nama produsen/negara bila tertulis, atau null",\n'
      + '    "titik_kritis": "risiko sumber/proses/kontaminasi + apa yang diperiksa + dokumen pembukti, berakar ke kriteria SJPH; bila tidak terverifikasi tulis \\"belum terverifikasi\\"",\n'
      + '    "rekomendasi_aksi": [{"prioritas": "wajib|disarankan|opsional", "aksi": "..."}]\n'
      + '  }],\n'
      + '  "bahan_tidak_dikenali": [{"nama": "...", "alasan": "..."}],\n'
      + '  "inkonsistensi": [{"jenis": "nama-vs-CAS|lainnya", "penjelasan": "...", "yang_perlu_dilengkapi": "..."}],\n'
      + '  "manufaktur_luar_negeri": true|false,\n'
      + '  "sitasi": [{"nama": "Keputusan Kepala BPJPH Nomor 301 Tahun 2026", "nomor": "301", "pasal": "Lampiran"}, ...]\n'
      + '}\n'
      + 'Aturan: bahan yang namanya tidak jelas/tidak ada CAS dan tidak dikenali masuk "bahan_tidak_dikenali", bukan "bahan". '
      + 'Bila CAS di dokumen tidak cocok dengan nama bahan (mis. CAS gliserin tertulis pada bahan lain), laporkan di "inkonsistensi". '
      + '"manufaktur_luar_negeri": true bila produsen/negara asal di luar Indonesia tertulis di teks.',
  };
}

function buildCertificatePrompt({ teks, potonganKorpus }) {
  const korpus = (potonganKorpus || []).map((h, i) =>
    `[${i + 1}] ${h.jenis} Nomor ${h.nomor} Tahun ${h.tahun}${h.pasal ? ' — ' + h.pasal : ''}\n${h.potongan}`).join('\n\n');
  return {
    system:
      'Kamu adalah asisten penyelia halal. Tugasmu HANYA mengekstrak tiga hal dari teks sertifikat berikut: '
      + 'nama penerbit (lembaga halal), lingkup sertifikat, dan masa berlaku (tanggal berakhir). '
      + 'Keluarkan HANYA JSON valid sesuai skema, tanpa teks lain.\n' + ATURAN_GROUNDING,
    user:
      `TEKS SERTIFIKAT:\n${teks}\n\n`
      + `POTONGAN KORPUS RELEVAN:\n${korpus || '(tidak ada potongan relevan)'}\n\n`
      + 'TUGAS — kembalikan JSON dengan bentuk persis ini:\n'
      + '{\n'
      + '  "penerbit": "nama lembaga persis seperti tertulis, atau null bila tidak terbaca",\n'
      + '  "lingkup": "teks lingkup persis seperti tertulis, atau null bila tidak terbaca",\n'
      + '  "masa_berlaku": "tanggal berakhir sertifikat format YYYY-MM-DD, atau null bila tidak terbaca",\n'
      + '  "nomor_sertifikat": "nomor sertifikat bila tertulis, atau null",\n'
      + '  "nama_pemegang": "nama perusahaan pemegang sertifikat bila tertulis, atau null",\n'
      + '  "sitasi": [{"nama": "...", "nomor": "...", "pasal": "..."}]\n'
      + '}\n'
      + 'Jangan menebak tanggal atau nama yang tidak tertulis. Bila tidak terbaca, isi null.',
  };
}

function buildAskPrompt({ question, potonganKorpus }) {
  const korpus = (potonganKorpus || []).map((h, i) =>
    `[${i + 1}] ${h.jenis} Nomor ${h.nomor} Tahun ${h.tahun}${h.pasal ? ' — ' + h.pasal : ''}\n${h.potongan}`).join('\n\n');
  return {
    system:
      'Kamu adalah asisten Tanya Jawab Halal. Jawablah pertanyaan HANYA dari potongan regulasi di bawah. '
      + 'Keluarkan HANYA JSON valid sesuai skema, tanpa teks lain.\n' + ATURAN_GROUNDING,
    user:
      `PERTANYAAN: ${question}\n\n`
      + `POTONGAN KORPUS RELEVAN:\n${korpus || '(tidak ada potongan relevan)'}\n\n`
      + 'TUGAS — kembalikan JSON dengan bentuk persis ini:\n'
      + '{\n'
      + '  "ditemukan": true|false,\n'
      + '  "jawaban": "jawaban Bahasa Indonesia. Bila tidak ditemukan, tulis persis: '
      + CONFIG.MSG_TIDAK_DITEMUKAN + '. Lalu sarankan langkah berikutnya (mis. tanyakan ke BPJPH/LPH).",\n'
      + '  "sitasi": [{"nama": "Undang-Undang Nomor 33 Tahun 2014", "nomor": "33", "pasal": "Pasal 2", "tautan": "https://..."}]\n'
      + '}\n'
      + 'Bila potongan korpus kosong atau tidak memuat jawaban: "ditemukan": false dan JANGAN mengarang isi regulasi.',
  };
}

// Parse respons LLM menjadi JSON: buang pagar ```json, ambil objek {...} pertama.
function parseJsonResponse(text) {
  if (typeof text !== 'string') throw new Error('Respons LLM bukan teks.');
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('Respons LLM bukan JSON.');
  return JSON.parse(t.slice(start, end + 1));
}

module.exports = {
  ATURAN_GROUNDING, buildAnalyzePrompt, buildCertificatePrompt,
  buildAskPrompt, parseJsonResponse,
};
