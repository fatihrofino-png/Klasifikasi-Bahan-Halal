#!/usr/bin/env node
/* Update harian data LHLN + Berita — Website Klasifikasi Bahan Halal BPJPH.
   Dibuat 16 Nov 2026. Dijalankan GitHub Actions tiap hari 06.00 WIB
   (23.00 UTC hari sebelumnya) — lihat .github/workflows/update-data-daily.yml.
   Node >= 18, stdlib saja (global fetch). TIDAK memakai API key / secret.
   TIDAK pernah commit sendiri — workflow yang commit bila ada diff.

   Sumber:
   - LHLN: scrape HTML https://bpjph.halal.go.id/cari/lembaga-halal-luar-negeri
     (tabel server-rendered, 20 baris/halaman, paginasi ?page=N).
     Dibandingkan dengan api/_data/lhln.json; bila berubah, file itu +
     CSV base64 yang di-embed di index.html diperbarui.
   - Berita BPJPH: scrape HTML https://bpjph.halal.go.id/berita
     (kartu <a href="/main/read/<slug>">; tanggal absolut TIDAK tampil di
     daftar — hanya label relatif "N hari yang lalu", jadi tanggal dihitung
     dari label itu + tanggal fetch, dan ditandai date_exact:false).
   - Berita LPPOM MUI: WordPress REST API resmi
     https://halalmui.org/wp-json/wp/v2/posts (tanggal ISO absolut).
   Hasil: data/berita.json + data/lhln-updates.json (dibaca website).
   Bila satu sumber berita gagal, sumber lain tetap ditulis + status error
   dicatat di JSON; website menampilkan catatan jujur di tab Berita.

   Pakai: node scripts/update-daily.mjs [--dry-run] [--lhln-only] [--berita-only]
   --dry-run: hanya mencetak ringkasan, tidak menulis file apa pun. */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" };
const DRY = process.argv.includes("--dry-run");
const LHLN_ONLY = process.argv.includes("--lhln-only");
const BERITA_ONLY = process.argv.includes("--berita-only");

function wibNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
}
function wibStamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} WIB`;
}
function isoDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
async function fetchText(url, timeoutMs = 30000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: UA, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}
async function fetchJSON(url, timeoutMs = 30000) {
  return JSON.parse(await fetchText(url, timeoutMs));
}
function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function normName(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }
/* Kunci pencocokan nama lembaga: nama tanpa isi kurung (mis. "(IFANCA)")
   + alias singkatan di dalam kurung. Situs BPJPH kadang menampilkan nama
   lengkap yang sebelumnya hanya singkatan ("IFANCA" → "Islamic Food and
   Nutrition Council of America (IFANCA)"); itu lembaga yang sama, bukan
   lembaga baru. Tanda baca diabaikan ("Co. Ltd." = "Co., Ltd."). */
function normKey(s) {
  return normName(String(s || "").replace(/\([^)]*\)/g, " ")).replace(/[.,'’‘`\-]/g, "").replace(/\s+/g, " ").trim();
}
function nameKeys(name) {
  const keys = [normKey(name)];
  const m = String(name || "").match(/\(([^)]+)\)/);
  if (m) keys.push(normKey(m[1]));
  return keys.filter(Boolean);
}
/* Alamat dari HTML: simpul teks "Paris" + "," + "France" ikut spasi saat
   tag di-strip ("Paris , France"). Normalisasi ke "Paris, France". */
function normAddr(s) { return String(s || "").replace(/\s+,/g, ",").replace(/,\s*/g, ", ").replace(/\s+/g, " ").trim(); }

