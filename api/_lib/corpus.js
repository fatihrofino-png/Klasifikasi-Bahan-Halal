// api/_lib/corpus.js — port SETIA retrieval.py (Tiket 11c) ke JavaScript.
// Algoritma, STOPWORDS, EXPANSIONS, bobot IDF, ukuran potongan (1200),
// dan label Pasal/BAB/Lampiran/Diktum dipertahankan identik dengan Python
// agar hasil retrieval di server sama dengan hasil uji korpus.
// Korpus: api/_data/corpus.json (11 dokumen JDIH BPJPH, v1.1).
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

const PASAL_RE = /(Pasal\s+\d+[A-Za-z]?(?:\s*ayat\s*\(\d+\))?)/i;
const BAB_RE = /\b(BAB\s+[IVXLCDM]+)\b/i;
const LAMPIRAN_RE = /\b(LAMPIRAN(?:\s+[IVXLCDM]+)?)\b/i;
const DIKTUM_RE = /\b(KESATU|KEDUA|KETIGA|KEEMPAT|KELIMA|KEENAM|KETUJUH|KEDELAPAN)\b/;

function tokenize(text) {
  const toks = (text.toLowerCase().match(/[a-z0-9]+/g) || []);
  return toks.filter((t) => !STOPWORDS.has(t) && t.length > 1);
}

let _corpus = null;
function loadCorpus(file) {
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!_corpus) {
    _corpus = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '_data', 'corpus.json'), 'utf8'));
  }
  return _corpus;
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

function retrieve(pertanyaan, topN = 5, korpus) {
  korpus = korpus || loadCorpus();
  const { tokens, phrases } = expandQuery(pertanyaan);
  if (!tokens.length && !phrases.length) return [];
  const docs = korpus.dokumen;
  // Cache potongan + DF per objek korpus: korpus 1,2 jt karakter; membangun
  // ulang potongan/IDF tiap panggilan memakan detik di serverless.
  let cached = retrieve._cache;
  if (!cached || cached.korpus !== korpus) {
    const allChunks = [];
    for (const d of docs) {
      chunkText(d.teks).forEach((c, i) => allChunks.push([d, i, c]));
    }
    const df = {};
    for (const [, , c] of allChunks) {
      for (const t of new Set(tokenize(c))) df[t] = (df[t] || 0) + 1;
    }
    cached = retrieve._cache = { korpus, allChunks, df };
  }
  const { allChunks, df } = cached;
  const nChunks = allChunks.length;
  const idf = (t) => Math.log((nChunks + 1) / ((df[t] || 0) + 1)) + 1.0;
  const phraseDf = {};
  for (const fr of new Set(phrases)) {
    phraseDf[fr] = allChunks.filter(([, , c]) => c.toLowerCase().includes(fr)).length;
  }
  const phraseIdf = (fr) => Math.log((nChunks + 1) / ((phraseDf[fr] || 0) + 1)) + 1.0;

  const hasil = [];
  for (const [d, , c] of allChunks) {
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
    const judulLow = d.judul.toLowerCase();
    for (const t of tokens) if (t.length > 3 && judulLow.includes(t)) skor += 0.5;
    for (const fr of phrases) if (judulLow.includes(fr)) skor += 1.0;
    if (skor <= 0) continue;
    hasil.push({
      skor: Math.round(skor * 100) / 100,
      dokumen_id: d.id,
      jenis: d.jenis,
      nomor: d.nomor,
      tahun: d.tahun,
      judul: d.judul,
      tanggal_ditetapkan: d.tanggal_ditetapkan,
      status: d.status,
      pasal: labelPotongan(c),
      potongan: c.slice(0, 1200),
      kata_cocok: [...new Set(cocok)].sort(),
      tautan_jdih: d.tautan_jdih || null,
      sumber_url: d.sumber_url || null,
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

module.exports = {
  STOPWORDS, EXPANSIONS, tokenize, loadCorpus, chunkText,
  labelPotongan, expandQuery, retrieve, sitasiDariHasil,
};
