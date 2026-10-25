/* RFS Reportes — App independiente para supervisores (build 188) */
const APP_BUILD = 189;
const APP_VERSION_LABEL = "v189-reportes";
const OWNER_USERNAME = "admin";
const TYPE_LABEL = { novedad: "Novedad", checkin: "Check-in", incidente: "Incidente" };
const STATUS_LABEL = { ok: "En puesto", warn: "Pendiente", alert: "Incidente" };
const POSTS_KEY = "rfs-rep-posts";
const REPORTS_KEY = "rfs-rep-reports";
const USERS_KEY = "rfs-rep-users";
const SESSION_KEY = "rfs-rep-session-user";

let posts = [];
let reports = [];
let appUsers = [];
let currentUser = null;
let pendingPhotoDataUrl = null;
let cloudBusy = false;

function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}
function getPost(id) { return posts.find((p) => p.id === id); }
function emptyGuard() { return { name: "", phone: "", cedula: "", weapons: "", serial: "", companyEntryDate: "" }; }
function normalizeGuard(g = {}) {
  return {
    name: String(g.name || "").trim(),
    phone: String(g.phone || "").trim(),
    cedula: String(g.cedula || "").trim(),
    weapons: String(g.weapons || "").trim(),
    serial: String(g.serial || g.license || "").trim(),
    companyEntryDate: String(g.companyEntryDate || "").trim(),
  };
}
function calcMonthly(hours, rate, priceMonth, priceNow) {
  const m = Number(priceMonth);
  if (Number.isFinite(m) && m > 0) return m;
  const n = Number(priceNow);
  if (Number.isFinite(n) && n > 0) return n;
  return (Number(hours) || 0) * (Number(rate) || 0);
}
function normalizePost(p = {}) {
  let guards = Array.isArray(p.guards) ? p.guards.map(normalizeGuard) : [];
  if (!guards.length && (p.guard || p.phone || p.cedula)) {
    guards = [normalizeGuard({ name: p.guard, phone: p.phone, cedula: p.cedula, weapons: p.weapons, serial: p.serial || p.license, companyEntryDate: p.companyEntryDate || "" })];
  }
  if (!guards.length) guards = [emptyGuard()];
  const clientNumber = Number(p.clientNumber);
  return {
    id: p.id || `p-${Date.now()}`,
    clientNumber: Number.isFinite(clientNumber) && clientNumber >= 101 ? Math.floor(clientNumber) : null,
    site: p.site || "",
    supervisor: p.supervisor || "",
    serviceType: p.serviceType === "24" ? "24" : "12",
    startDate: p.startDate || "",
    shift: p.shift || "Sin horario",
    guards,
    guardCount: guards.filter((g) => g.name.trim()).length || guards.length,
    hours: Number(p.hours) || 0,
    hourlyRate: Number(p.hourlyRate) || 0,
    priceMonth: calcMonthly(Number(p.hours) || 0, Number(p.hourlyRate) || 0, p.priceMonth, p.priceNow),
    status: STATUS_LABEL[p.status] ? p.status : "warn",
    note: p.note || "",
    address: p.address || "",
    clientContact: p.clientContact || "",
    clientPhone: p.clientPhone || "",
    region: p.region || "",
    mapsUrl: p.mapsUrl || "",
    lat: p.lat === null || p.lat === undefined || p.lat === "" ? null : Number(p.lat),
    lng: p.lng === null || p.lng === undefined || p.lng === "" ? null : Number(p.lng),
    history: Array.isArray(p.history) ? p.history : [],
    createdAt: p.createdAt || "",
    updatedAt: p.updatedAt || "",
  };
}
function sortPostsByClientNumber(list) {
  return [...(list || [])].sort((a, b) => {
    const na = Number(a.clientNumber) || 999999;
    const nb = Number(b.clientNumber) || 999999;
    if (na !== nb) return na - nb;
    return String(a.site || "").localeCompare(String(b.site || ""), "es");
  });
}
function guardsSummary(post) {
  if (!post) return "—";
  const names = (post.guards || []).map((g) => g.name).filter(Boolean);
  return names.length ? names.join(" · ") : "Sin vigilante";
}
function pushHistory(post, title, note) {
  const now = new Date();
  post.history = post.history || [];
  post.history.unshift({ id: `h-${Date.now()}`, title, note, when: now.toISOString(), whenLabel: now.toLocaleString("es") });
  post.history = post.history.slice(0, 100);
  post.updatedAt = now.toISOString();
}
function normalizeUser(u = {}) {
  const username = String(u.username || "").trim().toLowerCase();
  const role = u.role === "owner" || username === OWNER_USERNAME ? "owner" : "user";
  const modules = { ...(u.modules || {}) };
  if (role === "owner") modules.reports = true;
  return {
    id: u.id || `user-${username || Date.now()}`,
    username,
    password: String(u.password || ""),
    displayName: (u.displayName || u.name || username || "").trim(),
    role,
    modules,
    active: u.active === false ? false : true,
  };
}
function canUseReports(user) {
  if (!user || !user.active) return false;
  if (user.role === "owner" || user.username === OWNER_USERNAME) return true;
  if (user.modules && user.modules.admin) return true;
  return !!(user.modules && user.modules.reports);
}
function setCloudStatus(t) {
  const el = document.getElementById("repCloudStatus");
  if (el) el.textContent = t;
}
function saveLocal() {
  localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
  localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
  localStorage.setItem(USERS_KEY, JSON.stringify(appUsers));
}
function saveReports() { localStorage.setItem(REPORTS_KEY, JSON.stringify(reports)); queueCloudSave(); }
function savePosts() { localStorage.setItem(POSTS_KEY, JSON.stringify(posts)); queueCloudSave(); }

let cloudTimer = null;
function queueCloudSave() {
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => pushToCloud().catch(() => {}), 700);
}

