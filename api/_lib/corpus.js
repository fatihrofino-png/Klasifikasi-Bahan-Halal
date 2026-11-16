// api/_lib/corpus.js — retrieval korpus regulasi v2 (16 Nov 2026).
// Arsitektur: indeks tingkat-DOKUMEN (corpus-index.json, ~0,5 MB) + file
// chunk per dokumen (corpus-chunks/<doc-id>.json), lazy-load hanya 2-4
// dokumen kandidat per pertanyaan. Rumus skor, STOPWORDS, EXPANSIONS,
// ukuran potongan (1200) dan label Pasal/BAB/Lampiran/Diktum dipertahankan
// identik dengan v1 (port retrieval.py) agar hasil sebanding; DF frasa
// perluasan disimpan di indeks (frasa_df) supaya IDF frasa sama persis.
// Dokumen berstatus "tidak berlaku": skor chunk x 0,5 + penanda status.
// Korpus v2: 14 dokumen (lihat api/_data/corpus-meta.json).
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STOPWORDS = new Set(
  ('yang di ke dari dan atau pada untuk dengan dalam adalah ini itu sebagai oleh '
    + 'karena apabila jika maka serta juga tidak ada dapat bisa akan telah sudah '
    + 'merupakan tentang terhadap antara setiap semua suatu para saat ketika lalu '
    + 'agar supaya yakni yaitu bahwa dengan demikian hal tersebut nomor tahun '
    + 'tentang bagi tanpa melalui atas bawah sebelum sesudah setelah selama')
    .split(' '),
);

// Perluasan istilah domain -> frasa yang dicari juga di korpus.
const EXPANSIONS = {
  umkm: ['usaha mikro', 'mikro', 'kecil', 'pelaku usaha mikro dan kecil', 'self declare'],
  rshln: ['registrasi sertifikat halal luar negeri', 'sertifikat halal luar negeri',
    'registrasi sertifikat', 'lembaga halal luar negeri'],
  sjph: ['sistem jaminan produk halal', 'kriteria sistem jaminan produk halal',
    'kriteria sjph'],
  sertifikasi: ['sertifikat halal', 'sertifikasi halal', 'kewajiban bersertifikat halal'],
  syarat: ['persyaratan', 'syarat', 'ketentuan', 'kriteria'],
  label: ['label halal', 'logo halal'],
  bahan: ['bahan yang dikecualikan', 'positive list'],
  wajib: ['wajib bersertifikat halal', 'jenis produk yang wajib'],
  'luar negeri': ['produk halal luar negeri', 'pemastian kesesuaian'],
};

// Jumlah dokumen kandidat yang chunk-nya dimuat per pertanyaan.
const MAX_DOC_KANDIDAT = 4;
// Penalti skor untuk potongan dari dokumen berstatus tidak berlaku.
const PENALTI_TIDAK_BERLAKU = 0.5;

const PASAL_RE = /(Pasal\s+\d+[A-Za-z]?(?:\s*ayat\s*\(\d+\))?)/i;
const BAB_RE = /\b(BAB\s+[IVXLCDM]+)\b/i;
const LAMPIRAN_RE = /\b(LAMPIRAN(?:\s+[IVXLCDM]+)?)\b/i;
const DIKTUM_RE = /\b(KESATU|KEDUA|KETIGA|KEEMPAT|KELIMA|KEENAM|KETUJUH|KEDELAPAN)\b/;

function tokenize(text) {
  const toks = (text.toLowerCase().match(/[a-z0-9]+/g) || []);
  return toks.filter((t) => !STOPWORDS.has(t) && t.length > 1);
}

const DATA_DIR = path.join(__dirname, '..', '_data');

let _meta = null;
function loadMeta() {
  if (!_meta) {
    _meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'corpus-meta.json'), 'utf8'));
  }
  return _meta;
}

// Kompatibilitas: pemanggil lama memakai loadCorpus() + retrieve(q, 5, korpus).
// v2 tidak lagi memuat teks lengkap; loadCorpus() kini mengembalikan metadata.
function loadCorpus() {
  return loadMeta();
}

let _index = null;
function loadIndex() {
  if (!_index) {
    _index = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'corpus-index.json'), 'utf8'));
  }
  return _index;
}

const _chunkCache = new Map();
function loadDocChunks(docId) {
  if (!_chunkCache.has(docId)) {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'corpus-chunks', docId + '.json'), 'utf8'));
    _chunkCache.set(docId, data.chunks);
  }
  return _chunkCache.get(docId);
}

