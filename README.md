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

## Pembaruan data

File ini diekspor dari Muse. Bila ada perubahan klasifikasi/regulasi,
minta pembaruan lalu ganti `index.html` dengan hasil export terbaru.

## Kontak

Rofik — Microbiology Supervisor & Site Halal Coordinator, Haleon.
WhatsApp: https://wa.me/628999099708 · Instagram: @rofinoai ·
LinkedIn: https://www.linkedin.com/in/rofik