async function pushToCloud() {
  if (!window.RFSCloudApi || typeof window.RFSCloudApi.saveReportsAppBundle !== "function") return;
  if (cloudBusy || !currentUser) return;
  cloudBusy = true;
  setCloudStatus("Nube: guardando…");
  try {
    const saved = await window.RFSCloudApi.saveReportsAppBundle(reports, posts, { clientBuild: APP_BUILD });
    if (saved && Array.isArray(saved.reports)) reports = saved.reports;
    if (saved && Array.isArray(saved.posts)) posts = saved.posts.map(normalizePost);
    saveLocal();
    setCloudStatus("Nube: guardado ✓ (solo reportes)");
  } catch (err) {
    console.error(err);
    setCloudStatus("Nube: error al guardar (copia local OK)");
  } finally {
    cloudBusy = false;
  }
}

async function syncFromCloud() {
  if (!window.RFSCloudApi || typeof window.RFSCloudApi.loadReportsAppBundle !== "function") {
    setCloudStatus("Nube: no configurada");
    return;
  }
  setCloudStatus("Nube: sincronizando…");
  const remote = await window.RFSCloudApi.loadReportsAppBundle();
  if (!remote || remote.empty) {
    setCloudStatus("Nube: vacía");
    return;
  }
  appUsers = (remote.users || []).map(normalizeUser);
  const remotePosts = (remote.posts || []).map(normalizePost);
  const remoteReports = Array.isArray(remote.reports) ? remote.reports : [];
  if (window.RFSCloudApi.mergePostsPreferUnion) {
    posts = window.RFSCloudApi.mergePostsPreferUnion(posts, remotePosts).map(normalizePost);
  } else {
    posts = remotePosts;
  }
  if (window.RFSCloudApi.mergeReportsPreferUnion) {
    reports = window.RFSCloudApi.mergeReportsPreferUnion(reports, remoteReports);
  } else {
    reports = remoteReports;
  }
  saveLocal();
  setCloudStatus(`Nube: activa ✓ · ${posts.length} servicios · ${reports.length} reportes`);
}

function showApp() {
  document.getElementById("app").classList.toggle("logged-out", !currentUser);
  document.getElementById("loginView").classList.toggle("active", !currentUser);
  document.getElementById("reportsView").classList.toggle("active", !!currentUser);
  const label = document.getElementById("sessionUserLabel");
  const logout = document.getElementById("btnLogoutUser");
  const refresh = document.getElementById("btnRefreshApp");
  if (currentUser) {
    label.hidden = false;
    label.textContent = currentUser.displayName || currentUser.username;
    logout.hidden = false;
    refresh.hidden = false;
  } else {
    label.hidden = true;
    logout.hidden = true;
    refresh.hidden = true;
  }
}

function login() {
  const user = String(document.getElementById("loginUsername").value || "").trim().toLowerCase();
  const pass = String(document.getElementById("loginPassword").value || "");
  const err = document.getElementById("loginError");
  const found = appUsers.find((u) => u.username === user && u.password === pass && u.active);
  if (!found || !canUseReports(found)) {
    err.hidden = false;
    return;
  }
  err.hidden = true;
  currentUser = found;
  localStorage.setItem(SESSION_KEY, found.id);
  showApp();
  fillReportPostSelect();
  renderReports();
  toast(`Bienvenido, ${found.displayName || found.username}`);
  pushToCloud().catch(() => {});
}

function logout() {
  currentUser = null;
  localStorage.removeItem(SESSION_KEY);
  showApp();
}

async function refreshAppShell() {
  toast("Actualizando…");
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update().catch(() => {});
        if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      }
    }
  } catch (_) {}
  try {
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("rfs-reportes-")).map((k) => caches.delete(k)));
    }
  } catch (_) {}
  window.location.reload();
}

async function checkVersionGate() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return true;
    const data = await res.json();
    const need = Number(data.minBuild || data.build) || 0;
    if (need > 0 && APP_BUILD < need) {
      const gate = document.getElementById("repVersionGate");
      const detail = document.getElementById("repVersionGateDetail");
      if (detail) detail.textContent = `Tu App: ${APP_VERSION_LABEL}. Se requiere build ${need}.`;
      if (gate) gate.hidden = false;
      return false;
    }
  } catch (_) {}
  return true;
}

/* —— helpers reportes (alineados con App principal) —— */

function reportCompany() {
  if (typeof RFS_COMPANY !== "undefined" && RFS_COMPANY) return RFS_COMPANY;
  return {
    name: "Reaction Force Security, S.R.L.",
    slogan: "Tu mejor alternativa de seguridad",
    phones: "809-581-8181 / 809-694-3232",
    email: "reactionforce45@gmail.com",
    address: "Calle Penetración No. 2, sector El Paraíso, Gurabo, Santiago, R.D.",
    license: "Licencia de Operación No. 279",
  };
}



function nextIncidentReportNumber(type) {
  const prefix = type === "incidente" ? "RFS-INC" : type === "checkin" ? "RFS-SUP" : "RFS-NOV";
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const sameDay = reports.filter((r) => String(r.number || "").includes(`-${day}-`)).length + 1;
  return `${prefix}-${day}-${String(sameDay).padStart(3, "0")}`;
}



