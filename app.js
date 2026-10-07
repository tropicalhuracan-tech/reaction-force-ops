/** Claves estables: no borrar datos del usuario en actualizaciones */
const POSTS_KEY = "rfs-ops-posts";
const REPORTS_KEY = "rfs-ops-reports";
const EMPLOYEES_KEY = "rfs-ops-employees";
const ADMIN_SESSION_KEY = "rfs-admin-unlocked";
const ADMIN_PASSWORD = "mitesoro01";
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
let selectedEmployeeId = null;
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
    roles: Array.isArray(e.roles) ? e.roles.filter(Boolean) : [],
    sites: Array.isArray(e.sites) ? e.sites.filter(Boolean) : [],
    updatedAt: e.updatedAt || new Date().toISOString(),
  };
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
    roles: [...new Set([...(base.roles || []), ...(incoming.roles || [])].filter(Boolean))],
    sites: [...new Set([...(base.sites || []), ...(incoming.sites || [])].filter(Boolean))],
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
  const filtered = employees.filter((e) => employeeMatchesSearch(e, needle));
  const complete = employees.filter((e) => employeeCompleteness(e).filled === employeeCompleteness(e).total).length;

  summary.textContent = employees.length
    ? `${employees.length} empleados · ${complete} con ficha completa · datos vacíos se llenan al editar servicios`
    : "Sin empleados todavía. Aparecen al agregar vigilantes en los servicios.";

  if (!filtered.length) {
    list.innerHTML = employees.length
      ? `<p class="empty">Ningún empleado coincide con la búsqueda.</p>`
      : `<p class="empty">Todavía no hay personal. Guarda vigilantes en Admin y aparecerán aquí.</p>`;
    return;
  }

  list.innerHTML = filtered
    .map((e) => {
      const { filled, total } = employeeCompleteness(e);
      const sitesFixed = (e.sites || []).slice(0, 2).join(" · ") || "Sin servicio asignado";
      const meta = [
        e.phone ? `Tel: ${e.phone}` : "Tel: —",
        e.cedula ? `Cédula: ${e.cedula}` : "Cédula: —",
        `${filled}/${total} datos`,
      ].join(" · ");
      return `
      <button class="employee-card" type="button" data-id="${escapeHtml(e.id)}">
        <div class="row">
          <div>
            <h3>${escapeHtml(e.name)}</h3>
            <p>${escapeHtml(sitesFixed)}</p>
            <p style="margin-top:6px">${escapeHtml(meta)}</p>
          </div>
          <span class="status-pill ${filled === total ? "ok" : "warn"}">${filled}/${total}</span>
        </div>
      </button>`;
    })
    .join("");

  list.querySelectorAll(".employee-card").forEach((btn) => {
    btn.addEventListener("click", () => openEmployeeDetail(btn.dataset.id));
  });
}

function getEmployee(id) {
  return employees.find((e) => e.id === id);
}

