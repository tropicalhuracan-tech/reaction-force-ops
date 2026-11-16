/**
 * Importar asistencia desde Excel (.xlsx / .xls / .csv) → Ramón Vargas y Monorriel.
 * Formato flexible: fila de encabezado con Nombre, Puesto, Turno (opcional), Planilla (Monorriel),
 * columnas 1–31 con marcas (1, 1.5, 2, etc.).
 */
(function () {
  const XLSX_CDN = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";

  function ensureXlsxLib() {
    if (typeof window !== "undefined" && window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = XLSX_CDN;
      s.async = true;
      s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error("XLSX no cargó")));
      s.onerror = () => reject(new Error("No se pudo descargar el lector Excel"));
      document.head.appendChild(s);
    });
  }

  function cellStr(v) {
    if (v == null) return "";
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    return String(v).trim();
  }

  function parseMarkValue(raw) {
    const text = cellStr(raw).replace(",", ".").toLowerCase();
    if (!text) return null;
    if (text === "v" || text === "volao" || text === "vol") return 2;
    if (/^\d+(\.\d+)?$/.test(text)) {
      const n = Number(text);
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
    return null;
  }

  function normalizeShiftToken(raw) {
    const s = cellStr(raw).toLowerCase();
    if (!s) return "diurno";
    if (/^n\b|noct|noche|\bpm\b/.test(s)) return "nocturno";
    return "diurno";
  }

  function normalizeMonoSheetHint(raw, shift) {
    const s = cellStr(raw).toLowerCase();
    if (!s) return "";
    if (/moto/.test(s)) return shift === "nocturno" ? "moto_noche" : "moto_dia";
    if (/noch|noche|\bpm\b/.test(s)) return "noche";
    if (/dia|día|diurn|am|\bam\b/.test(s)) return "dia";
    return "";
  }

  function normalizePayBucket(raw) {
    const s = cellStr(raw).toUpperCase();
    if (s === "B" || /^BANCO/.test(s)) return "B";
    if (s === "E" || /^EFECT/.test(s)) return "E";
    return "";
  }

  function findHeaderRow(matrix) {
    for (let r = 0; r < Math.min(matrix.length, 25); r++) {
      const row = (matrix[r] || []).map((c) => cellStr(c).toLowerCase());
      if (row.some((c) => /nombre|empleado/.test(c))) return r;
    }
    return 0;
  }

  function headerMap(matrix, headerRow, allowedDays) {
    const headers = (matrix[headerRow] || []).map((c, i) => ({
      i,
      key: cellStr(c).toLowerCase().replace(/\s+/g, " "),
      raw: cellStr(c),
    }));
    const pick = (re) => headers.find((h) => re.test(h.key));
    const nameCol = pick(/nombre|empleado/);
    const postCol = pick(/puesto|ubicaci|cargo|post/);
    const shiftCol = pick(/turno/);
    const sheetCol = pick(/planilla|hoja|sheet|tanda/);
    const bucketCol = pick(/^b\/e$|^be$|banco|efectivo/);
    const hexCol = pick(/hora\s*ext|horas/);
    const pagosCol = pick(/volao.*pago|pagos/);
    const daySet = new Set((allowedDays || []).map((d) => Number(d)));
    const dayCols = headers.filter((h) => {
      const n = Number(h.raw);
      return Number.isInteger(n) && n >= 1 && n <= 31 && (daySet.size ? daySet.has(n) : true);
    });
    return { nameCol, postCol, shiftCol, sheetCol, bucketCol, hexCol, pagosCol, dayCols, headerRow };
  }

  function parseMatrixToRows(matrix, allowedDays, defaults = {}) {
    if (!matrix || !matrix.length) return [];
    const map = headerMap(matrix, findHeaderRow(matrix), allowedDays);
    if (!map.nameCol) return [];
    const out = [];
    for (let r = map.headerRow + 1; r < matrix.length; r++) {
      const row = matrix[r] || [];
      const fullName = cellStr(row[map.nameCol.i]).replace(/\s+/g, " ").trim().toUpperCase();
      if (!fullName) continue;
      const shift = map.shiftCol ? normalizeShiftToken(row[map.shiftCol.i]) : defaults.shift || "diurno";
      const postName = map.postCol
        ? cellStr(row[map.postCol.i]).replace(/\s+/g, " ").trim().toUpperCase()
        : defaults.postName || "(SIN PUESTO)";
      const sheetHint = map.sheetCol ? normalizeMonoSheetHint(row[map.sheetCol.i], shift) : defaults.sheetId || "";
      const marks = {};
      map.dayCols.forEach((dc) => {
        const day = Number(dc.raw);
        const val = parseMarkValue(row[dc.i]);
        if (val != null && val > 0) marks[String(day)] = val;
      });
      const payBucket = map.bucketCol ? normalizePayBucket(row[map.bucketCol.i]) : "";
      let horasExtras = 0;
      if (map.hexCol) {
        const hx = cellStr(row[map.hexCol.i]).replace(",", ".");
        if (hx && /^\d+(\.\d+)?$/.test(hx)) horasExtras = Number(hx);
      }
      const volaosPagos = map.pagosCol ? cellStr(row[map.pagosCol.i]) : "";
      out.push({ fullName, postName, shift, sheetHint, marks, payBucket, horasExtras, volaosPagos });
    }
    return out;
  }

  async function readWorkbook(file) {
    const XLSX = await ensureXlsxLib();
    const buf = await file.arrayBuffer();
  const isCsv = /\.csv$/i.test(file.name || "");
    const wb = isCsv
      ? XLSX.read(new TextDecoder("utf-8").decode(buf), { type: "string" })
      : XLSX.read(buf, { type: "array" });
    return { XLSX, wb };
  }

  function sheetMatrices(wb, XLSX) {
    return (wb.SheetNames || []).map((name) => {
      const ws = wb.Sheets[name];
      const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
      return { name, matrix };
    });
  }

  function applyRowsToVargas(report, rows) {
    if (!report || !rows.length) return { added: 0, updated: 0, marks: 0 };
    if (typeof vargasPushUndo === "function") vargasPushUndo("excel");
    let added = 0;
    let updated = 0;
    let marks = 0;
    rows.forEach((row) => {
      const shift = row.shift === "nocturno" ? "nocturno" : "diurno";
      let section = (report.sections || []).find(
        (s) =>
          (s.shift === "nocturno" ? "nocturno" : "diurno") === shift &&
          String(s.postName || "").trim().toUpperCase() === String(row.postName || "").trim().toUpperCase()
      );
      if (!section) {
        section = { shift, postName: row.postName, employees: [], deletedKeys: [] };
        report.sections = report.sections || [];
        report.sections.push(section);
      }
      let empIdx = (section.employees || []).findIndex(
        (e) =>
          typeof vargasNameKey === "function" &&
          vargasNameKey(e.fullName) === vargasNameKey(row.fullName)
      );
      if (empIdx < 0) {
        section.employees.push({
          fullName: row.fullName,
          marks: {},
          payBucket: row.payBucket || "",
          payBucketSetAt: row.payBucket ? new Date().toISOString() : "",
          volaosPagos: row.volaosPagos || "",
          horasExtras: row.horasExtras || 0,
          nameManual: true,
        });
        empIdx = section.employees.length - 1;
        added += 1;
      } else {
        updated += 1;
      }
      const emp = section.employees[empIdx];
      if (!emp.marks) emp.marks = {};
      Object.keys(row.marks || {}).forEach((d) => {
        emp.marks[d] = row.marks[d];
        marks += 1;
      });
      if (row.payBucket && !emp.payBucket) {
        emp.payBucket = row.payBucket;
        emp.payBucketSetAt = new Date().toISOString();
      }
      if (row.horasExtras > 0) emp.horasExtras = row.horasExtras;
      if (row.volaosPagos) emp.volaosPagos = row.volaosPagos;
    });
    report.updatedAt = new Date().toISOString();
    return { added, updated, marks };
  }

  function applyRowsToMonorriel(report, sheetId, rows) {
    if (!report || !sheetId || !rows.length) return { added: 0, updated: 0, marks: 0 };
    if (typeof monoQPushUndo === "function") monoQPushUndo("excel");
    report.sheets = report.sheets || {};
    if (!report.sheets[sheetId]) report.sheets[sheetId] = { employees: [], deletedKeys: [] };
    const sheet = report.sheets[sheetId];
    let added = 0;
    let updated = 0;
    let marks = 0;
    rows.forEach((row) => {
      const key = typeof monoQKey === "function" ? monoQKey(row.fullName) : row.fullName;
      let emp = (sheet.employees || []).find((e) => (typeof monoQKey === "function" ? monoQKey(e.fullName) : e.fullName) === key);
      if (!emp) {
        emp = {
          fullName: row.fullName,
          position: row.postName || "",
          marks: {},
          employeeId: "",
          volaosPagos: "",
          horasExtras: row.horasExtras || 0,
          nameManual: true,
        };
        sheet.employees.push(emp);
        added += 1;
      } else {
        updated += 1;
        if (row.postName) emp.position = row.postName;
      }
      if (!emp.marks) emp.marks = {};
      Object.keys(row.marks || {}).forEach((d) => {
        emp.marks[d] = row.marks[d];
        marks += 1;
      });
      if (row.horasExtras > 0) emp.horasExtras = row.horasExtras;
      if (row.volaosPagos && typeof monoQPagos === "function") emp.volaosPagos = monoQPagos(row.volaosPagos);
    });
    report.updatedAt = new Date().toISOString();
    return { added, updated, marks };
  }

  async function importVargasFromExcelFile(file) {
    if (!file) return { ok: false, reason: "no-file" };
    const report = typeof getActiveVargasReport === "function" ? getActiveVargasReport() : null;
    if (!report) return { ok: false, reason: "no-report" };
    const { wb, XLSX } = await readWorkbook(file);
    const sheets = sheetMatrices(wb, XLSX);
    const dayNums = report.dayNums || [];
    let allRows = [];
    sheets.forEach((sh) => {
      const defShift = /noct|noche|pm/i.test(sh.name) ? "nocturno" : "diurno";
      const part = parseMatrixToRows(sh.matrix, dayNums, { shift: defShift });
      allRows = allRows.concat(part);
    });
    if (!allRows.length) return { ok: false, reason: "no-rows" };
    const stats = applyRowsToVargas(report, allRows);
    if (typeof saveVargasData === "function") saveVargasData(true, true);
    if (typeof renderVargasModule === "function") renderVargasModule();
    return { ok: true, ...stats, people: allRows.length };
  }

  async function importMonorrielFromExcelFile(file) {
    if (!file) return { ok: false, reason: "no-file" };
    const report = typeof monoQActive === "function" ? monoQActive() : null;
    if (!report) return { ok: false, reason: "no-report" };
    const activeSheet =
      typeof monoQSheet !== "undefined" && monoQSheet
        ? monoQSheet
        : (typeof MONOQ_SHEETS !== "undefined" && MONOQ_SHEETS[0] && MONOQ_SHEETS[0].id) || "dia";
    const { wb, XLSX } = await readWorkbook(file);
    const sheets = sheetMatrices(wb, XLSX);
    const dayNums = report.dayNums || [];
    let total = { added: 0, updated: 0, marks: 0, people: 0 };
    sheets.forEach((sh) => {
      const defShift = /noct|noche|pm/i.test(sh.name) ? "nocturno" : "diurno";
      let sheetId = normalizeMonoSheetHint(sh.name, defShift) || activeSheet;
      const rows = parseMatrixToRows(sh.matrix, dayNums, { shift: defShift, sheetId: activeSheet });
      const bySheet = new Map();
      rows.forEach((row) => {
        const sid = row.sheetHint || sheetId || activeSheet;
        if (!bySheet.has(sid)) bySheet.set(sid, []);
        bySheet.get(sid).push(row);
      });
      bySheet.forEach((list, sid) => {
        const st = applyRowsToMonorriel(report, sid, list);
        total.added += st.added;
        total.updated += st.updated;
        total.marks += st.marks;
        total.people += list.length;
      });
    });
    if (!total.people) return { ok: false, reason: "no-rows" };
    if (typeof monoQSave === "function") monoQSave(true);
    if (typeof renderMonorrielQuincenaModule === "function") renderMonorrielQuincenaModule();
    return { ok: true, ...total };
  }

  function bindExcelImportButton(btnId, inputId, handler) {
    const btn = document.getElementById(btnId);
    if (!btn || btn.dataset.excelBound) return;
    btn.dataset.excelBound = "1";
    let input = document.getElementById(inputId);
    if (!input) {
      input = document.createElement("input");
      input.type = "file";
      input.id = inputId;
      input.accept = ".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      input.hidden = true;
      document.body.appendChild(input);
    }
    btn.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.value = "";
      if (!file) return;
      if (
        !confirm(
          `¿Importar «${file.name}»?\n\nCombina con la quincena abierta: las marcas del Excel reemplazan el día en cada celda.\nNo borra personas que no vengan en el archivo.\nLuego use Enviar a nómina / Guardar respaldo.`
        )
      ) {
        return;
      }
      btn.disabled = true;
      try {
        const r = await handler(file);
        if (!r.ok) {
          const msg =
            r.reason === "no-rows"
              ? "No se reconoció formato. Use columnas: Nombre, Puesto, Turno (opcional) y días 1–31."
              : "No se pudo importar.";
          if (typeof toast === "function") toast(msg);
          return;
        }
        if (typeof toast === "function") {
          toast(
            `Excel importado · ${r.people} fila(s) · +${r.added} nuevo(s) · ${r.updated} actualizado(s) · ${r.marks} marca(s)`
          );
        }
      } catch (err) {
        console.error(err);
        if (typeof toast === "function") toast(`Error leyendo Excel: ${(err && err.message) || err}`);
      } finally {
        btn.disabled = false;
      }
    });
  }

  window.importVargasFromExcelFile = importVargasFromExcelFile;
  window.importMonorrielFromExcelFile = importMonorrielFromExcelFile;
  window.bindVargasExcelImport = () => bindExcelImportButton("btnVargasImportExcel", "vargasExcelFile", importVargasFromExcelFile);
  window.bindMonorrielExcelImport = () =>
    bindExcelImportButton("btnMonoQImportExcel", "monoQExcelFile", importMonorrielFromExcelFile);
})();