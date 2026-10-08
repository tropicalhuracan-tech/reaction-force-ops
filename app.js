/** Claves estables: no borrar datos del usuario en actualizaciones */
const POSTS_KEY = "rfs-ops-posts";
const REPORTS_KEY = "rfs-ops-reports";
const EMPLOYEES_KEY = "rfs-ops-employees";
const USERS_KEY = "rfs-ops-users";
const APP_SESSION_KEY = "rfs-app-session-user";
const ADMIN_SESSION_KEY = "rfs-admin-unlocked";
const ADMIN_PASSWORD = "mitesoro01";
const OWNER_USERNAME = "admin";
const MAX_GUARDS = 20;
const LEGACY_POST_KEYS = [
  "rfs-ops-posts-v6",
  "rfs-ops-posts-v5",
  "rfs-ops-posts-v4",
  "rfs-ops-posts-v3",
  "rfs-ops-posts-v2",
  "rfs-ops-posts-v1",
];
const LEGACY_REPORT_KEYS = ["rfs-ops-reports-v2", "rfs-ops-reports-v1"];

const STATUS_LABEL = {
  ok: "En puesto",
  warn: "Pendiente",
  alert: "Incidente",
};

const TYPE_LABEL = {
  novedad: "Novedad",
  checkin: "Check-in",
  incidente: "Incidente",
};

let posts = [];
let reports = [];
let employees = [];
let appUsers = [];
let currentUser = null;
let chatMessages = [];
let selectedEmployeeId = null;
let employeeListFilter = "active"; // active | inactive
let creatingEmployee = false;
let pendingEmpPhoto = null; // data URL or "" to clear
let pendingEmpDoc = null; // { dataUrl, name, mime } or null; use { dataUrl:"" } to clear
const EMP_DOC_MAX_BYTES = 400 * 1024;
let map;
let markersLayer;
let selectedId = null;
let userMarker = null;
let pendingPhotoDataUrl = null;
let editingId = null;
let previousView = "mapView";
let guardEditorCount = 0;

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

/** Carga la data más reciente sin borrar versiones anteriores */
function loadPreservingUserData(primaryKey, legacyKeys) {
  const primary = loadJson(primaryKey, null);
  if (Array.isArray(primary) && primary.length) return primary;

  for (const key of legacyKeys) {
    const legacy = loadJson(key, null);
    if (Array.isArray(legacy) && legacy.length) return legacy;
  }

  if (Array.isArray(primary)) return primary;
  return [];
}

function emptyGuard() {
  return {
    id: `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: "",
    phone: "",
    cedula: "",
    companyEntryDate: "",
    weapons: "",
    serial: "",
  };
}

function normalizeGuard(g = {}) {
  return {
    id: g.id || `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: g.name || "",
    phone: g.phone || "",
    cedula: g.cedula || "",
    companyEntryDate: g.companyEntryDate || g.entryDate || "",
    weapons: g.weapons || "",
    serial: g.serial || g.license || "",
    role: g.role || "",
  };
}

function employeeKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizeEmployee(e = {}) {
  const name = (e.name || "").trim();
  const status = e.status === "inactive" ? "inactive" : "active";
  return {
    id: e.id || `emp-${employeeKey(name).replace(/\s+/g, "-").slice(0, 40) || Date.now()}`,
    key: e.key || employeeKey(name),
    name,
    phone: e.phone || "",
    cedula: e.cedula || "",
    companyEntryDate: e.companyEntryDate || "",
    weapons: e.weapons || "",
    serial: e.serial || "",
    note: e.note || "",
    photo: e.photo || "",
    documentData: e.documentData || "",
    documentName: e.documentName || "",
    documentMime: e.documentMime || "",
    roles: Array.isArray(e.roles) ? e.roles.filter(Boolean) : [],
    sites: Array.isArray(e.sites) ? e.sites.filter(Boolean) : [],
    status,
    inactiveReason: e.inactiveReason || "",
    inactiveAt: e.inactiveAt || "",
    updatedAt: e.updatedAt || new Date().toISOString(),
  };
}

function isEmployeeActive(emp) {
  return !emp || emp.status !== "inactive";
}

function applyMonorrielFlag(emp, isMono) {
  const out = normalizeEmployee(emp);
  let name = monoBaseName(out.name) || out.name;
  if (isMono) {
    name = monoDisplayName(name);
    out.sites = [...new Set([...(out.sites || []), "Monorriel"])];
    out.roles = [...new Set([...(out.roles || []), "Monorriel"])];
  } else {
    out.sites = (out.sites || []).filter((s) => !/monorriel/i.test(s));
    out.roles = (out.roles || []).filter((r) => !/monorriel/i.test(r));
  }
  out.name = name;
  out.key = employeeKey(out.name);
  return out;
}

function preferFill(current, incoming) {
  const cur = (current || "").trim();
  const next = (incoming || "").trim();
  if (!cur && next) return next;
  return cur;
}

function mergeEmployeeRecord(base, incoming) {
  const out = normalizeEmployee({
    ...base,
    name: base.name || incoming.name,
    phone: preferFill(base.phone, incoming.phone),
    cedula: preferFill(base.cedula, incoming.cedula),
    companyEntryDate: preferFill(base.companyEntryDate, incoming.companyEntryDate),
    weapons: preferFill(base.weapons, incoming.weapons),
    serial: preferFill(base.serial, incoming.serial),
    note: preferFill(base.note, incoming.note),
    photo: preferFill(base.photo, incoming.photo),
    documentData: preferFill(base.documentData, incoming.documentData),
    documentName: preferFill(base.documentName, incoming.documentName),
    documentMime: preferFill(base.documentMime, incoming.documentMime),
    roles: [...new Set([...(base.roles || []), ...(incoming.roles || [])].filter(Boolean))],
    sites: [...new Set([...(base.sites || []), ...(incoming.sites || [])].filter(Boolean))],
    status: base.status === "inactive" ? "inactive" : incoming.status === "inactive" ? "inactive" : "active",
    inactiveReason: preferFill(base.inactiveReason, incoming.inactiveReason),
    inactiveAt: preferFill(base.inactiveAt, incoming.inactiveAt),
    updatedAt: new Date().toISOString(),
  });
  out.key = employeeKey(out.name);
  return out;
}

/** Recopila empleados desde todos los servicios sin borrar datos ya llenos */
function rebuildEmployeesFromPosts(existingEmployees = employees) {
  const map = new Map();
  (existingEmployees || []).map(normalizeEmployee).forEach((e) => {
    if (!e.name || e.name.toLowerCase() === "por asignar") return;
    map.set(employeeKey(e.name), e);
  });

  posts.forEach((post) => {
    (post.guards || []).forEach((g) => {
      const name = (g.name || "").trim();
      if (!name || name.toLowerCase() === "por asignar") return;
      const key = employeeKey(name);
      const incoming = normalizeEmployee({
        name,
        phone: g.phone,
        cedula: g.cedula,
        companyEntryDate: g.companyEntryDate,
        weapons: g.weapons,
        serial: g.serial,
        roles: g.role ? [g.role] : [],
        sites: post.site ? [post.site] : [],
      });
      if (map.has(key)) {
        map.set(key, mergeEmployeeRecord(map.get(key), incoming));
      } else {
        map.set(key, incoming);
      }
    });
  });

  employees = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  return employees;
}

function employeeSearchNeedle() {
  const el = document.getElementById("employeeSearch");
  return String(el && el.value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function employeeMatchesSearch(emp, needle) {
  if (!needle) return true;
  const blob = [emp.name, emp.phone, emp.cedula, emp.weapons, emp.serial, ...(emp.sites || []), ...(emp.roles || [])]
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return blob.includes(needle);
}

function employeeCompleteness(emp) {
  const fields = [emp.phone, emp.cedula, emp.companyEntryDate, emp.weapons, emp.serial];
  const filled = fields.filter((v) => String(v || "").trim()).length;
  return { filled, total: fields.length };
}

function renderEmployees() {
  const list = document.getElementById("employeesList");
  const summary = document.getElementById("employeesSummary");
  if (!list || !summary) return;

  rebuildEmployeesFromPosts(employees);
  const needle = employeeSearchNeedle();
  const activeCount = employees.filter(isEmployeeActive).length;
  const inactiveCount = employees.filter((e) => !isEmployeeActive(e)).length;

  document.querySelectorAll(".emp-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.empFilter === employeeListFilter);
  });

  const pool = employees.filter((e) =>
    employeeListFilter === "inactive" ? !isEmployeeActive(e) : isEmployeeActive(e)
  );
  const filtered = pool.filter((e) => employeeMatchesSearch(e, needle));
  const complete = pool.filter((e) => isEmployeeActive(e) && employeeCompleteness(e).filled === employeeCompleteness(e).total).length;

  if (employeeListFilter === "inactive") {
    summary.textContent = inactiveCount
      ? `${inactiveCount} empleados inactivos / eliminados`
      : "No hay empleados eliminados.";
  } else {
    summary.textContent = activeCount
      ? `${activeCount} activos · ${inactiveCount} inactivos · datos vacíos se llenan al editar servicios`
      : "Sin empleados activos. Usa “Agregar empleado nuevo”.";
  }

  const addBtn = document.getElementById("btnAddEmployee");
  if (addBtn) addBtn.hidden = employeeListFilter === "inactive";

  if (!filtered.length) {
    list.innerHTML = pool.length
      ? `<p class="empty">Ningún empleado coincide con la búsqueda.</p>`
      : employeeListFilter === "inactive"
        ? `<p class="empty">Todavía no hay empleados eliminados.</p>`
        : `<p class="empty">Todavía no hay personal activo. Agrega uno o guárdalo desde un servicio / Monorriel.</p>`;
    return;
  }

  list.innerHTML = filtered
    .map((e) => {
      const { filled, total } = employeeCompleteness(e);
      const sitesFixed = (e.sites || []).slice(0, 2).join(" · ") || "Sin servicio asignado";
      const meta = isEmployeeActive(e)
        ? [
            e.phone ? `Tel: ${e.phone}` : "Tel: —",
            e.cedula ? `Cédula: ${e.cedula}` : "Cédula: —",
            e.documentData ? "Doc ✓" : "Sin doc",
            `${filled}/${total} datos`,
          ].join(" · ")
        : `Causa: ${e.inactiveReason || "—"} · ${e.inactiveAt ? e.inactiveAt.slice(0, 10) : ""}`;
      const initial = escapeHtml((e.name || "?").trim().charAt(0).toUpperCase() || "?");
      const avatar = e.photo
        ? `<img class="avatar" src="${e.photo}" alt="" />`
        : `<span class="avatar placeholder">${initial}</span>`;
      const pill = !isEmployeeActive(e) ? "alert" : filled === total ? "ok" : "warn";
      const pillText = !isEmployeeActive(e) ? "Inactivo" : `${filled}/${total}`;
      return `
      <button class="employee-card" type="button" data-id="${escapeHtml(e.id)}">
        <div class="row">
          ${avatar}
          <div style="flex:1;min-width:0">
            <h3>${escapeHtml(e.name)}</h3>
            <p>${escapeHtml(sitesFixed)}</p>
            <p style="margin-top:6px">${escapeHtml(meta)}</p>
          </div>
          <span class="status-pill ${pill}">${pillText}</span>
        </div>
      </button>`;
    })
    .join("");

  list.querySelectorAll(".employee-card").forEach((btn) => {
    btn.addEventListener("click", () => openEmployeeDetail(btn.dataset.id));
  });
}

function openNewEmployeeForm() {
  creatingEmployee = true;
  document.getElementById("nName").value = "";
  document.getElementById("nMonorriel").checked = false;
  document.getElementById("nPhone").value = "";
  document.getElementById("nCedula").value = "";
  document.getElementById("nEntry").value = "";
  document.getElementById("nNote").value = "";
  switchView("employeeNewView");
}

function createEmployeeManual() {
  let name = document.getElementById("nName").value.trim();
  if (!name) {
    toast("Escribe el nombre del empleado.");
    return;
  }
  const isMono = document.getElementById("nMonorriel").checked;
  if (isMono) name = monoDisplayName(name);
  const key = employeeKey(name);
  const keyBase = employeeKey(monoBaseName(name));
  const exists = employees.find(
    (e) => employeeKey(e.name) === key || employeeKey(monoBaseName(e.name)) === keyBase
  );
  if (exists) {
    if (!isEmployeeActive(exists)) {
      toast("Ese nombre está en inactivos. Ábrelo y reactívalo si aplica.");
      employeeListFilter = "inactive";
      openEmployeeDetail(exists.id);
      return;
    }
    toast("Ese empleado ya existe. Se abrió su ficha.");
    openEmployeeDetail(exists.id);
    return;
  }
  const emp = normalizeEmployee({
    name,
    phone: document.getElementById("nPhone").value.trim(),
    cedula: document.getElementById("nCedula").value.trim(),
    companyEntryDate: document.getElementById("nEntry").value,
    note: document.getElementById("nNote").value.trim(),
    sites: isMono ? ["Monorriel"] : [],
    roles: isMono ? ["Monorriel"] : [],
    status: "active",
  });
  employees.unshift(emp);
  employees.sort((a, b) => a.name.localeCompare(b.name, "es"));
  saveEmployees();
  creatingEmployee = false;
  employeeListFilter = "active";
  renderEmployees();
  openEmployeeDetail(emp.id);
  toast("Empleado creado. Completa el resto de datos cuando quieras.");
}

function deactivateSelectedEmployee() {
  if (!selectedEmployeeId) return;
  const idx = employees.findIndex((e) => e.id === selectedEmployeeId);
  if (idx < 0) return;
  const reason = document.getElementById("eInactiveReason").value.trim();
  if (!reason) {
    toast("Escribe la causa de la eliminación.");
    return;
  }
  const ok = window.confirm("El empleado pasará a Inactivos / Eliminados. ¿Continuar?");
  if (!ok) return;
  const current = employees[idx];
  employees[idx] = normalizeEmployee({
    ...current,
    status: "inactive",
    inactiveReason: reason,
    inactiveAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  saveEmployees();
  employeeListFilter = "inactive";
  renderEmployees();
  openEmployeeDetail(selectedEmployeeId);
  toast("Empleado pasado a inactivos.");
}

function reactivateSelectedEmployee() {
  if (!selectedEmployeeId) return;
  const idx = employees.findIndex((e) => e.id === selectedEmployeeId);
  if (idx < 0) return;
  const current = employees[idx];
  employees[idx] = normalizeEmployee({
    ...current,
    status: "active",
    inactiveReason: "",
    inactiveAt: "",
    updatedAt: new Date().toISOString(),
  });
  saveEmployees();
  employeeListFilter = "active";
  renderEmployees();
  openEmployeeDetail(selectedEmployeeId);
  toast("Empleado reactivado.");
}

/** Crea o reutiliza empleado Monorriel al escribir un nombre nuevo en el reporte */
function ensureEmployeeFromMonoName(rawName) {
  const base = String(rawName || "").trim();
  if (!base || base.toLowerCase() === "vacante") return null;
  const display = monoDisplayName(base);
  const key = employeeKey(display);
  const keyBase = employeeKey(monoBaseName(display));
  let existing = employees.find(
    (e) => employeeKey(e.name) === key || employeeKey(monoBaseName(e.name)) === keyBase
  );
  if (existing) {
    const idx = employees.findIndex((e) => e.id === existing.id);
    let merged = applyMonorrielFlag(existing, true);
    if (!isEmployeeActive(merged)) {
      // Si estaba inactivo y lo usan otra vez en Monorriel, reactivar
      merged = normalizeEmployee({
        ...merged,
        status: "active",
        inactiveReason: "",
        inactiveAt: "",
        updatedAt: new Date().toISOString(),
      });
      toast(`${merged.name} estaba inactivo y se reactivó al usarlo en Monorriel.`);
    }
    employees[idx] = merged;
    saveEmployees();
    return employees[idx];
  }
  const emp = normalizeEmployee({
    name: display,
    sites: ["Monorriel"],
    roles: ["Monorriel"],
    status: "active",
  });
  employees.push(emp);
  employees.sort((a, b) => a.name.localeCompare(b.name, "es"));
  saveEmployees();
  toast(`Se agregó a empleados: ${emp.name}`);
  return emp;
}

function getEmployee(id) {
  return employees.find((e) => e.id === id);
}

function safeDownloadName(name, fallback) {
  const clean = String(name || fallback || "archivo")
    .replace(/[^a-zA-Z0-9._\- áéíóúÁÉÍÓÚñÑ]/g, "_")
    .trim();
  return clean || fallback || "archivo";
}

function currentEmpPhoto() {
  if (pendingEmpPhoto === "") return "";
  if (pendingEmpPhoto) return pendingEmpPhoto;
  const emp = getEmployee(selectedEmployeeId);
  return (emp && emp.photo) || "";
}

function currentEmpDoc() {
  if (pendingEmpDoc && pendingEmpDoc.dataUrl === "") {
    return { dataUrl: "", name: "", mime: "" };
  }
  if (pendingEmpDoc && pendingEmpDoc.dataUrl) return pendingEmpDoc;
  const emp = getEmployee(selectedEmployeeId);
  if (!emp || !emp.documentData) return { dataUrl: "", name: "", mime: "" };
  return {
    dataUrl: emp.documentData,
    name: emp.documentName || "documento",
    mime: emp.documentMime || "",
  };
}

function renderEmpPhotoPreview() {
  const photo = currentEmpPhoto();
  const wrap = document.getElementById("ePhotoPreviewWrap");
  const img = document.getElementById("ePhotoPreview");
  const dl = document.getElementById("ePhotoDownload");
  const fileInput = document.getElementById("ePhotoFile");
  if (!photo) {
    wrap.hidden = true;
    img.removeAttribute("src");
    dl.removeAttribute("href");
    if (fileInput) fileInput.value = "";
    return;
  }
  img.src = photo;
  dl.href = photo;
  dl.download = safeDownloadName(
    (getEmployee(selectedEmployeeId) || {}).name || "empleado",
    "foto-empleado"
  ) + ".jpg";
  wrap.hidden = false;
}

function renderEmpDocPreview() {
  const doc = currentEmpDoc();
  const wrap = document.getElementById("eDocPreviewWrap");
  const nameEl = document.getElementById("eDocName");
  const img = document.getElementById("eDocPreviewImg");
  const pdf = document.getElementById("eDocPreviewPdf");
  const dl = document.getElementById("eDocDownload");
  const fileInput = document.getElementById("eDocFile");
  if (!doc.dataUrl) {
    wrap.hidden = true;
    nameEl.textContent = "";
    img.hidden = true;
    pdf.hidden = true;
    img.removeAttribute("src");
    pdf.removeAttribute("src");
    dl.removeAttribute("href");
    if (fileInput) fileInput.value = "";
    return;
  }
  const mime = (doc.mime || "").toLowerCase();
  const isPdf = mime.includes("pdf") || /\.pdf$/i.test(doc.name || "");
  const isImage = mime.startsWith("image/") || /\.(jpe?g|png|gif|webp)$/i.test(doc.name || "");
  nameEl.textContent = doc.name || (isPdf ? "Documento PDF" : "Documento");
  img.hidden = !isImage;
  pdf.hidden = !isPdf;
  if (isImage) {
    img.src = doc.dataUrl;
    pdf.removeAttribute("src");
  } else if (isPdf) {
    pdf.src = doc.dataUrl;
    img.removeAttribute("src");
  } else {
    img.hidden = true;
    pdf.hidden = true;
  }
  dl.href = doc.dataUrl;
  dl.download = safeDownloadName(doc.name, isPdf ? "documento.pdf" : "documento.jpg");
  wrap.hidden = false;
}

function clearEmpPhotoPending() {
  pendingEmpPhoto = "";
  document.getElementById("ePhotoFile").value = "";
  renderEmpPhotoPreview();
  toast("Foto quitada. Pulsa Guardar empleado para confirmar.");
}

function clearEmpDocPending() {
  pendingEmpDoc = { dataUrl: "", name: "", mime: "" };
  document.getElementById("eDocFile").value = "";
  renderEmpDocPreview();
  toast("Documento quitado. Pulsa Guardar empleado para confirmar.");
}

async function onEmpPhotoSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    pendingEmpPhoto = await compressImage(file, 720, 0.7);
    renderEmpPhotoPreview();
    toast("Foto lista. Pulsa Guardar empleado.");
  } catch (_) {
    toast("No se pudo procesar la foto.");
    event.target.value = "";
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read fail"));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

async function onEmpDocSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const mime = (file.type || "").toLowerCase();
  const name = file.name || "documento";
  const isPdf = mime === "application/pdf" || /\.pdf$/i.test(name);
  const isImage = mime.startsWith("image/") || /\.(jpe?g|png)$/i.test(name);
  if (!isPdf && !isImage) {
    toast("Solo se permiten JPG, PNG o PDF.");
    event.target.value = "";
    return;
  }
  if (file.size > EMP_DOC_MAX_BYTES) {
    toast("El documento es muy pesado. Usa uno de máximo 400 KB.");
    event.target.value = "";
    return;
  }
  try {
    let dataUrl;
    let outMime = mime;
    let outName = name;
    if (isImage) {
      dataUrl = await compressImage(file, 1280, 0.72);
      outMime = "image/jpeg";
      if (!/\.jpe?g$/i.test(outName)) outName = outName.replace(/\.[^.]+$/, "") + ".jpg";
    } else {
      dataUrl = await readFileAsDataUrl(file);
      outMime = "application/pdf";
    }
    // data URL ~ +33% size
    if (String(dataUrl).length > EMP_DOC_MAX_BYTES * 1.45) {
      toast("El archivo quedó muy grande después de cargarlo. Usa uno más liviano.");
      event.target.value = "";
      return;
    }
    pendingEmpDoc = { dataUrl, name: outName, mime: outMime };
    renderEmpDocPreview();
    toast("Documento listo. Pulsa Guardar empleado.");
  } catch (_) {
    toast("No se pudo leer el documento.");
    event.target.value = "";
  }
}

function openEmpDocument() {
  const doc = currentEmpDoc();
  if (!doc.dataUrl) {
    toast("No hay documento para ver.");
    return;
  }
  const win = window.open();
  if (!win) {
    toast("Permite ventanas emergentes para previsualizar.");
    return;
  }
  const mime = (doc.mime || "").toLowerCase();
  if (mime.includes("pdf") || /\.pdf$/i.test(doc.name || "")) {
    win.document.write(
      `<title>${escapeHtml(doc.name || "Documento")}</title><embed src="${doc.dataUrl}" type="application/pdf" width="100%" height="100%" style="border:0;position:fixed;inset:0" />`
    );
  } else {
    win.document.write(
      `<title>${escapeHtml(doc.name || "Documento")}</title><img src="${doc.dataUrl}" style="max-width:100%;height:auto;display:block;margin:0 auto" alt="Documento" />`
    );
  }
}

function openEmployeeDetail(id) {
  const emp = getEmployee(id);
  if (!emp) {
    toast("Empleado no encontrado.");
    return;
  }
  selectedEmployeeId = emp.id;
  creatingEmployee = false;
  pendingEmpPhoto = null;
  pendingEmpDoc = null;
  document.getElementById("employeeDetailTitle").textContent = emp.name || "Empleado";
  document.getElementById("eName").value = monoBaseName(emp.name) || emp.name || "";
  document.getElementById("eMonorriel").checked = isMonorrielEmployee(emp);
  document.getElementById("ePhone").value = emp.phone || "";
  document.getElementById("eCedula").value = emp.cedula || "";
  document.getElementById("eEntry").value = emp.companyEntryDate || "";
  document.getElementById("eWeapons").value = emp.weapons || "";
  document.getElementById("eSerial").value = emp.serial || "";
  document.getElementById("eNote").value = emp.note || "";
  document.getElementById("ePhotoFile").value = "";
  document.getElementById("eDocFile").value = "";
  document.getElementById("eInactiveReason").value = "";
  const sites = (emp.sites || []).join(", ") || "—";
  const roles = (emp.roles || []).join(", ");
  document.getElementById("eSites").textContent = roles
    ? `Servicios: ${sites} · Roles: ${roles}`
    : `Servicios: ${sites}`;
  const inactiveInfo = document.getElementById("eInactiveInfo");
  const deactBox = document.getElementById("empDeactivateBox");
  const btnReact = document.getElementById("btnReactivateEmployee");
  const active = isEmployeeActive(emp);
  if (!active) {
    inactiveInfo.hidden = false;
    inactiveInfo.textContent = `Inactivo desde ${(emp.inactiveAt || "").slice(0, 10) || "—"} · Causa: ${emp.inactiveReason || "—"}`;
    deactBox.hidden = true;
    btnReact.hidden = false;
  } else {
    inactiveInfo.hidden = true;
    deactBox.hidden = false;
    btnReact.hidden = true;
  }
  renderEmpPhotoPreview();
  renderEmpDocPreview();
  switchView("employeeDetailView");
}

/** Rellena campos vacíos de vigilantes en servicios con la ficha del empleado */
function pushEmployeeIntoPosts(emp) {
  const key = employeeKey(emp.name);
  let touched = false;
  posts.forEach((post) => {
    (post.guards || []).forEach((g) => {
      if (employeeKey(g.name) !== key) return;
      const before = JSON.stringify(g);
      g.phone = preferFill(g.phone, emp.phone);
      g.cedula = preferFill(g.cedula, emp.cedula);
      g.companyEntryDate = preferFill(g.companyEntryDate, emp.companyEntryDate);
      g.weapons = preferFill(g.weapons, emp.weapons);
      g.serial = preferFill(g.serial, emp.serial);
      if (JSON.stringify(g) !== before) touched = true;
    });
  });
  return touched;
}

function saveEmployeeDetail() {
  if (!selectedEmployeeId) {
    toast("No hay empleado seleccionado.");
    return;
  }
  const idx = employees.findIndex((e) => e.id === selectedEmployeeId);
  if (idx < 0) {
    toast("Empleado no encontrado.");
    return;
  }
  const name = document.getElementById("eName").value.trim();
  if (!name) {
    toast("El nombre es obligatorio.");
    return;
  }
  const current = employees[idx];
  const photo = currentEmpPhoto();
  const doc = currentEmpDoc();
  const isMono = document.getElementById("eMonorriel").checked;
  let updated = normalizeEmployee({
    ...current,
    name,
    phone: document.getElementById("ePhone").value.trim(),
    cedula: document.getElementById("eCedula").value.trim(),
    companyEntryDate: document.getElementById("eEntry").value,
    weapons: document.getElementById("eWeapons").value.trim(),
    serial: document.getElementById("eSerial").value.trim(),
    note: document.getElementById("eNote").value.trim(),
    photo,
    documentData: doc.dataUrl || "",
    documentName: doc.dataUrl ? doc.name || "" : "",
    documentMime: doc.dataUrl ? doc.mime || "" : "",
    status: current.status || "active",
    inactiveReason: current.inactiveReason || "",
    inactiveAt: current.inactiveAt || "",
    updatedAt: new Date().toISOString(),
  });
  updated = applyMonorrielFlag(updated, isMono);
  employees[idx] = updated;
  selectedEmployeeId = updated.id;
  pendingEmpPhoto = null;
  pendingEmpDoc = null;
  const postsTouched = pushEmployeeIntoPosts(updated);
  if (postsTouched) {
    localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
  }
  rebuildEmployeesFromPosts(employees);
  saveEmployees();
  if (postsTouched) {
    renderMarkers();
    renderShifts();
    renderFinance();
    renderAdminList();
  }
  renderEmployees();
  openEmployeeDetail(selectedEmployeeId);
  toast("Empleado guardado. Los datos vacíos seguirán llenándose desde los servicios.");
}

function normalizePost(p = {}) {
  let guards = Array.isArray(p.guards) ? p.guards.map(normalizeGuard) : [];
  if (!guards.length && (p.guard || p.phone || p.cedula)) {
    guards = [
      normalizeGuard({
        name: p.guard,
        phone: p.phone,
        cedula: p.cedula,
        weapons: p.weapons,
        serial: p.serial || p.license,
        companyEntryDate: p.companyEntryDate || "",
      }),
    ];
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
  };
}

/** Asigna números de cliente estables desde 101 sin reusar ni reordenar los ya asignados */
function ensureClientNumbers(shouldSave = false) {
  let maxNum = 100;
  posts.forEach((p) => {
    const n = Number(p.clientNumber);
    if (Number.isFinite(n) && n >= 101) maxNum = Math.max(maxNum, Math.floor(n));
  });
  let changed = false;
  // Asignar en orden actual a los que no tienen número
  posts.forEach((p) => {
    const n = Number(p.clientNumber);
    if (Number.isFinite(n) && n >= 101) return;
    maxNum += 1;
    p.clientNumber = maxNum;
    changed = true;
  });
  if (changed && shouldSave) {
    localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
    queueCloudSave();
  }
  return changed;
}

function nextClientNumber() {
  ensureClientNumbers(false);
  let maxNum = 100;
  posts.forEach((p) => {
    const n = Number(p.clientNumber);
    if (Number.isFinite(n) && n >= 101) maxNum = Math.max(maxNum, Math.floor(n));
  });
  return maxNum + 1;
}

function sortPostsByClientNumber(list) {
  return [...list].sort((a, b) => {
    const an = Number(a.clientNumber) || 999999;
    const bn = Number(b.clientNumber) || 999999;
    if (an !== bn) return an - bn;
    return String(a.site || "").localeCompare(String(b.site || ""), "es");
  });
}

function calcMonthly(hours, hourlyRate, fallbackMonth, fallbackNow) {
  if (hours > 0 && hourlyRate > 0) return hours * hourlyRate;
  return Number(fallbackMonth) || Number(fallbackNow) || 0;
}

function updateMonthPreview() {
  const hours = Number(document.getElementById("fHours").value) || 0;
  const rate = Number(document.getElementById("fHourlyRate").value) || 0;
  const month = hours * rate;
  document.getElementById("fPriceMonth").value = month
    ? month.toLocaleString("es-DO", { maximumFractionDigits: 2 })
    : "";
  document.getElementById("financeCalcHint").textContent = hours || rate
    ? `${hours} h × RD$ ${rate} = RD$ ${month.toLocaleString("es-DO", { maximumFractionDigits: 2 })}`
    : "Mes = horas × precio por hora";
}

function primaryGuard(post) {
  return (post.guards && post.guards.find((g) => g.name.trim())) || (post.guards && post.guards[0]) || emptyGuard();
}

let cloudReady = false;
let cloudSaving = false;
let cloudSaveTimer = null;

function setCloudStatus(text) {
  const el = document.getElementById("cloudStatus");
  if (el) el.textContent = text;
}

function savePosts() {
  localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
  rebuildEmployeesFromPosts();
  localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees));
  queueCloudSave();
}

