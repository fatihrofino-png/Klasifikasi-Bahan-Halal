// api/_lib/extract.js — ekstraksi teks PDF (Tiket 12b).
// Buffer in-memory saja; tidak pernah ditulis ke disk; pemanggil wajib
// membuang referensi buffer setelah ekstraksi (lihat analyze.js).
// Validasi jenis file dari MAGIC BYTES (%PDF), bukan ekstensi/nama file.
'use strict';

const { CONFIG } = require('./config');

function isPdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) return false;
  return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

class ExtractError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function extractPdf(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new ExtractError('bukan_pdf', CONFIG.MSG_FILE_BUKAN_PDF);
  }
  if (buffer.length > CONFIG.MAX_FILE_BYTES) {
    throw new ExtractError('terlalu_besar', CONFIG.MSG_FILE_TERLALU_BESAR);
  }
  if (!isPdf(buffer)) {
    throw new ExtractError('bukan_pdf', CONFIG.MSG_FILE_BUKAN_PDF);
  }
  let pdfParse;
  try {
    pdfParse = require('pdf-parse');
  } catch {
    throw new ExtractError('gagal_ekstrak', 'Layanan ekstraksi PDF sedang tidak tersedia.');
  }
  try {
    const data = await pdfParse(buffer);
    const text = (data.text || '').replace(/\r\n/g, '\n').trim();
    return { text, pages: data.numpages || 0, chars: text.length };
  } catch {
    throw new ExtractError('gagal_ekstrak', 'File PDF tidak dapat dibaca. Pastikan file tidak rusak atau terenkripsi.');
  }
}

module.exports = { isPdf, extractPdf, ExtractError };
