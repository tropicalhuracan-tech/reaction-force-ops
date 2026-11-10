/**
 * Alimenta columna Días de nóminas Monorriel desde reportes (quincena).
 * Uso: node scripts/feed-mono-payroll-days.mjs [auto|YYYY-MM] [1|2|both]
 * Por defecto: auto = mes actual + siguiente, ambas quincenas (16–30; día 31 excluido).
 */
import fs from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const API_KEY = "AIzaSyDW530ATdxnvR46vakYgodBXSunM-fk_dQ";
const BASE =
  "https://firestore.googleapis.com/v1/projects/rfs-ops-5709/databases/(default)/documents";

function safeId(v) {
  return String(v || "x")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 96);
}
async function getDoc(p) {
  const r = await fetch(`${BASE}/${p}?key=${API_KEY}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${p} ${r.status}`);
  return r.json();
}
async function patchDoc(p, fields, fieldPaths) {
  let url = `${BASE}/${p}?key=${API_KEY}`;
  if (fieldPaths) url += fieldPaths.map((x) => `&updateMask.fieldPaths=${encodeURIComponent(x)}`).join("");
  const r = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`PATCH ${p} ${r.status} ${(await r.text()).slice(0, 220)}`);
  return r.json();
}
function nameKey(n) {
  return String(n || "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
function cleanName(n) {
  return String(n || "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function loose(a, b) {
  const ka = nameKey(a);
  const kb = nameKey(b);
  if (!ka || !kb) return false;
  if (ka === kb || ka.includes(kb) || kb.includes(ka)) return true;
  const pa = ka.split(" ");
  const pb = kb.split(" ");
  return pa.length >= 2 && pb.length >= 2 && pa[0] === pb[0] && pa[pa.length - 1] === pb[pb.length - 1];
}
function periodRange(period, half) {
  const [y, m] = period.split("-").map(Number);
  if (half === 1) return { from: `${period}-01`, to: `${period}-15` };
  // 16–30: el día 31 se reporta pero no entra en nómina
  const last = new Date(y, m, 0).getDate();
  const endDay = Math.min(30, last);
  return { from: `${period}-16`, to: `${period}-${String(endDay).padStart(2, "0")}` };
}
function payDateFor(period, half) {
  if (half === 1) return `${period}-20`;
  const [y0, m0] = period.split("-").map(Number);
  let y = y0;
  let m = m0 + 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, "0")}-05`;
}

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, "monorriel-data.js"), "utf8") + "\nthis.out=window.RFS_MONORRIEL;", sandbox);
const tandas = sandbox.out.payrollTandas || [];

function resolveTanda(name, employeeId, shift) {
  const family = shift === "pm" ? ["noche", "moto_noche"] : ["dia", "moto_dia"];
  let hit = null;
  for (const t of tandas) {
    for (const r of t.roster || []) {
      if (employeeId && (r.employeeId === employeeId || r.id === employeeId)) {
        hit = { tanda: t.id, person: r };
        break;
      }
      if (loose(r.name, name)) {
        hit = { tanda: t.id, person: r };
        break;
      }
    }
    if (hit) break;
  }
  if (hit && family.includes(hit.tanda)) return hit;
  if (hit) {
    const wantMoto = String(hit.tanda).startsWith("moto");
    const alt = family.find((id) => (wantMoto ? id.startsWith("moto") : !id.startsWith("moto")));
    return { tanda: alt || family[0], person: hit.person };
  }
  return { tanda: shift === "pm" ? "noche" : "dia", person: null };
}

async function feedHalf(period, half, reports, payrollByKey, ids) {
  const range = periodRange(period, half);
  const locks = {};
  const byTanda = new Map();
  for (const shift of ["am", "pm"]) {
    const map = new Map();
    for (const report of reports) {
      const d = String(report.date || "").slice(0, 10);
      if (d < range.from || d > range.to) continue;
      if ((report.shift === "pm" ? "pm" : "am") !== shift) continue;
      for (const a of report.assignments || []) {
        const raw = String(a.employeeName || "").trim();
        if (!raw) continue;
        const key = a.employeeId ? `id:${a.employeeId}` : `name:${nameKey(raw)}`;
        let row = map.get(key);
        if (!row) {
          const nk = nameKey(raw);
          if (!locks[nk]) locks[nk] = cleanName(raw);
          row = { employeeId: a.employeeId || "", name: locks[nk], days: new Set() };
          map.set(key, row);
        }
        if (!row.employeeId && a.employeeId) row.employeeId = a.employeeId;
        row.days.add(d);
      }
    }
    for (const row of map.values()) {
      const resolved = resolveTanda(row.name, row.employeeId, shift);
      if (!byTanda.has(resolved.tanda)) byTanda.set(resolved.tanda, []);
      byTanda.get(resolved.tanda).push({ ...row, daysCount: row.days.size, person: resolved.person });
    }
  }

  const now = new Date().toISOString();
  let touched = 0;
  for (const [tanda, rows] of byTanda) {
    if (!rows.length) continue;
    const pkey = `${period}|${half}|${tanda}`;
    let p = payrollByKey.get(pkey);
    const roster = (tandas.find((t) => t.id === tanda) || {}).roster || [];
    if (!p) {
      const lines = [];
      const seen = new Set();
      for (const row of rows) {
        const nk = nameKey(row.name);
        if (seen.has(nk)) continue;
        seen.add(nk);
        const person = row.person || roster.find((r) => loose(r.name, row.name));
        lines.push({
          employeeId: row.employeeId || (person && (person.employeeId || person.id)) || "",
          fullName: row.name,
          position: (person && person.position) || "Monorriel",
          cedula: (person && person.cedula) || "",
          daysWorked: String(row.daysCount),
          daysFromReports: true,
          salaryMonthly: Math.max(0, Number(person && person.salaryMonthly) || 24000),
          adelantos: 0,
          prestamos: 0,
          horasExtras: 0,
          sfs: 800,
          uniformes: 115,
          rifa: 85,
          volaos: 0,
          incentivos: 0,
          feriado: 0,
          almuerzo: 0,
        });
      }
      p = {
        id: `pay-mono-${period}-h${half}-${tanda}`,
        period,
        half,
        group: "monorriel",
        tanda,
        payDate: payDateFor(period, half),
        status: "draft",
        note: `Nómina Monorriel · ${tanda} · Días desde reportes`,
        lines,
        createdAt: now,
        updatedAt: now,
        createdBy: "feed-mono-days",
      };
    } else {
      let changed = false;
      for (const row of rows) {
        let line = (p.lines || []).find(
          (l) => (row.employeeId && l.employeeId === row.employeeId) || loose(l.fullName, row.name)
        );
        if (!line) {
          const person = row.person || roster.find((r) => loose(r.name, row.name));
          line = {
            employeeId: row.employeeId || (person && (person.employeeId || person.id)) || "",
            fullName: row.name,
            position: (person && person.position) || "Monorriel",
            daysWorked: String(row.daysCount),
            daysFromReports: true,
            salaryMonthly: Math.max(0, Number(person && person.salaryMonthly) || 24000),
            adelantos: 0,
            prestamos: 0,
            horasExtras: 0,
            sfs: 800,
            uniformes: 115,
            rifa: 85,
          };
          p.lines = p.lines || [];
          p.lines.push(line);
          changed = true;
        } else if (String(line.daysWorked) !== String(row.daysCount) || !line.daysFromReports) {
          const adel = line.adelantos;
          const prest = line.prestamos;
          const hex = line.horasExtras;
          const hm = line.horasExtrasManual;
          line.daysWorked = String(row.daysCount);
          line.daysFromReports = true;
          line.adelantos = adel;
          line.prestamos = prest;
          if (hm) {
            line.horasExtras = hex;
            line.horasExtrasManual = true;
          }
          changed = true;
        }
      }
      if (!changed) continue;
      p.updatedAt = now;
      if (!/días desde reportes/i.test(p.note || "")) {
        p.note = `${p.note || ""} · Días desde reportes`.replace(/^\s·\s*/, "").trim();
      }
    }
    await patchDoc(
      `rfs_payrolls/${safeId(p.id)}`,
      {
        payrollJson: { stringValue: JSON.stringify(p) },
        group: { stringValue: "monorriel" },
        period: { stringValue: period },
        updatedAt: { stringValue: p.updatedAt || now },
      },
      ["payrollJson", "group", "period", "updatedAt"]
    );
    if (!ids.includes(p.id)) ids.unshift(p.id);
    payrollByKey.set(pkey, p);
    touched += 1;
    console.log("OK", p.id, "lines", (p.lines || []).length);
  }
  return touched;
}

function nextYm(ym) {
  const [y0, m0] = ym.split("-").map(Number);
  let y = y0;
  let m = m0 + 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

const now = new Date();
const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const periodArg = process.argv[2] || "auto";
const halfArg = process.argv[3] || "both";
const halves = halfArg === "both" ? [1, 2] : [Number(halfArg) === 2 ? 2 : 1];
// auto = mes actual + siguiente (todos los cortes, incl. noviembre)
const periods =
  periodArg === "auto"
    ? [defaultPeriod, nextYm(defaultPeriod)]
    : [String(periodArg).slice(0, 7)];

const main = await getDoc("rfs/main");
const reports = JSON.parse(main.fields.monorrielReportsJson.stringValue || "[]");
const idx = await getDoc("rfs/payroll_index");
let ids = JSON.parse((idx && idx.fields.payrollIdsJson.stringValue) || "[]");
const payrollByKey = new Map();
for (const id of ids) {
  const d = await getDoc(`rfs_payrolls/${safeId(id)}`);
  if (!d) continue;
  const p = JSON.parse(d.fields.payrollJson.stringValue);
  if (p.group !== "monorriel") continue;
  payrollByKey.set(`${p.period}|${p.half === 2 ? 2 : 1}|${p.tanda || "dia"}`, p);
}

let total = 0;
for (const period of periods) {
  for (const h of halves) total += await feedHalf(period, h, reports, payrollByKey, ids);
}
await patchDoc(
  "rfs/payroll_index",
  {
    payrollIdsJson: { stringValue: JSON.stringify(ids) },
    updatedAt: { stringValue: new Date().toISOString() },
    schema: { stringValue: "payrolls-v1" },
  },
  ["payrollIdsJson", "updatedAt", "schema"]
);
console.log("Done. payrolls touched:", total, "periods", periods.join(", "), "halves", halves.join(","));