function saveReports() {
  localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
  queueCloudSave();
}

function saveEmployees() {
  localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees));
  queueCloudSave();
}

function queueCloudSave() {
  if (!window.RFSCloudApi) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => {
    pushToCloud().catch(() => {});
  }, 600);
}

async function pushToCloud() {
  if (!window.RFSCloudApi || cloudSaving) return;
  cloudSaving = true;
  setCloudStatus("Nube: guardando…");
  try {
    await window.RFSCloudApi.saveCloud(posts, reports, employees, loans, monorrielReports, appUsers, chatMessages);
    cloudReady = true;
    setCloudStatus("Nube: guardado ✓ (todas las PCs)");
  } catch (err) {
    console.error(err);
    setCloudStatus("Nube: error al guardar (se mantiene copia local)");
  } finally {
    cloudSaving = false;
  }
}

async function syncFromCloud() {
  if (!window.RFSCloudApi) {
    setCloudStatus("Nube: no configurada");
    return { added: 0, usedCloud: false };
  }
  setCloudStatus("Nube: sincronizando…");
  try {
    const remote = await window.RFSCloudApi.loadCloud();
    const localPosts = posts;
    const localReports = reports;
    const localEmployees = employees;
    const localLoans = loans;
    const localMono = monorrielReports;
    const localUsers = appUsers;

    if (remote.empty || (!remote.posts.length && !remote.reports.length)) {
      rebuildEmployeesFromPosts(localEmployees);
      ensureMonorrielEmployeesImported();
      ensureOwnerUser();
      await window.RFSCloudApi.saveCloud(localPosts, localReports, employees, localLoans, localMono, appUsers, chatMessages);
      localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees));
      localStorage.setItem(LOANS_KEY, JSON.stringify(loans));
      localStorage.setItem(MONORRIEL_REPORTS_KEY, JSON.stringify(monorrielReports));
      localStorage.setItem(USERS_KEY, JSON.stringify(appUsers));
      localStorage.setItem(MESSAGES_KEY, JSON.stringify(chatMessages));
      cloudReady = true;
      setCloudStatus("Nube: activa ✓ (datos iniciales subidos)");
      return { added: 0, usedCloud: true };
    }

    posts = remote.posts.map(normalizePost);
    reports = Array.isArray(remote.reports) ? remote.reports : [];
    employees = Array.isArray(remote.employees) ? remote.employees.map(normalizeEmployee) : [];
    // Si la nube aún no tiene préstamos/monorriel, conservar los locales
    const remoteLoans = Array.isArray(remote.loans) ? remote.loans.map(normalizeLoan) : [];
    loans = remoteLoans.length ? remoteLoans : localLoans.map(normalizeLoan);
    const remoteMono = Array.isArray(remote.monorrielReports) ? remote.monorrielReports.map(normalizeMonoReport) : [];
    monorrielReports = remoteMono.length ? remoteMono : localMono.map(normalizeMonoReport);
    const remoteUsers = Array.isArray(remote.users) ? remote.users.map(normalizeUser) : [];
    if (remoteUsers.length) {
      appUsers = remoteUsers;
      ensureOwnerUser();
    } else {
      appUsers = localUsers.map(normalizeUser);
      ensureOwnerUser();
    }
    const remoteMsgs = Array.isArray(remote.messages) ? remote.messages.map(normalizeChatMessage) : [];
    chatMessages = mergeChatMessages(chatMessages, remoteMsgs);
    rebuildEmployeesFromPosts(employees);
    ensureMonorrielEmployeesImported();
    localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
    localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
    localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees));
    localStorage.setItem(LOANS_KEY, JSON.stringify(loans));
    localStorage.setItem(MONORRIEL_REPORTS_KEY, JSON.stringify(monorrielReports));
    localStorage.setItem(USERS_KEY, JSON.stringify(appUsers));
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(chatMessages));
    cloudReady = true;
    setCloudStatus(`Nube: activa ✓ · ${posts.length} servicios · ${employees.length} empleados · ${loans.length} préstamos · ${monorrielReports.length} monorriel`);
    return { added: 0, usedCloud: true };
  } catch (err) {
    console.error(err);
    setCloudStatus("Nube: sin conexión (usando datos locales)");
    return { added: 0, usedCloud: false };
  }
}

function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

function statusClass(status) {
  return STATUS_LABEL[status] ? status : "warn";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function money(n) {
  const value = Number(n) || 0;
  return `RD$ ${value.toLocaleString("es-DO", { maximumFractionDigits: 2 })}`;
}

function getPost(id) {
  return posts.find((p) => p.id === id);
}

function serviceLabel(type) {
  return type === "24" ? "24 horas" : "12 horas";
}

function todayLabel() {
  return new Date().toLocaleDateString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function guardsSummary(post) {
  const named = (post.guards || []).filter((g) => g.name.trim());
  if (!named.length) return "Sin vigilantes";
  if (named.length === 1) return named[0].name;
  return `${named[0].name} +${named.length - 1} más`;
}

/** Extrae lat/lng de enlaces comunes de Google Maps */
function parseGoogleMapsUrl(raw) {
  const input = String(raw || "").trim();
  if (!input) return null;

  // @18.4861,-69.9312,17z
  let m = input.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]), mapsUrl: input };

  // ?q=18.4861,-69.9312  or  ?query=18.4861,-69.9312
  m = input.match(/[?&](?:q|query)=(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]), mapsUrl: input };

  // /place/.../18.4861,-69.9312
  m = input.match(/\/(-?\d+\.\d+),\s*(-?\d+\.\d+)(?:\/|$|\?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]), mapsUrl: input };

  // !3dLAT!4dLNG
  m = input.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]), mapsUrl: input };

  // plain "18.4861, -69.9312"
  m = input.match(/^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)$/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]), mapsUrl: `https://maps.google.com/?q=${m[1]},${m[2]}` };

  return null;
}

async function resolveMapsLink() {
  const raw = document.getElementById("fMapsUrl").value.trim();
  if (!raw) {
    toast("Pega un enlace de Google Maps.");
    return;
  }

  let parsed = parseGoogleMapsUrl(raw);
  if (!parsed && /maps\.app\.goo\.gl|goo\.gl\/maps/i.test(raw)) {
    try {
      // Intento de resolver acortadores (puede fallar por CORS)
      const res = await fetch(raw, { method: "GET", redirect: "follow", mode: "cors" });
      parsed = parseGoogleMapsUrl(res.url || raw);
    } catch (_) {
      /* ignore */
    }
  }

  if (!parsed || !Number.isFinite(parsed.lat) || !Number.isFinite(parsed.lng)) {
    toast("No pude leer la ubicación. En Maps: Compartir → Copiar enlace (el largo), o pega lat,lng.");
    document.getElementById("mapsParseHint").textContent =
      "Tip: abre el lugar en Google Maps → Compartir → Copiar enlace. Si es maps.app.goo.gl, ábrelo y copia el enlace completo.";
    return;
  }

  document.getElementById("fLat").value = parsed.lat.toFixed(6);
  document.getElementById("fLng").value = parsed.lng.toFixed(6);
  document.getElementById("fMapsUrl").value = parsed.mapsUrl || raw;
  document.getElementById("mapsParseHint").textContent = "Ubicación cargada desde Google Maps.";
  toast("Ubicación cargada.");
}

