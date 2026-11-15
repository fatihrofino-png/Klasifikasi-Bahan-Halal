// api/_lib/llm.js — router LLM (Tiket 12a): Gemini dulu, Groq sekali bila
// 429/5xx — plus 404 "model tidak ditemukan" (Google mendepresiasi ID model
// berkala; model yang hilang diperlakukan sama seperti tidak tersedia).
// Skema output sama di kedua provider. Bila keduanya gagal: error jelas.
// Transport:
//   - Produksi: fetch REST langsung, kunci HANYA dari env (GEMINI_API_KEY,
//     GROQ_API_KEY). Tidak ada kunci di kode.
//   - Harness lokal: env FASE2_USE_HELPERS=1 memakai helper gemini.py /
//     groq.py via execFile (argv tetap, TANPA shell — input user tidak
//     pernah masuk ke perintah shell). Kunci dibaca helper dari Vault.
// Timeout tiap panggilan: 50 dtk (di bawah maxDuration 60 dtk).
'use strict';

const { execFile } = require('node:child_process');
const { CONFIG } = require('./config');
const { logEvent } = require('./log');
const { parseJsonResponse } = require('./prompt');

const TIMEOUT_MS = 50000;
const HELPERS = {
  gemini: '/home/hatch/workspace/custom-connectors/custom.gemini/bin/gemini.py',
  groq: '/home/hatch/workspace/custom-connectors/custom.groq/bin/groq.py',
};

class LlmError extends Error {
  constructor(message, status, provider) {
    super(message);
    this.status = status || 0;
    this.provider = provider || null;
  }
}

function useHelpers() { return process.env.FASE2_USE_HELPERS === '1'; }

function runHelper(provider, model, prompt) {
  return new Promise((resolve, reject) => {
    execFile('python3', [HELPERS[provider], 'generate', '--model', model, '--prompt', prompt],
      { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = String(stderr || err.message || '');
          const m404 = /404/.test(msg) ? 404 : /429/.test(msg) ? 429 : /5\d\d/.test(msg) ? 500 : 0;
          reject(new LlmError(`Helper ${provider} gagal: ${msg.slice(0, 200)}`, m404, provider));
          return;
        }
        resolve({ text: String(stdout || '').trim(), usage: null });
      });
  });
}

async function callGeminiRest(model, system, user) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new LlmError('GEMINI_API_KEY belum diisi.', 0, 'gemini');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: system + '\n\n' + user }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data.error && data.error.message) || `HTTP ${res.status}`;
      throw new LlmError(`Gemini: ${msg}`.slice(0, 300), res.status, 'gemini');
    }
    const text = data.candidates && data.candidates[0] && data.candidates[0].content
      && data.candidates[0].content.parts.map((p) => p.text || '').join('');
    if (!text) throw new LlmError('Gemini mengembalikan respons kosong.', 500, 'gemini');
    return { text, usage: data.usageMetadata || null };
  } finally { clearTimeout(timer); }
}

async function callGroqRest(model, system, user) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new LlmError('GROQ_API_KEY belum diisi.', 0, 'groq');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data.error && data.error.message) || `HTTP ${res.status}`;
      throw new LlmError(`Groq: ${msg}`.slice(0, 300), res.status, 'groq');
    }
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) throw new LlmError('Groq mengembalikan respons kosong.', 500, 'groq');
    return { text, usage: data.usage || null };
  } finally { clearTimeout(timer); }
}

function isFailoverEligible(err) {
  if (!err || typeof err.status !== 'number') return false;
  if (err.status === 429 || err.status >= 500) return true;
  // 404 model tidak ditemukan (model didepresiasi) -> coba cadangan.
  if (err.status === 404) return true;
  return false;
}

async function callProvider(provider, model, system, user) {
  if (useHelpers()) return runHelper(provider, model, system + '\n\n' + user);
  if (provider === 'gemini') return callGeminiRest(model, system, user);
  return callGroqRest(model, system, user);
}

// Satu panggilan dengan failover otomatis Gemini -> Groq.
async function generateText({ system, user, geminiModelOverride, groqModelOverride }) {
  const geminiModel = geminiModelOverride || CONFIG.GEMINI_MODEL;
  const groqModel = groqModelOverride || CONFIG.GROQ_MODEL;
  let lastErr = null;
  try {
    const r = await callProvider('gemini', geminiModel, system, user);
    logEvent('llm.panggil', { provider: 'gemini', model: geminiModel, berhasil: true });
    return { provider: 'gemini', text: r.text, usage: r.usage || null };
  } catch (e) {
    lastErr = e;
    logEvent('llm.gagal', { provider: 'gemini', model: geminiModel, status: e.status || 0, berhasil: false });
    if (!isFailoverEligible(e)) throw e;
  }
  try {
    const r = await callProvider('groq', groqModel, system, user);
    logEvent('llm.panggil', { provider: 'groq', model: groqModel, berhasil: true, failover_dari: 'gemini' });
    return { provider: 'groq', text: r.text, usage: r.usage || null };
  } catch (e) {
    logEvent('llm.gagal', { provider: 'groq', model: groqModel, status: e.status || 0, berhasil: false });
    lastErr = e;
    throw new LlmError(CONFIG.MSG_LLM_GAGAL, 502, null);
  }
}

// Seperti generateText, tapi memaksa JSON valid (retry sekali bila tidak valid — PRD §11.7).
async function generateJson(opts) {
  const first = await generateText(opts);
  try {
    return { ...first, parsed: parseJsonResponse(first.text) };
  } catch {
    logEvent('llm.json_tidak_valid', { provider: first.provider, percobaan: 1 });
    const second = await generateText(opts);
    try {
      return { ...second, parsed: parseJsonResponse(second.text) };
    } catch {
      logEvent('llm.json_tidak_valid', { provider: second.provider, percobaan: 2 });
      throw new LlmError(CONFIG.MSG_LLM_GAGAL, 502, null);
    }
  }
}

module.exports = { generateText, generateJson, LlmError, isFailoverEligible, TIMEOUT_MS };