/* ---------------- LHLN ---------------- */
function parseLhlnTable(html) {
  const tb = html.match(/<tbody[\s\S]*?<\/tbody>/);
  if (!tb) return [];
  const rows = [];
  for (const m of tb[0].matchAll(/<tr[\s>][\s\S]*?<\/tr>/g)) {
    const cells = [...m[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => stripTags(c[1]));
    if (cells.length < 5 || !/^\d+$/.test(cells[0])) continue;
    rows.push({
      no: parseInt(cells[0], 10),
      nama_lhln: cells[1],
      alamat: normAddr(cells[2]),
      lingkup: cells[3].split("|").map((s) => s.trim()).filter(Boolean),
      masa_berlaku: cells[4],
    });
  }
  return rows;
}
function totalPages(html) {
  const m = html.match(/data-total="(\d+)"/);
  return m ? parseInt(m[1], 10) : 1;
}
async function scrapeLhln() {
  const base = "https://bpjph.halal.go.id/cari/lembaga-halal-luar-negeri";
  const first = await fetchText(base);
  const pages = totalPages(first);
  let rows = parseLhlnTable(first);
  for (let p = 2; p <= pages; p++) {
    const html = await fetchText(`${base}?page=${p}`);
    const r = parseLhlnTable(html);
    if (!r.length) break;
    rows = rows.concat(r);
  }
  // Nomor urut ulang sesuai urutan situs (nomor situs sendiri sudah urut).
  rows.sort((a, b) => a.no - b.no);
  rows.forEach((r, i) => { r.no = i + 1; });
  return rows;
}
function diffLhln(oldRows, newRows) {
  const indexByKeys = (rows) => {
    const map = new Map();
    for (const r of rows) for (const k of nameKeys(r.nama_lhln)) if (!map.has(k)) map.set(k, r);
    return map;
  };
  const oldByKey = indexByKeys(oldRows);
  const newByKey = indexByKeys(newRows);
  const findOld = (n) => { for (const k of nameKeys(n.nama_lhln)) if (oldByKey.has(k)) return oldByKey.get(k); return null; };
  const changes = [];
  for (const n of newRows) {
    const o = findOld(n);
    if (!o) { changes.push({ type: "added", no: n.no, nama: n.nama_lhln, detail: `Lembaga baru: ${n.alamat}` }); continue; }
    const diffs = [];
    if (normName(o.nama_lhln) !== normName(n.nama_lhln)) diffs.push(`nama: "${o.nama_lhln}" → "${n.nama_lhln}"`);
    if (normAddr(o.alamat) !== normAddr(n.alamat)) diffs.push(`alamat: "${normAddr(o.alamat)}" → "${normAddr(n.alamat)}"`);
    if (JSON.stringify([...o.lingkup].sort()) !== JSON.stringify([...n.lingkup].sort())) diffs.push(`lingkup: "${o.lingkup.join(" | ")}" → "${n.lingkup.join(" | ")}"`);
    if (String(o.masa_berlaku) !== String(n.masa_berlaku)) diffs.push(`masa berlaku: "${o.masa_berlaku}" → "${n.masa_berlaku}"`);
    if (diffs.length) changes.push({ type: "changed", no: n.no, nama: n.nama_lhln, detail: diffs.join("; ") });
  }
  for (const o of oldRows) {
    let found = false;
    for (const k of nameKeys(o.nama_lhln)) if (newByKey.has(k)) { found = true; break; }
    if (!found) changes.push({ type: "removed", no: o.no, nama: o.nama_lhln, detail: "Tidak lagi tercantum di direktori BPJPH" });
  }
  return changes;
}
function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function lhlnToCsv(rows) {
  const head = "no,nama_lhln,alamat,lingkup,masa_berlaku";
  const lines = rows.map((r) => [r.no, r.nama_lhln, r.alamat, r.lingkup.join(" | "), r.masa_berlaku].map(csvCell).join(","));
  return head + "\n" + lines.join("\n") + "\n";
}
const ID_MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
function updateIndexLhln(rows, checkDate) {
  const idxPath = path.join(ROOT, "index.html");
  let html = readFileSync(idxPath, "utf8");
  const b64 = Buffer.from(lhlnToCsv(rows), "utf8").toString("base64");
  const before = html;
  html = html.replace(/data:application\/octet-stream;base64,[A-Za-z0-9+/=]+/, "data:application/octet-stream;base64," + b64);
  const dstr = isoDate(checkDate);
  html = html.replace(/lembaga-halal-luar-negeri-bpjph-\d{4}-\d{2}-\d{2}\.csv/, `lembaga-halal-luar-negeri-bpjph-${dstr}.csv`);
  // Tanggal "Data diperbarui" (4 bahasa + fallback HTML) — hanya bila data berubah.
  const idDate = `${checkDate.getDate()} ${ID_MONTHS[checkDate.getMonth()]} ${checkDate.getFullYear()}`;
  const arDate = `${checkDate.getDate()} ${AR_MONTHS[checkDate.getMonth()]} ${checkDate.getFullYear()}`;
  const zhDate = `${checkDate.getFullYear()} 年 ${checkDate.getMonth() + 1} 月 ${checkDate.getDate()} 日`;
  const reps = [
    ["Data diperbarui: 15 November 2026", `Data diperbarui: ${idDate}`],
    ["Data updated: 15 November 2026", `Data updated: ${idDate}`],
    ["آخر تحديث للبيانات: 15 نوفمبر 2026", `آخر تحديث للبيانات: ${arDate}`],
    ["数据更新于：2026 年 11 月 15 日", `数据更新于：${zhDate}`],
  ];
  for (const [a, b] of reps) {
    if (!html.includes(a)) console.warn(`  ! pola tanggal LHLN tidak ditemukan (dilewati): ${a}`);
    else html = html.split(a).join(b);
  }
  if (html === before) throw new Error("index.html tidak berubah saat update LHLN — pola CSV mungkin berubah");
  if (!DRY) writeFileSync(idxPath, html);
}

/* ---------------- Berita ---------------- */
function dateFromRelative(label, fetchDate) {
  const m = label.match(/(\d+)\s+(menit|jam|hari|minggu|bulan)\s+yang lalu/);
  if (!m) return isoDate(fetchDate);
  const n = parseInt(m[1], 10);
  const d = new Date(fetchDate);
  if (m[2] === "hari") d.setDate(d.getDate() - n);
  else if (m[2] === "minggu") d.setDate(d.getDate() - n * 7);
  else if (m[2] === "bulan") d.setDate(d.getDate() - n * 30);
  return isoDate(d); // menit/jam = hari yang sama
}
function parseBpjphNews(html, fetchDate) {
  const clean = html.replace(/\\"/g, '"').replace(/\\n/g, " ");
  const parts = clean.split('<a class="group block');
  const items = [];
  for (const p of parts.slice(1)) {
    const slug = (p.match(/href="\/main\/read\/([^"]+)"/) || [])[1];
    if (!slug) continue;
    const title = (p.match(/alt="([^"]+)"/) || [])[1];
    if (!title) continue;
    const rel = (p.match(/(\d+\s+(?:menit|jam|hari|minggu|bulan)\s+yang lalu)/) || [])[1] || "";
    const cat = (p.match(/>\s*(Nasional|Internasional|Daerah|Kegiatan|Pengumuman)\s*</) || [])[1] || "";
    // Teks kartu dimulai SETELAH tag <a …> penutup; sisa atribut class di
    // depan (mis. "bg-white dark:bg-zinc-900 …") bukan isi berita.
    const bodyStart = p.indexOf('">');
    let text = stripTags(bodyStart >= 0 ? p.slice(bodyStart + 2) : p);
    // Buang kategori, label relatif, judul, dan tombol dari teks kartu.
    text = text.replace(cat, "").replace(rel, "").replace(title, "").replace(/Baca Selengkapnya/g, "").replace(/\s+/g, " ").trim();
    // Sisa awal teks kartu adalah ringkasan (kadang isi penuh — potong).
    let summary = text.length > 280 ? text.slice(0, 280).replace(/\s+\S*$/, "") + "…" : text;
    if (!summary) summary = "";
    items.push({
      source: "BPJPH", title: decodeEntities(title),
      url: `https://bpjph.halal.go.id/main/read/${slug}`,
      date: dateFromRelative(rel, fetchDate), date_label: rel || null, date_exact: false,
      category: cat || null, summary,
    });
  }
  return items;
}
async function scrapeLppom() {
  const cats = {};
  try {
    const list = await fetchJSON("https://halalmui.org/wp-json/wp/v2/categories?per_page=100&_fields=id,name");
    for (const c of list) cats[c.id] = c.name;
  } catch (e) { console.warn("  ! gagal memetakan kategori LPPOM:", e.message); }
  const posts = await fetchJSON("https://halalmui.org/wp-json/wp/v2/posts?per_page=10&_fields=title,link,date,slug,categories,excerpt");
  return posts.map((p) => ({
    source: "LPPOM MUI", title: stripTags(p.title.rendered),
    url: p.link, date: String(p.date).slice(0, 10), date_label: null, date_exact: true,
    category: (p.categories || []).map((id) => cats[id]).filter(Boolean).map((c) => decodeEntities(c))[0] || null,
    summary: stripTags(p.excerpt.rendered).replace(/\[…\]/g, "…").slice(0, 280),
  }));
}

/* ---------------- main ---------------- */
const now = wibNow();
const out = { lhln: null, berita: null };
let failed = false;

if (!BERITA_ONLY) {
  console.log("== LHLN ==");
  try {
    const rows = await scrapeLhln();
    const oldPath = path.join(ROOT, "api/_data/lhln.json");
    const oldRows = JSON.parse(readFileSync(oldPath, "utf8"));
    const changes = diffLhln(oldRows, rows);
    const added = changes.filter((c) => c.type === "added").length;
    const removed = changes.filter((c) => c.type === "removed").length;
    const changed = changes.filter((c) => c.type === "changed").length;
    console.log(`  Live BPJPH: ${rows.length} lembaga (sebelumnya ${oldRows.length}); +${added} ~${changed} -${removed}`);
    for (const c of changes) console.log(`  - [${c.type}] #${c.no} ${c.nama}: ${c.detail}`);
    const logPath = path.join(ROOT, "data/lhln-updates.json");
    let prev = { history: [] };
    if (existsSync(logPath)) { try { prev = JSON.parse(readFileSync(logPath, "utf8")); } catch { prev = { history: [] }; } }
    const entry = { checked_at: new Date().toISOString(), checked_at_wib: wibStamp(now), total: rows.length, added, removed, changed, changes };
    const log = { ...entry, history: [entry, ...(prev.history || [])].slice(0, 30) };
    out.lhln = log;
    if (!DRY) {
      mkdirSync(path.join(ROOT, "data"), { recursive: true });
      if (changes.length) {
        writeFileSync(oldPath, JSON.stringify(rows));
        updateIndexLhln(rows, now);
        console.log("  lhln.json + CSV di index.html diperbarui.");
      } else console.log("  Tidak ada perubahan data — lhln.json & index.html tidak disentuh.");
      writeFileSync(logPath, JSON.stringify(log, null, 2) + "\n");
    }
  } catch (e) { failed = true; console.error("  LHLN GAGAL:", e.message); }
}

if (!LHLN_ONLY) {
  console.log("== Berita ==");
  const items = [];
  const sources = {};
  try {
    const html = await fetchText("https://bpjph.halal.go.id/berita");
    const bp = parseBpjphNews(html, now);
    sources.bpjph = { status: "ok", count: bp.length };
    items.push(...bp);
    console.log(`  BPJPH: ${bp.length} berita`);
    for (const b of bp) console.log(`    - [${b.date}${b.date_exact ? "" : " (perkiraan)"}] ${b.title.slice(0, 70)}`);
  } catch (e) { sources.bpjph = { status: "error", count: 0, error: e.message }; console.error("  BPJPH GAGAL:", e.message); }
  try {
    const lp = await scrapeLppom();
    sources.lppom = { status: "ok", count: lp.length };
    items.push(...lp);
    console.log(`  LPPOM MUI: ${lp.length} berita`);
    for (const b of lp) console.log(`    - [${b.date}] ${b.title.slice(0, 70)}`);
  } catch (e) { sources.lppom = { status: "error", count: 0, error: e.message }; console.error("  LPPOM GAGAL:", e.message); }
  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const berita = {
    updated_at: new Date().toISOString(), updated_at_wib: wibStamp(now),
    total: items.length, sources, items: items.slice(0, 20),
    note: "Tanggal berita BPJPH diperkirakan dari label relatif di situs sumber (mis. '3 hari yang lalu'); tanggal LPPOM MUI absolut dari WordPress REST API.",
  };
  out.berita = berita;
  if (!DRY) {
    mkdirSync(path.join(ROOT, "data"), { recursive: true });
    writeFileSync(path.join(ROOT, "data/berita.json"), JSON.stringify(berita, null, 2) + "\n");
    console.log(`  data/berita.json ditulis (${items.length} item).`);
  }
}

if (DRY) console.log("(dry-run: tidak ada file ditulis)");
if (failed) process.exit(1);
