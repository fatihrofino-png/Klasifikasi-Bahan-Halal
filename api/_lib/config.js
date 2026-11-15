// api/_lib/config.js — SATU-SATUNYA tempat model ID + angka batas.
// Jangan hardcode angka/model di file lain. Semua angka di sini dicatat
// beserta sumber + tanggal pengecekan (Tiket 11a/11b).
'use strict';

const CONFIG = {
  // --- Model LLM (terverifikasi 15 Nov 2026 via helper list-models) ---
  // Gemini: 64 model terdaftar; gemini-3-flash-preview mendukung generateContent.
  GEMINI_MODEL: 'gemini-3-flash-preview',
  GEMINI_VERIFIED: '2026-11-15 (list-models: 64 model; generate uji "OK", 8 prompt token)',
  // Groq: 11 model terdaftar; tidak ada lagi model chat Llama di free tier.
  GROQ_MODEL: 'openai/gpt-oss-120b',
  GROQ_VERIFIED: '2026-11-15 (list-models: 11 model; generate uji "OK")',
  // Limit Groq (dashboard/console + CONNECTOR.md custom.groq, 15 Nov 2026):
  // gpt-oss-120b ~30 RPM, 1.000 RPD, 200.000 token/hari.
  GROQ_LIMITS: { rpm: 30, rpd: 1000, tpd: 200000 },
  // Limit Gemini: RPD TIDAK dipublikasi Google — hanya terlihat di dashboard
  // AI Studio dan "tidak dijamin" (ai.google.dev/gemini-api/docs/rate-limits,
  // dicek 15 Nov 2026; PRD §11.9). Karena itu batas situs dibuat KONSERVATIF.
  GEMINI_LIMITS: 'tidak dipublikasi Google (hanya di dashboard AI Studio); RPD per proyek, reset tengah malam Pasifik',

  // --- Batas input ---
  MAX_FILE_BYTES: 4 * 1024 * 1024, // 4 MB (PRD §11.3 butir 1; batas body Vercel 4,5 MB)
  MAX_TEXT_CHARS: 20000,           // tempel-teks (PRD §11.3 butir 2)
  MAX_QUESTION_CHARS: 2000,        // Tanya Jawab (PRD §11.3 butir 4)

  // --- Kuota freemium (Tiket 11b; KONSERVATIF, ditinjau setelah 1 minggu) ---
  // Sumber: RPD Gemini tidak dipublikasi (lihat atas); Groq 1.000 RPD.
  // Angka situs (10/pengguna, 100/global) jauh di bawah kapasitas gabungan
  // kedua free tier agar satu pengguna tidak menghabiskan kuota proyek.
  QUOTA_PER_USER_PER_DAY: 10,
  QUOTA_GLOBAL_PER_DAY: 100,
  QUOTA_RESET_ZONE: 'America/Los_Angeles', // reset tengah malam waktu Pasifik
  QUOTA_EXCEEDED_MESSAGE:
    'Batas analisis harian sudah habis. Kuota direset tengah malam waktu Pasifik ' +
    '(sekitar pukul 15.00 WIB). Silakan coba lagi besok.',
  QUOTA_REVIEW_NOTE: 'Angka ditinjau setelah 1 minggu pemakaian (Tiket 11b).',

  // --- Privasi free tier Google (Tiket 11a; TERVERIFIKASI dari dokumen resmi) ---
  // Sumber: "Gemini API Additional Terms of Service", berlaku 23 Mar 2026,
  // https://ai.google.dev/gemini-api/terms — bagian Unpaid Services:
  // "When you use Unpaid Services, including, for example, Google AI Studio
  // and the unpaid quota on Gemini API, Google uses the content you submit to
  // the Services and any generated responses to provide, improve, and develop
  // Google products and services and machine learning technologies..."
  // "human reviewers may read, annotate, and process your API input and output."
  // "Do not submit sensitive, confidential, or personal information to the
  // Unpaid Services." (Dikutip verbatim; dicek 15 Nov 2026.)
  // Pengecualian: EEA/Swiss/UK memakai ketentuan Paid Services untuk semua layanan.
  PRIVACY_GOOGLE_FREE_TIER:
    'Sesuai ketentuan tier gratis Google (Gemini API Additional Terms of Service, ' +
    'berlaku 23 Mar 2026, https://ai.google.dev/gemini-api/terms), data input/output ' +
    'dapat dipakai Google untuk peningkatan layanan dan dapat dibaca peninjau manusia. ' +
    'Karena itu jangan mengunggah dokumen yang sangat rahasia.',
  PRIVACY_GOOGLE_TERMS_URL: 'https://ai.google.dev/gemini-api/terms',
  PRIVACY_GOOGLE_VERIFIED: '2026-11-15 (kutipan verbatim dari dokumen resmi di atas)',

  // --- Vercel (Tiket 12a; diverifikasi dari docs resmi) ---
  // PRD §11.7 menyebut durasi maks 300 dtk — BENAR untuk Fluid Compute
  // (default proyek baru): docs vercel.com/docs/functions/configuring-functions/duration
  // (last_updated 2026-08-24, dibaca 15 Nov 2026): Hobby default & maksimum 300 dtk.
  // Kontrak memakai maxDuration 60: aman di Fluid (≤300) maupun klasik (maks 60),
  // dan satu panggilan LLM + parse PDF muat jauh di bawah 60 dtk.
  VERCEL_MAX_DURATION: 60,

  // --- Pesan umum (Bahasa Indonesia) ---
  MSG_DAFTAR_DULU: 'Silakan daftar atau login dulu untuk memakai fitur ini.',
  MSG_BELUM_DIKONFIGURASI:
    'Fitur AI belum aktif — konfigurasi server belum lengkap. Silakan coba lagi nanti.',
  MSG_FILE_BUKAN_PDF: 'File harus berformat PDF. Silakan unggah file PDF.',
  MSG_FILE_TERLALU_BESAR: 'Ukuran file melebihi batas 4 MB. Silakan unggah file yang lebih kecil.',
  MSG_TEKS_KOSONG: 'Teks tidak boleh kosong.',
  MSG_TEKS_TERLALU_PANJANG: 'Teks melebihi batas 20.000 karakter. Silakan persingkat atau bagi menjadi beberapa analisis.',
  MSG_PERTANYAAN_KOSONG: 'Pertanyaan tidak boleh kosong.',
  MSG_PERTANYAAN_TERLALU_PANJANG: 'Pertanyaan melebihi batas 2.000 karakter. Silakan persingkat pertanyaan Anda.',
  MSG_LLM_GAGAL: 'Layanan analisis sedang tidak tersedia. Silakan coba lagi beberapa saat lagi.',
  MSG_TIDAK_DITEMUKAN: 'tidak ditemukan di regulasi yang tersedia',
};

module.exports = { CONFIG };
