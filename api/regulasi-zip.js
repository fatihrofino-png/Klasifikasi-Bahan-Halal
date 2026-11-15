// api/regulasi-zip.js — GET /api/regulasi-zip
// Mengunduh 11 PDF regulasi resmi (korpus JDIH Fase 2) lalu mengembalikannya
// sebagai SATU file ZIP (metode STORE, tanpa kompresi — PDF sudah terkompresi).
//
// Keamanan (gerbang Rofik):
// - Daftar URL HARDCODED (allowlist). TIDAK ADA input pengguna yang dipakai
//   sebagai URL — tidak ada SSRF. Query string diabaikan.
// - Setiap file divalidasi: harus diawali magic bytes "%PDF", ukuran per file
//   maks 40 MB, total maks 100 MB. File yang gagal dilewati dan dicatat di
//   DAFTAR-ISI.txt, bukan menggagalkan seluruh ZIP. Fetch memakai UA browser;
//   PP 39/2021 punya URL cadangan (Setkab, halalmui.org) karena BPK menolak
//   IP datacenter Vercel (HTTP 403) meski UA sudah diubah.
// - Respons di-STREAM (res.write) dengan Content-Length eksak, bukan dikirim
//   sebagai satu Buffer — supaya tidak kena batas respons 4,5 MB Vercel
//   (total ZIP ~25 MB).
// - Cache CDN hanya bila SEMUA 11 file berhasil (s-maxage 1 hari); bila ada
//   yang gagal, no-store supaya unduhan berikutnya mencoba ulang.
'use strict';

const DOCS = [
  { file: '01-UU-33-2014-Jaminan-Produk-Halal.pdf',
    title: 'Undang-Undang Nomor 33 Tahun 2014 tentang Jaminan Produk Halal',
    url: 'https://jdih.halal.go.id/api/jdih/pdf?path=JDIH%2Fdokumen%2F1770801119535_20140031033.pdf' },
  { file: '02-PP-39-2021-Penyelenggaraan-JPH.pdf',
    title: 'Peraturan Pemerintah Nomor 39 Tahun 2021 tentang Penyelenggaraan Bidang Jaminan Produk Halal (DICABUT oleh PP 42/2024 — disimpan sebagai arsip)',
    url: 'https://peraturan.bpk.go.id/Download/154605/PP%20Nomor%2039%20Tahun%202021.pdf',
    urls: ['https://peraturan.bpk.go.id/Download/154605/PP%20Nomor%2039%20Tahun%202021.pdf',
      'https://jdih.setkab.go.id/PUUdoc/176351/PP_Nomor_39_Tahun_2021.pdf',
      'https://www.halalmui.org/images/stories/kebijakanhalaldiindonesia/PP_Nomor_39_Tahun_2021.pdf'] },
  { file: '03-PP-42-2024-Penyelenggaraan-JPH.pdf',
    title: 'Peraturan Pemerintah Nomor 42 Tahun 2024 tentang Penyelenggaraan Bidang Jaminan Produk Halal (berlaku — pengganti PP 39/2021)',
    url: 'https://jdih.halal.go.id/api/jdih/pdf?path=JDIH%2Fdokumen%2F1770797380336_2024PP042.pdf' },
  { file: '04-Kepkaban-301-2026-Bahan-Dikecualikan.pdf',
    title: 'Keputusan Kepala BPJPH Nomor 301 Tahun 2026 tentang Produk dan Bahan yang Dikecualikan dari Kewajiban Bersertifikat Halal',
    url: 'https://jdih.halal.go.id/api/jdih/pdf?path=JDIH%2Fdokumen%2F1790224979382_2026keputusankepalabpjph301.pdf' },
  { file: '05-Kepkaban-387-2026-Jenis-Produk-Wajib.pdf',
    title: 'Keputusan Kepala BPJPH Nomor 387 Tahun 2026 tentang Jenis Produk yang Wajib Bersertifikat Halal',
    url: 'https://22fd5700.delivery.rocketcdn.me/wp-content/uploads/2026/05/Salinan-387.2026-Jenis-Produk-yang-Wajib-Bersertifikat-Halal-1_compressed-1.pdf' },
  { file: '06-Kepkaban-20-2023-Kriteria-SJPH.pdf',
    title: 'Keputusan Kepala BPJPH Nomor 20 Tahun 2023 tentang Kriteria Sistem Jaminan Produk Halal (SJPH)',
    url: 'https://jdih.halal.go.id/api/jdih/pdf?path=JDIH%2Fdokumen%2F1784695033475_2023keputusankepalabpjph20.pdf' },
  { file: '07-PMA-20-2021-Sertifikasi-Halal-UMK.pdf',
    title: 'Peraturan Menteri Agama Nomor 20 Tahun 2021 tentang Sertifikasi Halal bagi Pelaku Usaha Mikro dan Kecil',
    url: 'https://jdih.halal.go.id/api/jdih/pdf?path=JDIH%2Fdokumen%2F1784177666490_pma_20_2021_-_sertifikasi_halal_bagi_pelaku_usaha_mikro_%26_kecil.pdf' },
  { file: '08-Kepkaban-40-2022-Penetapan-Label-Halal.pdf',
    title: 'Keputusan Kepala BPJPH Nomor 40 Tahun 2022 tentang Penetapan Label Halal',
    url: 'https://jdih.halal.go.id/api/jdih/pdf?path=JDIH%2Fdokumen%2F1784172938068_40._kepkaban_40_2022_ttg_penetapan_label.pdf' },
  { file: '09-SE-2-2026-Mekanisme-Kategori-Produk.pdf',
    title: 'Surat Edaran Kepala BPJPH Nomor 2 Tahun 2026 tentang Mekanisme Penentuan Kategori Produk',
    url: 'https://jdih.halal.go.id/api/jdih/pdf?path=JDIH%2Fdokumen%2F1787827250099_2026sekepalabpjph002.pdf' },
  { file: '10-PerBPJPH-4-2026-Pemastian-Kesesuaian-PLN.pdf',
    title: 'Peraturan BPJPH Nomor 4 Tahun 2026 tentang Pemastian Kesesuaian Produk Halal Luar Negeri yang Masuk ke Wilayah Indonesia',
    url: 'https://jdih.halal.go.id/api/jdih/pdf?path=JDIH%2Fdokumen%2F1787202676942_salinan_-_peraturan_bpjph_4.2026._pemastian_kesesuaian_produk_halal_luar_negeri_yang_masuk_ke_wilayah_indonesia.pdf' },
  { file: '11-Kepkaban-328-2026-SOP-Pemastian-Kesesuaian.pdf',
    title: 'Keputusan Kepala BPJPH Nomor 328 Tahun 2026 tentang Standar Operasional Prosedur Layanan Pemastian Kesesuaian Produk Halal Luar Negeri',
    url: 'https://jdih.halal.go.id/api/jdih/pdf?path=JDIH%2Fdokumen%2F1790237694650_2026keputusankepalabpjph328.pdf' },
];