/** Limpia muletillas / dictado oral sin usar el texto crudo en el informe al cliente */
function sanitizeOperatorNotes(rawText) {
  let t = String(rawText || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  t = t
    .replace(/\b(este|esta|eh|ah|em+|mmm+|o sea|digamos|bueno|entonces pues|tipo que)\b/gi, " ")
    .replace(/\b(okey|okay|ok)\b/gi, "de acuerdo")
    .replace(/\s+/g, " ")
    .trim();
  // Pasar primera persona informal a tercera (aprox.)
  t = t
    .replace(/\byo (vi|vine|llegué|llamé|avisé|quedé|estaba)\b/gi, "el personal $1")
    .replace(/\bme (dijeron|avisaron|llamaron)\b/gi, "se $1 al personal")
    .replace(/\bnosotros\b/gi, "el equipo de seguridad");
  if (!/[.!?…]$/.test(t)) t += ".";
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

/** Parte los hechos en oraciones útiles para redactar, sin citar el narrado tal cual */
function splitFactSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

/** Redacta un informe ejecutivo amplio; no transcribe el narrado de forma directa */
function polishExecutiveNarrative(rawText, ctx = {}) {
  const notesPlain = String(rawText || "").replace(/\s+/g, " ").trim();
  const cleaned = sanitizeOperatorNotes(notesPlain);
  if (!cleaned) return "";

  const site = ctx.site || "el puesto asignado";
  const type = ctx.type || "novedad";
  const when = ctx.whenLabel || new Date().toLocaleString("es");
  const guards = ctx.guards || "el personal de seguridad asignado";
  const number = ctx.number || "";
  const facts = splitFactSentences(cleaned);
  const factBlock =
    facts.length > 1
      ? facts.map((f, i) => `(${i + 1}) ${f}`).join(" ")
      : cleaned;

  const titleLine =
    type === "incidente"
      ? "Reporte de incidente"
      : type === "checkin"
        ? "Reporte de supervisión / check-in"
        : "Reporte de novedad operativa";

  const opening =
    type === "incidente"
      ? `Por medio del presente, ${reportCompany().name} informa a ustedes, de manera formal y para los fines correspondientes, sobre un incidente registrado en el servicio de seguridad privada correspondiente a <strong>${escapeHtml(
          site
        )}</strong>, ocurrido / reportado el día <strong>${escapeHtml(
          when
        )}</strong>. El propósito de este documento es dejar constancia clara de los hechos, las acciones tomadas por el personal en sitio y el estado del servicio tras la intervención.`
      : type === "checkin"
        ? `Por medio del presente, ${reportCompany().name} deja constancia de la supervisión / check-in realizado en <strong>${escapeHtml(
            site
          )}</strong>, el día <strong>${escapeHtml(
            when
          )}</strong>, como parte del seguimiento operativo del servicio contratado.`
        : `Por medio del presente, ${reportCompany().name} comunica una novedad operativa en el servicio de <strong>${escapeHtml(
            site
          )}</strong>, registrada el día <strong>${escapeHtml(
            when
          )}</strong>, a fin de mantener informado al cliente y asegurar la continuidad del control preventivo.`;

  let body = "";
  if (type === "incidente") {
    body =
      `<p>Con base en la información consolidada del personal en sitio (<strong>${escapeHtml(
        guards
      )}</strong>), se establece el siguiente relato ejecutivo de los hechos, redactado para su comprensión y archivo (no constituye una transcripción literal del relato oral):</p>` +
      `<p>${escapeHtml(factBlock)}</p>` +
      `<p>Ante lo ocurrido, el personal de Reaction Force Security procedió conforme a los protocolos vigentes: contención y verificación en el área, comunicación con supervisión cuando correspondió, y priorización de la protección de personas, instalaciones y activos del cliente. Se mantuvo vigilancia reforzada en el punto hasta estabilizar la situación.</p>` +
      `<p>Al cierre de esta intervención, el servicio permanece bajo control operativo. Cualquier seguimiento adicional, evidencia complementaria o coordinación con autoridades / administración del cliente se realizará según las indicaciones que ustedes dispongan.</p>`;
  } else if (type === "checkin") {
    body =
      `<p>Durante la supervisión en <strong>${escapeHtml(
        site
      )}</strong>, a cargo de / con participación de <strong>${escapeHtml(
        guards
      )}</strong>, se verificó el estado del puesto y se consolidó la siguiente información operativa:</p>` +
      `<p>${escapeHtml(factBlock)}</p>` +
      `<p>La visita deja registro del cumplimiento de rutinas de seguridad, presencia del personal asignado y condiciones generales del servicio al momento de la supervisión. Las observaciones quedan disponibles para el seguimiento interno y la coordinación con el cliente.</p>`;
  } else {
    body =
      `<p>El personal asignado (<strong>${escapeHtml(
        guards
      )}</strong>) reportó una novedad del turno. A continuación se resume de forma ejecutiva lo acontecido, sin reproducir el relato hablado palabra por palabra:</p>` +
      `<p>${escapeHtml(factBlock)}</p>` +
      `<p>La novedad queda documentada para el control del servicio, la continuidad operativa y la comunicación oportuna con el cliente. El personal mantiene las medidas preventivas habituales en el puesto.</p>`;
  }

  const closing =
    type === "incidente"
      ? `Reaction Force Security permanece atenta a cualquier indicación adicional de su parte y reitera su compromiso de brindar un servicio profesional, preventivo y transparente. Este documento constituye el ${escapeHtml(
          titleLine.toLowerCase()
        )}${number ? ` N.º <strong>${escapeHtml(number)}</strong>` : ""} para su conocimiento, evaluación y archivo. Para ampliaciones, favor contactar a Supervisión / Operaciones.`
      : `Quedamos a disposición para ampliar cualquier detalle que requieran. Este documento de referencia${
          number ? ` N.º <strong>${escapeHtml(number)}</strong>` : ""
        } forma parte del expediente operativo del servicio. Contacto de Supervisión / Operaciones disponible en el pie de este informe.`;

  return { titleLine, opening, body, closing, notesPlain };
}



function buildIncidentReportHtml(report, post) {
  const co = reportCompany();
  const site = post ? post.site : report.siteName || "Puesto";
  const guards = post ? guardsSummary(post) : report.guardsLabel || "—";
  // Siempre regenerar: el narrado no se transcribe literal; evita cache viejo con notas crudas
  const parts =
    polishExecutiveNarrative(report.text, {
      site,
      type: report.type,
      whenLabel: report.whenLabel,
      guards,
      number: report.number,
    }) || {
      titleLine: "Reporte",
      opening: "",
      body: "",
      closing: "",
      notesPlain: report.text || "",
    };
  const photo = report.photo
    ? `<div style="margin:16px 0">
       <img src="${report.photo}" alt="Evidencia" style="max-width:100%;max-height:360px;border:1px solid #ccc;border-radius:8px" /></div>`
    : `<p class="muted" style="font-size:11px;color:#666">Sin evidencia fotográfica. La descripción narrativa es suficiente para este informe.</p>`;
  const creator = report.createdBy ? `<p style="font-size:11px;color:#666">Elaborado en sistema por: ${escapeHtml(report.createdBy)}</p>` : "";

  return `
    <div class="inc-doc">
      <div style="height:4px;background:linear-gradient(90deg,#0b0b0c,#d41414,#0b0b0c);border-radius:3px;margin:0 0 14px"></div>
      <p style="margin:0 0 4px;font-size:11px;color:#444">
        <strong>${escapeHtml(co.name)}</strong> · “${escapeHtml(co.slogan || "")}”<br/>
        ${escapeHtml(co.license || "")}<br/>
        ${escapeHtml(co.address || "")}<br/>
        Tel: ${escapeHtml(co.phones || "")} · ${escapeHtml(co.email || "")}
      </p>
      <h2 style="margin:14px 0 6px;border-bottom:2px solid #d41414;padding-bottom:6px">${escapeHtml(
        parts.titleLine
      )}</h2>
      <p style="margin:0 0 12px"><strong>N.º de reporte:</strong> ${escapeHtml(report.number || "—")}
        &nbsp;·&nbsp; <strong>Fecha:</strong> ${escapeHtml(report.whenLabel || "")}</p>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px">
        <div style="flex:1;min-width:160px;border-top:3px solid #d41414;border:1px solid #ddd;border-top:3px solid #d41414;padding:8px 10px;border-radius:6px">
          <strong style="color:#d41414;font-size:10px;text-transform:uppercase">Cliente / Puesto</strong><br/>${escapeHtml(site)}
        </div>
        <div style="flex:1;min-width:160px;border:1px solid #ddd;border-top:3px solid #d41414;padding:8px 10px;border-radius:6px">
          <strong style="color:#d41414;font-size:10px;text-transform:uppercase">Personal en sitio</strong><br/>${escapeHtml(guards)}
        </div>
        <div style="flex:1;min-width:120px;border:1px solid #ddd;border-top:3px solid #d41414;padding:8px 10px;border-radius:6px">
          <strong style="color:#d41414;font-size:10px;text-transform:uppercase">Tipo</strong><br/>${escapeHtml(
            TYPE_LABEL[report.type] || report.type
          )}
        </div>
      </div>
      <h3 style="border-left:4px solid #d41414;padding-left:10px;margin:16px 0 8px">1. Presentación</h3>
      <p>${parts.opening}</p>
      <h3 style="border-left:4px solid #d41414;padding-left:10px;margin:16px 0 8px">2. Descripción de los hechos</h3>
      <div>${parts.body}</div>
      <h3 style="border-left:4px solid #d41414;padding-left:10px;margin:16px 0 8px">3. Evidencia fotográfica</h3>
      ${photo}
      <h3 style="border-left:4px solid #d41414;padding-left:10px;margin:16px 0 8px">4. Cierre</h3>
      <p>${parts.closing}</p>
      <p style="margin-top:18px;padding:10px 12px;background:#0b0b0c;color:#fff;border-left:5px solid #d41414;border-radius:8px">
        <strong style="color:#d41414">Contacto:</strong> ${escapeHtml(co.phones || "")} · ${escapeHtml(co.email || "")}
      </p>
      <div style="margin-top:36px;display:grid;grid-template-columns:1fr 1fr;gap:28px">
        <div style="border-top:2px solid #0b0b0c;padding-top:8px;text-align:center;font-size:11px">Reaction Force Security<br/>Supervisión / Operaciones</div>
        <div style="border-top:2px solid #0b0b0c;padding-top:8px;text-align:center;font-size:11px">Recibido por el cliente<br/>Nombre / Firma / Sello</div>
      </div>
      ${creator}
      <div style="height:6px;margin:22px 0 8px;border-radius:3px;background:linear-gradient(90deg,#d41414,#0b0b0c,#d41414)"></div>
    </div>`;
}



/** Título corto para WhatsApp / correo / nombre PDF: "Incidente - Estancia Elianne" */
function incidentReportShareCaption(report, post) {
  const typeLabel = TYPE_LABEL[report && report.type] || "Reporte";
  const site = (post && post.site) || (report && report.siteName) || "Servicio";
  return `${typeLabel} - ${String(site).trim()}`;
}

function buildIncidentShareText(report, post) {
  // Solo el título corto: el detalle va en el PDF adjunto.
  return incidentReportShareCaption(report, post);
}

function getReportById(id) {
  return reports.find((r) => r.id === id) || null;
}

function printIncidentReport(id) {
  const report = getReportById(id);
  if (!report) {
    toast("No se encontró el reporte.");
    return;
  }
  const post = getPost(report.postId);
  const site = post ? post.site : report.siteName || "cliente";
  const title = `${TYPE_LABEL[report.type] || "Reporte"} ${report.number || ""}`.trim();
  if (typeof openPrintWindow !== "function") {
    toast("No se pudo abrir la impresión.");
    return;
  }
  openPrintWindow(title, buildIncidentReportHtml(report, post), {
    bodyClass: "quote-print",
    extraCss:
      typeof quotePrintCss === "function"
        ? quotePrintCss()
        : "body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:12px;line-height:1.4}",
    autoPrint: false,
    share: {
      text: incidentReportShareCaption(report, post),
      subject: incidentReportShareCaption(report, post),
      fileName: incidentReportPdfFileName(report),
    },
  });
  toast("Desde esa pantalla: Imprimir, WhatsApp PDF o Correo PDF.");
}



function loadExternalScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-rfs-lib="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "1") resolve();
      else existing.addEventListener("load", () => resolve(), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.rfsLib = src;
    s.onload = () => {
      s.dataset.loaded = "1";
      resolve();
    };
    s.onerror = () => reject(new Error("No se pudo cargar la librería PDF (revisa la conexión)."));
    document.head.appendChild(s);
  });
}

