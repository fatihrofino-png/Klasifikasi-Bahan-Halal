// api/_lib/lhln.js — pencocokan penerbit sertifikat ke daftar 126 LHLN (Tiket 12e).
// Normalisasi nama (huruf, singkatan, tanda baca) + fuzzy match (Jaccard token
// + kemiripan substring). Ambang cocok: skor >= 0.8. Di bawah itu: tidak cocok,
// kembalikan nama terdekat berlabel "kemiripan, bukan kecocokan pasti".
// Status MRA: SELALU "belum terverifikasi" (Tiket 12f — lihat MRA-NOTE.md).
// Pemetaan lingkup Indonesia <-> Inggris (tabel ditulis di sini + komentar):
// nilai lingkup di daftar LHLN berbahasa Inggris (dipisah " | ").
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Tabel pemetaan istilah lingkup Indonesia -> istilah Inggris di daftar LHLN.
// Dibangun dari nilai lingkup yang benar-benar ada di CSV (126 baris, dicek 15 Nov 2026):
// Food, Beverages, Cosmetics, Chemical products, Drugs/Pharmaceuticals,
// Slaughtering services, Biological products, Processing services,
// Storage services, Consumer Goods, Distribution services, Packaging services,
// Genetically modified organism (GMO) products, Drugs, Sales services, Serving services.
// Catatan: "Slaughtering services" vs "Slaughtering Services" (kapitalisasi)
// dinormalisasi ke satu bentuk. "Drugs" (2 baris) dianggap sama dengan
// "Drugs/Pharmaceuticals" karena merujuk kategori obat yang sama.
const SCOPE_MAP = [
  { id: [/makanan|food/i], en: 'Food' },
  { id: [/minuman|beverage/i], en: 'Beverages' },
  { id: [/kosmetik|cosmetic/i], en: 'Cosmetics' },
  { id: [/kimia|chemical/i], en: 'Chemical products' },
  { id: [/obat|farmasi|pharma|drug/i], en: 'Drugs/Pharmaceuticals' },
  { id: [/penyembelih|slaughter/i], en: 'Slaughtering services' },
  { id: [/biolog/i], en: 'Biological products' },
  { id: [/pengolahan|processing/i], en: 'Processing services' },
  { id: [/penyimpanan|storage/i], en: 'Storage services' },
  { id: [/barang gunaan|barang konsumsi|consumer goods/i], en: 'Consumer Goods' },
  { id: [/distribusi|distribution/i], en: 'Distribution services' },
  { id: [/kemasan|packaging/i], en: 'Packaging services' },
  { id: [/gmo|rekayasa genetik|genetically modified/i], en: 'Genetically modified organism (GMO) products' },
  { id: [/penjualan|sales/i], en: 'Sales services' },
  { id: [/penyajian|serving/i], en: 'Serving services' },
];

function normalizeScopeToken(s) {
  const t = String(s || '').trim();
  if (/^slaughtering services$/i.test(t)) return 'Slaughtering services';
  if (/^chemical products$/i.test(t)) return 'Chemical products';
  if (/^drugs$/i.test(t)) return 'Drugs/Pharmaceuticals';
  return t;
}

// Petakan teks lingkup bebas (ID atau EN) ke daftar istilah EN daftar LHLN.
function mapScopeText(text) {
  const out = [];
  const src = String(text || '');
  for (const { id, en } of SCOPE_MAP) {
    if (id.some((re) => re.test(src)) && !out.includes(en)) out.push(en);
  }
  return out;
}

function normName(s) {
  return String(s || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Singkatan umum penerbit -> bentuk panjang (membantu fuzzy match).
const ABBR = { hqc: 'halal quality control', lppom: 'lppom', mui: 'mui' };

// Akhiran bentuk badan hukum — dihapus saat pencocokan karena tidak membedakan
// lembaga ("Halal Quality Control BV" == "Halal Quality Control Netherlands").
const LEGAL_SUFFIX = new Set([
  'bv', 'gmbh', 'ltd', 'ltda', 'sa', 'sl', 'inc', 'llc', 'pty',
  'co', 'company', 'sdn', 'bhd', 'pte', 'ag', 'nv', 'sarl', 'as',
]);

function tokensOf(name) {
  return normName(name).split(' ').filter(Boolean)
    .map((t) => ABBR[t] || t)
    .filter((t) => !LEGAL_SUFFIX.has(t));
}

function similarity(a, b) {
  const ta = new Set(tokensOf(a));
  const tb = new Set(tokensOf(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const jaccard = inter / new Set([...ta, ...tb]).size;
  // Bonus bila satu nama mengandung nama lain utuh (mis. "halal quality
  // control netherlands" mengandung "halal quality control").
  const na = normName(a);
  const nb = normName(b);
  const contain = (na.includes(nb) || nb.includes(na)) ? 0.15 : 0;
  // Bonus awalan token (mis. "mui" vs "muis") agar nama terdekat tetap
  // bermakna meski tidak ada token yang sama persis.
  let prefix = 0;
  for (const x of ta) {
    for (const y of tb) {
      if (x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x))) { prefix = 0.2; break; }
    }
    if (prefix) break;
  }
  return Math.min(1, jaccard + contain + prefix);
}

let _lhln = null;
function loadLhln(file) {
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!_lhln) {
    _lhln = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '_data', 'lhln.json'), 'utf8'));
  }
  return _lhln;
}