const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 25000;

/* --- CRC32 (tabel standar, dipakai header ZIP) --- */
const CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

function localHeader(nameBuf, crc, size, time, date) {
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4);            // versi yang dibutuhkan
  h.writeUInt16LE(0x0800, 6);        // flag: nama berkas UTF-8
  h.writeUInt16LE(0, 8);             // metode STORE
  h.writeUInt16LE(time, 10);
  h.writeUInt16LE(date, 12);
  h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(size, 18);         // ukuran terkompresi (= ukuran asli, STORE)
  h.writeUInt32LE(size, 22);
  h.writeUInt16LE(nameBuf.length, 26);
  h.writeUInt16LE(0, 28);            // panjang extra
  return h;
}

function centralHeader(nameBuf, crc, size, offset, time, date) {
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014b50, 0);
  h.writeUInt16LE(20, 4);            // versi pembuat
  h.writeUInt16LE(20, 6);            // versi yang dibutuhkan
  h.writeUInt16LE(0x0800, 8);
  h.writeUInt16LE(0, 10);
  h.writeUInt16LE(time, 12);
  h.writeUInt16LE(date, 14);
  h.writeUInt32LE(crc, 16);
  h.writeUInt32LE(size, 20);
  h.writeUInt32LE(size, 24);
  h.writeUInt16LE(nameBuf.length, 28);
  h.writeUInt16LE(0, 30);
  h.writeUInt16LE(0, 32);
  h.writeUInt16LE(0, 34);            // nomor disk
  h.writeUInt16LE(0, 36);            // atribut internal
  h.writeUInt32LE(0, 38);            // atribut eksternal
  h.writeUInt32LE(offset, 42);       // offset header lokal
  return h;
}

function endRecord(count, cdSize, cdOffset) {
  const h = Buffer.alloc(22);
  h.writeUInt32LE(0x06054b50, 0);
  h.writeUInt16LE(0, 4);
  h.writeUInt16LE(0, 6);
  h.writeUInt16LE(count, 8);
  h.writeUInt16LE(count, 10);
  h.writeUInt32LE(cdSize, 12);
  h.writeUInt32LE(cdOffset, 16);
  h.writeUInt16LE(0, 20);
  return h;
}

/* Coba semua URL cadangan berurutan (doc.urls, bila ada) sampai satu
   mengembalikan PDF valid. Tiap URL dicoba 1x; jeda 1,5 dtk antar percobaan
   supaya host yang membatasi laju tidak makin menolak. */