async function ensureHtml2Pdf() {
  if (typeof window.html2pdf === "function") return window.html2pdf;
  await loadExternalScript(
    "https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js"
  );
  if (typeof window.html2pdf !== "function") {
    throw new Error("html2pdf no disponible");
  }
  return window.html2pdf;
}

function incidentReportPdfFileName(report) {
  const post = report && report.postId ? getPost(report.postId) : null;
  const caption = incidentReportShareCaption(report, post);
  const safe = String(caption || "reporte")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${safe || "reporte"}.pdf`;
}

function incidentReportLogoUrl() {
  try {
    return new URL("../logo.jpg", window.location.href).href;
  } catch (_) {
    return "../logo.jpg";
  }
}

function waitForImages(root) {
  const imgs = [...(root.querySelectorAll("img") || [])];
  return Promise.all(
    imgs.map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.onload = () => resolve();
          img.onerror = () => resolve();
        })
    )
  );
}

async function buildIncidentReportPdfBlob(report, post) {
  const html2pdf = await ensureHtml2Pdf();
  const title = `${TYPE_LABEL[report.type] || "Reporte"} ${report.number || ""}`.trim();
  const host = document.createElement("div");
  host.setAttribute("data-rfs-pdf-host", "1");
  // Visible en layout (opacity 0): html2canvas falla si el nodo está fuera de pantalla
  host.style.cssText =
    "position:fixed;left:0;top:0;width:794px;background:#fff;color:#111;padding:24px;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;opacity:0;pointer-events:none;z-index:-1;";
  host.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;background:#0b0b0c;color:#fff;padding:12px 14px;border-left:6px solid #d41414;border-radius:10px">
      <img src="${incidentReportLogoUrl()}" alt="RFS" crossorigin="anonymous" style="width:64px;height:64px;object-fit:contain;border:2px solid #d41414;border-radius:12px;background:#fff" />
      <div>
        <div style="font-size:18px;font-weight:700;margin:0">Reaction Force Security</div>
        <div>${escapeHtml(title)}</div>
      </div>
    </div>
    ${buildIncidentReportHtml(report, post)}
  `;
  document.body.appendChild(host);
  try {
    await waitForImages(host);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const opt = {
      margin: [10, 10, 12, 10],
      filename: incidentReportPdfFileName(report),
      image: { type: "jpeg", quality: 0.92 },
      html2canvas: { scale: 1.5, useCORS: true, allowTaint: true, logging: false, backgroundColor: "#ffffff" },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["avoid-all", "css", "legacy"] },
    };
    let blob = null;
    try {
      blob = await html2pdf().set(opt).from(host).outputPdf("blob");
    } catch (_) {
      // API alternativa en algunas builds
      blob = await html2pdf().set(opt).from(host).toPdf().get("pdf").then((pdf) => pdf.output("blob"));
    }
    if (!blob || !blob.size) throw new Error("PDF vacío");
    return blob;
  } finally {
    host.remove();
  }
}