function chunkText(teks, maxChars = 1200) {
  const paras = teks.split('\n').map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length + 1 > maxChars) { chunks.push(cur.trim()); cur = p; }
    else cur = cur ? cur + ' ' + p : p;
  }
  if (cur) chunks.push(cur.trim());
  return chunks;
}

function labelPotongan(potongan) {
  let m = PASAL_RE.exec(potongan);
  if (m) return m[1].trim();
  m = DIKTUM_RE.exec(potongan);
  if (m) return 'Diktum ' + m[1].charAt(0) + m[1].slice(1).toLowerCase();
  m = LAMPIRAN_RE.exec(potongan);
  if (m) return m[1].trim().replace(/\b\w/g, (c) => c.toUpperCase());
  m = BAB_RE.exec(potongan);
  if (m) return m[1].trim();
  return '';
}

function expandQuery(query) {
  const q = query.toLowerCase();
  const tokens = tokenize(q);
  const phrases = [];
  for (const [key, vals] of Object.entries(EXPANSIONS)) {
    if (q.includes(key)) phrases.push(...vals);
  }
  return { tokens, phrases };
}

// Peringkat dokumen kandidat dari posting-list tingkat-dokumen (IDF dokumen)
// + kehadiran frasa perluasan (frasa_docs) + kecocokan judul. Frasa dan
// judul HARUS ikut: tanpa itu, dokumen kecil yang spesifik (mis. PMA 20/2021
// untuk UMKM, SE 2/2026 untuk RSHLN) kalah dari dokumen besar yang sekadar
// memuat token umum — diukur 16 Nov 2026 (debug-retrieval-v2).
function kandidatDokumen(tokens, phrases, index, meta, topK = MAX_DOC_KANDIDAT) {
  const nDocs = index.jumlah_dokumen;
  const idfDoc = (dc) => Math.log((nDocs + 1) / (dc + 1)) + 1.0;
  const skorDoc = new Map();
  const tambah = (di, s) => skorDoc.set(di, (skorDoc.get(di) || 0) + s);
  for (const t of new Set(tokens)) {
    const ent = index.istilah[t];
    if (!ent) continue;
    const s = idfDoc(ent.docs.length);
    for (const di of ent.docs) tambah(di, s);
  }
  const frasaDocs = index.frasa_docs || {};
  for (const fr of new Set(phrases || [])) {
    const docs = frasaDocs[fr];
    if (!docs) continue;
    const s = 2.0 * idfDoc(docs.length);
    for (const di of docs) tambah(di, s);
  }
  if (meta) {
    for (const t of new Set(tokens)) {
      if (t.length <= 3) continue;
      meta.dokumen.forEach((d, di) => { if (d.judul.toLowerCase().includes(t)) tambah(di, 0.5); });
    }
    for (const fr of new Set(phrases || [])) {
      meta.dokumen.forEach((d, di) => { if (d.judul.toLowerCase().includes(fr)) tambah(di, 1.0); });
    }
  }
  return [...skorDoc.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([di]) => di);
}

// Dokumen yang disebut eksplisit di pertanyaan ("PerBPJPH 4 tahun 2026",
// "378/2026", "PP 42/2024") — nomor+tahun dicocokkan ke metadata.
function dokumenDisebut(pertanyaan, meta) {
  const disebut = new Set();
  const pola = /\b(\d{1,3})\s*(?:\/|tahun\s*)(\d{4})\b/gi;
  let m;
  while ((m = pola.exec(pertanyaan)) !== null) {
    const nomor = String(parseInt(m[1], 10));
    const tahun = m[2];
    meta.dokumen.forEach((d, di) => {
      if (String(parseInt(d.nomor, 10)) === nomor && String(d.tahun) === tahun) disebut.add(di);
    });
  }
  return disebut;
}