async function fetchPdf(doc) {
  const urls = doc.urls || [doc.url];
  let lastReason = 'gagal diunduh';
  for (let i = 0; i < urls.length; i++) {
    if (i > 0) await new Promise((res) => setTimeout(res, 1500));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      // UA browser: sebagian host (mis. peraturan.bpk.go.id) menolak UA
      // default runtime serverless (HTTP 403) — UA browser biasa lolos.
      const r = await fetch(urls[i], {
        signal: ctrl.signal, redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/pdf,*/*',
        },
      });
      if (!r.ok) { lastReason = 'HTTP ' + r.status; continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_FILE_BYTES) { lastReason = 'file terlalu besar'; continue; }
      if (buf.length < 5 || buf.slice(0, 5).toString('ascii') !== '%PDF-') {
        lastReason = 'bukan PDF'; continue;
      }
      return { doc, ok: true, buf, usedUrl: urls[i] };
    } catch (e) {
      lastReason = e && e.name === 'AbortError' ? 'timeout' : 'gagal diunduh';
    } finally {
      clearTimeout(timer);
    }
  }
  return { doc, ok: false, reason: lastReason };
}

function daftarIsiText(results, now) {
  const lines = [
    'REGULASI HALAL BPJPH — DAFTAR ISI',
    'Diunduh dari https://cek-bahan.vercel.app/ pada ' + now.toISOString().slice(0, 10),
    '',
    'Paket ini berisi salinan PDF resmi dari JDIH BPJPH, JDIH BPK, dan arsip',
    'ekstraksi proyek. PP 39/2021 sudah DICABUT oleh PP 42/2024 dan disimpan',
    'di sini hanya sebagai arsip; aturan yang berlaku saat ini adalah PP 42/2024.',
    '',
  ];
  results.forEach((r, i) => {
    lines.push((i + 1) + '. ' + r.doc.title);
    lines.push('   File   : ' + r.doc.file);
    lines.push('   Sumber : ' + (r.ok && r.usedUrl ? r.usedUrl : r.doc.url));
    lines.push('   Status : ' + (r.ok ? 'OK (' + (r.buf.length / 1024).toFixed(0) + ' KB)' : 'GAGAL — ' + r.reason));
    lines.push('');
  });
  const gagal = results.filter((r) => !r.ok).length;
  if (gagal) {
    lines.push('CATATAN: ' + gagal + ' dokumen gagal diunduh saat ZIP ini dibuat. Unduh ulang');
    lines.push('di lain waktu, atau buka tautan sumber di atas satu per satu.');
  }
  lines.push('Verifikasi akhir melalui BPJPH atau Lembaga Pemeriksa Halal (LPH).');
  return lines.join('\n');
}

async function vercelHandler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const now = new Date();
  const { time, date } = dosDateTime(now);
  let results;
  try {
    results = await Promise.all(DOCS.map(fetchPdf));
  } catch (e) {
    res.status(502).json({ error: 'fetch_failed' });
    return;
  }
  const okFiles = results.filter((r) => r.ok);
  if (!okFiles.length) {
    res.status(502).json({ error: 'all_failed' });
    return;
  }
  const total = okFiles.reduce((a, r) => a + r.buf.length, 0);
  if (total > MAX_TOTAL_BYTES) {
    res.status(502).json({ error: 'too_large' });
    return;
  }

  // Daftar isi sebagai entri teks terakhir di ZIP.
  const isiBuf = Buffer.from(daftarIsiText(results, now), 'utf8');
  const isiName = Buffer.from('DAFTAR-ISI.txt', 'utf8');
  const entries = okFiles.map((r) => ({
    name: Buffer.from(r.doc.file, 'utf8'),
    data: r.buf,
    crc: crc32(r.buf),
  }));
  entries.push({ name: isiName, data: isiBuf, crc: crc32(isiBuf) });

  // Hitung ukuran total ZIP lebih dulu agar Content-Length eksak.
  let totalSize = 0;
  let offset = 0;
  const metas = entries.map((e) => {
    const localSize = 30 + e.name.length + e.data.length;
    const meta = { e, offset, localSize };
    offset += localSize;
    totalSize += localSize + 46 + e.name.length;
    return meta;
  });
  const cdOffset = offset;
  const cdSize = totalSize - offset;
  totalSize += 22; // EOCD

  const allOk = okFiles.length === DOCS.length;
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': 'attachment; filename="regulasi-halal-bpjph.zip"',
    'Content-Length': String(totalSize),
    'Cache-Control': allOk ? 'public, s-maxage=86400, max-age=3600' : 'no-store',
  });
  try {
    for (const m of metas) {
      res.write(localHeader(m.e.name, m.e.crc, m.e.data.length, time, date));
      res.write(m.e.name);
      res.write(m.e.data);
    }
    for (const m of metas) {
      res.write(centralHeader(m.e.name, m.e.crc, m.e.data.length, m.offset, time, date));
      res.write(m.e.name);
    }
    res.write(endRecord(entries.length, cdSize, cdOffset));
    res.end();
  } catch (e) {
    try { res.end(); } catch (_) { /* koneksi sudah putus */ }
  }
}

module.exports = vercelHandler;
module.exports.default = vercelHandler;
module.exports._internals = { DOCS, crc32, localHeader, centralHeader, endRecord, fetchPdf, daftarIsiText };