async function buildIncidentReportPdfFile(report, post) {
  const blob = await buildIncidentReportPdfBlob(report, post);
  return new File([blob], incidentReportPdfFileName(report), { type: "application/pdf" });
}

function downloadBlobFile(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function trySharePdfFile(file, title, text) {
  if (!navigator.share) return false;
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title, text, files: [file] });
      return true;
    }
  } catch (err) {
    if (err && err.name === "AbortError") return true;
  }
  return false;
}

async function shareIncidentWhatsApp(id) {
  const report = getReportById(id);
  if (!report) return;
  const post = getPost(report.postId);
  const caption = incidentReportShareCaption(report, post);
  toast("Preparando PDF para WhatsApp…");
  try {
    const file = await buildIncidentReportPdfFile(report, post);
    const shared = await trySharePdfFile(file, caption, caption);
    if (shared) {
      toast("Elige WhatsApp en el menú para enviar el PDF.");
      return;
    }
    downloadBlobFile(file, file.name);
    window.open(`https://wa.me/?text=${encodeURIComponent(caption)}`, "_blank");
    toast("PDF descargado. Adjúntalo en WhatsApp.");
  } catch (err) {
    console.error(err);
    window.open(`https://wa.me/?text=${encodeURIComponent(caption)}`, "_blank");
    toast("No se pudo crear el PDF; se abrió WhatsApp solo con el título.");
  }
}

async function shareIncidentEmail(id) {
  const report = getReportById(id);
  if (!report) return;
  const post = getPost(report.postId);
  const caption = incidentReportShareCaption(report, post);
  toast("Preparando PDF para correo…");
  try {
    const file = await buildIncidentReportPdfFile(report, post);
    const shared = await trySharePdfFile(file, caption, caption);
    if (shared) {
      toast("Elige Correo / Gmail en el menú para enviar el PDF.");
      return;
    }
    downloadBlobFile(file, file.name);
    window.location.href = `mailto:?subject=${encodeURIComponent(caption)}&body=${encodeURIComponent(caption)}`;
    toast("PDF descargado. Adjúntalo al correo.");
  } catch (err) {
    console.error(err);
    window.location.href = `mailto:?subject=${encodeURIComponent(caption)}&body=${encodeURIComponent(caption)}`;
    toast("No se pudo crear el PDF; se abrió el correo solo con el título.");
  }
}

async function downloadIncidentReport(id) {
  const report = getReportById(id);
  if (!report) return;
  const post = getPost(report.postId);
  toast("Generando PDF…");
  try {
    const file = await buildIncidentReportPdfFile(report, post);
    downloadBlobFile(file, file.name);
    toast("PDF descargado.");
  } catch (err) {
    console.error(err);
    toast("No se pudo generar el PDF. Revisa la conexión e inténtalo de nuevo.");
  }
}

async function shareIncidentPdf(id) {
  const report = getReportById(id);
  if (!report) return;
  const post = getPost(report.postId);
  const caption = incidentReportShareCaption(report, post);
  toast("Generando PDF…");
  try {
    const file = await buildIncidentReportPdfFile(report, post);
    const shared = await trySharePdfFile(file, caption, caption);
    if (shared) {
      toast("PDF listo para enviar.");
      return;
    }
    downloadBlobFile(file, file.name);
    toast("PDF descargado. Puedes adjuntarlo en WhatsApp o correo.");
  } catch (err) {
    console.error(err);
    toast("No se pudo generar el PDF.");
  }
}