function openEmployeeDetail(id) {
  const emp = getEmployee(id);
  if (!emp) {
    toast("Empleado no encontrado.");
    return;
  }
  selectedEmployeeId = emp.id;
  document.getElementById("employeeDetailTitle").textContent = emp.name || "Empleado";
  document.getElementById("eName").value = emp.name || "";
  document.getElementById("ePhone").value = emp.phone || "";
  document.getElementById("eCedula").value = emp.cedula || "";
  document.getElementById("eEntry").value = emp.companyEntryDate || "";
  document.getElementById("eWeapons").value = emp.weapons || "";
  document.getElementById("eSerial").value = emp.serial || "";
  document.getElementById("eNote").value = emp.note || "";
  const sites = (emp.sites || []).join(", ") || "—";
  const roles = (emp.roles || []).join(", ");
  document.getElementById("eSites").textContent = roles
    ? `Servicios: ${sites} · Roles: ${roles}`
    : `Servicios: ${sites}`;
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
  const updated = normalizeEmployee({
    ...current,
    name,
    phone: document.getElementById("ePhone").value.trim(),
    cedula: document.getElementById("eCedula").value.trim(),
    companyEntryDate: document.getElementById("eEntry").value,
    weapons: document.getElementById("eWeapons").value.trim(),
    serial: document.getElementById("eSerial").value.trim(),
    note: document.getElementById("eNote").value.trim(),
    updatedAt: new Date().toISOString(),
  });
  employees[idx] = updated;
  selectedEmployeeId = updated.id;
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

  return {
    id: p.id || `p-${Date.now()}`,
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
    await window.RFSCloudApi.saveCloud(posts, reports, employees);
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

    if (remote.empty || (!remote.posts.length && !remote.reports.length)) {
      rebuildEmployeesFromPosts(localEmployees);
      await window.RFSCloudApi.saveCloud(localPosts, localReports, employees);
      localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees));
      cloudReady = true;
      setCloudStatus("Nube: activa ✓ (datos iniciales subidos)");
      return { added: 0, usedCloud: true };
    }

    posts = remote.posts.map(normalizePost);
    reports = Array.isArray(remote.reports) ? remote.reports : [];
    employees = Array.isArray(remote.employees) ? remote.employees.map(normalizeEmployee) : [];
    rebuildEmployeesFromPosts(employees);
    localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
    localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
    localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees));
    cloudReady = true;
    setCloudStatus(`Nube: activa ✓ · ${posts.length} servicios · ${employees.length} empleados`);
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
  const counts = { ok: 0, warn: 0, alert: 0 };
  posts.forEach((p) => {
    counts[p.status] = (counts[p.status] || 0) + 1;
  });
  summary.textContent = posts.length
    ? `${todayLabel()} · ${counts.ok || 0} en puesto · ${counts.warn || 0} pendientes · ${counts.alert || 0} incidentes`
    : `${todayLabel()} · Sin puestos todavía`;

  if (!posts.length) {
    list.innerHTML = `<p class="empty">No hay puestos. Entra a Admin con la clave y crea el primero.</p>`;
    return;
  }

  list.innerHTML = posts
    .map((p) => {
      const g = primaryGuard(p);
      return `
      <button class="shift-card" type="button" data-id="${p.id}">
        <div class="row">
          <div>
            <h3>${escapeHtml(p.site)}</h3>
            <p>${escapeHtml(guardsSummary(p))} · ${escapeHtml(p.guardCount)} vigilante(s)</p>
            <p style="margin-top:6px">Turno: <strong style="color:#fff">${escapeHtml(p.shift || "—")}</strong> · ${serviceLabel(p.serviceType)}</p>
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
  select.innerHTML = posts
    .map((p) => `<option value="${p.id}">${escapeHtml(p.site)} — ${escapeHtml(guardsSummary(p))}</option>`)
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

  list.innerHTML = posts
    .map((p) => {
      const g = primaryGuard(p);
      return `
      <article class="report-card admin-card" data-id="${p.id}">
        <div class="row">
          <div>
            <h3>${escapeHtml(p.site)}</h3>
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

  document.getElementById("detailTitle").textContent = post.site;
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

function isAdminUnlocked() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === "1";
}

function setAdminUnlocked(value) {
  if (value) sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
  else sessionStorage.removeItem(ADMIN_SESSION_KEY);
  updateAdminGate();
}

function updateAdminGate() {
  const unlocked = isAdminUnlocked();
  document.getElementById("adminLock").hidden = unlocked;
  document.getElementById("adminContent").hidden = !unlocked;
  if (unlocked) renderAdminList();
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

function switchView(viewId) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === viewId));
  document.querySelectorAll(".tab").forEach((t) => {
    // detailView no tiene tab; no marcar ninguno extra
    t.classList.toggle("active", t.dataset.view === viewId);
  });
  if (viewId !== "mapView") closeSheet();
  if (viewId === "mapView" && map) setTimeout(() => map.invalidateSize(), 80);
  if (viewId === "shiftsView") renderShifts();
  if (viewId === "reportsView") {
    fillReportPostSelect();
    renderReports();
  }
  if (viewId === "financeView") renderFinance();
  if (viewId === "employeesView") renderEmployees();
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

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la foto"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 1280;
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
        resolve(canvas.toDataURL("image/jpeg", 0.72));
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
    version: 2,
    exportedAt: new Date().toISOString(),
    posts,
    reports,
    employees,
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
      savePosts();
      saveReports();
      saveEmployees();
      renderMarkers();
      renderShifts();
      fillReportPostSelect();
      renderReports();
      renderFinance();
      renderEmployees();
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
      rebuildEmployeesFromPosts(employees);
      savePosts();
      saveReports();
      saveEmployees();
      renderMarkers();
      renderShifts();
      fillReportPostSelect();
      renderReports();
      renderFinance();
      renderEmployees();
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
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });

  document.querySelectorAll("[data-go]").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.go));
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
  document.getElementById("btnSaveEmployee").addEventListener("click", saveEmployeeDetail);
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
  rebuildEmployeesFromPosts(employees);

  // 1) Intentar nube primero
  const cloud = await syncFromCloud();

  // 2) Si la nube estaba vacía o falló, completar con importación Word (solo agregar faltantes)
  const added = await mergeImportedPosts();
  rebuildEmployeesFromPosts(employees);
  if (added > 0) {
    localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
    localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees));
    await pushToCloud();
    toast(`Se importaron ${added} servicios y se subieron a la nube.`);
  } else {
    localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
    localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
    localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees));
    // Sube el listado consolidado a la nube (sin borrar servicios)
    if (cloud.usedCloud && employees.length) await pushToCloud();
  }

  bindUi();
  setupInstallPrompt();
  updateAdminGate();
  renderGuardsEditor([emptyGuard()]);
  updateMonthPreview();
  initMap();
  renderShifts();
  fillReportPostSelect();
  renderReports();
  renderFinance();
  renderEmployees();

  if (cloud.usedCloud && !added) {
    toast("Datos sincronizados desde la nube.");
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
});