function initMap() {
  map = L.map("map", { zoomControl: false, attributionControl: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
  L.control.zoom({ position: "topright" }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
  renderMarkers();
  fitAll();
}

function pinIcon(status, siteName) {
  const label = escapeHtml(siteName || "Servicio");
  return L.divIcon({
    className: "rfs-marker",
    html: `<div class="marker-wrap"><div class="marker-label">${label}</div><div class="marker-pin ${statusClass(status)}"></div></div>`,
    iconSize: [140, 54],
    iconAnchor: [70, 52],
  });
}

function renderMarkers() {
  markersLayer.clearLayers();
  posts.forEach((post) => {
    if (!Number.isFinite(post.lat) || !Number.isFinite(post.lng)) return;
    const marker = L.marker([post.lat, post.lng], { icon: pinIcon(post.status, post.site) });
    marker.on("click", () => openSheet(post.id));
    marker.addTo(markersLayer);
  });
}

function fitAll() {
  const valid = posts.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!valid.length) {
    map.setView([18.4861, -69.9312], 12);
    return;
  }
  const bounds = L.latLngBounds(valid.map((p) => [p.lat, p.lng]));
  map.fitBounds(bounds.pad(0.2));
}

function renderShifts() {
  const list = document.getElementById("shiftsList");
  const summary = document.getElementById("shiftsSummary");
  ensureClientNumbers(true);
  const activeClients = posts.length;
  const counts = { ok: 0, warn: 0, alert: 0 };
  posts.forEach((p) => {
    counts[p.status] = (counts[p.status] || 0) + 1;
  });
  summary.textContent = activeClients
    ? `Clientes activos: ${activeClients} · ${counts.ok || 0} en puesto · ${counts.warn || 0} pendientes · ${counts.alert || 0} incidentes`
    : "Clientes activos: 0 · Sin clientes todavía";

  if (!posts.length) {
    list.innerHTML = `<p class="empty">No hay clientes. Entra a Admin con la clave y crea el primero (se numera desde 101).</p>`;
    return;
  }

  const ordered = sortPostsByClientNumber(posts);
  list.innerHTML = ordered
    .map((p) => {
      const g = primaryGuard(p);
      const num = p.clientNumber || "—";
      return `
      <button class="shift-card" type="button" data-id="${p.id}">
        <div class="row">
          <div>
            <h3><span class="client-num">#${escapeHtml(String(num))}</span> ${escapeHtml(p.site)}</h3>
            <p>${escapeHtml(guardsSummary(p))} · ${escapeHtml(p.guardCount)} vigilante(s)</p>
            <p style="margin-top:6px">Horario: <strong style="color:#fff">${escapeHtml(p.shift || "—")}</strong> · ${serviceLabel(p.serviceType)}</p>
            <p>Supervisor: ${escapeHtml(p.supervisor || "—")} · Tel: ${escapeHtml(g.phone || "—")}</p>
          </div>
          <span class="status-pill ${statusClass(p.status)}">${STATUS_LABEL[p.status]}</span>
        </div>
      </button>`;
    })
    .join("");

  list.querySelectorAll(".shift-card").forEach((btn) => {
    btn.addEventListener("click", () => openDetail(btn.dataset.id));
  });
}

function fillReportPostSelect(preferredId) {
  const select = document.getElementById("reportPost");
  select.innerHTML = sortPostsByClientNumber(posts)
    .map((p) => `<option value="${p.id}">#${escapeHtml(String(p.clientNumber || "—"))} ${escapeHtml(p.site)} — ${escapeHtml(guardsSummary(p))}</option>`)
    .join("");
  if (preferredId && getPost(preferredId)) select.value = preferredId;
}

function renderReports() {
  const list = document.getElementById("reportsList");
  if (!reports.length) {
    list.innerHTML = `<p class="empty">Aún no hay reportes. Crea el primero arriba.</p>`;
    return;
  }
  list.innerHTML = reports
    .map((r) => {
      const post = getPost(r.postId);
      const site = post ? post.site : "Puesto eliminado";
      const guard = post ? guardsSummary(post) : "—";
      const photo = r.photo ? `<img class="thumb" src="${r.photo}" alt="Foto del reporte" />` : "";
      return `
        <article class="report-card">
          <h3>${escapeHtml(site)}</h3>
          <p>${escapeHtml(guard)}</p>
          <div class="meta">
            <span class="type-pill">${TYPE_LABEL[r.type] || r.type}</span>
            <span class="status-pill ${r.type === "incidente" ? "alert" : "ok"}">${escapeHtml(r.whenLabel)}</span>
          </div>
          <p style="margin-top:10px;color:#d4d4d8">${escapeHtml(r.text)}</p>
          ${photo}
        </article>`;
    })
    .join("");
}

function renderFinance() {
  const totalMonth = posts.reduce((sum, p) => sum + (Number(p.priceMonth) || 0), 0);
  const totalGuards = posts.reduce((sum, p) => sum + (Number(p.guardCount) || 0), 0);
  const totalHours = posts.reduce((sum, p) => sum + (Number(p.hours) || 0), 0);
  const avgRate = totalHours > 0 ? totalMonth / totalHours : 0;

  document.getElementById("financeServicesCount").textContent = String(posts.length);
  document.getElementById("financeGuardsCount").textContent = String(totalGuards);
  document.getElementById("financeTotalMonth").textContent = money(totalMonth);
  document.getElementById("financeHoursSummary").textContent = posts.length
    ? `${totalHours.toLocaleString("es-DO")} horas en total · promedio ${money(avgRate)} / hora`
    : "Sin servicios todavía";

  const list = document.getElementById("financeList");
  if (!posts.length) {
    list.innerHTML = `<p class="empty">No hay servicios registrados.</p>`;
    return;
  }

  list.innerHTML = posts
    .map(
      (p) => `
      <article class="report-card finance-clickable" data-id="${p.id}" role="button" tabindex="0">
        <h3>${escapeHtml(p.site)}</h3>
        <p>${serviceLabel(p.serviceType)} · ${escapeHtml(p.guardCount)} vigilante(s) · Inicio: ${escapeHtml(p.startDate || "—")}</p>
        <div class="finance-row">
          <div>
            <span class="muted">Horas</span>
            <strong>${escapeHtml(p.hours || 0)}</strong>
          </div>
          <div>
            <span class="muted">Precio / hora</span>
            <strong>${money(p.hourlyRate)}</strong>
          </div>
        </div>
        <div class="finance-row" style="margin-top:8px">
          <div>
            <span class="muted">A cobrar por mes</span>
            <strong>${money(p.priceMonth)}</strong>
          </div>
        </div>
      </article>`
    )
    .join("");

  list.querySelectorAll(".finance-clickable").forEach((el) => {
    el.addEventListener("click", () => openDetail(el.dataset.id));
  });
}

function guardCardHtml(index, guard = emptyGuard()) {
  return `
    <div class="guard-card" data-index="${index}">
      <div class="row" style="align-items:center;margin-bottom:8px">
        <strong>Vigilante ${index + 1}</strong>
        <button type="button" class="btn ghost btn-remove-guard" data-index="${index}" style="width:auto;margin:0;padding:6px 10px" ${index === 0 ? "disabled" : ""}>Quitar</button>
      </div>
      <label>Nombre<input class="g-name" type="text" value="${escapeHtml(guard.name)}" placeholder="Nombre completo" /></label>
      <div class="coords-row">
        <label>Teléfono<input class="g-phone" type="tel" value="${escapeHtml(guard.phone)}" placeholder="809-000-0000" /></label>
        <label>Cédula<input class="g-cedula" type="text" value="${escapeHtml(guard.cedula)}" placeholder="000-0000000-0" /></label>
      </div>
      <label>Fecha de entrada a la empresa<input class="g-entry" type="date" value="${escapeHtml(guard.companyEntryDate)}" /></label>
      <label>Arma / equipo asignado<input class="g-weapons" type="text" value="${escapeHtml(guard.weapons)}" placeholder="Ej. Escopeta, radio" /></label>
      <label>Número de serie<input class="g-serial" type="text" value="${escapeHtml(guard.serial)}" placeholder="Nº de serie del arma/equipo" /></label>
    </div>`;
}

function renderGuardsEditor(guards) {
  const list = Array.isArray(guards) && guards.length ? guards : [emptyGuard()];
  guardEditorCount = list.length;
  const editor = document.getElementById("guardsEditor");
  editor.innerHTML = list.map((g, i) => guardCardHtml(i, g)).join("");
  editor.querySelectorAll(".btn-remove-guard").forEach((btn) => {
    btn.addEventListener("click", () => {
      const current = readGuardsFromEditor();
      const idx = Number(btn.dataset.index);
      if (current.length <= 1) return;
      current.splice(idx, 1);
      renderGuardsEditor(current);
    });
  });
}

function readGuardsFromEditor() {
  return [...document.querySelectorAll("#guardsEditor .guard-card")].map((card) =>
    normalizeGuard({
      name: card.querySelector(".g-name").value.trim(),
      phone: card.querySelector(".g-phone").value.trim(),
      cedula: card.querySelector(".g-cedula").value.trim(),
      companyEntryDate: card.querySelector(".g-entry").value,
      weapons: card.querySelector(".g-weapons").value.trim(),
      serial: card.querySelector(".g-serial").value.trim(),
    })
  );
}

function addGuardEditor() {
  const current = readGuardsFromEditor();
  if (current.length >= MAX_GUARDS) {
    toast(`Máximo ${MAX_GUARDS} vigilantes por puesto.`);
    return;
  }
  current.push(emptyGuard());
  renderGuardsEditor(current);
}

function renderAdminList() {
  const list = document.getElementById("adminList");
  if (!posts.length) {
    list.innerHTML = `<p class="empty">No hay puestos. Crea el primero arriba.</p>`;
    return;
  }

  ensureClientNumbers(false);
  list.innerHTML = sortPostsByClientNumber(posts)
    .map((p) => {
      const g = primaryGuard(p);
      return `
      <article class="report-card admin-card" data-id="${p.id}">
        <div class="row">
          <div>
            <h3><span class="client-num">#${escapeHtml(String(p.clientNumber || "—"))}</span> ${escapeHtml(p.site)}</h3>
            <p>${escapeHtml(guardsSummary(p))} · ${escapeHtml(p.guardCount)} vigilante(s)</p>
            <p>Supervisor: ${escapeHtml(p.supervisor || "—")} · Tel: ${escapeHtml(g.phone || "—")}</p>
            <p>${serviceLabel(p.serviceType)} · ${money(p.priceMonth)} / mes · ${escapeHtml(p.hours || 0)} h</p>
            <p>${Number.isFinite(p.lat) ? "📍 Con ubicación" : "⚠ Sin ubicación en mapa"} · ${escapeHtml(p.region || "")}</p>
          </div>
          <span class="status-pill ${statusClass(p.status)}">${STATUS_LABEL[p.status]}</span>
        </div>
        <div class="admin-actions">
          <button class="btn secondary btn-open" type="button" data-id="${p.id}">Ver datos</button>
          <button class="btn secondary btn-edit" type="button" data-id="${p.id}">Editar</button>
          <button class="btn danger btn-delete" type="button" data-id="${p.id}">Eliminar</button>
        </div>
      </article>`;
    })
    .join("");

  list.querySelectorAll(".btn-open").forEach((btn) => btn.addEventListener("click", () => openDetail(btn.dataset.id)));
  list.querySelectorAll(".btn-edit").forEach((btn) => btn.addEventListener("click", () => loadPostIntoForm(btn.dataset.id)));
  list.querySelectorAll(".btn-delete").forEach((btn) =>
    btn.addEventListener("click", () => askDeletePost(btn.dataset.id))
  );
}

function openSheet(id) {
  const post = getPost(id);
  if (!post) return;
  selectedId = id;
  document.getElementById("sheetTitle").textContent = post.site;
  document.getElementById("sheetMeta").textContent = `${guardsSummary(post)} · ${post.shift || "Sin turno"}`;
  const pill = document.getElementById("sheetStatus");
  pill.textContent = STATUS_LABEL[post.status];
  pill.className = `status-pill ${statusClass(post.status)}`;
  document.getElementById("sheetNote").textContent = post.note || "Toca “Ver todos los datos” para el detalle completo.";
  document.getElementById("sheet").hidden = false;
}

function closeSheet() {
  document.getElementById("sheet").hidden = true;
}

function openDetail(id) {
  const post = getPost(id);
  if (!post) return;
  selectedId = id;
  closeSheet();
  previousView = document.querySelector(".view.active")?.id || "mapView";
  if (previousView === "detailView") previousView = "shiftsView";

  document.getElementById("detailTitle").textContent = post.clientNumber ? `#${post.clientNumber} ${post.site}` : post.site;
  document.getElementById("detailMeta").textContent = `${serviceLabel(post.serviceType)} · Supervisor: ${post.supervisor || "—"} · ${post.shift || "Sin horario"}`;
  document.getElementById("detailStatusWrap").innerHTML = `<span class="status-pill ${statusClass(post.status)}">${STATUS_LABEL[post.status]}</span>`;

  const guardsHtml = (post.guards || [])
    .filter((g) => g.name.trim())
    .map(
      (g, i) => `
      <article class="report-card">
        <h3>Vigilante ${i + 1}: ${escapeHtml(g.name)}</h3>
        <div class="detail-grid" style="margin-top:10px">
          <div><span>Teléfono</span><strong>${escapeHtml(g.phone || "—")}</strong></div>
          <div><span>Cédula</span><strong>${escapeHtml(g.cedula || "—")}</strong></div>
          <div><span>Entrada a la empresa</span><strong>${escapeHtml(g.companyEntryDate || "—")}</strong></div>
          <div><span>Arma / equipo</span><strong>${escapeHtml(g.weapons || "—")}</strong></div>
          <div><span>Nº de serie</span><strong>${escapeHtml(g.serial || "—")}</strong></div>
        </div>
      </article>`
    )
    .join("") || `<p class="empty">Sin vigilantes registrados.</p>`;

  const historyHtml = (post.history || []).length
    ? post.history
        .map(
          (h) => `
        <article class="report-card">
          <h3>${escapeHtml(h.title || "Cambio")}</h3>
          <p>${escapeHtml(h.whenLabel || "")}</p>
          <p style="margin-top:8px;color:#d4d4d8">${escapeHtml(h.note || "")}</p>
        </article>`
        )
        .join("")
    : `<p class="empty">Sin cambios registrados todavía.</p>`;

  document.getElementById("detailBody").innerHTML = `
    <article class="report-card">
      <h3>Datos del servicio</h3>
      <div class="detail-grid" style="margin-top:10px">
        <div><span>Inicio</span><strong>${escapeHtml(post.startDate || "—")}</strong></div>
        <div><span>Vigilantes</span><strong>${escapeHtml(post.guardCount)}</strong></div>
        <div><span>Horas</span><strong>${escapeHtml(post.hours || 0)}</strong></div>
        <div><span>Precio / hora</span><strong>${money(post.hourlyRate)}</strong></div>
        <div><span>Cobro mensual</span><strong>${money(post.priceMonth)}</strong></div>
        <div><span>Zona</span><strong>${escapeHtml(post.region || "—")}</strong></div>
        <div><span>Encargado cliente</span><strong>${escapeHtml(post.clientContact || "—")}</strong></div>
        <div><span>Tel. cliente</span><strong>${escapeHtml(post.clientPhone || "—")}</strong></div>
        <div><span>Ubicación mapa</span><strong>${Number.isFinite(post.lat) ? "Cargada" : "Pendiente"}</strong></div>
      </div>
      <p class="sheet-note"><strong>Dirección:</strong> ${escapeHtml(post.address || "—")}</p>
      <p class="sheet-note">${escapeHtml(post.note || "Sin notas.")}</p>
    </article>
    <div class="section-head tight"><h2>Vigilantes</h2></div>
    ${guardsHtml}
    <div class="section-head tight"><h2>Historial del servicio</h2></div>
    ${historyHtml}
  `;

  switchView("detailView");
}

function focusPost(id) {
  const post = getPost(id);
  if (!post || !map || !Number.isFinite(post.lat) || !Number.isFinite(post.lng)) {
    toast("Este servicio no tiene ubicación cargada.");
    return;
  }
  map.setView([post.lat, post.lng], 16, { animate: true });
  openSheet(id);
}


/* ==== USUARIOS Y PERMISOS ==== */
const MODULE_DEFS = [
  { key: "home", label: "Inicio", view: "homeView" },
  { key: "map", label: "Mapa", view: "mapView" },
  { key: "clients", label: "Clientes", view: "shiftsView" },
  { key: "employees", label: "Empleados", view: "employeesView" },
  { key: "loans", label: "Préstamos", view: "loansView" },
  { key: "monorriel", label: "Monorriel", view: "monorrielView" },
  { key: "finance", label: "Finanzas", view: "financeView" },
  { key: "reports", label: "Reportes", view: "reportsView" },
  { key: "messages", label: "Mensajes", view: "messagesView" },
  { key: "admin", label: "Admin", view: "adminView" },
];

const VIEW_TO_MODULE = {
  homeView: "home",
  mapView: "map",
  shiftsView: "clients",
  employeesView: "employees",
  employeeDetailView: "employees",
  employeeNewView: "employees",
  loansView: "loans",
  loanNewView: "loans",
  loanDetailView: "loans",
  monorrielView: "monorriel",
  monoReportEditView: "monorriel",
  monoReportDetailView: "monorriel",
  monoStaffView: "monorriel",
  financeView: "finance",
  reportsView: "reports",
  messagesView: "messages",
  adminView: "admin",
  detailView: "clients",
  loginView: null,
};

function allModulesTrue() {
  const mods = {};
  MODULE_DEFS.forEach((m) => {
    mods[m.key] = true;
  });
  return mods;
}

function normalizeUser(u = {}) {
  const modules = { ...allModulesTrue(), ...(u.modules || {}) };
  // ensure keys exist
  MODULE_DEFS.forEach((m) => {
    if (typeof modules[m.key] !== "boolean") modules[m.key] = !!modules[m.key];
  });
  const username = String(u.username || "").trim().toLowerCase();
  const role = u.role === "owner" || username === OWNER_USERNAME ? "owner" : "user";
  if (role === "owner") {
    MODULE_DEFS.forEach((m) => {
      modules[m.key] = true;
    });
  }
  return {
    id: u.id || `user-${username || Date.now()}`,
    username,
    password: String(u.password || ""),
    displayName: (u.displayName || u.name || username || "").trim(),
    role,
    modules,
    active: u.active === false ? false : true,
    createdAt: u.createdAt || new Date().toISOString(),
    updatedAt: u.updatedAt || new Date().toISOString(),
  };
}

function ensureOwnerUser() {
  let owner = appUsers.find((u) => u.role === "owner" || u.username === OWNER_USERNAME);
  if (!owner) {
    owner = normalizeUser({
      id: "user-owner",
      username: OWNER_USERNAME,
      password: ADMIN_PASSWORD,
      displayName: "Dueño",
      role: "owner",
      modules: allModulesTrue(),
    });
    appUsers.unshift(owner);
    return true;
  }
  // keep owner password in sync with master admin password if empty
  const idx = appUsers.findIndex((u) => u.id === owner.id);
  owner = normalizeUser({ ...owner, role: "owner", username: OWNER_USERNAME, modules: allModulesTrue() });
  if (!owner.password) owner.password = ADMIN_PASSWORD;
  appUsers[idx] = owner;
  return false;
}

function saveUsers() {
  ensureOwnerUser();
  localStorage.setItem(USERS_KEY, JSON.stringify(appUsers));
  queueCloudSave();
}

function getSessionUserId() {
  // sessionStorage: al cerrar la app hay que volver a poner usuario y clave
  return sessionStorage.getItem(APP_SESSION_KEY) || "";
}

function setSessionUserId(id) {
  if (id) sessionStorage.setItem(APP_SESSION_KEY, id);
  else sessionStorage.removeItem(APP_SESSION_KEY);
  // limpia restos viejos en localStorage
  try { localStorage.removeItem(APP_SESSION_KEY); } catch (_) {}
}

function restoreSessionUser() {
  const id = getSessionUserId();
  currentUser = appUsers.find((u) => u.id === id && u.active) || null;
  return currentUser;
}

function canAccessModule(moduleKey) {
  if (!currentUser) return false;
  if (currentUser.role === "owner") return true;
  return !!(currentUser.modules && currentUser.modules[moduleKey]);
}

function canAccessView(viewId) {
  if (viewId === "loginView") return true;
  const mod = VIEW_TO_MODULE[viewId];
  if (!mod) return !!currentUser;
  return canAccessModule(mod);
}

function firstAllowedView() {
  const order = ["homeView", "mapView", "shiftsView", "employeesView", "messagesView", "loansView", "monorrielView", "financeView", "reportsView", "adminView"];
  for (const v of order) {
    if (canAccessView(v)) return v;
  }
  return "loginView";
}

function applyAccessControl() {
  const loggedIn = !!currentUser;
  const app = document.getElementById("app");
  if (app) app.classList.toggle("logged-out", !loggedIn);

  const label = document.getElementById("sessionUserLabel");
  const btnOut = document.getElementById("btnLogoutUser");
  if (label && btnOut) {
    if (loggedIn) {
      label.hidden = false;
      btnOut.hidden = false;
      label.textContent = currentUser.displayName || currentUser.username;
      label.title = currentUser.username;
    } else {
      label.hidden = true;
      btnOut.hidden = true;
    }
  }

  // Ocultar toda la barra inferior si no hay sesión
  const tabbar = document.querySelector(".tabbar");
  if (tabbar) tabbar.hidden = !loggedIn;

  document.querySelectorAll(".tabbar .tab").forEach((tab) => {
    const view = tab.dataset.view;
    const allowed = loggedIn && canAccessView(view);
    tab.hidden = !allowed;
    tab.disabled = !allowed;
    if (!allowed) tab.classList.remove("active");
  });

  document.querySelectorAll(".welcome-actions [data-go]").forEach((btn) => {
    const view = btn.dataset.go;
    btn.hidden = !(loggedIn && canAccessView(view));
  });

  const usersCard = document.getElementById("usersAdminCard");
  if (usersCard) usersCard.hidden = !(currentUser && currentUser.role === "owner");

  const printBtn = document.getElementById("btnPrintCurrent");
  if (printBtn) printBtn.hidden = !loggedIn;
  const locateBtn = document.getElementById("btnLocateMe");
  if (locateBtn) locateBtn.hidden = !loggedIn;
}

function requireLoginOrContinue() {
  if (currentUser) {
    applyAccessControl();
    const active = document.querySelector(".view.active");
    if (!active || active.id === "loginView" || !canAccessView(active.id)) {
      switchView(firstAllowedView());
    }
    return true;
  }
  applyAccessControl();
  switchView("loginView");
  return false;
}

function tryAppLogin() {
  const user = document.getElementById("loginUsername").value.trim().toLowerCase();
  const pass = document.getElementById("loginPassword").value;
  const error = document.getElementById("loginError");
  const found = appUsers.find((u) => u.active && u.username === user && u.password === pass);
  if (!found) {
    error.hidden = false;
    toast("Usuario o clave incorrectos.");
    return;
  }
  currentUser = found;
  setSessionUserId(found.id);
  error.hidden = true;
  document.getElementById("loginPassword").value = "";
  // Owner auto-unlock admin tools
  if (found.role === "owner" || found.modules.admin) setAdminUnlocked(true);
  else setAdminUnlocked(false);
  applyAccessControl();
  switchView(firstAllowedView());
  toast(`Bienvenido, ${found.displayName || found.username}`);
}

function logoutAppUser() {
  currentUser = null;
  setSessionUserId("");
  setAdminUnlocked(false);
  applyAccessControl();
  switchView("loginView");
  toast("Sesión cerrada.");
}

function readUserFormModules() {
  const modules = allModulesTrue();
  MODULE_DEFS.forEach((m) => {
    const el = document.querySelector(`#uPermGrid [data-perm="${m.key}"]`);
    modules[m.key] = !!(el && el.checked);
  });
  modules.home = true; // siempre puede volver al inicio si tiene algún acceso; still honor checkbox if unchecked
  const homeEl = document.querySelector(`#uPermGrid [data-perm="home"]`);
  modules.home = !!(homeEl && homeEl.checked);
  return modules;
}

function fillUserFormModules(modules) {
  MODULE_DEFS.forEach((m) => {
    const el = document.querySelector(`#uPermGrid [data-perm="${m.key}"]`);
    if (el) el.checked = modules && typeof modules[m.key] === "boolean" ? modules[m.key] : true;
  });
}

function clearUserForm() {
  document.getElementById("uEditingId").value = "";
  document.getElementById("uDisplayName").value = "";
  document.getElementById("uUsername").value = "";
  document.getElementById("uPassword").value = "";
  document.getElementById("uUsername").disabled = false;
  fillUserFormModules({
    home: true,
    map: true,
    clients: true,
    employees: true,
    loans: false,
    monorriel: true,
    finance: false,
    reports: true,
    messages: true,
    admin: false,
  });
  document.getElementById("btnCancelUserEdit").hidden = true;
  document.getElementById("btnSaveUser").textContent = "Guardar usuario";
}

function renderUsersAdmin() {
  const list = document.getElementById("usersList");
  if (!list) return;
  if (!(currentUser && currentUser.role === "owner")) {
    list.innerHTML = "";
    return;
  }
  const rows = appUsers
    .slice()
    .sort((a, b) => a.username.localeCompare(b.username))
    .map((u) => {
      const allowed = MODULE_DEFS.filter((m) => u.modules[m.key]).map((m) => m.label).join(", ");
      return `<article class="report-card">
        <div class="row">
          <div>
            <h3>${escapeHtml(u.displayName || u.username)} ${u.role === "owner" ? "(Dueño)" : ""}</h3>
            <p>Usuario: <strong>${escapeHtml(u.username)}</strong> · ${u.active ? "Activo" : "Inactivo"}</p>
            <p style="margin-top:6px">${escapeHtml(allowed || "Sin módulos")}</p>
          </div>
        </div>
        <div class="admin-actions">
          ${
            u.role === "owner"
              ? ""
              : `<button class="btn secondary btn-edit-user" type="button" data-id="${escapeHtml(u.id)}">Editar</button>
                 <button class="btn danger btn-del-user" type="button" data-id="${escapeHtml(u.id)}">Eliminar</button>`
          }
        </div>
      </article>`;
    })
    .join("");
  list.innerHTML = rows || `<p class="empty">Solo está el usuario dueño.</p>`;
  list.querySelectorAll(".btn-edit-user").forEach((btn) => {
    btn.addEventListener("click", () => editUser(btn.dataset.id));
  });
  list.querySelectorAll(".btn-del-user").forEach((btn) => {
    btn.addEventListener("click", () => deleteUser(btn.dataset.id));
  });
}

function editUser(id) {
  const u = appUsers.find((x) => x.id === id);
  if (!u || u.role === "owner") return;
  document.getElementById("uEditingId").value = u.id;
  document.getElementById("uDisplayName").value = u.displayName || "";
  document.getElementById("uUsername").value = u.username;
  document.getElementById("uUsername").disabled = true;
  document.getElementById("uPassword").value = "";
  document.getElementById("uPassword").placeholder = "Dejar vacío para no cambiar";
  fillUserFormModules(u.modules);
  document.getElementById("btnCancelUserEdit").hidden = false;
  document.getElementById("btnSaveUser").textContent = "Actualizar usuario";
  toast("Editando usuario. Cambia permisos y guarda.");
}

function deleteUser(id) {
  const u = appUsers.find((x) => x.id === id);
  if (!u || u.role === "owner") return;
  const ok = window.confirm(`¿Eliminar el usuario "${u.username}"?`);
  if (!ok) return;
  appUsers = appUsers.filter((x) => x.id !== id);
  saveUsers();
  renderUsersAdmin();
  toast("Usuario eliminado.");
}

function saveUserFromForm() {
  if (!(currentUser && currentUser.role === "owner")) {
    toast("Solo el dueño puede crear usuarios.");
    return;
  }
  const editingId = document.getElementById("uEditingId").value;
  const displayName = document.getElementById("uDisplayName").value.trim();
  let username = document.getElementById("uUsername").value.trim().toLowerCase();
  const password = document.getElementById("uPassword").value;
  const modules = readUserFormModules();

  if (!username) {
    toast("Escribe el usuario.");
    return;
  }
  if (username === OWNER_USERNAME) {
    toast("Ese usuario está reservado para el dueño.");
    return;
  }
  if (!editingId && !password) {
    toast("Escribe una clave para el nuevo usuario.");
    return;
  }
  // must have at least one module
  if (!Object.values(modules).some(Boolean)) {
    toast("Marca al menos un módulo visible.");
    return;
  }

  if (editingId) {
    const idx = appUsers.findIndex((u) => u.id === editingId);
    if (idx < 0) return;
    const prev = appUsers[idx];
    appUsers[idx] = normalizeUser({
      ...prev,
      displayName: displayName || prev.displayName,
      password: password || prev.password,
      modules,
      role: "user",
      updatedAt: new Date().toISOString(),
    });
    toast("Usuario actualizado.");
  } else {
    if (appUsers.some((u) => u.username === username)) {
      toast("Ese usuario ya existe.");
      return;
    }
    appUsers.push(
      normalizeUser({
        username,
        password,
        displayName: displayName || username,
        modules,
        role: "user",
      })
    );
    toast("Usuario creado.");
  }
  saveUsers();
  clearUserForm();
  document.getElementById("uPassword").placeholder = "Clave del usuario";
  renderUsersAdmin();
}
/* ==== FIN USUARIOS ==== */


function isAdminUnlocked() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === "1";
}

function setAdminUnlocked(value) {
  if (value) sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
  else sessionStorage.removeItem(ADMIN_SESSION_KEY);
  updateAdminGate();
}

function updateAdminGate() {
  const canAdmin = !!currentUser && canAccessModule("admin");
  if (!canAdmin) {
    document.getElementById("adminLock").hidden = true;
    document.getElementById("adminContent").hidden = true;
    return;
  }
  // Con permiso Admin, entrar directo (ya validó usuario/clave al iniciar sesión)
  if (!isAdminUnlocked()) {
    sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
  }
  document.getElementById("adminLock").hidden = true;
  document.getElementById("adminContent").hidden = false;
  renderAdminList();
  renderUsersAdmin();
}

function tryAdminLogin() {
  const input = document.getElementById("adminPassword");
  const error = document.getElementById("adminLockError");
  if (input.value === ADMIN_PASSWORD) {
    setAdminUnlocked(true);
    input.value = "";
    error.hidden = true;
    toast("Acceso administrador activo.");
  } else {
    error.hidden = false;
    toast("Clave incorrecta.");
  }
}

function mapsLink(post) {
  if (post.mapsUrl) return post.mapsUrl;
  return `https://maps.google.com/?q=${post.lat},${post.lng}`;
}

function shareText(post) {
  return `Reaction Force Security\nServicio: ${post.site}\nVigilantes: ${guardsSummary(post)}\nUbicación: ${mapsLink(post)}`;
}

async function shareLocation() {
  const post = getPost(selectedId);
  if (!post || !Number.isFinite(post.lat) || !Number.isFinite(post.lng)) {
    toast("Este puesto no tiene ubicación.");
    return;
  }
  const text = shareText(post);
  const url = mapsLink(post);
  if (navigator.share) {
    try {
      await navigator.share({ title: `Ubicación — ${post.site}`, text, url });
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Ubicación copiada. Ya puedes pegarla en WhatsApp u otra app.");
  } catch (_) {
    window.prompt("Copia este enlace de ubicación:", url);
  }
}

function shareWhatsApp() {
  const post = getPost(selectedId);
  if (!post || !Number.isFinite(post.lat) || !Number.isFinite(post.lng)) {
    toast("Este puesto no tiene ubicación.");
    return;
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(shareText(post))}`, "_blank");
}

/* ==== MÓDULO PRÉSTAMOS ==== */
const LOANS_KEY = "rfs-ops-loans";
const LOAN_RATE_AUTH = "021112";
const DEFAULT_LOAN_RATE = 0.1;
const ADVANCE_PACKAGES = {
  2000: { lend: 2000, collect: 2250 },
  3000: { lend: 3000, collect: 3350 },
  5000: { lend: 5000, collect: 5550 },
};

let loans = [];
let selectedLoanId = null;
let loanSelectedEmployeeId = null;
let loanRateUnlocked = false;

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function addDaysIso(isoDate, days) {
  const d = isoDate ? new Date(`${isoDate}T12:00:00`) : new Date();
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    now.setDate(now.getDate() + days);
    return now.toISOString().slice(0, 10);
  }
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function buildAmortizationSchedule(principal, rate, periods, startDate) {
  const P = roundMoney(principal);
  const r = Number(rate) || 0;
  const n = Number(periods) || 1;
  let payment;
  if (r <= 0) {
    payment = roundMoney(P / n);
  } else {
    const factor = Math.pow(1 + r, n);
    payment = roundMoney((P * r * factor) / (factor - 1));
  }
  let balance = P;
  const schedule = [];
  for (let i = 1; i <= n; i += 1) {
    const interest = roundMoney(balance * r);
    let principalPart = roundMoney(payment - interest);
    if (i === n) {
      principalPart = roundMoney(balance);
      payment = roundMoney(principalPart + interest);
    }
    balance = roundMoney(Math.max(0, balance - principalPart));
    schedule.push({
      n: i,
      dueDate: addDaysIso(startDate, 15 * i),
      principal: principalPart,
      interest,
      payment,
      balance,
      paid: false,
      paidAt: "",
      paidAmount: 0,
    });
  }
  return schedule;
}

function buildAdvanceSchedule(collectAmount, startDate) {
  const payment = roundMoney(collectAmount);
  return [
    {
      n: 1,
      dueDate: addDaysIso(startDate, 15),
      principal: payment,
      interest: 0,
      payment,
      balance: 0,
      paid: false,
      paidAt: "",
      paidAmount: 0,
    },
  ];
}

function normalizeLoanInstallment(row = {}, index = 0) {
  return {
    n: Number(row.n) || index + 1,
    dueDate: row.dueDate || "",
    principal: roundMoney(row.principal),
    interest: roundMoney(row.interest),
    payment: roundMoney(row.payment),
    balance: roundMoney(row.balance),
    paid: !!row.paid,
    paidAt: row.paidAt || "",
    paidAmount: roundMoney(row.paidAmount),
  };
}

function normalizeLoan(raw = {}) {
  const type = raw.type === "advance" ? "advance" : "amortized";
  const schedule = Array.isArray(raw.schedule) ? raw.schedule.map(normalizeLoanInstallment) : [];
  const paidTotal = roundMoney(schedule.filter((s) => s.paid).reduce((a, s) => a + (s.paidAmount || s.payment), 0));
  const dueTotal = roundMoney(schedule.reduce((a, s) => a + s.payment, 0));
  const interestTotal = roundMoney(schedule.reduce((a, s) => a + s.interest, 0));
  const remaining = roundMoney(schedule.filter((s) => !s.paid).reduce((a, s) => a + s.payment, 0));
  let status = raw.status || "active";
  if (schedule.length && schedule.every((s) => s.paid)) status = "paid";
  else if (schedule.some((s) => !s.paid && s.dueDate && s.dueDate < todayIso())) status = "overdue";
  else if (status === "paid" || status === "overdue") status = remaining > 0 ? "active" : "paid";

  return {
    id: raw.id || `loan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    employeeId: raw.employeeId || "",
    employeeName: raw.employeeName || "",
    principal: roundMoney(raw.principal),
    collectAmount: roundMoney(raw.collectAmount),
    rate: Number(raw.rate) || 0,
    rateUnlocked: !!raw.rateUnlocked,
    periods: Number(raw.periods) || schedule.length || 1,
    startDate: raw.startDate || "",
    note: raw.note || "",
    schedule,
    paidTotal,
    dueTotal,
    interestTotal,
    remaining,
    profitExpected:
      type === "advance"
        ? roundMoney((raw.collectAmount || 0) - (raw.principal || 0))
        : interestTotal,
    profitCollected: roundMoney(
      type === "advance"
        ? (schedule.length && schedule.every((s) => s.paid) ? (Number(raw.collectAmount) || 0) - (Number(raw.principal) || 0) : 0)
        : schedule.filter((s) => s.paid).reduce((a, s) => a + s.interest, 0)
    ),
    status: schedule.length && schedule.every((s) => s.paid) ? "paid" : status === "overdue" ? "overdue" : "active",
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

function refreshLoanDerived(loan) {
  return normalizeLoan(loan);
}

function saveLoans() {
  localStorage.setItem(LOANS_KEY, JSON.stringify(loans));
  queueCloudSave();
}

function getLoan(id) {
  return loans.find((l) => l.id === id);
}

function loanTypeLabel(type) {
  return type === "advance" ? "Avance de efectivo" : "Préstamo amortizado";
}

function loanStatusLabel(status) {
  if (status === "paid") return "Saldado";
  if (status === "overdue") return "Cuota vencida";
  return "Activo";
}

function computeLoanPreview() {
  const type = document.getElementById("loanType").value;
  const startDate = document.getElementById("loanStartDate").value || todayIso();
  if (type === "advance") {
    const pkg = ADVANCE_PACKAGES[document.getElementById("loanAdvancePackage").value] || ADVANCE_PACKAGES[2000];
    const schedule = buildAdvanceSchedule(pkg.collect, startDate);
    return {
      type,
      principal: pkg.lend,
      collectAmount: pkg.collect,
      rate: 0,
      periods: 1,
      schedule,
      profit: pkg.collect - pkg.lend,
    };
  }
  const principal = Number(document.getElementById("loanPrincipal").value) || 0;
  const periods = Number(document.getElementById("loanPeriods").value) || 3;
  let ratePct = Number(document.getElementById("loanRate").value);
  if (!Number.isFinite(ratePct)) ratePct = 10;
  const rate = ratePct / 100;
  const schedule = principal > 0 ? buildAmortizationSchedule(principal, rate, periods, startDate) : [];
  const dueTotal = roundMoney(schedule.reduce((a, s) => a + s.payment, 0));
  const interestTotal = roundMoney(schedule.reduce((a, s) => a + s.interest, 0));
  return {
    type,
    principal,
    collectAmount: dueTotal,
    rate,
    periods,
    schedule,
    profit: interestTotal,
  };
}

function renderLoanPreview() {
  const box = document.getElementById("loanPreviewBox");
  if (!box) return;
  const preview = computeLoanPreview();
  if (!preview.schedule.length) {
    box.innerHTML = `<p class="muted">Completa el monto para ver el cuadro.</p>`;
    return;
  }
  const rows = preview.schedule
    .map(
      (s) => `<tr>
      <td>${s.n}</td>
      <td>${escapeHtml(s.dueDate)}</td>
      <td>${money(s.principal)}</td>
      <td>${money(s.interest)}</td>
      <td><strong>${money(s.payment)}</strong></td>
      <td>${money(s.balance)}</td>
    </tr>`
    )
    .join("");
  box.innerHTML = `
    <p><strong>${loanTypeLabel(preview.type)}</strong> · Capital ${money(preview.principal)} · A cobrar ${money(preview.collectAmount)} · Ganancia ${money(preview.profit)}</p>
    <table>
      <thead><tr><th>#</th><th>Vence</th><th>Capital</th><th>Interés</th><th>Cuota</th><th>Saldo</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function toggleLoanTypeFields() {
  const type = document.getElementById("loanType").value;
  document.getElementById("loanAdvanceFields").hidden = type !== "advance";
  document.getElementById("loanAmortFields").hidden = type !== "amortized";
  if (type === "amortized" && !loanRateUnlocked) {
    document.getElementById("loanRate").value = "10";
    document.getElementById("loanRate").readOnly = true;
  }
  renderLoanPreview();
}

function unlockLoanRate() {
  const code = document.getElementById("loanRateAuth").value.trim();
  const msg = document.getElementById("loanRateAuthMsg");
  if (code !== LOAN_RATE_AUTH) {
    loanRateUnlocked = false;
    document.getElementById("loanRate").value = "10";
    document.getElementById("loanRate").readOnly = true;
    msg.textContent = "Clave incorrecta. El interés sigue en 10%.";
    msg.style.color = "#fca5a5";
    toast("Clave de autorización incorrecta.");
    return;
  }
  loanRateUnlocked = true;
  document.getElementById("loanRate").readOnly = false;
  msg.textContent = "Autorizado: puedes bajar el interés quincenal.";
  msg.style.color = "#86efac";
  toast("Interés desbloqueado.");
  renderLoanPreview();
}

function renderLoanEmployeePicker() {
  const list = document.getElementById("loanEmpPickList");
  const selected = document.getElementById("loanEmpSelected");
  if (!list) return;
  const needle = String(document.getElementById("loanEmpSearch").value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  const filtered = employees
    .filter((e) => e.name && isEmployeeActive(e))
    .filter((e) => {
      if (!needle) return true;
      const blob = [e.name, e.phone, e.cedula].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      return blob.includes(needle);
    })
    .slice(0, 30);

  if (!filtered.length) {
    list.innerHTML = `<p class="empty">No hay empleados para mostrar.</p>`;
  } else {
    list.innerHTML = filtered
      .map((e) => {
        const sel = e.id === loanSelectedEmployeeId ? "selected" : "";
        return `<button class="employee-card ${sel}" type="button" data-emp-id="${escapeHtml(e.id)}">
          <div class="row">
            <div>
              <h3>${escapeHtml(e.name)}</h3>
              <p>${escapeHtml(e.cedula || "Sin cédula")} · ${escapeHtml(e.phone || "Sin tel.")}</p>
            </div>
          </div>
        </button>`;
      })
      .join("");
    list.querySelectorAll("[data-emp-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        loanSelectedEmployeeId = btn.dataset.empId;
        renderLoanEmployeePicker();
      });
    });
  }

  const emp = employees.find((e) => e.id === loanSelectedEmployeeId);
  selected.textContent = emp
    ? `Seleccionado: ${emp.name}${emp.cedula ? ` · Cédula ${emp.cedula}` : ""}`
    : "Ningún empleado seleccionado.";
}

function resetNewLoanForm() {
  loanSelectedEmployeeId = null;
  loanRateUnlocked = false;
  document.getElementById("loanEmpSearch").value = "";
  document.getElementById("loanType").value = "advance";
  document.getElementById("loanAdvancePackage").value = "2000";
  document.getElementById("loanPrincipal").value = "";
  document.getElementById("loanPeriods").value = "3";
  document.getElementById("loanRate").value = "10";
  document.getElementById("loanRate").readOnly = true;
  document.getElementById("loanRateAuth").value = "";
  document.getElementById("loanRateAuthMsg").textContent = "";
  document.getElementById("loanStartDate").value = todayIso();
  document.getElementById("loanNote").value = "";
  toggleLoanTypeFields();
  renderLoanEmployeePicker();
  renderLoanPreview();
}

function openNewLoan() {
  resetNewLoanForm();
  switchView("loanNewView");
}

function saveNewLoan() {
  const emp = employees.find((e) => e.id === loanSelectedEmployeeId);
  if (!emp) {
    toast("Selecciona un empleado de la lista.");
    return;
  }
  const preview = computeLoanPreview();
  if (preview.type === "amortized" && preview.principal <= 0) {
    toast("Indica el monto a prestar.");
    return;
  }
  if (!preview.schedule.length) {
    toast("No se pudo armar el cuadro de cuotas.");
    return;
  }
  if (preview.type === "amortized" && preview.rate < DEFAULT_LOAN_RATE && !loanRateUnlocked) {
    toast("Para bajar el 10% necesitas la clave de autorización.");
    return;
  }
  const loan = refreshLoanDerived({
    id: `loan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: preview.type,
    employeeId: emp.id,
    employeeName: emp.name,
    principal: preview.principal,
    collectAmount: preview.collectAmount,
    rate: preview.rate,
    rateUnlocked: loanRateUnlocked,
    periods: preview.periods,
    startDate: document.getElementById("loanStartDate").value || todayIso(),
    note: document.getElementById("loanNote").value.trim(),
    schedule: preview.schedule,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  loans.unshift(loan);
  saveLoans();
  toast("Préstamo guardado.");
  openLoanDetail(loan.id);
}

function loansSummaryStats() {
  const active = loans.filter((l) => l.status !== "paid");
  const paid = loans.filter((l) => l.status === "paid");
  const overdue = loans.filter((l) => l.status === "overdue");
  const capitalActive = roundMoney(active.reduce((a, l) => a + l.principal, 0));
  const toCollect = roundMoney(active.reduce((a, l) => a + l.remaining, 0));
  const collected = roundMoney(loans.reduce((a, l) => a + l.paidTotal, 0));
  const profitExpected = roundMoney(active.reduce((a, l) => a + (l.profitExpected || 0), 0));
  const profitCollected = roundMoney(loans.reduce((a, l) => a + (l.profitCollected || 0), 0));

  // Ganancia de cuotas con vencimiento en los próximos 15 días (esta quincena)
  const horizon = addDaysIso(todayIso(), 15);
  let quincenaDue = 0;
  let quincenaProfit = 0;
  let quincenaCount = 0;
  active.forEach((loan) => {
    loan.schedule.forEach((s) => {
      if (s.paid) return;
      if (!s.dueDate || s.dueDate > horizon) return;
      quincenaDue += s.payment;
      quincenaCount += 1;
      if (loan.type === "advance") quincenaProfit += loan.profitExpected || 0;
      else quincenaProfit += s.interest;
    });
  });

  return {
    active: active.length,
    paid: paid.length,
    overdue: overdue.length,
    capitalActive,
    toCollect,
    collected,
    profitExpected,
    profitCollected,
    quincenaDue: roundMoney(quincenaDue),
    quincenaProfit: roundMoney(quincenaProfit),
    quincenaCount,
  };
}

function renderLoansStats() {
  const el = document.getElementById("loansStats");
  const summary = document.getElementById("loansSummary");
  if (!el) return;
  const s = loansSummaryStats();
  if (summary) {
    summary.textContent = `${s.active} activos · ${s.overdue} con cuota vencida · ${s.paid} saldados`;
  }
  el.innerHTML = `
    <div class="stat-box"><span class="muted">Por cobrar</span><strong>${money(s.toCollect)}</strong></div>
    <div class="stat-box"><span class="muted">Ya cobrado</span><strong>${money(s.collected)}</strong></div>
    <div class="stat-box"><span class="muted">Ganancia cobrada</span><strong>${money(s.profitCollected)}</strong></div>
    <div class="stat-box"><span class="muted">Ganancia pendiente</span><strong>${money(s.profitExpected)}</strong></div>
    <div class="stat-box"><span class="muted">Capital activo</span><strong>${money(s.capitalActive)}</strong></div>
    <div class="stat-box"><span class="muted">Esta quincena</span><strong>${money(s.quincenaDue)}</strong><span class="muted" style="display:block;font-size:11px;margin-top:4px">${s.quincenaCount} cuotas · ganancia ${money(s.quincenaProfit)}</span></div>
  `;
}

function renderLoansPayrollBox() {
  const box = document.getElementById("loansPayrollBox");
  if (!box) return;
  const horizon = addDaysIso(todayIso(), 15);
  const items = [];
  loans.forEach((loan) => {
    if (loan.status === "paid") return;
    loan.schedule.forEach((inst, idx) => {
      if (inst.paid) return;
      if (inst.dueDate && inst.dueDate > horizon) return;
      items.push({ loan, inst, idx });
    });
  });
  items.sort((a, b) => String(a.inst.dueDate).localeCompare(String(b.inst.dueDate)));

  if (!items.length) {
    box.innerHTML = `<p class="muted">No hay cuotas pendientes para esta quincena.</p>`;
    return;
  }

  box.innerHTML = `
    ${items
      .map(({ loan, inst, idx }) => {
        const overdue = inst.dueDate && inst.dueDate < todayIso();
        return `<div class="payroll-item">
          <label>
            <input type="checkbox" data-pay-loan="${escapeHtml(loan.id)}" data-pay-idx="${idx}" />
            <span>
              <strong>${escapeHtml(loan.employeeName)}</strong> · ${loanTypeLabel(loan.type)} · Cuota #${inst.n}<br/>
              <span class="muted">Vence ${escapeHtml(inst.dueDate || "—")} · ${money(inst.payment)}${overdue ? " · VENCIDA" : ""}</span>
            </span>
          </label>
        </div>`;
      })
      .join("")}
    <button id="btnApplyPayrollPayments" class="btn primary" type="button">Registrar cuotas marcadas como pagadas</button>
  `;
  document.getElementById("btnApplyPayrollPayments").addEventListener("click", applyPayrollPayments);
}

function applyPayrollPayments() {
  const checks = [...document.querySelectorAll("#loansPayrollBox input[type=checkbox]:checked")];
  if (!checks.length) {
    toast("Marca al menos una cuota pagada.");
    return;
  }
  let count = 0;
  checks.forEach((chk) => {
    const loan = getLoan(chk.dataset.payLoan);
    const idx = Number(chk.dataset.payIdx);
    if (!loan || !loan.schedule[idx] || loan.schedule[idx].paid) return;
    loan.schedule[idx].paid = true;
    loan.schedule[idx].paidAt = new Date().toISOString();
    loan.schedule[idx].paidAmount = loan.schedule[idx].payment;
    loan.updatedAt = new Date().toISOString();
    const refreshed = refreshLoanDerived(loan);
    const pos = loans.findIndex((l) => l.id === loan.id);
    if (pos >= 0) loans[pos] = refreshed;
    count += 1;
  });
  saveLoans();
  renderLoans();
  toast(`${count} cuota(s) registradas como pagadas.`);
}

function renderLoansList() {
  const list = document.getElementById("loansList");
  if (!list) return;
  const needle = String(document.getElementById("loanListSearch").value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  const filtered = loans.filter((l) => {
    if (!needle) return true;
    const blob = [l.employeeName, loanTypeLabel(l.type), l.note, l.status].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return blob.includes(needle);
  });

  if (!filtered.length) {
    list.innerHTML = loans.length
      ? `<p class="empty">Ningún préstamo coincide con la búsqueda.</p>`
      : `<p class="empty">Aún no hay préstamos. Pulsa “Nuevo préstamo”.</p>`;
    return;
  }

  list.innerHTML = filtered
    .map((l) => {
      const pill =
        l.status === "paid" ? "ok" : l.status === "overdue" ? "alert" : "warn";
      return `<button class="loan-card" type="button" data-loan-id="${escapeHtml(l.id)}">
        <div class="row">
          <div>
            <h3>${escapeHtml(l.employeeName || "Empleado")}</h3>
            <p>${loanTypeLabel(l.type)} · Capital ${money(l.principal)}</p>
            <p style="margin-top:6px">Pendiente ${money(l.remaining)} · Cobrado ${money(l.paidTotal)}</p>
          </div>
          <span class="status-pill ${pill}">${loanStatusLabel(l.status)}</span>
        </div>
      </button>`;
    })
    .join("");

  list.querySelectorAll("[data-loan-id]").forEach((btn) => {
    btn.addEventListener("click", () => openLoanDetail(btn.dataset.loanId));
  });
}

function renderLoans() {
  loans = loans.map(refreshLoanDerived);
  renderLoansStats();
  renderLoansPayrollBox();
  renderLoansList();
}

function openLoanDetail(id) {
  const loan = getLoan(id);
  if (!loan) {
    toast("Préstamo no encontrado.");
    return;
  }
  selectedLoanId = id;
  document.getElementById("loanDetailTitle").textContent = loan.employeeName || "Préstamo";
  document.getElementById("loanDetailSub").textContent = `${loanTypeLabel(loan.type)} · ${loanStatusLabel(loan.status)}`;
  document.getElementById("loanDetailStats").innerHTML = `
    <div class="stats-grid">
      <div class="stat-box"><span class="muted">Capital</span><strong>${money(loan.principal)}</strong></div>
      <div class="stat-box"><span class="muted">A cobrar</span><strong>${money(loan.dueTotal)}</strong></div>
      <div class="stat-box"><span class="muted">Pendiente</span><strong>${money(loan.remaining)}</strong></div>
      <div class="stat-box"><span class="muted">Ganancia</span><strong>${money(loan.profitExpected)}</strong></div>
    </div>
    <p class="muted" style="margin-top:12px">Inicio: ${escapeHtml(loan.startDate || "—")} · Cuotas: ${loan.periods}${
      loan.type === "amortized" ? ` · Interés: ${(loan.rate * 100).toFixed(1)}% / quincena` : ""
    }</p>
    ${loan.note ? `<p class="muted">Nota: ${escapeHtml(loan.note)}</p>` : ""}
  `;

  const rows = loan.schedule
    .map((s, idx) => {
      const overdue = !s.paid && s.dueDate && s.dueDate < todayIso();
      return `<tr>
        <td>${s.n}</td>
        <td>${escapeHtml(s.dueDate)}${overdue ? " *" : ""}</td>
        <td>${money(s.principal)}</td>
        <td>${money(s.interest)}</td>
        <td>${money(s.payment)}</td>
        <td>${s.paid ? "Pagada" : "Pendiente"}</td>
        <td>${
          s.paid
            ? escapeHtml((s.paidAt || "").slice(0, 10))
            : `<button class="btn secondary" type="button" data-mark-idx="${idx}" style="margin:0;padding:6px 8px;width:auto;font-size:12px">Marcar pagada</button>`
        }</td>
      </tr>`;
    })
    .join("");

  document.getElementById("loanScheduleBox").innerHTML = `
    <table class="schedule-table">
      <thead><tr><th>#</th><th>Vence</th><th>Capital</th><th>Interés</th><th>Cuota</th><th>Estado</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="muted tight">* Cuota vencida. Después de la nómina marca aquí o en Cobro quincenal.</p>
  `;
  document.querySelectorAll("#loanScheduleBox [data-mark-idx]").forEach((btn) => {
    btn.addEventListener("click", () => markLoanInstallmentPaid(selectedLoanId, Number(btn.dataset.markIdx)));
  });
  switchView("loanDetailView");
}

function markLoanInstallmentPaid(loanId, idx) {
  const loan = getLoan(loanId);
  if (!loan || !loan.schedule[idx] || loan.schedule[idx].paid) return;
  loan.schedule[idx].paid = true;
  loan.schedule[idx].paidAt = new Date().toISOString();
  loan.schedule[idx].paidAmount = loan.schedule[idx].payment;
  loan.updatedAt = new Date().toISOString();
  const pos = loans.findIndex((l) => l.id === loanId);
  if (pos >= 0) loans[pos] = refreshLoanDerived(loan);
  saveLoans();
  openLoanDetail(loanId);
  toast("Cuota marcada como pagada. Saldo actualizado.");
}

function deleteSelectedLoan() {
  if (!selectedLoanId) return;
  const loan = getLoan(selectedLoanId);
  const label = loan ? `${loan.employeeName || "préstamo"} (${loanStatusLabel(loan.status)})` : "este préstamo";
  const code = window.prompt(`Para eliminar ${label} escribe la clave de autorización:`);
  if (code === null) return;
  if (String(code).trim() !== LOAN_RATE_AUTH) {
    toast("Clave incorrecta. No se eliminó el préstamo.");
    return;
  }
  const ok = window.confirm("Clave correcta. ¿Eliminar este préstamo? Esta acción no se puede deshacer.");
  if (!ok) return;
  loans = loans.filter((l) => l.id !== selectedLoanId);
  selectedLoanId = null;
  saveLoans();
  switchView("loansView");
  renderLoans();
  toast("Préstamo eliminado.");
}


/* ==== IMPRESIÓN ==== */
function openPrintWindow(title, bodyHtml) {
  const win = window.open("", "_blank");
  if (!win) {
    toast("Permite ventanas emergentes para imprimir, o elige una impresora en el diálogo del sistema.");
    return null;
  }
  win.document.write(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:22px;max-width:900px;margin:0 auto;font-size:12px;line-height:1.35}
  h1{font-size:18px;margin:0 0 4px}
  h2{font-size:14px;margin:0 0 14px;font-weight:normal;color:#444}
  .meta{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px}
  .meta div{min-width:140px}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th,td{border:1px solid #333;padding:6px 8px;text-align:left}
  th{background:#eee}
  .right{text-align:right}
  .sign-box{margin-top:36px;display:grid;grid-template-columns:1fr 1fr;gap:28px}
  .sign-line{border-top:1px solid #111;margin-top:56px;padding-top:6px;text-align:center}
  .footer{margin-top:18px;font-size:11px;color:#555}
  .brand{display:flex;align-items:center;gap:12px;margin-bottom:14px}
  .brand img{width:54px;height:54px;object-fit:contain;border:1px solid #ccc;border-radius:10px}
  @media print{body{padding:0} .no-print{display:none}}
</style></head><body>
  <div class="brand">
    <img src="logo.jpg" alt="RFS" />
    <div>
      <h1>Reaction Force Security</h1>
      <div>${escapeHtml(title)}</div>
    </div>
  </div>
  ${bodyHtml}
  <p class="footer">Impreso: ${escapeHtml(new Date().toLocaleString("es"))} · Uso interno</p>
  <p class="no-print" style="margin-top:16px">
    <button onclick="window.print()" style="padding:10px 14px;font-weight:700">Imprimir ahora</button>
    — Elige tu impresora en el cuadro del sistema (USB, Wi‑Fi o PDF).
  </p>
  <script>setTimeout(function(){ try{ window.focus(); window.print(); }catch(e){} }, 350);</script>
</body></html>`);
  win.document.close();
  return win;
}

function printLoanSheet(loanId) {
  const loan = getLoan(loanId || selectedLoanId);
  if (!loan) {
    toast("Abre un préstamo para imprimir su cuadro.");
    return;
  }
  const rows = (loan.schedule || [])
    .map(
      (s) => `<tr>
        <td>${s.n}</td>
        <td>${escapeHtml(s.dueDate || "—")}</td>
        <td class="right">${money(s.principal)}</td>
        <td class="right">${money(s.interest)}</td>
        <td class="right"><strong>${money(s.payment)}</strong></td>
        <td class="right">${money(s.balance)}</td>
        <td>${s.paid ? "Pagada" : "Pendiente"}</td>
      </tr>`
    )
    .join("");
  const body = `
    <h2>Cuadro de ${escapeHtml(loanTypeLabel(loan.type))} · ${escapeHtml(loanStatusLabel(loan.status))}</h2>
    <div class="meta">
      <div><strong>Empleado:</strong><br/>${escapeHtml(loan.employeeName || "—")}</div>
      <div><strong>Capital:</strong><br/>${money(loan.principal)}</div>
      <div><strong>Total a cobrar:</strong><br/>${money(loan.dueTotal)}</div>
      <div><strong>Pendiente:</strong><br/>${money(loan.remaining)}</div>
      <div><strong>Inicio:</strong><br/>${escapeHtml(loan.startDate || "—")}</div>
      <div><strong>Cuotas:</strong><br/>${loan.periods}${loan.type === "amortized" ? ` · ${(loan.rate * 100).toFixed(1)}% / quincena` : ""}</div>
    </div>
    ${loan.note ? `<p><strong>Nota:</strong> ${escapeHtml(loan.note)}</p>` : ""}
    <table>
      <thead><tr><th>#</th><th>Vence</th><th class="right">Capital</th><th class="right">Interés</th><th class="right">Cuota</th><th class="right">Saldo</th><th>Estado</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin-top:14px">Declaro haber recibido el monto indicado y acepto el plan de pagos detallado en este cuadro.</p>
    <div class="sign-box">
      <div>
        <div class="sign-line">Firma del empleado / deudor<br/>${escapeHtml(loan.employeeName || "")}</div>
      </div>
      <div>
        <div class="sign-line">Firma autorizado RFS<br/>Fecha: _______________</div>
      </div>
    </div>
  `;
  openPrintWindow(`Préstamo — ${loan.employeeName || ""}`, body);
}

function printClientsSheet() {
  ensureClientNumbers(false);
  const rows = sortPostsByClientNumber(posts)
    .map((p) => {
      const g = primaryGuard(p);
      return `<tr>
        <td>#${escapeHtml(String(p.clientNumber || "—"))}</td>
        <td>${escapeHtml(p.site)}</td>
        <td>${escapeHtml(guardsSummary(p))}</td>
        <td>${escapeHtml(p.supervisor || "—")}</td>
        <td>${escapeHtml(g.phone || "—")}</td>
        <td>${escapeHtml(STATUS_LABEL[p.status] || p.status)}</td>
        <td class="right">${money(p.priceMonth)}</td>
      </tr>`;
    })
    .join("");
  openPrintWindow("Listado de clientes", `
    <h2>Clientes activos: ${posts.length}</h2>
    <table>
      <thead><tr><th>No.</th><th>Cliente / Sitio</th><th>Vigilantes</th><th>Supervisor</th><th>Tel.</th><th>Estado</th><th class="right">Mes</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7">Sin clientes</td></tr>`}</tbody>
    </table>`);
}

function printEmployeesSheet() {
  const pool = employees.filter((e) => (employeeListFilter === "inactive" ? !isEmployeeActive(e) : isEmployeeActive(e)));
  const rows = pool
    .map((e) => `<tr>
      <td>${escapeHtml(e.name)}</td>
      <td>${escapeHtml(e.phone || "—")}</td>
      <td>${escapeHtml(e.cedula || "—")}</td>
      <td>${escapeHtml((e.sites || []).join(", ") || "—")}</td>
      <td>${isEmployeeActive(e) ? "Activo" : "Inactivo"}</td>
      <td>${escapeHtml(e.inactiveReason || "—")}</td>
    </tr>`)
    .join("");
  openPrintWindow(
    employeeListFilter === "inactive" ? "Empleados inactivos" : "Empleados activos",
    `<h2>Total: ${pool.length}</h2>
    <table>
      <thead><tr><th>Nombre</th><th>Teléfono</th><th>Cédula</th><th>Servicios</th><th>Estado</th><th>Causa baja</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6">Sin registros</td></tr>`}</tbody>
    </table>`
  );
}

function printEmployeeDetailSheet() {
  const emp = getEmployee(selectedEmployeeId);
  if (!emp) {
    toast("Abre un empleado para imprimir su ficha.");
    return;
  }
  openPrintWindow(`Ficha — ${emp.name}`, `
    <h2>${escapeHtml(emp.name)}</h2>
    <div class="meta">
      <div><strong>Teléfono:</strong><br/>${escapeHtml(emp.phone || "—")}</div>
      <div><strong>Cédula:</strong><br/>${escapeHtml(emp.cedula || "—")}</div>
      <div><strong>Entrada:</strong><br/>${escapeHtml(emp.companyEntryDate || "—")}</div>
      <div><strong>Arma:</strong><br/>${escapeHtml(emp.weapons || "—")}</div>
      <div><strong>Serie:</strong><br/>${escapeHtml(emp.serial || "—")}</div>
      <div><strong>Estado:</strong><br/>${isEmployeeActive(emp) ? "Activo" : "Inactivo"}</div>
    </div>
    <p><strong>Servicios:</strong> ${escapeHtml((emp.sites || []).join(", ") || "—")}</p>
    <p><strong>Notas:</strong> ${escapeHtml(emp.note || "—")}</p>
    ${!isEmployeeActive(emp) ? `<p><strong>Causa baja:</strong> ${escapeHtml(emp.inactiveReason || "—")}</p>` : ""}
    <div class="sign-box">
      <div><div class="sign-line">Firma del empleado</div></div>
      <div><div class="sign-line">Firma RFS</div></div>
    </div>`);
}

function printLoansListSheet() {
  const rows = loans
    .map((l) => `<tr>
      <td>${escapeHtml(l.employeeName || "—")}</td>
      <td>${escapeHtml(loanTypeLabel(l.type))}</td>
      <td class="right">${money(l.principal)}</td>
      <td class="right">${money(l.remaining)}</td>
      <td class="right">${money(l.paidTotal)}</td>
      <td>${escapeHtml(loanStatusLabel(l.status))}</td>
    </tr>`)
    .join("");
  const s = loansSummaryStats();
  openPrintWindow("Resumen de préstamos", `
    <h2>Activos: ${s.active} · Saldados: ${s.paid} · Vencidos: ${s.overdue}</h2>
    <div class="meta">
      <div><strong>Por cobrar:</strong><br/>${money(s.toCollect)}</div>
      <div><strong>Cobrado:</strong><br/>${money(s.collected)}</div>
      <div><strong>Ganancia cobrada:</strong><br/>${money(s.profitCollected)}</div>
      <div><strong>Esta quincena:</strong><br/>${money(s.quincenaDue)}</div>
    </div>
    <table>
      <thead><tr><th>Empleado</th><th>Tipo</th><th class="right">Capital</th><th class="right">Pendiente</th><th class="right">Cobrado</th><th>Estado</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6">Sin préstamos</td></tr>`}</tbody>
    </table>`);
}

function printFinanceSheet() {
  const rows = sortPostsByClientNumber(posts)
    .map((p) => `<tr>
      <td>#${escapeHtml(String(p.clientNumber || "—"))}</td>
      <td>${escapeHtml(p.site)}</td>
      <td>${escapeHtml(String(p.guardCount || 0))}</td>
      <td class="right">${escapeHtml(String(p.hours || 0))}</td>
      <td class="right">${money(p.hourlyRate)}</td>
      <td class="right">${money(p.priceMonth)}</td>
    </tr>`)
    .join("");
  const total = posts.reduce((a, p) => a + (Number(p.priceMonth) || 0), 0);
  openPrintWindow("Resumen financiero", `
    <h2>Total mensual: ${money(total)} · Clientes: ${posts.length}</h2>
    <table>
      <thead><tr><th>No.</th><th>Cliente</th><th>Vigilantes</th><th class="right">Horas</th><th class="right">Tarifa</th><th class="right">Mes</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6">Sin datos</td></tr>`}</tbody>
    </table>`);
}

function printMonorrielIndexSheet() {
  const rows = monorrielReports
    .map((r) => `<tr>
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(monoShiftLabel(r.shift))}</td>
      <td>${r.covered}</td>
      <td>${r.vacant}</td>
      <td>${escapeHtml(r.supervisor || "—")}</td>
    </tr>`)
    .join("");
  openPrintWindow("Historial Reportes Monorriel", `
    <h2>${monorrielReports.length} reportes · ${getMonorrielEmployees(true).length} personal Monorriel</h2>
    <table>
      <thead><tr><th>Fecha</th><th>Turno</th><th>Cubiertos</th><th>Vacantes</th><th>Supervisor</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5">Sin reportes</td></tr>`}</tbody>
    </table>
    <p class="footer">Para imprimir un reporte completo, ábrelo y usa Imprimir en su detalle.</p>`);
}

function printCurrentView() {
  const active = document.querySelector(".view.active");
  const id = active && active.id;
  if (id === "loanDetailView") return printLoanSheet();
  if (id === "loansView" || id === "loanNewView") return printLoansListSheet();
  if (id === "shiftsView") return printClientsSheet();
  if (id === "employeesView") return printEmployeesSheet();
  if (id === "employeeDetailView") return printEmployeeDetailSheet();
  if (id === "financeView") return printFinanceSheet();
  if (id === "monoReportDetailView") return printMonoReport();
  if (id === "monorrielView" || id === "monoStaffView") return printMonorrielIndexSheet();
  if (id === "detailView") {
    const post = getPost(selectedId);
    if (!post) return toast("No hay ficha para imprimir.");
    ensureClientNumbers(false);
    return openPrintWindow(`Cliente #${post.clientNumber || "—"} ${post.site}`, `
      <h2>#${escapeHtml(String(post.clientNumber || "—"))} ${escapeHtml(post.site)}</h2>
      <div class="meta">
        <div><strong>Supervisor:</strong><br/>${escapeHtml(post.supervisor || "—")}</div>
        <div><strong>Horario:</strong><br/>${escapeHtml(post.shift || "—")}</div>
        <div><strong>Servicio:</strong><br/>${escapeHtml(serviceLabel(post.serviceType))}</div>
        <div><strong>Estado:</strong><br/>${escapeHtml(STATUS_LABEL[post.status] || post.status)}</div>
        <div><strong>Mes:</strong><br/>${money(post.priceMonth)}</div>
      </div>
      <p><strong>Vigilantes:</strong> ${escapeHtml(guardsSummary(post))}</p>
      <p><strong>Nota:</strong> ${escapeHtml(post.note || "—")}</p>`);
  }
  toast("Abre Clientes, Empleados, Préstamos, Finanzas o Monorriel para imprimir.");
}

function bindPrintUi() {
  const map = [
    ["btnPrintCurrent", printCurrentView],
    ["btnPrintClients", printClientsSheet],
    ["btnPrintEmployees", printEmployeesSheet],
    ["btnPrintEmployeeDetail", printEmployeeDetailSheet],
    ["btnPrintLoansList", printLoansListSheet],
    ["btnPrintLoanDetail", () => printLoanSheet()],
    ["btnPrintLoanSheet", () => printLoanSheet()],
    ["btnPrintFinance", printFinanceSheet],
    ["btnPrintMonorrielList", printMonorrielIndexSheet],
  ];
  map.forEach(([id, fn]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", fn);
  });
}
/* ==== FIN IMPRESIÓN ==== */


function bindLoansUi() {
  const btnNew = document.getElementById("btnNewLoan");
  if (!btnNew) return;
  btnNew.addEventListener("click", openNewLoan);
  document.getElementById("btnBackLoansFromNew").addEventListener("click", () => switchView("loansView"));
  document.getElementById("btnBackLoansFromDetail").addEventListener("click", () => {
    switchView("loansView");
    renderLoans();
  });
  document.getElementById("btnSaveLoan").addEventListener("click", saveNewLoan);
  document.getElementById("btnDeleteLoan").addEventListener("click", deleteSelectedLoan);
  document.getElementById("btnUnlockLoanRate").addEventListener("click", unlockLoanRate);
  document.getElementById("loanType").addEventListener("change", toggleLoanTypeFields);
  ["loanAdvancePackage", "loanPrincipal", "loanPeriods", "loanRate", "loanStartDate"].forEach((id) => {
    document.getElementById(id).addEventListener("input", renderLoanPreview);
    document.getElementById(id).addEventListener("change", renderLoanPreview);
  });
  document.getElementById("loanEmpSearch").addEventListener("input", renderLoanEmployeePicker);
  document.getElementById("loanListSearch").addEventListener("input", renderLoansList);
}
/* ==== FIN MÓDULO PRÉSTAMOS ==== */


/* ==== MÓDULO MONORRIEL ==== */
const MONORRIEL_REPORTS_KEY = "rfs-ops-monorriel-reports";
const MONORRIEL_TAG = "Monorriel";

let monorrielReports = [];
let selectedMonoReportId = null;
let editingMonoReportId = null;
let monoDraftAssignments = {}; // postId -> employeeId or ""

function monoData() {
  return window.RFS_MONORRIEL || { posts: [], staffAm: [], staffPm: [] };
}

function monoPosts() {
  return monoData().posts || [];
}

function monoDisplayName(baseName) {
  const raw = String(baseName || "").trim();
  if (!raw) return "";
  if (/\(monorriel\)/i.test(raw)) return raw;
  return `${raw} (${MONORRIEL_TAG})`;
}

function monoBaseName(displayName) {
  return String(displayName || "")
    .replace(/\s*\(monorriel\)\s*$/i, "")
    .trim();
}

function isMonorrielEmployee(emp) {
  if (!emp) return false;
  if (/\(monorriel\)/i.test(emp.name || "")) return true;
  if ((emp.sites || []).some((s) => /monorriel/i.test(s))) return true;
  if ((emp.roles || []).some((r) => /monorriel/i.test(r))) return true;
  return false;
}

function getMonorrielEmployees(includeInactive = false) {
  return employees
    .filter(isMonorrielEmployee)
    .filter((e) => includeInactive || isEmployeeActive(e))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** Importa personal AM/PM a la lista general sin borrar datos ya llenos */
function ensureMonorrielEmployeesImported() {
  const data = monoData();
  const names = [...new Set([...(data.staffAm || []), ...(data.staffPm || [])].map((n) => n.trim()).filter(Boolean))];
  let added = 0;
  names.forEach((base) => {
    const display = monoDisplayName(base);
    const key = employeeKey(display);
    const keyBase = employeeKey(base);
    const existing = employees.find((e) => employeeKey(e.name) === key || employeeKey(monoBaseName(e.name)) === keyBase);
    if (existing) {
      const idx = employees.findIndex((e) => e.id === existing.id);
      const merged = mergeEmployeeRecord(existing, {
        name: /\(monorriel\)/i.test(existing.name) ? existing.name : display,
        sites: ["Monorriel"],
        roles: ["Monorriel"],
      });
      // Forzar etiqueta Monorriel en nombre si faltaba
      if (!/\(monorriel\)/i.test(merged.name)) merged.name = display;
      merged.sites = [...new Set([...(merged.sites || []), "Monorriel"])];
      merged.roles = [...new Set([...(merged.roles || []), "Monorriel"])];
      employees[idx] = merged;
      return;
    }
    employees.push(
      normalizeEmployee({
        name: display,
        sites: ["Monorriel"],
        roles: ["Monorriel"],
      })
    );
    added += 1;
  });
  if (added) {
    employees.sort((a, b) => a.name.localeCompare(b.name, "es"));
  }
  return added;
}

function normalizeMonoAssignment(a = {}) {
  return {
    postId: a.postId || "",
    employeeId: a.employeeId || "",
    employeeName: a.employeeName || "",
  };
}

function normalizeMonoReport(raw = {}) {
  const posts = monoPosts();
  const byPost = new Map((raw.assignments || []).map((a) => [a.postId, normalizeMonoAssignment(a)]));
  const assignments = posts.map((p) => byPost.get(p.id) || { postId: p.id, employeeId: "", employeeName: "" });
  const covered = assignments.filter((a) => (a.employeeName || "").trim()).length;
  return {
    id: raw.id || `mono-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date: raw.date || todayIso(),
    shift: raw.shift === "pm" ? "pm" : "am",
    supervisor: raw.supervisor || "",
    novedades: raw.novedades || "",
    assignments,
    covered,
    vacant: Math.max(0, posts.length - covered),
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

function saveMonorrielReports() {
  localStorage.setItem(MONORRIEL_REPORTS_KEY, JSON.stringify(monorrielReports));
  queueCloudSave();
}

function getMonoReport(id) {
  return monorrielReports.find((r) => r.id === id);
}

function monoShiftLabel(shift) {
  return shift === "pm" ? "P.M. / Nocturno" : "A.M. / Diurno";
}

function monoPostLabel(post) {
  return `${post.no}. ${post.location} — ${post.position}`;
}

function emptyMonoDraft() {
  const draft = {};
  monoPosts().forEach((p) => {
    draft[p.id] = { employeeId: "", customName: "" };
  });
  return draft;
}

function draftFromReport(report) {
  const draft = emptyMonoDraft();
  (report.assignments || []).forEach((a) => {
    draft[a.postId] = {
      employeeId: a.employeeId || "",
      customName: a.employeeId ? "" : monoBaseName(a.employeeName || ""),
    };
  });
  return draft;
}

function monoDraftHasPerson(slot) {
  return !!(slot && (slot.employeeId || (slot.customName || "").trim()));
}

function renderMonoPostsEditor() {
  const box = document.getElementById("monoPostsEditor");
  if (!box) return;
  const staff = getMonorrielEmployees(false);
  const options = [`<option value="">— Vacante / elegir lista —</option>`]
    .concat(staff.map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`))
    .join("");

  box.innerHTML = monoPosts()
    .map((p) => {
      const slot = monoDraftAssignments[p.id] || { employeeId: "", customName: "" };
      return `<div class="mono-post-row">
        <div class="mono-post-label">${escapeHtml(monoPostLabel(p))}</div>
        <select data-mono-post="${escapeHtml(p.id)}">${options}</select>
        <input class="mono-name-input" data-mono-name="${escapeHtml(p.id)}" type="text" placeholder="O escribe un nombre nuevo" value="${escapeHtml(slot.customName || "")}" />
        <p class="mono-hint">Si escribes un nombre nuevo, se agrega solo a Empleados (Monorriel).</p>
      </div>`;
    })
    .join("");

  box.querySelectorAll("select[data-mono-post]").forEach((sel) => {
    const postId = sel.dataset.monoPost;
    const slot = monoDraftAssignments[postId] || { employeeId: "", customName: "" };
    sel.value = slot.employeeId || "";
    sel.addEventListener("change", () => {
      const current = monoDraftAssignments[postId] || { employeeId: "", customName: "" };
      monoDraftAssignments[postId] = { employeeId: sel.value, customName: sel.value ? "" : current.customName };
      const nameInput = box.querySelector(`input[data-mono-name="${postId}"]`);
      if (sel.value && nameInput) nameInput.value = "";
      updateMonoCoverageHint();
    });
  });

  box.querySelectorAll("input[data-mono-name]").forEach((inp) => {
    const postId = inp.dataset.monoName;
    const commit = () => {
      const typed = inp.value.trim();
      if (!typed) {
        const current = monoDraftAssignments[postId] || { employeeId: "", customName: "" };
        monoDraftAssignments[postId] = { employeeId: current.employeeId || "", customName: "" };
        updateMonoCoverageHint();
        return;
      }
      const emp = ensureEmployeeFromMonoName(typed);
      if (!emp) return;
      monoDraftAssignments[postId] = { employeeId: emp.id, customName: "" };
      inp.value = "";
      // refrescar opciones para que aparezca el nuevo
      renderMonoPostsEditor();
      const sel = document.querySelector(`#monoPostsEditor select[data-mono-post="${postId}"]`);
      if (sel) sel.value = emp.id;
    };
    inp.addEventListener("change", commit);
    inp.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        commit();
      }
    });
  });
  updateMonoCoverageHint();
}

function updateMonoCoverageHint() {
  const hint = document.getElementById("monoCoverageHint");
  if (!hint) return;
  const total = monoPosts().length;
  const covered = Object.values(monoDraftAssignments).filter(monoDraftHasPerson).length;
  hint.textContent = `Cubiertos: ${covered} · Vacantes: ${total - covered} · Plazas: ${total}`;
}

function openMonoReportNew() {
  editingMonoReportId = null;
  monoDraftAssignments = emptyMonoDraft();
  document.getElementById("monoReportEditTitle").textContent = "Nuevo reporte Monorriel";
  document.getElementById("monoReportDate").value = todayIso();
  document.getElementById("monoReportShift").value = "am";
  document.getElementById("monoReportSupervisor").value = "";
  document.getElementById("monoReportNovedades").value = "";
  renderMonoPostsEditor();
  switchView("monoReportEditView");
}

function openMonoReportEdit(id) {
  const report = getMonoReport(id);
  if (!report) {
    toast("Reporte no encontrado.");
    return;
  }
  editingMonoReportId = id;
  monoDraftAssignments = draftFromReport(report);
  document.getElementById("monoReportEditTitle").textContent = "Editar reporte Monorriel";
  document.getElementById("monoReportDate").value = report.date || todayIso();
  document.getElementById("monoReportShift").value = report.shift || "am";
  document.getElementById("monoReportSupervisor").value = report.supervisor || "";
  document.getElementById("monoReportNovedades").value = report.novedades || "";
  renderMonoPostsEditor();
  switchView("monoReportEditView");
}

function copyLastMonoReport() {
  const shift = document.getElementById("monoReportShift").value;
  const previous = monorrielReports
    .filter((r) => r.shift === shift && r.id !== editingMonoReportId)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  if (!previous) {
    toast("No hay un reporte anterior de ese turno para copiar.");
    return;
  }
  monoDraftAssignments = draftFromReport(previous);
  if (previous.supervisor && !document.getElementById("monoReportSupervisor").value.trim()) {
    document.getElementById("monoReportSupervisor").value = previous.supervisor;
  }
  renderMonoPostsEditor();
  toast(`Se copió el reporte del ${previous.date}. Puedes corregir puestos.`);
}

function clearMonoDraftPosts() {
  monoDraftAssignments = emptyMonoDraft();
  renderMonoPostsEditor();
  toast("Puestos vaciados.");
}

function collectMonoAssignmentsFromDraft() {
  const staffById = new Map(employees.map((e) => [e.id, e]));
  return monoPosts().map((p) => {
    const slot = monoDraftAssignments[p.id] || { employeeId: "", customName: "" };
    let emp = slot.employeeId ? staffById.get(slot.employeeId) : null;
    if (!emp && (slot.customName || "").trim()) {
      emp = ensureEmployeeFromMonoName(slot.customName);
    }
    return {
      postId: p.id,
      employeeId: emp ? emp.id : "",
      employeeName: emp ? emp.name : "",
    };
  });
}

function saveMonoReport() {
  const date = document.getElementById("monoReportDate").value || todayIso();
  const shift = document.getElementById("monoReportShift").value === "pm" ? "pm" : "am";
  const assignments = collectMonoAssignmentsFromDraft();
  const payload = {
    id: editingMonoReportId || `mono-${date}-${shift}-${Date.now().toString(36)}`,
    date,
    shift,
    supervisor: document.getElementById("monoReportSupervisor").value.trim(),
    novedades: document.getElementById("monoReportNovedades").value.trim(),
    assignments,
    updatedAt: new Date().toISOString(),
  };

  const existingSame = monorrielReports.find(
    (r) => r.date === date && r.shift === shift && r.id !== editingMonoReportId
  );
  if (existingSame) {
    const ok = window.confirm(
      `Ya hay un reporte ${monoShiftLabel(shift)} del ${date}.\n¿Reemplazarlo con este?`
    );
    if (!ok) return;
    monorrielReports = monorrielReports.filter((r) => r.id !== existingSame.id);
  }

  const normalized = normalizeMonoReport({
    ...payload,
    createdAt: (getMonoReport(editingMonoReportId) || {}).createdAt || new Date().toISOString(),
  });

  if (editingMonoReportId) {
    const idx = monorrielReports.findIndex((r) => r.id === editingMonoReportId);
    if (idx >= 0) monorrielReports[idx] = normalized;
    else monorrielReports.unshift(normalized);
  } else {
    monorrielReports.unshift(normalized);
  }

  monorrielReports.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.shift).localeCompare(String(b.shift)));
  saveMonorrielReports();
  toast("Reporte Monorriel guardado.");
  openMonoReportDetail(normalized.id);
}

function renderMonorrielHome() {
  const summary = document.getElementById("monorrielSummary");
  if (summary) {
    const staff = getMonorrielEmployees().length;
    summary.textContent = `28 puestos · ${staff} empleados Monorriel · ${monorrielReports.length} reportes`;
  }
  renderMonoReportsList();
}

function renderMonoReportsList() {
  const list = document.getElementById("monoReportsList");
  if (!list) return;
  const needle = String(document.getElementById("monoReportSearch")?.value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  const filtered = monorrielReports.filter((r) => {
    if (!needle) return true;
    const blob = [r.date, monoShiftLabel(r.shift), r.supervisor, r.novedades].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return blob.includes(needle);
  });
  if (!filtered.length) {
    list.innerHTML = monorrielReports.length
      ? `<p class="empty">Ningún reporte coincide.</p>`
      : `<p class="empty">Aún no hay reportes. Crea el de hoy con “Nuevo reporte Monorriel”.</p>`;
    return;
  }
  list.innerHTML = filtered
    .map((r) => {
      const pill = r.vacant ? "warn" : "ok";
      return `<button class="loan-card" type="button" data-mono-id="${escapeHtml(r.id)}">
        <div class="row">
          <div>
            <h3>${escapeHtml(r.date)} · ${escapeHtml(monoShiftLabel(r.shift))}</h3>
            <p>Cubiertos ${r.covered} · Vacantes ${r.vacant}</p>
            <p style="margin-top:6px">Supervisor: ${escapeHtml(r.supervisor || "—")}</p>
          </div>
          <span class="status-pill ${pill}">${r.vacant ? `${r.vacant} vacantes` : "Completo"}</span>
        </div>
      </button>`;
    })
    .join("");
  list.querySelectorAll("[data-mono-id]").forEach((btn) => {
    btn.addEventListener("click", () => openMonoReportDetail(btn.dataset.monoId));
  });
}

function monoReportPlainText(report) {
  const postsById = new Map(monoPosts().map((p) => [p.id, p]));
  const lines = [
    "REACTION FORCE SECURITY — REPORTE DE PERSONAL",
    `Proyecto Monorriel · ${monoShiftLabel(report.shift)} · ${report.date}`,
    `Cubiertos: ${report.covered} · Vacantes: ${report.vacant} · Plazas: ${monoPosts().length}`,
    `Supervisor: ${report.supervisor || "—"}`,
    "",
    "No. | Ubicación | Puesto | Personal",
    "-".repeat(64),
  ];
  report.assignments.forEach((a) => {
    const post = postsById.get(a.postId);
    if (!post) return;
    lines.push(`${post.no}. ${post.location} / ${post.position} · ${a.employeeName || "VACANTE"}`);
  });
  lines.push("");
  lines.push(`Novedades: ${report.novedades || "Ninguna"}`);
  return lines.join("\n");
}

function monoReportHtml(report) {
  const postsById = new Map(monoPosts().map((p) => [p.id, p]));
  const rows = report.assignments
    .map((a) => {
      const post = postsById.get(a.postId);
      if (!post) return "";
      return `<tr>
        <td>${post.no}</td>
        <td>${escapeHtml(post.location)}</td>
        <td>${escapeHtml(post.position)}</td>
        <td>${escapeHtml(a.employeeName || "VACANTE")}</td>
      </tr>`;
    })
    .join("");
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8" />
<title>Reporte Monorriel ${escapeHtml(report.date)} ${escapeHtml(report.shift.toUpperCase())}</title>
<style>
  body{font-family:Arial,sans-serif;color:#111;padding:24px;max-width:900px;margin:0 auto}
  h1{font-size:18px;margin:0 0 4px} h2{font-size:14px;margin:0 0 16px;font-weight:normal;color:#444}
  .meta{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:14px;font-size:13px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{border:1px solid #333;padding:6px 8px;text-align:left}
  th{background:#eee}
  .novedades{margin-top:16px;border:1px solid #333;padding:10px;min-height:60px}
  @media print{button{display:none}}
</style></head><body class="mono-print-sheet">
  <h1>REACTION FORCE SECURITY — REPORTE DE PERSONAL</h1>
  <h2>Proyecto Monorriel · ${escapeHtml(monoShiftLabel(report.shift))} · ${escapeHtml(report.date)}</h2>
  <div class="meta">
    <div><strong>Cubiertos:</strong> ${report.covered}</div>
    <div><strong>Vacantes:</strong> ${report.vacant}</div>
    <div><strong>Plazas:</strong> ${monoPosts().length}</div>
    <div><strong>Supervisor:</strong> ${escapeHtml(report.supervisor || "—")}</div>
  </div>
  <table>
    <thead><tr><th>No.</th><th>Ubicación / Área</th><th>Posición / Puesto</th><th>Nombre del personal</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="novedades"><strong>Novedades:</strong><br/>${escapeHtml(report.novedades || "Ninguna").replaceAll("\n", "<br/>")}</div>
</body></html>`;
}

function openMonoReportDetail(id) {
  const report = getMonoReport(id);
  if (!report) {
    toast("Reporte no encontrado.");
    return;
  }
  selectedMonoReportId = id;
  document.getElementById("monoReportDetailTitle").textContent = `Monorriel ${report.date}`;
  document.getElementById("monoReportDetailSub").textContent = `${monoShiftLabel(report.shift)} · ${report.covered} cubiertos · ${report.vacant} vacantes`;
  const postsById = new Map(monoPosts().map((p) => [p.id, p]));
  const rows = report.assignments
    .map((a) => {
      const post = postsById.get(a.postId);
      if (!post) return "";
      return `<tr>
        <td>${post.no}</td>
        <td>${escapeHtml(post.location)}<br/><span class="muted">${escapeHtml(post.position)}</span></td>
        <td>${escapeHtml(a.employeeName || "VACANTE")}</td>
      </tr>`;
    })
    .join("");
  document.getElementById("monoReportDetailBody").innerHTML = `
    <p class="muted">Supervisor: ${escapeHtml(report.supervisor || "—")}</p>
    <div class="schedule-wrap">
      <table class="schedule-table">
        <thead><tr><th>#</th><th>Puesto</th><th>Personal</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p style="margin-top:12px"><strong>Novedades</strong></p>
    <p class="muted">${escapeHtml(report.novedades || "Ninguna").replaceAll("\n", "<br/>")}</p>
  `;
  switchView("monoReportDetailView");
}

function printMonoReport() {
  const report = getMonoReport(selectedMonoReportId);
  if (!report) return;
  const win = window.open("", "_blank");
  if (!win) {
    toast("Permite ventanas emergentes para imprimir.");
    return;
  }
  win.document.write(monoReportHtml(report));
  win.document.close();
  setTimeout(() => {
    win.focus();
    win.print();
  }, 250);
}

function downloadMonoReport() {
  const report = getMonoReport(selectedMonoReportId);
  if (!report) return;
  const html = monoReportHtml(report);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `reporte-monorriel-${report.date}-${report.shift}.html`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Reporte descargado. Puedes abrirlo o imprimirlo.");
}

async function shareMonoReport() {
  const report = getMonoReport(selectedMonoReportId);
  if (!report) return;
  const text = monoReportPlainText(report);
  const title = `Reporte Monorriel ${report.date} ${report.shift.toUpperCase()}`;
  try {
    if (navigator.share) {
      const file = new File([monoReportHtml(report)], `reporte-monorriel-${report.date}-${report.shift}.html`, {
        type: "text/html",
      });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ title, text, files: [file] });
      } else {
        await navigator.share({ title, text });
      }
      return;
    }
  } catch (err) {
    if (err && err.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Reporte copiado. Ya puedes pegarlo en WhatsApp u otra app.");
  } catch (_) {
    downloadMonoReport();
  }
}

function deleteMonoReport() {
  if (!selectedMonoReportId) return;
  const ok = window.confirm("¿Eliminar este reporte Monorriel?");
  if (!ok) return;
  monorrielReports = monorrielReports.filter((r) => r.id !== selectedMonoReportId);
  selectedMonoReportId = null;
  saveMonorrielReports();
  switchView("monorrielView");
  renderMonorrielHome();
  toast("Reporte eliminado.");
}

function renderMonoStaffList() {
  const list = document.getElementById("monoStaffList");
  if (!list) return;
  const staff = getMonorrielEmployees(true);
  if (!staff.length) {
    list.innerHTML = `<p class="empty">No hay personal Monorriel importado todavía.</p>`;
    return;
  }
  list.innerHTML = staff
    .map((e) => {
      return `<button class="employee-card" type="button" data-emp-id="${escapeHtml(e.id)}">
        <div class="row">
          <div>
            <h3>${escapeHtml(e.name)}</h3>
            <p>${escapeHtml(e.phone || "Sin teléfono")} · ${escapeHtml(e.cedula || "Sin cédula")}</p>
            <p style="margin-top:6px">Completa datos en Empleados</p>
          </div>
        </div>
      </button>`;
    })
    .join("");
  list.querySelectorAll("[data-emp-id]").forEach((btn) => {
    btn.addEventListener("click", () => openEmployeeDetail(btn.dataset.empId));
  });
}

function bindMonorrielUi() {
  if (!document.getElementById("btnOpenMonoReportNew")) return;
  document.getElementById("btnOpenMonoReportNew").addEventListener("click", openMonoReportNew);
  document.getElementById("btnMonoStaffInfo").addEventListener("click", () => {
    renderMonoStaffList();
    switchView("monoStaffView");
  });
  document.getElementById("btnBackMonoFromEdit").addEventListener("click", () => {
    switchView("monorrielView");
    renderMonorrielHome();
  });
  document.getElementById("btnBackMonoFromDetail").addEventListener("click", () => {
    switchView("monorrielView");
    renderMonorrielHome();
  });
  document.getElementById("btnBackMonoFromStaff").addEventListener("click", () => switchView("monorrielView"));
  document.getElementById("btnSaveMonoReport").addEventListener("click", saveMonoReport);
  document.getElementById("btnMonoCopyLast").addEventListener("click", copyLastMonoReport);
  document.getElementById("btnMonoClearPosts").addEventListener("click", clearMonoDraftPosts);
  document.getElementById("btnEditMonoReport").addEventListener("click", () => openMonoReportEdit(selectedMonoReportId));
  document.getElementById("btnPrintMonoReport").addEventListener("click", printMonoReport);
  document.getElementById("btnDownloadMonoReport").addEventListener("click", downloadMonoReport);
  document.getElementById("btnShareMonoReport").addEventListener("click", () => {
    shareMonoReport().catch(() => downloadMonoReport());
  });
  document.getElementById("btnDeleteMonoReport").addEventListener("click", deleteMonoReport);
  document.getElementById("monoReportSearch").addEventListener("input", renderMonoReportsList);
  document.getElementById("monoReportShift").addEventListener("change", () => {
    // keep draft; only hint refresh
    updateMonoCoverageHint();
  });
}
/* ==== FIN MÓDULO MONORRIEL ==== */


/* ==== MENSAJERÍA INTERNA ==== */
const MESSAGES_KEY = "rfs-ops-messages";
const MAX_MESSAGES = 180;
const MSG_FILE_MAX_BYTES = 300 * 1024;
const MSG_VOICE_MAX_MS = 40000;

let selectedChatUserId = null; // user id or "*"
let pendingMsgAttach = null; // { type, dataUrl, fileName, mime, durationMs }
let voiceRecorder = null;
let voiceChunks = [];
let voiceStartedAt = 0;
let voiceTimer = null;
let messagesPollTimer = null;

function normalizeChatMessage(m = {}) {
  const type = m.type === "voice" || m.type === "file" ? m.type : "text";
  return {
    id: m.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fromUserId: m.fromUserId || "",
    fromName: m.fromName || "",
    toUserId: m.toUserId || "",
    toName: m.toName || "",
    type,
    text: m.text || "",
    dataUrl: m.dataUrl || "",
    fileName: m.fileName || "",
    mime: m.mime || "",
    durationMs: Number(m.durationMs) || 0,
    createdAt: m.createdAt || new Date().toISOString(),
    readBy: Array.isArray(m.readBy) ? m.readBy.filter(Boolean) : [],
  };
}

function pruneChatMessages(list = chatMessages) {
  let arr = [...list].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  if (arr.length > MAX_MESSAGES) arr = arr.slice(arr.length - MAX_MESSAGES);
  // si aún es muy pesado, quitar adjuntos viejos primero
  const rough = JSON.stringify(arr).length;
  if (rough > 700000) {
    for (let i = 0; i < arr.length && JSON.stringify(arr).length > 700000; i += 1) {
      if (arr[i].dataUrl && arr[i].type !== "text") {
        arr[i] = { ...arr[i], dataUrl: "", text: arr[i].text || "[Adjunto antiguo omitido por tamaño]" };
      }
    }
  }
  return arr;
}

function saveChatMessages() {
  chatMessages = pruneChatMessages(chatMessages);
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(chatMessages));
  queueCloudSave();
}

function mergeChatMessages(localList, remoteList) {
  const map = new Map();
  [...(localList || []), ...(remoteList || [])].map(normalizeChatMessage).forEach((m) => {
    if (!m.id) return;
    if (!map.has(m.id)) {
      map.set(m.id, m);
      return;
    }
    const prev = map.get(m.id);
    map.set(m.id, {
      ...prev,
      ...m,
      readBy: [...new Set([...(prev.readBy || []), ...(m.readBy || [])])],
      dataUrl: m.dataUrl || prev.dataUrl,
      text: m.text || prev.text,
    });
  });
  return pruneChatMessages([...map.values()]);
}

function otherChatUsers() {
  if (!currentUser) return [];
  return appUsers
    .filter((u) => u.active && u.id !== currentUser.id)
    .sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username, "es"));
}

function conversationWith(userId) {
  if (!currentUser) return [];
  return chatMessages
    .filter((m) => {
      if (userId === "*") {
        return m.toUserId === "*";
      }
      return (
        (m.fromUserId === currentUser.id && m.toUserId === userId) ||
        (m.fromUserId === userId && m.toUserId === currentUser.id)
      );
    })
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

function unreadCountFor(userId) {
  if (!currentUser) return 0;
  return conversationWith(userId).filter(
    (m) => m.fromUserId !== currentUser.id && !(m.readBy || []).includes(currentUser.id)
  ).length;
}

function totalUnreadMessages() {
  if (!currentUser) return 0;
  return chatMessages.filter(
    (m) =>
      (m.toUserId === currentUser.id || m.toUserId === "*") &&
      m.fromUserId !== currentUser.id &&
      !(m.readBy || []).includes(currentUser.id)
  ).length;
}

function markConversationRead(userId) {
  if (!currentUser) return;
  let changed = false;
  chatMessages = chatMessages.map((m) => {
    const inConv =
      userId === "*"
        ? m.toUserId === "*"
        : (m.fromUserId === userId && m.toUserId === currentUser.id) ||
          (m.fromUserId === currentUser.id && m.toUserId === userId);
    if (!inConv) return m;
    if (m.fromUserId === currentUser.id) return m;
    if ((m.readBy || []).includes(currentUser.id)) return m;
    changed = true;
    return { ...m, readBy: [...new Set([...(m.readBy || []), currentUser.id])] };
  });
  if (changed) saveChatMessages();
}

function clearPendingMsgAttach() {
  pendingMsgAttach = null;
  const box = document.getElementById("msgPendingAttach");
  if (box) {
    box.hidden = true;
    box.innerHTML = "";
  }
}

function showPendingMsgAttach() {
  const box = document.getElementById("msgPendingAttach");
  if (!box) return;
  if (!pendingMsgAttach) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  const a = pendingMsgAttach;
  box.hidden = false;
  if (a.type === "voice") {
    box.innerHTML = `Nota de voz lista (${Math.round((a.durationMs || 0) / 1000)}s) <button type="button" class="btn ghost" id="btnClearMsgAttach" style="width:auto;margin:0;padding:4px 8px">Quitar</button><audio controls src="${a.dataUrl}" style="width:100%;margin-top:6px"></audio>`;
  } else {
    box.innerHTML = `Archivo: ${escapeHtml(a.fileName || "documento")} <button type="button" class="btn ghost" id="btnClearMsgAttach" style="width:auto;margin:0;padding:4px 8px">Quitar</button>`;
  }
  const btn = document.getElementById("btnClearMsgAttach");
  if (btn) btn.addEventListener("click", clearPendingMsgAttach);
}

function renderMessagesUsers() {
  const list = document.getElementById("msgUsersList");
  if (!list) return;
  const users = otherChatUsers();
  list.innerHTML = users
    .map((u) => {
      const unread = unreadCountFor(u.id);
      const active = selectedChatUserId === u.id ? "active" : "";
      return `<button class="msg-user-btn ${active}" type="button" data-user-id="${escapeHtml(u.id)}">
        ${escapeHtml(u.displayName || u.username)}
        ${unread ? `<span class="unread">${unread}</span>` : ""}
      </button>`;
    })
    .join("") || `<p class="empty">No hay otros usuarios. Créalos en Admin.</p>`;

  list.querySelectorAll("[data-user-id]").forEach((btn) => {
    btn.addEventListener("click", () => openChatWith(btn.dataset.userId));
  });

  const bcast = document.getElementById("btnMsgBroadcast");
  if (bcast) bcast.classList.toggle("active", selectedChatUserId === "*");
}

function renderMessageThread() {
  const thread = document.getElementById("msgThread");
  const title = document.getElementById("msgThreadTitle");
  const sub = document.getElementById("msgThreadSub");
  const summary = document.getElementById("messagesSummary");
  if (!thread) return;

  const unread = totalUnreadMessages();
  if (summary) {
    summary.textContent = unread
      ? `Chat interno · ${unread} sin leer`
      : "Chat interno entre usuarios de la empresa.";
  }

  if (!selectedChatUserId) {
    title.textContent = "Selecciona un usuario";
    sub.textContent = "";
    thread.innerHTML = `<p class="empty">Elige a quién escribir o envía un aviso a todos.</p>`;
    return;
  }

  if (selectedChatUserId === "*") {
    title.textContent = "Aviso a todos";
    sub.textContent = "Visible para todos los usuarios";
  } else {
    const u = appUsers.find((x) => x.id === selectedChatUserId);
    title.textContent = u ? u.displayName || u.username : "Usuario";
    sub.textContent = u ? `@${u.username}` : "";
  }

  const msgs = conversationWith(selectedChatUserId);
  markConversationRead(selectedChatUserId);
  renderMessagesUsers();

  thread.innerHTML = msgs
    .map((m) => {
      const mine = currentUser && m.fromUserId === currentUser.id;
      const when = (m.createdAt || "").replace("T", " ").slice(0, 16);
      let body = "";
      if (m.type === "voice" && m.dataUrl) {
        body = `<div>${escapeHtml(m.text || "Nota de voz")}</div><audio controls preload="metadata" src="${m.dataUrl}"></audio>`;
      } else if (m.type === "file" && m.dataUrl) {
        const isImg = (m.mime || "").startsWith("image/");
        body = isImg
          ? `<div>${escapeHtml(m.text || m.fileName || "Imagen")}</div><img src="${m.dataUrl}" alt="" style="max-width:100%;border-radius:10px;margin-top:6px" />`
          : `<div>${escapeHtml(m.text || "Documento")}</div><a class="doc-link" href="${m.dataUrl}" download="${escapeHtml(m.fileName || "documento")}">Descargar ${escapeHtml(m.fileName || "archivo")}</a>`;
      } else {
        body = `<div>${escapeHtml(m.text || "").replaceAll("\n", "<br/>")}</div>`;
      }
      return `<div class="msg-bubble ${mine ? "mine" : ""}">
        <div class="meta">${escapeHtml(m.fromName || "Usuario")} · ${escapeHtml(when)}</div>
        ${body}
      </div>`;
    })
    .join("") || `<p class="empty">Sin mensajes todavía. Escribe el primero.</p>`;

  thread.scrollTop = thread.scrollHeight;
}

function openChatWith(userId) {
  selectedChatUserId = userId;
  renderMessagesUsers();
  renderMessageThread();
}

function sendChatMessage() {
  if (!currentUser) {
    toast("Inicia sesión para enviar mensajes.");
    return;
  }
  if (!selectedChatUserId) {
    toast("Selecciona un usuario o “Todos”.");
    return;
  }
  const text = document.getElementById("msgText").value.trim();
  if (!text && !pendingMsgAttach) {
    toast("Escribe un mensaje o adjunta voz/archivo.");
    return;
  }

  let toName = "Todos";
  if (selectedChatUserId !== "*") {
    const u = appUsers.find((x) => x.id === selectedChatUserId);
    if (!u) {
      toast("Usuario no encontrado.");
      return;
    }
    toName = u.displayName || u.username;
  }

  const msg = normalizeChatMessage({
    fromUserId: currentUser.id,
    fromName: currentUser.displayName || currentUser.username,
    toUserId: selectedChatUserId,
    toName,
    type: pendingMsgAttach ? pendingMsgAttach.type : "text",
    text: text || (pendingMsgAttach && pendingMsgAttach.type === "voice" ? "Nota de voz" : pendingMsgAttach ? pendingMsgAttach.fileName : ""),
    dataUrl: pendingMsgAttach ? pendingMsgAttach.dataUrl : "",
    fileName: pendingMsgAttach ? pendingMsgAttach.fileName : "",
    mime: pendingMsgAttach ? pendingMsgAttach.mime : "",
    durationMs: pendingMsgAttach ? pendingMsgAttach.durationMs : 0,
    readBy: [currentUser.id],
  });

  chatMessages.push(msg);
  document.getElementById("msgText").value = "";
  clearPendingMsgAttach();
  saveChatMessages();
  renderMessageThread();
  toast(selectedChatUserId === "*" ? "Aviso enviado a todos." : "Mensaje enviado.");
}

async function toggleVoiceRecording() {
  const status = document.getElementById("msgVoiceStatus");
  const btn = document.getElementById("btnMsgVoice");
  if (voiceRecorder && voiceRecorder.state === "recording") {
    voiceRecorder.stop();
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast("Este dispositivo no permite grabar audio.");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceChunks = [];
    voiceStartedAt = Date.now();
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
    voiceRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    voiceRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size) voiceChunks.push(e.data);
    };
    voiceRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearTimeout(voiceTimer);
      if (status) status.hidden = true;
      if (btn) btn.textContent = "🎙 Voz";
      const blob = new Blob(voiceChunks, { type: voiceRecorder.mimeType || "audio/webm" });
      const durationMs = Date.now() - voiceStartedAt;
      if (blob.size > MSG_FILE_MAX_BYTES) {
        toast("La nota de voz quedó muy pesada. Graba más corto.");
        voiceRecorder = null;
        return;
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      pendingMsgAttach = {
        type: "voice",
        dataUrl,
        fileName: `voz-${Date.now()}.webm`,
        mime: blob.type || "audio/webm",
        durationMs,
      };
      showPendingMsgAttach();
      toast("Nota de voz lista. Pulsa Enviar.");
      voiceRecorder = null;
    };
    voiceRecorder.start();
    if (btn) btn.textContent = "⏹ Detener";
    if (status) {
      status.hidden = false;
      status.textContent = "Grabando… pulsa Detener (máx. 40 s)";
    }
    voiceTimer = setTimeout(() => {
      if (voiceRecorder && voiceRecorder.state === "recording") voiceRecorder.stop();
    }, MSG_VOICE_MAX_MS);
  } catch (_) {
    toast("No se pudo acceder al micrófono.");
  }
}

async function onMsgFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;
  if (file.size > MSG_FILE_MAX_BYTES) {
    toast("Archivo muy pesado. Máximo aprox. 300 KB.");
    return;
  }
  const mime = file.type || "";
  const isPdf = mime === "application/pdf" || /\.pdf$/i.test(file.name);
  const isImage = mime.startsWith("image/");
  if (!isPdf && !isImage) {
    toast("Solo JPG/PNG o PDF.");
    return;
  }
  try {
    let dataUrl;
    let outMime = mime;
    let outName = file.name || "archivo";
    if (isImage && typeof compressImage === "function") {
      dataUrl = await compressImage(file, 1280, 0.7);
      outMime = "image/jpeg";
      if (!/\.jpe?g$/i.test(outName)) outName = outName.replace(/\.[^.]+$/, "") + ".jpg";
    } else {
      dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }
    if (String(dataUrl).length > MSG_FILE_MAX_BYTES * 1.5) {
      toast("El archivo quedó muy grande.");
      return;
    }
    pendingMsgAttach = {
      type: "file",
      dataUrl,
      fileName: outName,
      mime: outMime || (isPdf ? "application/pdf" : "image/jpeg"),
      durationMs: 0,
    };
    showPendingMsgAttach();
    toast("Archivo listo. Pulsa Enviar.");
  } catch (_) {
    toast("No se pudo leer el archivo.");
  }
}

function renderMessagesModule() {
  if (!canAccessModule("messages")) return;
  renderMessagesUsers();
  renderMessageThread();
}

function startMessagesPolling() {
  stopMessagesPolling();
  messagesPollTimer = setInterval(() => {
    if (!currentUser || !canAccessModule("messages")) return;
    const active = document.querySelector(".view.active");
    if (!active || active.id !== "messagesView") return;
    if (!window.RFSCloudApi) return;
    window.RFSCloudApi
      .loadCloud()
      .then((remote) => {
        if (!remote || remote.empty) return;
        const remoteMsgs = Array.isArray(remote.messages) ? remote.messages.map(normalizeChatMessage) : [];
        if (!remoteMsgs.length) return;
        const before = chatMessages.length;
        chatMessages = mergeChatMessages(chatMessages, remoteMsgs);
        localStorage.setItem(MESSAGES_KEY, JSON.stringify(chatMessages));
        if (chatMessages.length !== before || document.querySelector(".view.active")?.id === "messagesView") {
          renderMessagesModule();
        }
      })
      .catch(() => {});
  }, 12000);
}

function stopMessagesPolling() {
  if (messagesPollTimer) {
    clearInterval(messagesPollTimer);
    messagesPollTimer = null;
  }
}

function bindMessagesUi() {
  if (!document.getElementById("messagesView")) return;
  document.getElementById("btnMsgSend").addEventListener("click", sendChatMessage);
  document.getElementById("btnMsgVoice").addEventListener("click", () => {
    toggleVoiceRecording().catch(() => toast("No se pudo grabar."));
  });
  document.getElementById("msgFile").addEventListener("change", onMsgFileSelected);
  document.getElementById("btnMsgBroadcast").addEventListener("click", () => openChatWith("*"));
  document.getElementById("btnRefreshMessages").addEventListener("click", () => {
    if (!window.RFSCloudApi) {
      renderMessagesModule();
      return;
    }
    window.RFSCloudApi
      .loadCloud()
      .then((remote) => {
        if (remote && Array.isArray(remote.messages)) {
          chatMessages = mergeChatMessages(chatMessages, remote.messages.map(normalizeChatMessage));
          localStorage.setItem(MESSAGES_KEY, JSON.stringify(chatMessages));
        }
        renderMessagesModule();
        toast("Mensajes actualizados.");
      })
      .catch(() => {
        renderMessagesModule();
        toast("Sin conexión. Mostrando mensajes locales.");
      });
  });
  document.getElementById("msgText").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
  startMessagesPolling();
}
/* ==== FIN MENSAJERÍA ==== */


function switchView(viewId) {
  if (!currentUser) {
    viewId = "loginView";
  } else if (viewId !== "loginView" && !canAccessView(viewId)) {
    toast("Tu usuario no tiene acceso a esa sección.");
    viewId = firstAllowedView();
  }
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === viewId));
  document.querySelectorAll(".tab").forEach((t) => {
    // detailView no tiene tab; no marcar ninguno extra
    t.classList.toggle("active", t.dataset.view === viewId);
  });
  applyAccessControl();
  if (viewId !== "mapView") closeSheet();
  if (viewId === "mapView" && map) setTimeout(() => map.invalidateSize(), 80);
  if (viewId === "shiftsView") renderShifts();
  if (viewId === "reportsView") {
    fillReportPostSelect();
    renderReports();
  }
  if (viewId === "financeView") renderFinance();
  if (viewId === "employeesView") renderEmployees();
  if (viewId === "employeeNewView") {}
  if (viewId === "loansView") renderLoans();
  if (viewId === "loanNewView") {
    renderLoanEmployeePicker();
    renderLoanPreview();
  }
  if (viewId === "monorrielView") renderMonorrielHome();
  if (viewId === "monoReportEditView") renderMonoPostsEditor();
  if (viewId === "monoStaffView") renderMonoStaffList();
  if (viewId === "messagesView") renderMessagesModule();
  if (viewId === "adminView") updateAdminGate();
}

function locateUser(alsoFillForm = false) {
  if (!navigator.geolocation) {
    toast("Este celular no permite GPS en el navegador.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      if (map) {
        if (userMarker) userMarker.remove();
        userMarker = L.circleMarker([latitude, longitude], {
          radius: 8,
          color: "#fff",
          weight: 2,
          fillColor: "#d41414",
          fillOpacity: 1,
        }).addTo(map);
        map.setView([latitude, longitude], 15);
      }
      if (alsoFillForm) {
        document.getElementById("fLat").value = latitude.toFixed(6);
        document.getElementById("fLng").value = longitude.toFixed(6);
        document.getElementById("fMapsUrl").value = `https://maps.google.com/?q=${latitude},${longitude}`;
        toast("Ubicación GPS cargada.");
      }
    },
    () => toast("No se pudo obtener el GPS. Activa la ubicación."),
    { enableHighAccuracy: true, timeout: 12000 }
  );
}

function clearAdminForm() {
  editingId = null;
  document.getElementById("adminFormTitle").textContent = "Nuevo puesto";
  document.getElementById("btnSaveAdmin").textContent = "Guardar puesto";
  document.getElementById("btnCancelEdit").hidden = true;
  ["fSite", "fSupervisor", "fStartDate", "fShift", "fNote", "fHours", "fHourlyRate", "fPriceMonth", "fMapsUrl", "fLat", "fLng", "fHistoryNote"].forEach(
    (id) => {
      document.getElementById(id).value = "";
    }
  );
  document.getElementById("fServiceType").value = "12";
  document.getElementById("fStatus").value = "ok";
  document.getElementById("mapsParseHint").textContent = "También puedes usar GPS si estás en el sitio.";
  updateMonthPreview();
  renderGuardsEditor([emptyGuard()]);
}

function loadPostIntoForm(id) {
  const post = getPost(id);
  if (!post) return;
  editingId = id;
  document.getElementById("adminFormTitle").textContent = "Editar puesto";
  document.getElementById("btnSaveAdmin").textContent = "Actualizar puesto";
  document.getElementById("btnCancelEdit").hidden = false;
  document.getElementById("fSite").value = post.site;
  document.getElementById("fSupervisor").value = post.supervisor || "";
  document.getElementById("fServiceType").value = post.serviceType || "12";
  document.getElementById("fStartDate").value = post.startDate || "";
  document.getElementById("fShift").value = post.shift || "";
  document.getElementById("fStatus").value = post.status || "ok";
  document.getElementById("fNote").value = post.note || "";
  document.getElementById("fHours").value = post.hours || "";
  document.getElementById("fHourlyRate").value = post.hourlyRate || "";
  updateMonthPreview();
  document.getElementById("fMapsUrl").value = post.mapsUrl || "";
  document.getElementById("fLat").value = Number.isFinite(post.lat) ? post.lat : "";
  document.getElementById("fLng").value = Number.isFinite(post.lng) ? post.lng : "";
  document.getElementById("fHistoryNote").value = "";
  renderGuardsEditor(post.guards && post.guards.length ? post.guards : [emptyGuard()]);
  document.getElementById("adminFormCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

function guardsFingerprint(guards) {
  return (guards || [])
    .map((g) => `${g.name}|${g.cedula}|${g.phone}|${g.serial}`)
    .join("||");
}

function readFormPost() {
  const site = document.getElementById("fSite").value.trim();
  const guards = readGuardsFromEditor().filter((g) => g.name.trim());
  const lat = Number(document.getElementById("fLat").value);
  const lng = Number(document.getElementById("fLng").value);
  const hours = Number(document.getElementById("fHours").value) || 0;
  const hourlyRate = Number(document.getElementById("fHourlyRate").value) || 0;
  const priceMonth = hours * hourlyRate;

  if (!site) {
    toast("Escribe el nombre del sitio.");
    return null;
  }
  if (!guards.length) {
    toast("Agrega al menos un vigilante con nombre.");
    return null;
  }
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  const mapsUrl = document.getElementById("fMapsUrl").value.trim();
  const existing = editingId ? getPost(editingId) : null;

  return normalizePost({
    id: editingId || `p-${Date.now()}`,
    clientNumber: existing?.clientNumber || (editingId ? null : nextClientNumber()),
    site,
    supervisor: document.getElementById("fSupervisor").value.trim(),
    serviceType: document.getElementById("fServiceType").value,
    startDate: document.getElementById("fStartDate").value,
    shift: document.getElementById("fShift").value.trim() || "Sin horario",
    guards,
    hours,
    hourlyRate,
    priceMonth,
    status: document.getElementById("fStatus").value,
    note: document.getElementById("fNote").value.trim(),
    address: existing?.address || "",
    clientContact: existing?.clientContact || "",
    clientPhone: existing?.clientPhone || "",
    region: existing?.region || "",
    mapsUrl: mapsUrl || (hasCoords ? `https://maps.google.com/?q=${lat},${lng}` : existing?.mapsUrl || ""),
    lat: hasCoords ? lat : existing?.lat ?? null,
    lng: hasCoords ? lng : existing?.lng ?? null,
    history: existing?.history || [],
  });
}

function pushHistory(post, title, note) {
  const now = new Date();
  post.history = post.history || [];
  post.history.unshift({
    id: `h-${Date.now()}`,
    title,
    note,
    when: now.toISOString(),
    whenLabel: now.toLocaleString("es"),
  });
  post.history = post.history.slice(0, 100);
}

function saveAdminPost() {
  const data = readFormPost();
  if (!data) return;
  const historyNote = document.getElementById("fHistoryNote").value.trim();

  if (editingId) {
    const prev = getPost(editingId);
    const idx = posts.findIndex((p) => p.id === editingId);
    if (idx >= 0) {
      if (prev && guardsFingerprint(prev.guards) !== guardsFingerprint(data.guards)) {
        pushHistory(
          data,
          "Cambio de vigilantes",
          historyNote ||
            `Antes: ${guardsSummary(prev)} (${prev.guardCount}). Ahora: ${guardsSummary(data)} (${data.guardCount}).`
        );
      } else if (historyNote) {
        pushHistory(data, "Actualización del servicio", historyNote);
      } else {
        data.history = prev?.history || [];
      }
      posts[idx] = data;
    }
    toast("Puesto actualizado.");
  } else {
    pushHistory(data, "Servicio creado", historyNote || `Alta del servicio con ${data.guardCount} vigilante(s).`);
    posts.unshift(data);
    toast("Puesto guardado.");
  }

  savePosts();
  renderMarkers();
  renderShifts();
  fillReportPostSelect();
  renderFinance();
  renderAdminList();
  clearAdminForm();
}

let pendingDeleteId = null;

function askDeletePost(id) {
  const post = getPost(id);
  if (!post) return;
  pendingDeleteId = id;
  document.getElementById("confirmModalText").textContent =
    `Vas a eliminar "${post.site}". Esta acción no se puede deshacer.`;
  document.getElementById("confirmModal").hidden = false;
}

function closeConfirmModal() {
  pendingDeleteId = null;
  document.getElementById("confirmModal").hidden = true;
}

function confirmDeletePost() {
  const id = pendingDeleteId;
  const post = getPost(id);
  closeConfirmModal();
  if (!id || !post) return;

  // Segunda confirmación por seguridad
  const ok = window.confirm(`Confirma otra vez:\n¿Eliminar definitivamente "${post.site}"?`);
  if (!ok) {
    toast("Eliminación cancelada.");
    return;
  }

  posts = posts.filter((p) => p.id !== id);
  reports = reports.filter((r) => r.postId !== id);
  savePosts();
  saveReports();
  if (editingId === id) clearAdminForm();
  if (selectedId === id) {
    selectedId = null;
    closeSheet();
  }
  renderMarkers();
  renderShifts();
  fillReportPostSelect();
  renderReports();
  renderFinance();
  renderAdminList();
  toast("Puesto eliminado.");
}

function deletePost(id) {
  askDeletePost(id);
}

function updateSelectedStatus(status, noteExtra) {
  const post = getPost(selectedId);
  if (!post) return;
  post.status = status;
  if (noteExtra) {
    const stamp = new Date().toLocaleString("es");
    post.note = `${noteExtra} (${stamp})${post.note ? " · " + post.note : ""}`;
    pushHistory(post, "Check-in", noteExtra);
  }
  savePosts();
  renderMarkers();
  renderShifts();
  renderAdminList();
  openSheet(post.id);
}

function clearPhoto() {
  pendingPhotoDataUrl = null;
  document.getElementById("reportPhoto").value = "";
  document.getElementById("photoPreviewWrap").hidden = true;
  document.getElementById("photoPreview").removeAttribute("src");
}

function compressImage(file, maxSide = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la foto"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxSide || height > maxSide) {
          const ratio = Math.min(maxSide / width, maxSide / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Foto inválida"));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function onPhotoSelected(event) {
  const file = event.target.files && event.target.files[0];
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

function saveReport() {
  const postId = document.getElementById("reportPost").value;
  const type = document.getElementById("reportType").value;
  const text = document.getElementById("reportText").value.trim();
  const post = getPost(postId);
  if (!post) {
    toast("Selecciona un puesto.");
    return;
  }
  if (!text) {
    toast("Escribe la descripción del reporte.");
    return;
  }
  if ((type === "checkin" || type === "incidente") && !pendingPhotoDataUrl) {
    toast("Este tipo de reporte necesita una foto.");
    return;
  }

  const now = new Date();
  const report = {
    id: `r-${Date.now()}`,
    postId,
    type,
    text,
    photo: pendingPhotoDataUrl,
    createdAt: now.toISOString(),
    whenLabel: now.toLocaleString("es"),
  };
  reports.unshift(report);
  if (type === "checkin") {
    post.status = "ok";
    pushHistory(post, "Check-in con foto", text);
  }
  if (type === "incidente") {
    post.status = "alert";
    pushHistory(post, "Incidente", text);
  }
  reports = reports.slice(0, 40);
  saveReports();
  savePosts();
  renderMarkers();
  renderShifts();
  renderAdminList();
  renderReports();
  document.getElementById("reportText").value = "";
  clearPhoto();
  toast("Reporte guardado.");
}

function exportBackup() {
  const payload = {
    app: "Reaction Force Security Ops",
    version: 5,
    exportedAt: new Date().toISOString(),
    posts,
    reports,
    employees,
    loans,
    monorrielReports,
    users: appUsers,
    messages: chatMessages,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `rfs-respaldo-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Respaldo descargado. Guárdalo en Drive o en la PC.");
}

function readBackupFile() {
  const input = document.getElementById("backupFile");
  const file = input.files && input.files[0];
  if (!file) {
    toast("Elige primero un archivo de respaldo.");
    return Promise.reject(new Error("no file"));
  }
  return file.text().then((text) => {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.posts)) {
      throw new Error("Archivo inválido");
    }
    return data;
  });
}

function restoreBackupMerge() {
  readBackupFile()
    .then((data) => {
      const byId = new Map(posts.map((p) => [p.id, p]));
      let added = 0;
      let updated = 0;
      data.posts.map(normalizePost).forEach((incoming) => {
        if (byId.has(incoming.id)) {
          // Actualiza solo si el respaldo trae más datos útiles, sin borrar ubicación local si el respaldo no tiene
          const current = byId.get(incoming.id);
          const merged = normalizePost({
            ...incoming,
            lat: Number.isFinite(incoming.lat) ? incoming.lat : current.lat,
            lng: Number.isFinite(incoming.lng) ? incoming.lng : current.lng,
            mapsUrl: incoming.mapsUrl || current.mapsUrl,
            history: [...(incoming.history || []), ...(current.history || [])].slice(0, 100),
          });
          const idx = posts.findIndex((p) => p.id === incoming.id);
          posts[idx] = merged;
          updated += 1;
        } else {
          posts.push(incoming);
          added += 1;
        }
      });
      if (Array.isArray(data.reports)) {
        const reportIds = new Set(reports.map((r) => r.id));
        data.reports.forEach((r) => {
          if (r && r.id && !reportIds.has(r.id)) reports.push(r);
        });
      }
      if (Array.isArray(data.employees)) {
        const byKey = new Map(employees.map((e) => [employeeKey(e.name), normalizeEmployee(e)]));
        data.employees.map(normalizeEmployee).forEach((incoming) => {
          if (!incoming.name) return;
          const key = employeeKey(incoming.name);
          if (byKey.has(key)) byKey.set(key, mergeEmployeeRecord(byKey.get(key), incoming));
          else byKey.set(key, incoming);
        });
        employees = [...byKey.values()];
      }
      if (Array.isArray(data.loans)) {
        const byId = new Map(loans.map((l) => [l.id, l]));
        data.loans.map(normalizeLoan).forEach((incoming) => {
          if (!byId.has(incoming.id)) {
            loans.push(incoming);
            byId.set(incoming.id, incoming);
          }
        });
      }
      if (Array.isArray(data.monorrielReports)) {
        const byId = new Map(monorrielReports.map((r) => [r.id, r]));
        data.monorrielReports.map(normalizeMonoReport).forEach((incoming) => {
          if (!byId.has(incoming.id)) {
            monorrielReports.push(incoming);
            byId.set(incoming.id, incoming);
          }
        });
      }
      if (Array.isArray(data.users)) {
        const byUser = new Map(appUsers.map((u) => [u.username, u]));
        data.users.map(normalizeUser).forEach((incoming) => {
          if (!incoming.username) return;
          if (!byUser.has(incoming.username)) {
            appUsers.push(incoming);
            byUser.set(incoming.username, incoming);
          }
        });
        ensureOwnerUser();
      }
      if (Array.isArray(data.messages)) {
        chatMessages = mergeChatMessages(chatMessages, data.messages.map(normalizeChatMessage));
        saveChatMessages();
      }
      ensureMonorrielEmployeesImported();
      savePosts();
      saveReports();
      saveEmployees();
      saveLoans();
      saveMonorrielReports();
      saveUsers();
      renderMarkers();
      renderShifts();
      fillReportPostSelect();
      renderReports();
      renderFinance();
      renderEmployees();
      renderLoans();
      renderMonorrielHome();
      renderAdminList();
      toast(`Respaldo aplicado: ${added} nuevos, ${updated} actualizados. Nada se borró.`);
    })
    .catch((err) => {
      if (err && err.message === "no file") return;
      toast("No se pudo leer el respaldo.");
    });
}

function restoreBackupReplace() {
  const ok = window.confirm(
    "Esto REEMPLAZARÁ todos los puestos actuales por el respaldo.\n¿Seguro? Si no estás seguro, usa “Restaurar sin borrar”."
  );
  if (!ok) return;
  readBackupFile()
    .then((data) => {
      posts = data.posts.map(normalizePost);
      reports = Array.isArray(data.reports) ? data.reports : [];
      employees = Array.isArray(data.employees) ? data.employees.map(normalizeEmployee) : [];
      loans = Array.isArray(data.loans) ? data.loans.map(normalizeLoan) : [];
      monorrielReports = Array.isArray(data.monorrielReports) ? data.monorrielReports.map(normalizeMonoReport) : [];
      if (Array.isArray(data.users)) {
        appUsers = data.users.map(normalizeUser);
        ensureOwnerUser();
      }
      if (Array.isArray(data.messages)) {
        chatMessages = pruneChatMessages(data.messages.map(normalizeChatMessage));
      }
      rebuildEmployeesFromPosts(employees);
      ensureMonorrielEmployeesImported();
      savePosts();
      saveReports();
      saveEmployees();
      saveLoans();
      saveMonorrielReports();
      saveUsers();
      saveChatMessages();
      renderMarkers();
      renderShifts();
      fillReportPostSelect();
      renderReports();
      renderFinance();
      renderEmployees();
      renderLoans();
      renderMonorrielHome();
      renderAdminList();
      toast("Respaldo restaurado (reemplazo completo).");
    })
    .catch((err) => {
      if (err && err.message === "no file") return;
      toast("No se pudo leer el respaldo.");
    });
}

let deferredInstallPrompt = null;

function setupInstallPrompt() {
  const btn = document.getElementById("btnInstallApp");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    btn.hidden = false;
  });
  btn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      toast("Usa el menú de Chrome → Instalar aplicación.");
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    btn.hidden = true;
  });
  window.addEventListener("appinstalled", () => {
    toast("App instalada en esta PC.");
    btn.hidden = true;
  });
}

function bindUi() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", (e) => {
      if (!currentUser) {
        e.preventDefault();
        e.stopPropagation();
        toast("Debes iniciar sesión con tu usuario y clave.");
        switchView("loginView");
        return;
      }
      switchView(tab.dataset.view);
    });
  });

  document.querySelectorAll("[data-go]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      if (!currentUser) {
        e.preventDefault();
        e.stopPropagation();
        toast("Debes iniciar sesión con tu usuario y clave.");
        switchView("loginView");
        return;
      }
      switchView(btn.dataset.go);
    });
  });

  document.getElementById("btnConfirmCancel").addEventListener("click", closeConfirmModal);
  document.getElementById("btnConfirmDelete").addEventListener("click", confirmDeletePost);
  document.getElementById("confirmModal").addEventListener("click", (e) => {
    if (e.target.id === "confirmModal") closeConfirmModal();
  });

  document.getElementById("btnExportBackup").addEventListener("click", exportBackup);
  document.getElementById("btnImportBackupMerge").addEventListener("click", restoreBackupMerge);
  document.getElementById("btnImportBackupReplace").addEventListener("click", restoreBackupReplace);

  document.getElementById("btnCloseSheet").addEventListener("click", closeSheet);
  document.getElementById("btnLocateMe").addEventListener("click", () => locateUser(false));
  document.getElementById("btnUseGps").addEventListener("click", () => locateUser(true));
  document.getElementById("btnParseMaps").addEventListener("click", () => resolveMapsLink());
  document.getElementById("btnAddGuard").addEventListener("click", addGuardEditor);
  document.getElementById("btnSaveAdmin").addEventListener("click", saveAdminPost);
  document.getElementById("btnCancelEdit").addEventListener("click", clearAdminForm);
  document.getElementById("fHours").addEventListener("input", updateMonthPreview);
  document.getElementById("fHourlyRate").addEventListener("input", updateMonthPreview);
  document.getElementById("btnSaveReport").addEventListener("click", saveReport);
  document.getElementById("reportPhoto").addEventListener("change", onPhotoSelected);
  document.getElementById("btnClearPhoto").addEventListener("click", clearPhoto);
  document.getElementById("btnAdminLogin").addEventListener("click", tryAdminLogin);
  document.getElementById("btnAdminLogout").addEventListener("click", () => {
    setAdminUnlocked(false);
    clearAdminForm();
    toast("Sesión de administrador cerrada.");
  });
  document.getElementById("adminPassword").addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryAdminLogin();
  });
  document.getElementById("btnShareLocation").addEventListener("click", shareLocation);
  document.getElementById("btnShareWhatsApp").addEventListener("click", shareWhatsApp);
  document.getElementById("btnOpenDetail").addEventListener("click", () => openDetail(selectedId));
  document.getElementById("btnBackDetail").addEventListener("click", () => switchView(previousView || "shiftsView"));
  document.getElementById("btnDetailMap").addEventListener("click", () => {
    switchView("mapView");
    focusPost(selectedId);
  });
  document.getElementById("btnDetailShare").addEventListener("click", shareLocation);
  document.getElementById("btnDetailWhatsApp").addEventListener("click", shareWhatsApp);
  document.getElementById("btnDetailEdit").addEventListener("click", () => {
    switchView("adminView");
    if (isAdminUnlocked()) loadPostIntoForm(selectedId);
  });
  document.getElementById("btnCheckIn").addEventListener("click", () => {
    updateSelectedStatus("ok", "Check-in confirmado");
    toast("Check-in registrado.");
  });

  document.getElementById("employeeSearch").addEventListener("input", () => renderEmployees());
  document.getElementById("btnBackEmployees").addEventListener("click", () => switchView("employeesView"));
  document.getElementById("btnBackEmployeesFromNew").addEventListener("click", () => switchView("employeesView"));
  document.getElementById("btnAddEmployee").addEventListener("click", openNewEmployeeForm);
  document.getElementById("btnCreateEmployee").addEventListener("click", createEmployeeManual);
  document.getElementById("btnSaveEmployee").addEventListener("click", saveEmployeeDetail);
  document.getElementById("btnDeactivateEmployee").addEventListener("click", deactivateSelectedEmployee);
  document.getElementById("btnReactivateEmployee").addEventListener("click", reactivateSelectedEmployee);
  document.querySelectorAll(".emp-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      employeeListFilter = tab.dataset.empFilter === "inactive" ? "inactive" : "active";
      renderEmployees();
    });
  });
  document.getElementById("ePhotoFile").addEventListener("change", onEmpPhotoSelected);
  document.getElementById("eDocFile").addEventListener("change", onEmpDocSelected);
  document.getElementById("btnClearEmpPhoto").addEventListener("click", clearEmpPhotoPending);
  document.getElementById("btnClearEmpDoc").addEventListener("click", clearEmpDocPending);
  document.getElementById("btnOpenEmpDoc").addEventListener("click", openEmpDocument);
  bindLoansUi();
  bindMonorrielUi();
  bindPrintUi();
  bindMessagesUi();

  document.getElementById("btnAppLogin").addEventListener("click", tryAppLogin);
  document.getElementById("loginPassword").addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryAppLogin();
  });
  document.getElementById("loginUsername").addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryAppLogin();
  });
  document.getElementById("btnLogoutUser").addEventListener("click", logoutAppUser);
  document.getElementById("btnSaveUser").addEventListener("click", saveUserFromForm);
  document.getElementById("btnCancelUserEdit").addEventListener("click", clearUserForm);
}

async function mergeImportedPosts() {
  try {
    const res = await fetch("import-posts.json", { cache: "no-store" });
    if (!res.ok) return 0;
    const imported = await res.json();
    if (!Array.isArray(imported) || !imported.length) return 0;

    const byId = new Map(posts.map((p) => [p.id, p]));
    const bySite = new Map(posts.map((p) => [String(p.site || "").trim().toLowerCase(), p]));
    let added = 0;

    imported.forEach((raw) => {
      const incoming = normalizePost(raw);
      const siteKey = String(incoming.site || "").trim().toLowerCase();
      if (byId.has(incoming.id) || bySite.has(siteKey)) {
        // No sobrescribir lo que el usuario ya tiene
        return;
      }
      posts.push(incoming);
      byId.set(incoming.id, incoming);
      bySite.set(siteKey, incoming);
      added += 1;
    });

    if (added) savePosts();
    return added;
  } catch (_) {
    return 0;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  // IMPORTANTE: nunca borrar datos del usuario
  posts = loadPreservingUserData(POSTS_KEY, LEGACY_POST_KEYS).map(normalizePost);
  reports = loadPreservingUserData(REPORTS_KEY, LEGACY_REPORT_KEYS);
  employees = loadJson(EMPLOYEES_KEY, []).map(normalizeEmployee);
  loans = loadJson(LOANS_KEY, []).map(normalizeLoan);
  monorrielReports = loadJson(MONORRIEL_REPORTS_KEY, []).map(normalizeMonoReport);
  appUsers = loadJson(USERS_KEY, []).map(normalizeUser);
  chatMessages = loadJson(MESSAGES_KEY, []).map(normalizeChatMessage);
  ensureOwnerUser();
  localStorage.setItem(USERS_KEY, JSON.stringify(appUsers));
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(chatMessages));
  rebuildEmployeesFromPosts(employees);
  ensureMonorrielEmployeesImported();
  restoreSessionUser();
  applyAccessControl();
  if (!currentUser) {
    // Forzar pantalla de login de inmediato (antes de que se usen las pestañas)
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "loginView"));
  }

  // 1) Intentar nube primero
  const cloud = await syncFromCloud();

  // 2) Si la nube estaba vacía o falló, completar con importación Word (solo agregar faltantes)
  const added = await mergeImportedPosts();
  rebuildEmployeesFromPosts(employees);
  if (added > 0) {
    localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
    localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees));
    localStorage.setItem(LOANS_KEY, JSON.stringify(loans));
    localStorage.setItem(MONORRIEL_REPORTS_KEY, JSON.stringify(monorrielReports));
    localStorage.setItem(USERS_KEY, JSON.stringify(appUsers));
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(chatMessages));
    await pushToCloud();
    toast(`Se importaron ${added} servicios y se subieron a la nube.`);
  } else {
    localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
    localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
    localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees));
    localStorage.setItem(LOANS_KEY, JSON.stringify(loans));
    localStorage.setItem(MONORRIEL_REPORTS_KEY, JSON.stringify(monorrielReports));
    localStorage.setItem(USERS_KEY, JSON.stringify(appUsers));
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(chatMessages));
    // Sube el listado consolidado a la nube (sin borrar servicios)
    if (cloud.usedCloud && (employees.length || loans.length || monorrielReports.length || appUsers.length || chatMessages.length)) await pushToCloud();
  }

  bindUi();
  setupInstallPrompt();
  updateAdminGate();
  renderGuardsEditor([emptyGuard()]);
  updateMonthPreview();
  ensureClientNumbers(true);
  initMap();
  renderShifts();
  fillReportPostSelect();
  renderReports();
  renderFinance();
  renderEmployees();
  renderLoans();
  renderMonorrielHome();
  applyAccessControl();
  requireLoginOrContinue();

  if (cloud.usedCloud && !added && currentUser) {
    toast("Datos sincronizados desde la nube.");
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js?v=27").then((reg) => {
      reg.update().catch(() => {});
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }).catch(() => {});
    // limpia caches viejas que dejaban el inicio vertical
    if (window.caches) {
      caches.keys().then((keys) => {
        keys.filter((k) => k.startsWith("rfs-ops-") && k !== "rfs-ops-v27").forEach((k) => caches.delete(k));
      }).catch(() => {});
    }
  }
});