function renderReports() {
  const list = document.getElementById("reportsList");
  if (!reports.length) {
    list.innerHTML = `<p class="empty">Aún no hay reportes. Genera el primero arriba.</p>`;
    return;
  }
  list.innerHTML = reports
    .map((r) => {
      const post = getPost(r.postId);
      const site = post ? post.site : r.siteName || "Puesto eliminado";
      const guard = post ? guardsSummary(post) : r.guardsLabel || "—";
      const photo = r.photo ? `<img class="thumb" src="${r.photo}" alt="Foto del reporte" />` : "";
      const narrative = polishExecutiveNarrative(r.text, {
        site,
        type: r.type,
        whenLabel: r.whenLabel,
        guards: guard,
        number: r.number,
      });
      const preview = String(narrative.body || r.text || "")
        .replace(/<[^>]+>/g, "")
        .slice(0, 220);
      return `
        <article class="report-card">
          <h3>${escapeHtml(r.number || "Sin número")} · ${escapeHtml(site)}</h3>
          <p>${escapeHtml(guard)}</p>
          <div class="meta">
            <span class="type-pill">${TYPE_LABEL[r.type] || r.type}</span>
            <span class="status-pill ${r.type === "incidente" ? "alert" : "ok"}">${escapeHtml(r.whenLabel)}</span>
          </div>
          <p class="muted" style="margin-top:6px;font-size:12px">Creado por: ${escapeHtml(
            r.createdBy || "—"
          )}${
            Array.isArray(r.voiceNotes) && r.voiceNotes.length
              ? ` · ${r.voiceNotes.length} nota(s) de voz`
              : ""
          }</p>
          <p style="margin-top:10px;color:#d4d4d8">${escapeHtml(preview)}${preview.length >= 220 ? "…" : ""}</p>
          ${photo}
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            <button type="button" class="btn primary btn-rep-print" data-id="${escapeHtml(
              r.id
            )}" style="width:auto;padding:8px 10px;font-size:12px">Abrir informe (imprimir / WhatsApp / correo PDF)</button>
            ${
              r.photo
                ? `<button type="button" class="btn ghost btn-rep-del-photo" data-id="${escapeHtml(
                    r.id
                  )}" style="width:auto;padding:8px 10px;font-size:12px">Quitar foto</button>`
                : ""
            }
            <button type="button" class="btn danger btn-rep-del" data-id="${escapeHtml(
              r.id
            )}" style="width:auto;padding:8px 10px;font-size:12px">Eliminar</button>
          </div>
        </article>`;
    })
    .join("");
  list.querySelectorAll(".btn-rep-print").forEach((btn) => {
    btn.addEventListener("click", () => printIncidentReport(btn.dataset.id));
  });
  list.querySelectorAll(".btn-rep-del-photo").forEach((btn) => {
    btn.addEventListener("click", () => removeReportPhoto(btn.dataset.id));
  });
  list.querySelectorAll(".btn-rep-del").forEach((btn) => {
    btn.addEventListener("click", () => deleteIncidentReport(btn.dataset.id));
  });
}



function removeReportPhoto(id) {
  const report = getReportById(id);
  if (!report) return;
  if (!report.photo) {
    toast("Este reporte no tiene foto.");
    return;
  }
  const label = report.number || report.siteName || "este reporte";
  if (!confirm(`¿Quitar la foto del reporte ${label}? El informe escrito se mantiene.`)) return;
  report.photo = "";
  saveReports();
  renderReports();
  if (typeof logActivity === "function") {
    logActivity(
      "report_photo_delete",
      `Foto quitada del reporte ${report.number || id} · por ${
        currentUser ? currentUser.displayName || currentUser.username : "—"
      }`
    );
  }
  toast("Foto eliminada del reporte.");
}



function deleteIncidentReport(id) {
  const report = getReportById(id);
  if (!report) return;
  const label = report.number || report.siteName || "este reporte";
  if (!confirm(`¿Eliminar el reporte ${label}?`)) return;
  reports = reports.filter((r) => r.id !== id);
  saveReports();
  renderReports();
  if (typeof logActivity === "function") {
    logActivity(
      "report_delete",
      `Reporte eliminado: ${report.number || id} · ${report.siteName || ""} · por ${
        currentUser ? currentUser.displayName || currentUser.username : "—"
      }`
    );
  }
  toast("Reporte eliminado.");
}




function filterReportPostSelect(preferredId) {
  const select = document.getElementById("reportPost");
  if (!select) return;
  const searchEl = document.getElementById("reportPostSearch");
  const needle = String(searchEl?.value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const tokens = needle.split(/\s+/).filter(Boolean);
  const current = preferredId || select.value || "";
  const sorted = sortPostsByClientNumber(posts);
  const filtered = !tokens.length ? sorted : sorted.filter((p) => {
    const blob = `#${p.clientNumber || ""} ${p.site || ""} ${guardsSummary(p)}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return tokens.every((t) => blob.includes(t));
  });
  if (!filtered.length) {
    select.innerHTML = `<option value="">Sin coincidencias — limpia la búsqueda</option>`;
    return;
  }
  select.innerHTML = filtered.map((p) => `<option value="${p.id}">#${escapeHtml(String(p.clientNumber || "—"))} ${escapeHtml(p.site)} — ${escapeHtml(guardsSummary(p))}</option>`).join("");
  if (current && filtered.some((p) => p.id === current)) select.value = current;
  else if (filtered.length === 1) select.value = filtered[0].id;
}
function fillReportPostSelect(preferredId) {
  const select = document.getElementById("reportPost");
  if (!select) return;
  if (preferredId && getPost(preferredId)) select.dataset.preferredId = preferredId;
  filterReportPostSelect(preferredId || select.dataset.preferredId || select.value || "");
}

