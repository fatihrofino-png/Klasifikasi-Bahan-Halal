// api/_lib/log.js — logging terstruktur (observability_and_instrumentation).
// Mencatat: event, provider, token, hasil, kuota. TIDAK PERNAH mencatat:
// kunci/token, isi file user, teks tempelan, pertanyaan user, atau nama file.
// Field terlarang dibuang diam-diam (defense in depth) agar satu pemanggilan
// yang ceroboh tidak membocorkan data ke log.
'use strict';

const FORBIDDEN_KEYS = new Set([
  'api_key', 'apikey', 'key', 'token', 'secret', 'password',
  'authorization', 'service_role', 'service_key',
  'isi_file', 'file_content', 'teks', 'text', 'question', 'pertanyaan',
  'nama_file', 'filename', 'prompt', 'jawaban', 'dokumen',
]);
const FORBIDDEN_SUBSTRINGS = ['AIza', 'gsk_', 'sbp_', 'sk-'];

function sanitize(value, depth = 0) {
  if (depth > 3) return '[terpotong]';
  if (value == null) return value;
  if (typeof value === 'string') {
    for (const s of FORBIDDEN_SUBSTRINGS) {
      if (value.includes(s)) return '[disensor: pola rahasia]';
    }
    return value.length > 200 ? value.slice(0, 200) + '…' : value;
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k.toLowerCase())) continue; // buang field terlarang
      out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  return value;
}

function logEvent(event, fields = {}) {
  const entry = {
    ts: new Date().toISOString(),
    event,
    ...sanitize(fields),
  };
  console.log(JSON.stringify(entry));
}

function logSecurity(event, fields = {}) {
  logEvent('keamanan.' + event, fields);
}

module.exports = { logEvent, logSecurity, sanitize };
