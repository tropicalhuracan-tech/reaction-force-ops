/* ==== MÓDULO RAMÓN VARGAS — reporte diurno/nocturno → Reaction Banco / Efectivo ==== */
const VARGAS_KEY = "rfs-ops-vargas";

let vargasData = emptyVargasData();
let vargasFilterShift = "all"; // all | diurno | nocturno
let vargasFilterBucket = "all"; // all | B | E | none
let vargasSearch = "";

function emptyVargasData() {
  return { reports: [] };
}

function vargasReportId(period, half) {
  return `vargas-${period}-h${half === 2 ? 2 : 1}`;
}

function cloneVargasSeedReport(seed) {
  const src = seed && typeof seed === "object" ? seed : {};
  const half = src.half === 1 || src.half === "1" ? 1 : 2;
  const period = String(src.period || "").slice(0, 7) || "2026-10";
  const dayNums = Array.isArray(src.dayNums) && src.dayNums.length
    ? src.dayNums.map((d) => Number(d)).filter((d) => d >= 1 && d <= 31)
    : half === 1
      ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
      : [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
  return {
    id: vargasReportId(period, half),
    period,
    half,
    from: String(src.from || "").slice(0, 10),
    to: String(src.to || "").slice(0, 10),
    label: String(src.label || "").trim(),
    dayNums,
    sections: (Array.isArray(src.sections) ? src.sections : []).map((sec) => ({
      shift: sec.shift === "nocturno" ? "nocturno" : "diurno",
      postName: String(sec.postName || "").trim() || "(sin puesto)",
      employees: (Array.isArray(sec.employees) ? sec.employees : []).map((emp) => ({
        fullName: String(emp.fullName || "").trim(),
        marks: emp.marks && typeof emp.marks === "object" ? { ...emp.marks } : {},
        payBucket: normalizeVargasPayBucket(emp.payBucket),
      })),
    })),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeVargasPayBucket(v) {
  const s = String(v || "")
    .trim()
    .toUpperCase();
  if (s === "B" || s === "BANCO") return "B";
  if (s === "E" || s === "EFECTIVO") return "E";
  return "";
}

function normalizeVargasReport(raw = {}) {
  const half = raw.half === 1 || raw.half === "1" ? 1 : 2;
  const period = String(raw.period || "").slice(0, 7);
  const dayNums = Array.isArray(raw.dayNums)
    ? raw.dayNums.map((d) => Number(d)).filter((d) => d >= 1 && d <= 31)
    : [];
  return {
    id: String(raw.id || vargasReportId(period, half)),
    period,
    half,
    from: String(raw.from || "").slice(0, 10),
    to: String(raw.to || "").slice(0, 10),
    label: String(raw.label || "").trim(),
    dayNums,
    sections: (Array.isArray(raw.sections) ? raw.sections : []).map((sec) => ({
      shift: sec.shift === "nocturno" ? "nocturno" : "diurno",
      postName: String(sec.postName || "").trim() || "(sin puesto)",
      employees: (Array.isArray(sec.employees) ? sec.employees : []).map((emp) => ({
        fullName: String(emp.fullName || "").trim(),
        marks: emp.marks && typeof emp.marks === "object" ? { ...emp.marks } : {},
        payBucket: normalizeVargasPayBucket(emp.payBucket),
      })),
    })),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

function normalizeVargasData(raw = {}) {
  const reports = (Array.isArray(raw.reports) ? raw.reports : [])
    .map(normalizeVargasReport)
    .filter((r) => r.period && r.sections);
  reports.sort((a, b) => {
    const c = String(b.period).localeCompare(String(a.period));
    if (c) return c;
    return (b.half || 0) - (a.half || 0);
  });
  return { reports };
}

function ensureVargasSeedLoaded() {
  vargasData = normalizeVargasData(vargasData);
  if (vargasData.reports.length) return false;
  const seed = typeof window !== "undefined" ? window.RFS_VARGAS_SEED : null;
  if (!seed || !Array.isArray(seed.sections) || !seed.sections.length) return false;
  const report = cloneVargasSeedReport(seed);
  vargasData = { reports: [report] };
  localStorage.setItem(VARGAS_KEY, JSON.stringify(vargasData));
  return true;
}

function saveVargasData(push = true) {
  vargasData = normalizeVargasData(vargasData);
  localStorage.setItem(VARGAS_KEY, JSON.stringify(vargasData));
  if (push && typeof queueCloudSave === "function") queueCloudSave();
}

function applyRemoteVargasData(remote) {
  const remoteNorm = normalizeVargasData(remote || {});
  const local = normalizeVargasData(vargasData);
  const map = new Map();
  [...local.reports, ...remoteNorm.reports].forEach((r) => {
    if (!r || !r.id) return;
    const prev = map.get(r.id);
    if (!prev || String(r.updatedAt || "") >= String(prev.updatedAt || "")) {
      map.set(r.id, r);
    }
  });
  vargasData = { reports: [...map.values()] };
  ensureVargasSeedLoaded();
  vargasData = normalizeVargasData(vargasData);
  localStorage.setItem(VARGAS_KEY, JSON.stringify(vargasData));
}

function getActiveVargasReport() {
  ensureVargasSeedLoaded();
  vargasData = normalizeVargasData(vargasData);
  return vargasData.reports[0] || null;
}

function vargasMarkIsWorked(mark) {
  if (mark == null || mark === "") return false;
  if (typeof mark === "number") return mark > 0;
  const s = String(mark).trim().toUpperCase();
  if (!s) return false;
  if (/^(FO|INC|N|RENUNCIA|TERMINADO|INICIO)$/i.test(s)) return false;
  if (/RETIRADO/i.test(s)) return false;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n > 0;
}

/** Días para nómina: cuenta marcas trabajadas; día 31 nunca entra. */
function countVargasPayrollDays(marks, dayNums) {
  const days = Array.isArray(dayNums) ? dayNums : [];
  let n = 0;
  days.forEach((d) => {
    if (Number(d) === 31) return;
    const m = marks && marks[String(d)];
    if (vargasMarkIsWorked(m)) n += 1;
  });
  return n;
}

function formatVargasMarkCell(mark) {
  if (mark == null || mark === "") return "";
  if (typeof mark === "number") {
    if (mark === 0) return "0";
    if (mark === 1) return "1";
    return String(mark);
  }
  return String(mark).trim();
}

function vargasNameKey(name) {
  if (typeof monoPayrollNameKey === "function") return monoPayrollNameKey(name);
  return String(name || "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function vargasNamesMatch(a, b) {
  if (typeof monoNamesLooselyMatch === "function") return monoNamesLooselyMatch(a, b);
  const ka = vargasNameKey(a);
  const kb = vargasNameKey(b);
  return !!ka && !!kb && (ka === kb || ka.includes(kb) || kb.includes(ka));
}

function findReactionRosterHit(name, kind) {
  if (typeof getReactionPayrollRoster !== "function") return null;
  const roster = getReactionPayrollRoster(kind === "efectivo" ? "efectivo" : "banco");
  return (roster || []).find((r) => vargasNamesMatch(r.name, name)) || null;
}

function suggestVargasPayBucketsFromRosters(overwrite = false) {
  const report = getActiveVargasReport();
  if (!report) return { filled: 0 };
  let filled = 0;
  report.sections.forEach((sec) => {
    (sec.employees || []).forEach((emp) => {
      if (!overwrite && emp.payBucket) return;
      const inB = findReactionRosterHit(emp.fullName, "banco");
      const inE = findReactionRosterHit(emp.fullName, "efectivo");
      let next = "";
      if (inB && !inE) next = "B";
      else if (inE && !inB) next = "E";
      else if (inB && inE) next = "B";
      if (next && emp.payBucket !== next) {
        emp.payBucket = next;
        filled += 1;
      }
    });
  });
  if (filled) {
    report.updatedAt = new Date().toISOString();
    saveVargasData(true);
  }
  return { filled };
}

function setVargasEmployeePayBucket(sectionIdx, empIdx, value) {
  const report = getActiveVargasReport();
  if (!report || !report.sections[sectionIdx]) return;
  const emp = report.sections[sectionIdx].employees[empIdx];
  if (!emp) return;
  emp.payBucket = normalizeVargasPayBucket(value);
  report.updatedAt = new Date().toISOString();
  saveVargasData(true);
}

function setVargasEmployeeMark(sectionIdx, empIdx, day, value) {
  const report = getActiveVargasReport();
  if (!report || !report.sections[sectionIdx]) return;
  const emp = report.sections[sectionIdx].employees[empIdx];
  if (!emp) return;
  const key = String(day);
  const raw = String(value == null ? "" : value).trim();
  if (!raw) {
    delete emp.marks[key];
  } else if (/^\d+(\.\d+)?$/.test(raw)) {
    emp.marks[key] = Number(raw);
  } else {
    emp.marks[key] = raw;
  }
  report.updatedAt = new Date().toISOString();
  saveVargasData(true);
}

function flattenVargasEmployees(report, opts = {}) {
  const rows = [];
  if (!report) return rows;
  const shift = opts.shift || "all";
  const bucket = opts.bucket || "all";
  const q = String(opts.search || "")
    .trim()
    .toLowerCase();
  (report.sections || []).forEach((sec, sIdx) => {
    if (shift !== "all" && sec.shift !== shift) return;
    (sec.employees || []).forEach((emp, eIdx) => {
      if (bucket === "none" && emp.payBucket) return;
      if (bucket === "B" && emp.payBucket !== "B") return;
      if (bucket === "E" && emp.payBucket !== "E") return;
      if (q) {
        const hay = `${emp.fullName} ${sec.postName}`.toLowerCase();
        if (!hay.includes(q)) return;
      }
      rows.push({
        sectionIdx: sIdx,
        empIdx: eIdx,
        shift: sec.shift,
        postName: sec.postName,
        fullName: emp.fullName,
        marks: emp.marks || {},
        payBucket: emp.payBucket || "",
        daysPayroll: countVargasPayrollDays(emp.marks, report.dayNums),
      });
    });
  });
  return rows;
}

function vargasReportStats(report) {
  const rows = flattenVargasEmployees(report, { shift: "all", bucket: "all" });
  return {
    total: rows.length,
    banco: rows.filter((r) => r.payBucket === "B").length,
    efectivo: rows.filter((r) => r.payBucket === "E").length,
    sinMarca: rows.filter((r) => !r.payBucket).length,
    diurno: rows.filter((r) => r.shift === "diurno").length,
    nocturno: rows.filter((r) => r.shift === "nocturno").length,
  };
}

/**
 * Envía días del reporte Vargas a nóminas Reaction Banco / Efectivo
 * según la columna B/E. Conserva adelantos, préstamos y extras manuales.
 */
function feedVargasPayrollFromReport(opts = {}) {
  const report = opts.report || getActiveVargasReport();
  if (!report) return { updated: 0, lines: 0, reason: "no-report" };
  if (typeof findPayrollByGroup !== "function" || typeof buildPayrollLineFromPerson !== "function") {
    return { updated: 0, lines: 0, reason: "no-payroll-api" };
  }
  const period = opts.period || report.period;
  const half = opts.half != null ? (opts.half === 2 || opts.half === "2" ? 2 : 1) : report.half;
  const createMissing = opts.createMissing !== false;
  const quiet = opts.quiet !== false;

  const byBucket = { B: [], E: [] };
  (report.sections || []).forEach((sec) => {
    (sec.employees || []).forEach((emp) => {
      const bucket = normalizeVargasPayBucket(emp.payBucket);
      if (bucket !== "B" && bucket !== "E") return;
      const daysCount = countVargasPayrollDays(emp.marks, report.dayNums);
      byBucket[bucket].push({
        fullName: emp.fullName,
        postName: sec.postName,
        shift: sec.shift,
        daysCount,
      });
    });
  });

  let payrollsTouched = 0;
  let linesTouched = 0;
  const summary = { banco: 0, efectivo: 0, skipped: 0 };

  [
    { key: "B", group: "banco", label: "Reaction Banco" },
    { key: "E", group: "efectivo", label: "Reaction Efectivo" },
  ].forEach(({ key, group, label }) => {
    const rows = byBucket[key];
    if (!rows.length) return;

    let payroll = findPayrollByGroup(period, half, group, "");
    if (!payroll && createMissing && typeof generatePayrollForSelection === "function") {
      const gen = generatePayrollForSelection({
        period,
        half,
        group,
        quiet: true,
        skipConfirm: true,
      });
      payroll = gen && gen.payroll;
    }
    if (!payroll) {
      summary.skipped += rows.length;
      return;
    }

    const formulaOpts =
      typeof payrollComputeOpts === "function" ? payrollComputeOpts(payroll) : {};
    const prevByName = new Map();
    (payroll.lines || []).forEach((l) => {
      if (!l) return;
      const nk = vargasNameKey(l.fullName);
      if (nk) prevByName.set(nk, l);
    });

    let changed = false;
    rows.forEach((row) => {
      const displayName =
        typeof payrollCleanEmployeeName === "function"
          ? payrollCleanEmployeeName(row.fullName)
          : String(row.fullName || "").trim();
      const nameKey = vargasNameKey(displayName);
      let line =
        prevByName.get(nameKey) ||
        (payroll.lines || []).find((l) => vargasNamesMatch(l.fullName, displayName)) ||
        null;

      const rosterHit = findReactionRosterHit(displayName, group);
      const keepAdelantos = line ? Math.max(0, Number(line.adelantos) || 0) : 0;
      const keepPrestamos = line ? Math.max(0, Number(line.prestamos) || 0) : 0;
      const keepExtrasManual = !!(line && line.horasExtrasManual);
      const keepExtras = keepExtrasManual ? Math.max(0, Number(line.horasExtras) || 0) : null;

      if (!line) {
        const person = rosterHit
          ? {
              ...rosterHit,
              name: displayName,
              position: rosterHit.position || row.postName || label,
              daysWorked: String(row.daysCount),
            }
          : {
              id: "",
              employeeId: "",
              name: displayName,
              position: row.postName || label,
              salaryMonthly:
                typeof LVA_PAYROLL_DEFAULT_MONTHLY !== "undefined" ? LVA_PAYROLL_DEFAULT_MONTHLY : 24000,
              daysWorked: String(row.daysCount),
            };
        line = buildPayrollLineFromPerson(person, null, label, formulaOpts);
        payroll.lines = payroll.lines || [];
        payroll.lines.push(line);
        prevByName.set(nameKey, line);
        changed = true;
        linesTouched += 1;
      }

      const nextDays = String(Math.max(0, row.daysCount));
      const prevDays = String(line.daysWorked || "").trim();
      if (prevDays !== nextDays || !line.daysFromVargas) {
        line.daysWorked = nextDays;
        line.daysFromVargas = true;
        if (!String(line.fullName || "").trim()) line.fullName = displayName;
        if (row.postName && (!line.position || /reaction/i.test(String(line.position)))) {
          line.position = row.postName;
        }
        changed = true;
        linesTouched += 1;
      }

      line.adelantos = keepAdelantos;
      line.prestamos = keepPrestamos;
      if (keepExtrasManual) {
        line.horasExtras = keepExtras;
        line.horasExtrasManual = true;
      }
      if (typeof computePayrollLineTotals === "function") {
        let recomputed = computePayrollLineTotals(line, formulaOpts);
        recomputed.adelantos = keepAdelantos;
        recomputed.prestamos = keepPrestamos;
        if (keepExtrasManual) {
          recomputed.horasExtras = keepExtras;
          recomputed.horasExtrasManual = true;
          recomputed = computePayrollLineTotals(recomputed, formulaOpts);
          recomputed.adelantos = keepAdelantos;
          recomputed.prestamos = keepPrestamos;
          recomputed.horasExtras = keepExtras;
          recomputed.horasExtrasManual = true;
        }
        recomputed.daysFromVargas = true;
        Object.assign(line, recomputed);
      }

      if (key === "B") summary.banco += 1;
      else summary.efectivo += 1;
    });

    if (changed) {
      payroll.updatedAt = new Date().toISOString();
      payroll.note = String(payroll.note || "");
      if (!/días desde Vargas/i.test(payroll.note)) {
        payroll.note = `${payroll.note} · Días desde Vargas`.replace(/^\s·\s*/, "").trim();
      }
      payrollsTouched += 1;
    }
  });

  if (payrollsTouched && typeof saveContabilidadData === "function") {
    saveContabilidadData(true);
  }
  if (!quiet && typeof toast === "function") {
    toast(
      `Reorganizado: ${summary.banco} banco · ${summary.efectivo} efectivo` +
        (summary.skipped ? ` · ${summary.skipped} sin nómina` : "")
    );
  }
  return {
    updated: payrollsTouched,
    lines: linesTouched,
    banco: summary.banco,
    efectivo: summary.efectivo,
    skipped: summary.skipped,
  };
}

function reorganizeVargasToPayroll() {
  if (!canAccessVargas()) {
    if (typeof toast === "function") toast("Sin acceso a Ramón Vargas.");
    return;
  }
  const report = getActiveVargasReport();
  if (!report) {
    if (typeof toast === "function") toast("No hay reporte Vargas cargado.");
    return;
  }
  const stats = vargasReportStats(report);
  if (!stats.banco && !stats.efectivo) {
    if (typeof toast === "function") {
      toast("Marca B (banco) o E (efectivo) en la columna Pago y vuelve a pulsar Reorganizar.");
    }
    return;
  }
  if (
    !confirm(
      `¿Reorganizar a nómina?\n\n` +
        `Período ${report.period} · corte ${report.half === 2 ? "16–30" : "01–15"}\n` +
        `Banco (B): ${stats.banco}\nEfectivo (E): ${stats.efectivo}\n` +
        `Sin marca: ${stats.sinMarca} (no se envían)\n\n` +
        `El día 31 no entra en nómina. Se conservan adelantos/préstamos.`
    )
  ) {
    return;
  }
  const result = feedVargasPayrollFromReport({ report, quiet: false, createMissing: true });
  if (typeof renderNominaTab === "function") {
    try {
      renderNominaTab();
    } catch (_) {}
  }
  renderVargasModule();
  return result;
}

function renderVargasModule() {
  if (typeof canAccessVargas === "function" && !canAccessVargas()) return;
  ensureVargasSeedLoaded();
  const report = getActiveVargasReport();
  const summary = document.getElementById("vargasSummary");
  const host = document.getElementById("vargasReportHost");
  if (!host) return;

  if (!report) {
    if (summary) {
      summary.textContent = "Sin reporte. Carga la semilla Excel o sincroniza la nube.";
    }
    host.innerHTML =
      '<div class="form-card"><p class="muted">No hay datos del reporte de Ramón Vargas.</p></div>';
    return;
  }

  const stats = vargasReportStats(report);
  if (summary) {
    summary.textContent = `${report.label || report.period} · ${stats.total} empleados · B ${stats.banco} · E ${stats.efectivo} · sin marca ${stats.sinMarca}`;
  }

  const rows = flattenVargasEmployees(report, {
    shift: vargasFilterShift,
    bucket: vargasFilterBucket,
    search: vargasSearch,
  });

  const dayHeaders = (report.dayNums || [])
    .map((d) => {
      const excl = Number(d) === 31 ? ' title="Día 31: se ve en reporte, no entra en nómina"' : "";
      return `<th class="vargas-day${Number(d) === 31 ? " vargas-day-excl" : ""}"${excl}>${d}</th>`;
    })
    .join("");

  const body = rows
    .map((row) => {
      const markCells = (report.dayNums || [])
        .map((d) => {
          const val = formatVargasMarkCell(row.marks[String(d)]);
          const worked = vargasMarkIsWorked(row.marks[String(d)]);
          const excl = Number(d) === 31;
          return `<td class="vargas-day-cell${worked ? " is-work" : ""}${excl ? " is-excl" : ""}" data-s="${row.sectionIdx}" data-e="${row.empIdx}" data-day="${d}" contenteditable="true" spellcheck="false">${escapeVargasHtml(val)}</td>`;
        })
        .join("");
      const bucketSel = `
        <select class="vargas-bucket" data-s="${row.sectionIdx}" data-e="${row.empIdx}" aria-label="Pago B o E">
          <option value="" ${!row.payBucket ? "selected" : ""}>—</option>
          <option value="B" ${row.payBucket === "B" ? "selected" : ""}>B</option>
          <option value="E" ${row.payBucket === "E" ? "selected" : ""}>E</option>
        </select>`;
      return `<tr data-shift="${row.shift}">
        <td class="vargas-shift">${row.shift === "nocturno" ? "N" : "D"}</td>
        <td class="sticky-name vargas-name">${escapeVargasHtml(row.fullName)}</td>
        <td class="vargas-post">${escapeVargasHtml(row.postName)}</td>
        <td class="vargas-bucket-cell">${bucketSel}</td>
        <td class="vargas-days-total">${row.daysPayroll}</td>
        ${markCells}
      </tr>`;
    })
    .join("");

  host.innerHTML = `
    <div class="form-card vargas-toolbar">
      <div class="vargas-toolbar-row">
        <label>Buscar
          <input id="vargasSearchInput" type="search" placeholder="Nombre o puesto" value="${escapeVargasAttr(vargasSearch)}" />
        </label>
        <label>Turno
          <select id="vargasFilterShift">
            <option value="all" ${vargasFilterShift === "all" ? "selected" : ""}>Todos</option>
            <option value="diurno" ${vargasFilterShift === "diurno" ? "selected" : ""}>Diurno (${stats.diurno})</option>
            <option value="nocturno" ${vargasFilterShift === "nocturno" ? "selected" : ""}>Nocturno (${stats.nocturno})</option>
          </select>
        </label>
        <label>Pago
          <select id="vargasFilterBucket">
            <option value="all" ${vargasFilterBucket === "all" ? "selected" : ""}>Todos</option>
            <option value="B" ${vargasFilterBucket === "B" ? "selected" : ""}>Banco (B)</option>
            <option value="E" ${vargasFilterBucket === "E" ? "selected" : ""}>Efectivo (E)</option>
            <option value="none" ${vargasFilterBucket === "none" ? "selected" : ""}>Sin marca</option>
          </select>
        </label>
      </div>
      <div class="vargas-actions">
        <button type="button" class="secondary" id="btnVargasSuggestBE">Sugerir B/E</button>
        <button type="button" class="primary" id="btnVargasReorganizar">Reorganizar → nómina</button>
      </div>
      <p class="muted tight" style="margin-top:10px">
        Columna <strong>B/E</strong>: escribe o elige <strong>B</strong> (banco) o <strong>E</strong> (efectivo).
        Al pulsar <strong>Reorganizar</strong> se actualizan las nóminas Reaction Banco / Efectivo con los días trabajados (sin día 31).
      </p>
    </div>
    <div class="form-card" style="padding:0; overflow:hidden">
      <div class="vargas-table-wrap">
        <table class="vargas-table">
          <thead>
            <tr>
              <th>T</th>
              <th class="sticky-name">Empleado</th>
              <th>Puesto</th>
              <th>B/E</th>
              <th>Días</th>
              ${dayHeaders}
            </tr>
          </thead>
          <tbody>
            ${body || `<tr><td colspan="${5 + (report.dayNums || []).length}" class="muted" style="padding:16px">Ningún empleado con este filtro.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;

  bindVargasUiHandlers();
}

function escapeVargasHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeVargasAttr(s) {
  return escapeVargasHtml(s).replace(/'/g, "&#39;");
}

function bindVargasUiHandlers() {
  const search = document.getElementById("vargasSearchInput");
  if (search) {
    search.addEventListener("input", () => {
      vargasSearch = search.value || "";
      renderVargasModule();
      const el = document.getElementById("vargasSearchInput");
      if (el) {
        el.focus();
        const len = el.value.length;
        try {
          el.setSelectionRange(len, len);
        } catch (_) {}
      }
    });
  }
  const shift = document.getElementById("vargasFilterShift");
  if (shift) {
    shift.addEventListener("change", () => {
      vargasFilterShift = shift.value || "all";
      renderVargasModule();
    });
  }
  const bucket = document.getElementById("vargasFilterBucket");
  if (bucket) {
    bucket.addEventListener("change", () => {
      vargasFilterBucket = bucket.value || "all";
      renderVargasModule();
    });
  }
  document.querySelectorAll(".vargas-bucket").forEach((sel) => {
    sel.addEventListener("change", () => {
      const s = Number(sel.dataset.s);
      const e = Number(sel.dataset.e);
      setVargasEmployeePayBucket(s, e, sel.value);
      renderVargasModule();
    });
  });
  document.querySelectorAll(".vargas-day-cell").forEach((cell) => {
    cell.addEventListener("blur", () => {
      const s = Number(cell.dataset.s);
      const e = Number(cell.dataset.e);
      const day = Number(cell.dataset.day);
      setVargasEmployeeMark(s, e, day, cell.textContent);
    });
  });
  const btnSug = document.getElementById("btnVargasSuggestBE");
  if (btnSug) {
    btnSug.addEventListener("click", () => {
      const r = suggestVargasPayBucketsFromRosters(false);
      if (typeof toast === "function") {
        toast(r.filled ? `Sugeridos ${r.filled} B/E desde nómina existente.` : "No hubo cambios (ya marcados o sin coincidencia).");
      }
      renderVargasModule();
    });
  }
  const btnReorg = document.getElementById("btnVargasReorganizar");
  if (btnReorg) {
    btnReorg.addEventListener("click", () => reorganizeVargasToPayroll());
  }
}

// Expose for cloud / app wiring
window.RFSVargas = {
  emptyVargasData,
  normalizeVargasData,
  applyRemoteVargasData,
  saveVargasData,
  ensureVargasSeedLoaded,
  getActiveVargasReport,
  feedVargasPayrollFromReport,
  reorganizeVargasToPayroll,
  renderVargasModule,
};