function clearPhoto() {
  pendingPhotoDataUrl = null;
  const gallery = document.getElementById("reportPhoto");
  if (gallery) gallery.value = "";
  const nativeCam = document.getElementById("reportPhotoCameraNative");
  if (nativeCam) nativeCam.value = "";
  const wrap = document.getElementById("photoPreviewWrap");
  const img = document.getElementById("photoPreview");
  if (wrap) wrap.hidden = true;
  if (img) img.removeAttribute("src");
}

function compressImage(file, maxSide = 1280, quality = 0.72, maxBytes = 180 * 1024) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la foto"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let side = maxSide, q = quality, out = "";
        const encode = (s, qq) => {
          let w = img.naturalWidth, h = img.naturalHeight;
          if (w > s || h > s) { const r = Math.min(s / w, s / h); w = Math.round(w * r); h = Math.round(h * r); }
          const c = document.createElement("canvas"); c.width = w; c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          return c.toDataURL("image/jpeg", qq);
        };
        out = encode(side, q);
        while (maxBytes > 0 && out.length * 0.75 > maxBytes && (q > 0.35 || side > 420)) {
          if (q > 0.35) q -= 0.1; else side = Math.max(420, Math.round(side * 0.75));
          out = encode(side, q);
        }
        resolve(out);
      };
      img.onerror = () => reject(new Error("Foto inválida"));
      img.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

async function onPhotoSelected(ev) {
  const file = ev.target && ev.target.files && ev.target.files[0];
  if (!file) return;
  try {
    pendingPhotoDataUrl = await compressImage(file);
    document.getElementById("photoPreview").src = pendingPhotoDataUrl;
    document.getElementById("photoPreviewWrap").hidden = false;
  } catch (_) {
    toast("No se pudo procesar la foto.");
    clearPhoto();
  }
}

/* Voz (simple) */
const REPORT_VOICE_MAX = 2;
let pendingReportVoices = [];
let reportSpeechRec = null;
let reportVoiceActive = false;
let reportSpeechDraft = "";
function clearPendingReportVoices() {
  stopReportVoiceSession(true);
  pendingReportVoices = [];
  renderReportVoiceList();
  updateReportVoiceButton();
}
function updateReportVoiceButton() {
  const btn = document.getElementById("btnReportVoice");
  if (!btn) return;
  if (reportVoiceActive) { btn.textContent = "⏹ Detener y pegar texto"; btn.disabled = false; return; }
  if (pendingReportVoices.length >= REPORT_VOICE_MAX) { btn.textContent = "🎙 Límite de 2 notas"; btn.disabled = true; return; }
  btn.disabled = false;
  btn.textContent = pendingReportVoices.length === 0 ? "🎙 Dictar nota de voz" : `🎙 Dictar nota ${pendingReportVoices.length + 1} de ${REPORT_VOICE_MAX}`;
}
function setReportVoiceStatus(text, show) {
  const status = document.getElementById("reportVoiceStatus");
  if (!status) return;
  status.hidden = !show; status.textContent = show ? (text || "") : "";
}
function renderReportVoiceList() {
  const box = document.getElementById("reportVoiceList");
  if (!box) return;
  box.innerHTML = pendingReportVoices.map((v, idx) => `<div class="report-voice-item"><p class="report-voice-meta">Nota ${idx + 1}</p><p class="report-voice-transcript">${escapeHtml(v.transcript || "")}</p></div>`).join("");
}
function appendTranscriptToReportText(transcript) {
  const t = String(transcript || "").trim();
  if (!t) return;
  const el = document.getElementById("reportText");
  if (!el) return;
  const cur = String(el.value || "").trim();
  el.value = cur ? `${cur}\n\n${t}` : t;
}
function stopReportVoiceSession(silent) {
  reportVoiceActive = false;
  try { if (reportSpeechRec) reportSpeechRec.stop(); } catch (_) {}
  reportSpeechRec = null;
  updateReportVoiceButton();
  if (!silent) setReportVoiceStatus("", false);
}
function startReportVoiceSession() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast("Dictado no disponible en este navegador. Usa Chrome/Edge."); return; }
  if (pendingReportVoices.length >= REPORT_VOICE_MAX) return;
  reportSpeechDraft = "";
  reportVoiceActive = true;
  updateReportVoiceButton();
  setReportVoiceStatus("Escuchando… habla ahora", true);
  const rec = new SR();
  reportSpeechRec = rec;
  rec.lang = "es-DO";
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (ev) => {
    let finalText = "";
    for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
      const r = ev.results[i];
      if (r.isFinal) finalText += r[0].transcript + " ";
    }
    if (finalText.trim()) reportSpeechDraft = (reportSpeechDraft + " " + finalText).trim();
    setReportVoiceStatus(reportSpeechDraft ? ("… " + reportSpeechDraft.slice(-80)) : "Escuchando…", true);
  };
  rec.onerror = () => {};
  rec.onend = () => {
    if (!reportVoiceActive) return;
    // auto-restart while active
    try { rec.start(); } catch (_) {}
  };
  try { rec.start(); } catch (_) { stopReportVoiceSession(); toast("No se pudo iniciar el micrófono."); }
}
function finishReportVoiceSession() {
  const text = String(reportSpeechDraft || "").trim();
  stopReportVoiceSession(true);
  setReportVoiceStatus("", false);
  if (!text) { toast("No se captó texto. Intenta de nuevo."); return; }
  pendingReportVoices.push({ id: "v-" + Date.now(), transcript: text, durationMs: 5000, recordedAt: new Date().toISOString() });
  appendTranscriptToReportText(text);
  renderReportVoiceList();
  updateReportVoiceButton();
  toast("Nota dictada pegada en el relato.");
}

