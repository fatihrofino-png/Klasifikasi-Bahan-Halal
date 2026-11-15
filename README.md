# Klasifikasi Bahan Halal BPJPH

Website publik yang membantu penyelia halal menentukan klasifikasi suatu bahan:
**wajib bersertifikat halal** atau masuk **positive list** (dikecualikan).

- Jargon: *Klasifikasi Bahan, Tanpa Ragu*
- Pencarian bahan mencakup sinonim, nama Inggris, dan nama dagang, menampilkan nomor CAS.
- 4.574 bahan positive list, 1.404 jenis produk wajib, 126 Lembaga Halal Luar Negeri (LHLN).
- Bahasa: Indonesia, English, العربية, 中文. Mode gelap/terang.

## Dasar hukum

- Kepkaban BPJPH No. 20 Tahun 2023 (5 kriteria SJPH)
- Kepkaban BPJPH No. 301 Tahun 2026 (positive list / dikecualikan)
- Kepkaban BPJPH No. 387 Tahun 2026 (jenis produk wajib bersertifikat halal)

## Deploy

Situs statis — cukup `index.html` di root. Deploy gratis misalnya via
[Vercel](https://vercel.com) (Import Project dari repo ini) atau GitHub Pages.
Tidak butuh server; pencarian sinonim/CAS live memakai PubChem (client-side).

## Fase 2 — Analisis Dokumen & Sertifikat (Vercel Serverless Functions)

Fitur AI (upload CoA/MSDS, tempel-teks, cek sertifikat halal, Tanya Jawab)
hidup di folder `api/` (Node.js). Link muse.ai tetap versi statis (tanpa Fase 2);
versi lengkap di Vercel (`cek-bahan.vercel.app`).

- Endpoint: `POST /api/analyze`, `POST /api/verify-certificate`, `POST /api/ask`
  (semua JSON; butuh login Supabase — tanpa token menjawab 401 "daftar dulu").
- LLM: Gemini `gemini-3-flash-preview` (utama) → Groq `openai/gpt-oss-120b`
  (cadangan bila 429/5xx). Kunci HANYA di Environment Variables Vercel
  (`GEMINI_API_KEY`, `GROQ_API_KEY`) — tidak ada di kode/repo.
- Klasifikasi dihitung LOKAL dari `api/_data/lookup.json` (4.574 positive list +
  1.404 jenis produk wajib); LLM hanya mengekstrak nama bahan + CAS.
- Kuota freemium: 10 analisis/hari/pengguna, 100/hari global, reset tengah malam
  waktu Pasifik; dihitung atomik via RPC Supabase `cek_dan_catat_kuota`.
- Privasi: file dihapus dari memori setelah analisis, tidak disimpan. Sesuai
  ketentuan tier gratis Google, input/output dapat dipakai Google untuk
  peningkatan layanan — jangan unggah dokumen yang sangat rahasia.
- Status MRA LHLN: "belum terverifikasi" (BPJPH tidak menerbitkan status MRA
  per lembaga di sumber publik — lihat `hidden_files/fase2-tests/MRA-NOTE.md`).
- Environment Variables server (Vercel): `GEMINI_API_KEY`, `GROQ_API_KEY`,
  `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (service
  key HANYA di server). Tanpa env Supabase, endpoint AI menjawab 503 jujur.
- `config.public.js` hanya berisi `SUPABASE_URL` + `SUPABASE_ANON_KEY`
  (anon key boleh di client); isi setelah project Supabase dibuat.

## Pembaruan data

File ini diekspor dari Muse. Bila ada perubahan klasifikasi/regulasi,
minta pembaruan lalu ganti `index.html` dengan hasil export terbaru.

## Kontak

Rofik — Microbiology Supervisor & Site Halal Coordinator, Haleon.
WhatsApp: https://wa.me/628999099708 · Instagram: @rofinoai ·
LinkedIn: https://www.linkedin.com/in/rofik