function retrieve(pertanyaan, topN = 5, _korpus) {
  // _korpus diabaikan (kompatibilitas pemanggil v1); sumber kebenaran v2
  // adalah corpus-index.json + corpus-chunks/.
  const index = loadIndex();
  const meta = loadMeta();
  const { tokens, phrases } = expandQuery(pertanyaan);
  if (!tokens.length && !phrases.length) return [];
  const docIdx = kandidatDokumen(tokens, phrases, index, meta);
  // Dokumen yang disebut eksplisit SELALU jadi kandidat (di luar top-4):
  // tanpa ini, dokumen yang ditanya langsung bisa tersingkir oleh dokumen
  // besar yang sekadar mengutipnya (diukur 16 Nov 2026: PerBPJPH 4/2026
  // kalah dari 328/2026 yang mengutipnya di mana-mana).
  const disebut = dokumenDisebut(pertanyaan, meta);
  for (const di of disebut) if (!docIdx.includes(di) && docIdx.length < 6) docIdx.push(di);
  if (!docIdx.length) return [];

  const nChunks = index.total_chunk;
  const idf = (t) => {
    const ent = index.istilah[t];
    return Math.log((nChunks + 1) / ((ent ? ent.df : 0) + 1)) + 1.0;
  };
  const frasaDf = index.frasa_df || {};
  const phraseIdf = (fr) => Math.log((nChunks + 1) / ((frasaDf[fr] || 0) + 1)) + 1.0;

  const hasil = [];
  for (const di of docIdx) {
    const d = meta.dokumen[di];
    const chunks = loadDocChunks(d.id);
    // Penalti dokumen dicabut TIDAK berlaku bila dokumen itu sendiri yang
    // ditanyakan (pengguna berhak melihat aturannya + penanda statusnya);
    // dokumen yang disebut eksplisit mendapat dorongan kecil (x1,15).
    const dinamai = disebut.has(di);
    const penalti = (d.status === 'tidak berlaku' && !dinamai) ? PENALTI_TIDAK_BERLAKU : 1.0;
    const dorongan = dinamai ? 1.15 : 1.0;
    const judulLow = d.judul.toLowerCase();
    chunks.forEach((ch, i) => {
      const c = ch.teks;
      const cLow = c.toLowerCase();
      const cToks = tokenize(c);
      const cSet = new Set(cToks);
      let skor = 0;
      const cocok = [];
      for (const t of tokens) {
        if (cSet.has(t)) {
          const count = Math.min(cToks.filter((x) => x === t).length, 3);
          skor += idf(t) * (1 + count * 0.3);
          cocok.push(t);
        }
      }
      for (const fr of phrases) {
        if (cLow.includes(fr)) { skor += 2.0 * phraseIdf(fr); cocok.push(fr); }
      }
      for (const t of tokens) if (t.length > 3 && judulLow.includes(t)) skor += 0.5;
      for (const fr of phrases) if (judulLow.includes(fr)) skor += 1.0;
      if (skor <= 0) return;
      skor *= penalti * dorongan;
      hasil.push({
        skor: Math.round(skor * 100) / 100,
        dokumen_id: d.id,
        jenis: d.jenis,
        nomor: d.nomor,
        tahun: d.tahun,
        judul: d.judul,
        tanggal_ditetapkan: d.tanggal_ditetapkan,
        status: d.status,
        dicabut_oleh: d.dicabut_oleh || null,
        diubah_oleh: d.diubah_oleh || null,
        pasal: ch.pasal || labelPotongan(c),
        potongan: c.slice(0, 1200),
        kata_cocok: [...new Set(cocok)].sort(),
        tautan_jdih: d.tautan_jdih || null,
        sumber_url: d.sumber_url || null,
      });
    });
  }
  hasil.sort((a, b) => b.skor - a.skor);
  return hasil.slice(0, topN);
}

// Sitasi terstruktur dari satu hasil retrieval (kontrak §3).
function sitasiDariHasil(h) {
  return {
    nama: `${h.jenis} Nomor ${h.nomor} Tahun ${h.tahun}`,
    nomor: h.nomor,
    tahun: h.tahun,
    pasal: h.pasal || '',
    tautan: h.tautan_jdih || h.sumber_url || '',
  };
}

// Dokumen yang teks resminya belum tersedia (registry): bila pertanyaan
// menyebut nomornya, kembalikan entrinya agar ask.js bisa memberi caveat
// spesifik alih-alih jawaban generik — tanpa mengarang isi.
function cariDokumenBelumMasuk(pertanyaan) {
  const meta = loadMeta();
  const q = ` ${pertanyaan.toLowerCase()} `;
  return (meta.dokumen_belum_masuk || []).filter((d) => {
    const nomor = String(d.nomor);
    const pola = new RegExp(`\\b${nomor}\\s*(?:tahun\\s*)?${d.tahun}\\b|\\b${nomor}/${d.tahun}\\b`, 'i');
    return pola.test(pertanyaan) || q.includes(` ${nomor} `) && q.includes(`${d.tahun}`);
  });
}

module.exports = {
  STOPWORDS, EXPANSIONS, tokenize, loadCorpus, loadMeta, loadIndex,
  loadDocChunks, kandidatDokumen, dokumenDisebut, chunkText,
  labelPotongan, expandQuery, retrieve, sitasiDariHasil,
  cariDokumenBelumMasuk, MAX_DOC_KANDIDAT, PENALTI_TIDAK_BERLAKU,
};
