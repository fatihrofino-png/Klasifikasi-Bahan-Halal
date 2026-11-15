// api/_lib/classify.js — klasifikasi LOKAL dari lookup.json (kontrak §5).
// LLM TIDAK PERNAH mengklasifikasi: ia hanya mengekstrak nama + CAS.
// Aturan (sama seperti Fase 1, Tiket 4):
//   ada di positive_list (nama/CAS) -> Dikecualikan (Kepkaban 301/2026)
//   nama cocok judul jenis produk 387 -> Wajib (Kepkaban 387/2026)
//   tidak ada di keduanya -> Belum Diatur
// Gliserin TIDAK ada di lampiran 301 (grep 14 Nov 2026) -> Belum Diatur.
// Pencocokan Wajib konservatif (D4): nama bahan harus menjadi token/frasa
// dalam judul jenis_produk/klasifikasi; bila ragu -> Belum Diatur.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function norm(s) {
  if (!s) return '';
  return String(s).toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normCas(cas) {
  if (!cas) return null;
  const m = String(cas).trim().match(/^(\d{2,7})-(\d{2})-(\d)$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

let _lookup = null;
function loadLookup(file) {
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!_lookup) {
    _lookup = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '_data', 'lookup.json'), 'utf8'));
  }
  return _lookup;
}

function matchWajib(namaNorm, lookup) {
  if (!namaNorm) return null;
  const tokens = namaNorm.split(' ');
  let best = null;
  for (const w of lookup.wajib) {
    const judul = w.judul_norm;
    // Nama bahan utuh muncul sebagai frasa dalam judul, atau semua token
    // nama (yg panjang > 2) muncul dalam judul.
    const frasa = judul.includes(namaNorm);
    const semuaToken = tokens.every((t) => t.length <= 2 || judul.includes(t));
    if (frasa || (tokens.length >= 1 && semuaToken && tokens.some((t) => t.length > 3))) {
      // Pilih judul terpendek yang cocok (paling spesifik).
      if (!best || judul.length < best.judul_norm.length) best = w;
    }
  }
  return best;
}

function classifyIngredient({ nama, cas }, lookup) {
  lookup = lookup || loadLookup();
  const namaNorm = norm(nama);
  const casNorm = normCas(cas);

  // 1) Positive list — cek CAS dulu (paling pasti), lalu nama/alias.
  let pos = null;
  if (casNorm && lookup.positive_by_cas[casNorm]) pos = lookup.positive_by_cas[casNorm];
  if (!pos && namaNorm && lookup.positive_by_name[namaNorm]) pos = lookup.positive_by_name[namaNorm];
  if (pos) {
    return {
      status: 'Dikecualikan',
      dasar_hukum: 'Keputusan Kepala BPJPH Nomor 301 Tahun 2026',
      kategori: pos.kategori || '',
      kelompok: pos.kelompok || '',
      nama_lampiran: pos.nama_id,
      nama_en: pos.nama_en || null,
      cas_lampiran: pos.cas || null,
      tak_dikenali: false,
    };
  }

  // 2) Wajib 387 — pencocokan konservatif ke judul jenis produk.
  const w = matchWajib(namaNorm, lookup);
  if (w) {
    return {
      status: 'Wajib',
      dasar_hukum: 'Keputusan Kepala BPJPH Nomor 387 Tahun 2026',
      kategori: w.kategori,
      jenis_produk: w.jenis_produk,
      klasifikasi: w.klasifikasi,
      tak_dikenali: false,
    };
  }

  // 3) Tidak ada di keduanya. "Tak dikenali" = tidak ada di lampiran dan
  // tidak ada CAS yang bisa dilacak (mis. nama asing tanpa CAS).
  // Bahan dikenal (punya CAS/nama jelas) tapi belum diatur tetap
  // "Belum Diatur", bukan "tak dikenali" — mis. gliserin (CAS 56-81-5).
  return {
    status: 'Belum Diatur',
    dasar_hukum: 'Keputusan Kepala BPJPH Nomor 20 Tahun 2023 (dokumen pendukung diperlukan)',
    kategori: '',
    tak_dikenali: !casNorm,
    dokumen_pendukung: ['CoA', 'alur proses produksi', 'komposisi bahan'],
  };
}

module.exports = { norm, normCas, loadLookup, matchWajib, classifyIngredient };
