// api/_lib/auth.js — verifikasi token Supabase (Tiket 11d, kontrak §3).
// Tanpa token atau token tidak valid -> 401 {error:"daftar_dulu"}.
// BYPASS HANYA untuk harness tes lokal: env FASE2_DEV_BYPASS_AUTH=1.
// JANGAN PERNAH mengisi env itu di Vercel.
'use strict';

const { CONFIG } = require('./config');

class AuthError extends Error {
  constructor(status, error, message) {
    super(message);
    this.status = status;
    this.error = error;
  }
}

async function verifyAuth(ctx, supabase) {
  if (process.env.FASE2_DEV_BYPASS_AUTH === '1') {
    return { id: 'dev-user', email: 'dev@localhost' };
  }
  const headers = ctx.headers || {};
  const auth = headers.authorization || headers.Authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(String(auth));
  if (!m) {
    throw new AuthError(401, 'daftar_dulu', CONFIG.MSG_DAFTAR_DULU);
  }
  const token = m[1].trim();
  const sb = supabase || null;
  if (!sb) {
    // Tanpa klien Supabase (env belum diisi) auth tidak bisa diverifikasi.
    throw new AuthError(503, 'belum_dikonfigurasi', CONFIG.MSG_BELUM_DIKONFIGURASI);
  }
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data || !data.user) {
    throw new AuthError(401, 'daftar_dulu', CONFIG.MSG_DAFTAR_DULU);
  }
  return data.user;
}

module.exports = { verifyAuth, AuthError };