const MATCH_THRESHOLD = 0.8;

function matchIssuer(namaPenerbit, list) {
  list = list || loadLhln();
  let best = null;
  let bestScore = 0;
  for (const row of list) {
    const s = similarity(namaPenerbit, row.nama_lhln);
    if (s > bestScore) { bestScore = s; best = row; }
  }
  if (best && bestScore >= MATCH_THRESHOLD) {
    return {
      cocok: true,
      nomor_urut: best.no,
      nama_di_daftar: best.nama_lhln,
      nama_terdekat: best.nama_lhln,
      skor_kemiripan: Math.round(bestScore * 100) / 100,
      alamat: best.alamat,
      lingkup_daftar: best.lingkup.map(normalizeScopeToken),
      masa_berlaku_lhln: best.masa_berlaku,
    };
  }
  return {
    cocok: false,
    nomor_urut: null,
    nama_di_daftar: null,
    nama_terdekat: best ? best.nama_lhln : null,
    skor_kemiripan: Math.round(bestScore * 100) / 100,
    catatan: 'kemiripan, bukan kecocokan pasti',
  };
}

// Bandingkan lingkup sertifikat (sudah dipetakan ke EN) dengan lingkup LHLN.
function assessScope(lingkupSertifikat, lingkupDaftar) {
  const cert = (lingkupSertifikat || []).map(normalizeScopeToken);
  const daftar = (lingkupDaftar || []).map(normalizeScopeToken);
  if (!cert.length) {
    return { penilaian: 'tidak dapat dinilai', sertifikat: cert, daftar, alasan: 'Lingkup sertifikat tidak terbaca dari dokumen.' };
  }
  const cocokSemua = cert.every((c) => daftar.includes(c));
  const cocokSebagian = cert.some((c) => daftar.includes(c));
  if (cocokSemua) return { penilaian: 'sesuai', sertifikat: cert, daftar };
  if (cocokSebagian) {
    return {
      penilaian: 'tidak sesuai', sertifikat: cert, daftar,
      alasan: 'Sebagian lingkup sertifikat tidak termasuk dalam lingkup pengakuan LHLN: '
        + cert.filter((c) => !daftar.includes(c)).join(', '),
    };
  }
  return {
    penilaian: 'tidak sesuai', sertifikat: cert, daftar,
    alasan: 'Lingkup sertifikat tidak termasuk dalam lingkup pengakuan LHLN.',
  };
}

// Nilai masa berlaku terhadap tanggal hari ini (default: sekarang).
// masih berlaku / segera habis (< 90 hari) / kedaluwarsa.
// "null"/kosong (mis. MUIS No.97) -> tidak dapat dinilai.
function assessExpiry(tanggalBerakhir, now = new Date()) {
  const raw = String(tanggalBerakhir || '').trim();
  if (!raw || raw.toLowerCase() === 'null') {
    return { penilaian: 'tidak dapat dinilai', tanggal: null, alasan: 'Masa berlaku tidak tercantum di data.' };
  }
  const t = new Date(raw + 'T00:00:00Z');
  if (Number.isNaN(t.getTime())) {
    return { penilaian: 'tidak dapat dinilai', tanggal: raw, alasan: 'Format tanggal tidak dapat dibaca.' };
  }
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const diffHari = Math.round((t.getTime() - today.getTime()) / 86400000);
  if (diffHari < 0) return { penilaian: 'kedaluwarsa', tanggal: raw, sisa_hari: diffHari };
  if (diffHari < 90) return { penilaian: 'segera habis', tanggal: raw, sisa_hari: diffHari };
  return { penilaian: 'masih berlaku', tanggal: raw, sisa_hari: diffHari };
}

module.exports = {
  SCOPE_MAP, mapScopeText, normalizeScopeToken, normName, similarity,
  loadLhln, matchIssuer, assessScope, assessExpiry, MATCH_THRESHOLD,
  MRA_STATUS: 'belum terverifikasi', // Tiket 12f — jangan diubah tanpa data BPJPH.
};