function openPrintWindow(title, bodyHtml, options = {}) {
  const share = options.share || {};
  const win = window.open("", "_blank");
  if (!win) { toast("Permite ventanas emergentes para imprimir."); return null; }
  const reportId = share.reportId || "";
  win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(title)}</title>
  <style>body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:22px;max-width:900px;margin:0 auto;font-size:12px;line-height:1.35}
  .print-bar{position:sticky;top:0;z-index:20;display:flex;flex-wrap:wrap;gap:8px;background:#111;color:#fff;padding:12px;margin:-22px -22px 18px}
  .print-bar button{padding:11px 14px;font-weight:800;border:0;border-radius:10px;cursor:pointer}
  .btn-back{background:#fff;color:#111}.btn-print{background:#d41414;color:#fff}.btn-wa{background:#25d366}.btn-mail{background:#3b82f6;color:#fff}.btn-pdf{background:#f5f5f5}
  @media print{.no-print{display:none!important}}</style></head><body>
  <div class="print-bar no-print">
    <button class="btn-back" id="btnPrintBack" type="button">← Volver</button>
    <button class="btn-print" id="btnPrintNow" type="button">Imprimir</button>
    <button class="btn-wa" id="btnPrintWhatsApp" type="button">WhatsApp PDF</button>
    <button class="btn-mail" id="btnPrintEmail" type="button">Correo PDF</button>
    <button class="btn-pdf" id="btnPrintPdf" type="button">Descargar PDF</button>
  </div>
  <div id="rfsPrintRoot">${bodyHtml}</div>
  <script>
    document.getElementById('btnPrintBack').onclick=function(){window.close();};
    document.getElementById('btnPrintNow').onclick=function(){window.print();};
    function callOpener(fn){try{if(window.opener&&window.opener[fn])window.opener[fn]("${reportId}");}catch(e){}}
    document.getElementById('btnPrintWhatsApp').onclick=function(){callOpener('shareIncidentWhatsApp');};
    document.getElementById('btnPrintEmail').onclick=function(){callOpener('shareIncidentEmail');};
    document.getElementById('btnPrintPdf').onclick=function(){callOpener('downloadIncidentReport');};
  <\/script></body></html>`);
  win.document.close();
  return win;
}

function saveReport() {
  const postId = document.getElementById("reportPost").value;
  const type = document.getElementById("reportType").value;
  const text = document.getElementById("reportText").value.trim();
  const post = getPost(postId);
  if (!post) { toast("Selecciona un puesto."); return; }
  if (!text) { toast("Escribe en tus palabras lo que ocurrió."); return; }
  const now = new Date();
  const number = nextIncidentReportNumber(type);
  const createdBy = currentUser && (currentUser.displayName || currentUser.username) ? (currentUser.displayName || currentUser.username) : "Usuario";
  const polished = polishExecutiveNarrative(text, { site: post.site, type, whenLabel: now.toLocaleString("es"), guards: guardsSummary(post), number });
  const voiceMeta = pendingReportVoices.map((v, i) => ({ n: i + 1, durationSec: Math.max(1, Math.round((v.durationMs || 0) / 1000)), transcript: String(v.transcript || "").trim(), recordedAt: v.recordedAt || now.toISOString() }));
  const report = {
    id: `r-${Date.now()}`, number, postId, siteName: post.site, guardsLabel: guardsSummary(post), type, text,
    narrativeTitle: polished.titleLine, narrativeHtml: polished, photo: pendingPhotoDataUrl || "", voiceNotes: voiceMeta,
    createdAt: now.toISOString(), whenLabel: now.toLocaleString("es"), createdBy,
  };
  reports.unshift(report);
  if (type === "checkin") { post.status = "ok"; pushHistory(post, "Check-in / supervisión", `${number}: ${text}`); }
  if (type === "incidente") { post.status = "alert"; pushHistory(post, "Incidente", `${number}: ${text}`); }
  if (type === "novedad") { pushHistory(post, "Novedad", `${number}: ${text}`); }
  reports = reports.slice(0, 80);
  saveLocal();
  queueCloudSave();
  renderReports();
  document.getElementById("reportText").value = "";
  const reportSearch = document.getElementById("reportPostSearch");
  if (reportSearch) reportSearch.value = "";
  fillReportPostSelect(postId);
  clearPhoto();
  clearPendingReportVoices();
  toast(`Informe ${number} generado.`);
  printIncidentReport(report.id);
}

function bindUi() {
  document.getElementById("btnAppLogin")?.addEventListener("click", login);
  document.getElementById("loginPassword")?.addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
  document.getElementById("btnLogoutUser")?.addEventListener("click", logout);
  document.getElementById("btnRefreshApp")?.addEventListener("click", refreshAppShell);
  document.getElementById("btnForceAppUpdate")?.addEventListener("click", refreshAppShell);
  document.getElementById("btnSaveReport")?.addEventListener("click", saveReport);
  document.getElementById("reportPostSearch")?.addEventListener("input", () => filterReportPostSelect());
  document.getElementById("reportPhoto")?.addEventListener("change", onPhotoSelected);
  document.getElementById("reportPhotoCameraNative")?.addEventListener("change", onPhotoSelected);
  document.getElementById("btnReportPhotoCamera")?.addEventListener("click", () => {
    document.getElementById("reportPhotoCameraNative")?.click();
  });
  document.getElementById("btnClearPhoto")?.addEventListener("click", clearPhoto);
  document.getElementById("btnReportVoice")?.addEventListener("click", () => {
    if (reportVoiceActive) finishReportVoiceSession();
    else startReportVoiceSession();
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  posts = loadJson(POSTS_KEY, []).map(normalizePost);
  reports = loadJson(REPORTS_KEY, []);
  appUsers = loadJson(USERS_KEY, []).map(normalizeUser);
  bindUi();
  await checkVersionGate();
  try {
    await syncFromCloud();
  } catch (err) {
    console.error(err);
    setCloudStatus("Nube: sin conexión (usando copia local)");
  }
  const sid = localStorage.getItem(SESSION_KEY) || "";
  const found = appUsers.find((u) => u.id === sid && u.active && canUseReports(u));
  if (found) currentUser = found;
  showApp();
  if (currentUser) {
    fillReportPostSelect();
    renderReports();
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js?v=189").then((reg) => {
      reg.update().catch(() => {});
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }).catch(() => {});
  }
});
