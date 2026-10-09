/** Claves estables: no borrar datos del usuario en actualizaciones */
const POSTS_KEY = "rfs-ops-posts";
const REPORTS_KEY = "rfs-ops-reports";
const EMPLOYEES_KEY = "rfs-ops-employees";
const USERS_KEY = "rfs-ops-users";
const ACTIVITY_KEY = "rfs-ops-activity";
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
let activityLog = [];
let activityFilter = "all"; // all | login | change
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

function loadJsonObject(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
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

const MAX_ACTIVITY = 250;

function levRatio(a, b) {
  const s = String(a || "");
  const t = String(b || "");
  if (!s && !t) return 1;
  if (!s || !t) return 0;
  if (s === t) return 1;
  const m = s.length;
  const n = t.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return 1 - dp[m][n] / Math.max(m, n);
}

function tokenOverlap(a, b) {
  const ta = new Set(String(a || "").split(" ").filter((x) => x.length > 1));
  const tb = new Set(String(b || "").split(" ").filter((x) => x.length > 1));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((x) => {
    if (tb.has(x)) inter += 1;
  });
  return inter / Math.max(ta.size, tb.size);
}

function nameSimilarity(aName, bName) {
  const a = employeeKey(monoBaseName(aName) || aName);
  const b = employeeKey(monoBaseName(bName) || bName);
  if (!a || !b) return { score: 0, exact: false };
  if (a === b) return { score: 1, exact: true };
  let score = Math.max(levRatio(a, b), tokenOverlap(a, b));
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) {
    score = Math.max(score, 0.9);
  }
  return { score, exact: false };
}

function findSimilarEmployees(name, excludeId = null) {
  const raw = String(name || "").trim();
  if (raw.length < 3) return [];
  return employees
    .filter((e) => e && e.name && e.id !== excludeId)
    .map((e) => {
      const sim = nameSimilarity(raw, e.name);
      return { emp: e, score: sim.score, exact: sim.exact };
    })
    .filter((x) => x.score >= 0.72)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function formatDupHint(matches) {
  if (!matches.length) return "";
  return matches
    .map((m) => {
      const pct = Math.round(m.score * 100);
      const tag = m.exact ? "ya existe" : `parecido ${pct}%`;
      const st = isEmployeeActive(m.emp) ? "activo" : "inactivo";
      return `• ${m.emp.name} (${tag}, ${st})`;
    })
    .join("\n");
}

function updateEmployeeNameDupHint(inputId, hintId, excludeId = null) {
  const input = document.getElementById(inputId);
  const hint = document.getElementById(hintId);
  if (!input || !hint) return [];
  const matches = findSimilarEmployees(input.value, excludeId);
  if (!matches.length) {
    hint.hidden = true;
    hint.textContent = "";
    hint.classList.remove("dup-exact");
    return [];
  }
  const exact = matches.some((m) => m.exact);
  hint.hidden = false;
  hint.classList.toggle("dup-exact", exact);
  hint.textContent = (exact ? "⚠ Posible duplicado exacto:\n" : "⚠ Nombres parecidos:\n") + formatDupHint(matches);
  return matches;
}

function normalizeActivity(entry = {}) {
  const type = entry.type === "login" || entry.type === "logout" ? entry.type : "change";
  return {
    id: entry.id || `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: entry.at || new Date().toISOString(),
    type,
    action: String(entry.action || type),
    userId: entry.userId || "",
    userName: entry.userName || "",
    detail: String(entry.detail || "").slice(0, 240),
  };
}

function pruneActivity(list = activityLog) {
  return [...list]
    .map(normalizeActivity)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, MAX_ACTIVITY);
}

function mergeActivity(localList, remoteList) {
  const map = new Map();
  [...(localList || []), ...(remoteList || [])].map(normalizeActivity).forEach((e) => {
    if (!e.id) return;
    if (!map.has(e.id)) map.set(e.id, e);
  });
  return pruneActivity([...map.values()]);
}

function logActivity(action, detail, type = "change") {
  const entry = normalizeActivity({
    action,
    detail,
    type: action === "login" || action === "logout" ? action : type,
    userId: currentUser ? currentUser.id : "",
    userName: currentUser ? currentUser.displayName || currentUser.username : "sistema",
  });
  activityLog = pruneActivity([entry, ...activityLog]);
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activityLog));
  queueCloudSave();
  if (document.getElementById("activityLogList")) renderActivityLog();
  return entry;
}

function renderActivityLog() {
  const list = document.getElementById("activityLogList");
  if (!list) return;
  const filtered = activityLog.filter((e) => {
    if (activityFilter === "login") return e.type === "login" || e.type === "logout" || e.action === "login" || e.action === "logout";
    if (activityFilter === "change") return e.type === "change";
    return true;
  });
  list.innerHTML = filtered.length
    ? filtered
        .map((e) => {
          const when = (e.at || "").replace("T", " ").slice(0, 16);
          const kind =
            e.action === "login"
              ? "Entrada"
              : e.action === "logout"
                ? "Salida"
                : "Cambio";
          return `<article class="report-card activity-item">
            <div class="row">
              <div>
                <h3>${escapeHtml(kind)} · ${escapeHtml(e.userName || "Usuario")}</h3>
                <p class="muted tight">${escapeHtml(when)}</p>
                <p style="margin-top:6px">${escapeHtml(e.detail || e.action)}</p>
              </div>
            </div>
          </article>`;
        })
        .join("")
    : `<p class="empty">Sin registros todavía.</p>`;
  document.querySelectorAll(".activity-filter").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.activityFilter === activityFilter);
    btn.classList.toggle("ghost", btn.dataset.activityFilter !== activityFilter);
    btn.classList.toggle("secondary", btn.dataset.activityFilter === activityFilter);
  });
}



function normalizeHrContactRow(c = {}) {
  return {
    name: String(c.name || "").trim(),
    relation: String(c.relation || "").trim(),
    phone: String(c.phone || "").trim(),
    yearsKnown: String(c.yearsKnown || "").trim(),
  };
}

function normalizeEmployeeHrProfile(p = {}) {
  const family = Array.isArray(p.familyContacts) ? p.familyContacts.map(normalizeHrContactRow).filter((c) => c.name || c.phone) : [];
  const refs = Array.isArray(p.personalRefs) ? p.personalRefs.map(normalizeHrContactRow).filter((c) => c.name || c.phone) : [];
  return {
    address: String(p.address || "").trim(),
    sector: String(p.sector || "").trim(),
    city: String(p.city || "").trim(),
    phoneAlt: String(p.phoneAlt || "").trim(),
    email: String(p.email || "").trim(),
    bloodType: String(p.bloodType || "").trim(),
    birthDate: String(p.birthDate || "").trim(),
    gender: String(p.gender || "").trim(),
    maritalStatus: String(p.maritalStatus || "").trim(),
    nationality: String(p.nationality || "").trim(),
    educationLevel: String(p.educationLevel || "").trim(),
    availableShifts: String(p.availableShifts || "").trim(),
    emergencyName: String(p.emergencyName || "").trim(),
    emergencyPhone: String(p.emergencyPhone || "").trim(),
    emergencyRelation: String(p.emergencyRelation || "").trim(),
    familyContacts: family,
    personalRefs: refs,
    psychScore: p.psychScore === "" || p.psychScore == null ? "" : Number(p.psychScore),
    psychViolenceRisk: String(p.psychViolenceRisk || "").trim(),
    psychComprehension: String(p.psychComprehension || "").trim(),
    psychRecommendation: String(p.psychRecommendation || "").trim(),
    confidentialitySigned: !!p.confidentialitySigned,
  };
}

function employeeHrProfileHasData(p) {
  if (!p) return false;
  return !!(
    p.emergencyName ||
    p.emergencyPhone ||
    (p.familyContacts && p.familyContacts.length) ||
    (p.personalRefs && p.personalRefs.length) ||
    p.psychScore !== "" ||
    p.address ||
    p.bloodType
  );
}

function mergeEmployeeHrProfile(base = {}, incoming = {}) {
  const a = normalizeEmployeeHrProfile(base);
  const b = normalizeEmployeeHrProfile(incoming);
  if (!employeeHrProfileHasData(a) && employeeHrProfileHasData(b)) return b;
  if (employeeHrProfileHasData(a) && !employeeHrProfileHasData(b)) return a;
  return {
    address: preferFill(a.address, b.address),
    sector: preferFill(a.sector, b.sector),
    city: preferFill(a.city, b.city),
    phoneAlt: preferFill(a.phoneAlt, b.phoneAlt),
    email: preferFill(a.email, b.email),
    bloodType: preferFill(a.bloodType, b.bloodType),
    birthDate: preferFill(a.birthDate, b.birthDate),
    gender: preferFill(a.gender, b.gender),
    maritalStatus: preferFill(a.maritalStatus, b.maritalStatus),
    nationality: preferFill(a.nationality, b.nationality),
    educationLevel: preferFill(a.educationLevel, b.educationLevel),
    availableShifts: preferFill(a.availableShifts, b.availableShifts),
    emergencyName: preferFill(a.emergencyName, b.emergencyName),
    emergencyPhone: preferFill(a.emergencyPhone, b.emergencyPhone),
    emergencyRelation: preferFill(a.emergencyRelation, b.emergencyRelation),
    familyContacts: a.familyContacts.length ? a.familyContacts : b.familyContacts,
    personalRefs: a.personalRefs.length ? a.personalRefs : b.personalRefs,
    psychScore: a.psychScore !== "" && a.psychScore != null ? a.psychScore : b.psychScore,
    psychViolenceRisk: preferFill(a.psychViolenceRisk, b.psychViolenceRisk),
    psychComprehension: preferFill(a.psychComprehension, b.psychComprehension),
    psychRecommendation: preferFill(a.psychRecommendation, b.psychRecommendation),
    confidentialitySigned: a.confidentialitySigned || b.confidentialitySigned,
  };
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
    hrApplicationId: String(e.hrApplicationId || "").trim(),
    hrProfile: normalizeEmployeeHrProfile(e.hrProfile || {}),
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
    hrApplicationId: preferFill(base.hrApplicationId, incoming.hrApplicationId),
    hrProfile: mergeEmployeeHrProfile(base.hrProfile, incoming.hrProfile),
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

  document.querySelectorAll(".emp-tab[data-emp-filter]").forEach((tab) => {
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
  if (addBtn) addBtn.hidden = !canWriteEmployees() || employeeListFilter === "inactive";

  if (!filtered.length) {
    list.innerHTML = pool.length
      ? `<p class="empty">Ningún empleado coincide con la búsqueda.</p>`
      : employeeListFilter === "inactive"
        ? `<p class="empty">Todavía no hay empleados eliminados.</p>`
        : `<p class="empty">Todavía no hay personal activo.${canWriteEmployees() ? " Agrega uno o guárdalo desde un servicio / Monorriel." : ""}</p>`;
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
  if (!canWriteEmployees()) {
    toast("No tienes permiso para crear empleados.");
    return;
  }
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
  if (!canWriteEmployees()) {
    toast("No tienes permiso para crear empleados.");
    return;
  }
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
  const similar = findSimilarEmployees(name);
  if (similar.length) {
    const msg = "Hay nombres parecidos:\n" + formatDupHint(similar) + "\n\n¿Crear de todos modos?";
    if (!window.confirm(msg)) {
      toast("Creación cancelada para evitar duplicado.");
      return;
    }
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
  logActivity("employee_create", `Alta de empleado: ${emp.name}`);
  creatingEmployee = false;
  employeeListFilter = "active";
  renderEmployees();
  openEmployeeDetail(emp.id);
  toast("Empleado creado. Completa el resto de datos cuando quieras.");
}

function deactivateSelectedEmployee() {
  if (!canWriteEmployees()) {
    toast("No tienes permiso para eliminar empleados.");
    return;
  }
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
  logActivity("employee_deactivate", `Inactivó empleado: ${employees[idx].name}. Causa: ${reason}`);
  toast("Empleado pasado a inactivos.");
}

function reactivateSelectedEmployee() {
  if (!canWriteEmployees()) {
    toast("No tienes permiso para reactivar empleados.");
    return;
  }
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
  logActivity("employee_reactivate", `Reactivó empleado: ${employees[idx].name}`);
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
  const expandBtn = document.getElementById("btnEmpDocExpand");
  if (expandBtn) expandBtn.hidden = !isImage;
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

function closeMediaLightbox() {
  const box = document.getElementById("mediaLightbox");
  const img = document.getElementById("mediaLightboxImg");
  const pdf = document.getElementById("mediaLightboxPdf");
  if (box) box.hidden = true;
  if (img) {
    img.hidden = true;
    img.removeAttribute("src");
  }
  if (pdf) {
    pdf.hidden = true;
    pdf.removeAttribute("src");
  }
  document.body.classList.remove("lightbox-open");
}

function openMediaLightbox({ title, dataUrl, mime = "", name = "" }) {
  if (!dataUrl) {
    toast("No hay archivo para ver.");
    return;
  }
  const box = document.getElementById("mediaLightbox");
  const titleEl = document.getElementById("mediaLightboxTitle");
  const img = document.getElementById("mediaLightboxImg");
  const pdf = document.getElementById("mediaLightboxPdf");
  if (!box || !img || !pdf) {
    toast("No se pudo abrir la vista previa.");
    return;
  }
  const lowerMime = String(mime || "").toLowerCase();
  const isPdf = lowerMime.includes("pdf") || /\.pdf$/i.test(name || "");
  if (titleEl) titleEl.textContent = title || name || (isPdf ? "Documento PDF" : "Vista previa");
  img.hidden = isPdf;
  pdf.hidden = !isPdf;
  if (isPdf) {
    pdf.src = dataUrl;
    img.removeAttribute("src");
  } else {
    img.src = dataUrl;
    pdf.removeAttribute("src");
  }
  box.hidden = false;
  document.body.classList.add("lightbox-open");
}

function openEmpPhotoPreview() {
  const photo = currentEmpPhoto();
  if (!photo) {
    toast("No hay foto para ver.");
    return;
  }
  const emp = getEmployee(selectedEmployeeId);
  openMediaLightbox({
    title: emp ? `Foto · ${emp.name}` : "Foto del empleado",
    dataUrl: photo,
    mime: "image/jpeg",
    name: "foto.jpg",
  });
}

function openEmpDocument() {
  const doc = currentEmpDoc();
  if (!doc.dataUrl) {
    toast("No hay documento para ver.");
    return;
  }
  openMediaLightbox({
    title: doc.name || "Documento",
    dataUrl: doc.dataUrl,
    mime: doc.mime || "",
    name: doc.name || "",
  });
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
  syncEmployeeHrFromApplications(emp.id);
  renderEmpHrProfile(getEmployee(selectedEmployeeId) || emp);
  switchView("employeeDetailView");
  applyEmployeeWriteUi();
}

function buildHrProfileFromApplication(app) {
  if (!app) return normalizeEmployeeHrProfile({});
  return normalizeEmployeeHrProfile({
    address: app.address,
    sector: app.sector,
    city: app.city,
    phoneAlt: app.phoneAlt,
    email: app.email,
    bloodType: app.bloodType,
    birthDate: app.birthDate,
    gender: app.gender,
    maritalStatus: app.maritalStatus,
    nationality: app.nationality,
    educationLevel: app.educationLevel,
    availableShifts: app.availableShifts,
    emergencyName: app.emergencyName,
    emergencyPhone: app.emergencyPhone,
    emergencyRelation: app.emergencyRelation,
    familyContacts: app.familyContacts,
    personalRefs: app.personalRefs,
    psychScore: app.psychTest?.completedAt ? app.psychTest.score : "",
    psychViolenceRisk: app.psychTest?.violenceRisk || "",
    psychComprehension: app.psychTest?.comprehension || "",
    psychRecommendation: app.psychTest?.recommendation || "",
    confidentialitySigned: !!app.confidentialitySigned,
  });
}

/** Si el empleado se contrató por RRHH y aún no tiene perfil, lo completa desde la solicitud */
function syncEmployeeHrFromApplications(empId) {
  if (typeof hrData === "undefined" || !hrData || !Array.isArray(hrData.applications)) return;
  const idx = employees.findIndex((e) => e.id === empId);
  if (idx < 0) return;
  const emp = employees[idx];
  const app =
    hrData.applications.find((a) => a.hiredEmployeeId === emp.id) ||
    (emp.hrApplicationId ? hrData.applications.find((a) => a.id === emp.hrApplicationId) : null);
  if (!app) return;
  const profile = buildHrProfileFromApplication(app);
  if (!employeeHrProfileHasData(profile) && !app.photo) return;
  const needsProfile = !employeeHrProfileHasData(emp.hrProfile);
  const needsPhoto = !emp.photo && app.photo;
  if (!needsProfile && !needsPhoto && emp.hrApplicationId) return;
  employees[idx] = normalizeEmployee({
    ...emp,
    photo: preferFill(emp.photo, app.photo),
    hrApplicationId: preferFill(emp.hrApplicationId, app.id),
    hrProfile: needsProfile ? profile : mergeEmployeeHrProfile(emp.hrProfile, profile),
    updatedAt: new Date().toISOString(),
  });
  saveEmployees();
}

function renderEmpHrProfile(emp) {
  const card = document.getElementById("empHrEmergencyCard");
  const body = document.getElementById("empHrEmergencyBody");
  if (!card || !body) return;
  const p = normalizeEmployeeHrProfile(emp?.hrProfile || {});
  if (!employeeHrProfileHasData(p) && !emp?.hrApplicationId) {
    card.hidden = true;
    body.innerHTML = "";
    return;
  }
  card.hidden = false;
  const fam = (p.familyContacts || [])
    .map((c) => `<li><strong>${escapeHtml(c.name || "—")}</strong> (${escapeHtml(c.relation || "familiar")}) · ${escapeHtml(c.phone || "sin tel.")}</li>`)
    .join("");
  const refs = (p.personalRefs || [])
    .map((c) => `<li><strong>${escapeHtml(c.name || "—")}</strong> (${escapeHtml(c.relation || "ref.")}) · ${escapeHtml(c.phone || "sin tel.")}${c.yearsKnown ? ` · ${escapeHtml(c.yearsKnown)} años` : ""}</li>`)
    .join("");
  const psych =
    p.psychScore === "" || p.psychScore == null
      ? "—"
      : `${p.psychScore}/100${p.psychViolenceRisk ? ` · violencia: ${p.psychViolenceRisk}` : ""}${p.psychComprehension ? ` · comprensión: ${p.psychComprehension}` : ""}`;
  const addr = [p.address, p.sector, p.city].filter(Boolean).join(", ") || "—";
  body.innerHTML = `
    <div class="emp-hr-grid">
      <p><span class="muted">Emergencia</span><br/><strong>${escapeHtml(p.emergencyName || "—")}</strong><br/>${escapeHtml(p.emergencyRelation || "")} · ${escapeHtml(p.emergencyPhone || "—")}</p>
      <p><span class="muted">Test psicológico</span><br/><strong>${escapeHtml(psych)}</strong></p>
      <p><span class="muted">Dirección</span><br/>${escapeHtml(addr)}</p>
      <p><span class="muted">Tel. alterno / correo</span><br/>${escapeHtml(p.phoneAlt || "—")} · ${escapeHtml(p.email || "—")}</p>
      <p><span class="muted">Sangre / turnos</span><br/>${escapeHtml(p.bloodType || "—")} · ${escapeHtml(p.availableShifts || "—")}</p>
    </div>
    <p class="muted" style="margin-top:10px;margin-bottom:4px">Familiares</p>
    <ul class="emp-hr-list">${fam || "<li>Sin contactos familiares</li>"}</ul>
    <p class="muted" style="margin-top:10px;margin-bottom:4px">Referencias personales</p>
    <ul class="emp-hr-list">${refs || "<li>Sin referencias</li>"}</ul>
  `;
}

function buildEmployeeHirePrintHtml(emp) {
  const p = normalizeEmployeeHrProfile(emp.hrProfile || {});
  const famRows = (p.familyContacts || [])
    .map((c) => `<tr><td>${escapeHtml(c.name || "—")}</td><td>${escapeHtml(c.relation || "—")}</td><td>${escapeHtml(c.phone || "—")}</td></tr>`)
    .join("");
  const refRows = (p.personalRefs || [])
    .map((c) => `<tr><td>${escapeHtml(c.name || "—")}</td><td>${escapeHtml(c.relation || "—")}</td><td>${escapeHtml(c.phone || "—")}</td><td>${escapeHtml(c.yearsKnown || "—")}</td></tr>`)
    .join("");
  const psych =
    p.psychScore === "" || p.psychScore == null
      ? "—"
      : `${p.psychScore}/100 (violencia: ${p.psychViolenceRisk || "—"}, comprensión: ${p.psychComprehension || "—"})`;
  const photo = emp.photo
    ? `<img src="${emp.photo}" alt="Foto" style="width:110px;height:130px;object-fit:cover;border:1px solid #333;border-radius:6px" />`
    : "";
  return `
    <div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:12px">
      ${photo}
      <div style="flex:1">
        <h2 style="margin:0 0 6px">${escapeHtml(emp.name || "—")}</h2>
        <div class="meta">
          <div><strong>Cédula:</strong><br/>${escapeHtml(emp.cedula || "—")}</div>
          <div><strong>Teléfono:</strong><br/>${escapeHtml(emp.phone || "—")}</div>
          <div><strong>Entrada:</strong><br/>${escapeHtml(emp.companyEntryDate || "—")}</div>
          <div><strong>Nacimiento:</strong><br/>${escapeHtml(p.birthDate || "—")}</div>
          <div><strong>Sexo:</strong><br/>${escapeHtml(p.gender || "—")}</div>
          <div><strong>Estado civil:</strong><br/>${escapeHtml(p.maritalStatus || "—")}</div>
        </div>
      </div>
    </div>
    <p><strong>Dirección:</strong> ${escapeHtml([p.address, p.sector, p.city].filter(Boolean).join(", ") || "—")}</p>
    <p><strong>Tel. alterno:</strong> ${escapeHtml(p.phoneAlt || "—")} · <strong>Correo:</strong> ${escapeHtml(p.email || "—")}</p>
    <p><strong>Sangre:</strong> ${escapeHtml(p.bloodType || "—")} · <strong>Turnos:</strong> ${escapeHtml(p.availableShifts || "—")} · <strong>Educación:</strong> ${escapeHtml(p.educationLevel || "—")}</p>
    <p><strong>Contacto de emergencia:</strong> ${escapeHtml(p.emergencyName || "—")} (${escapeHtml(p.emergencyRelation || "—")}) · ${escapeHtml(p.emergencyPhone || "—")}</p>
    <p><strong>Puntuación test psicológico:</strong> ${escapeHtml(psych)}</p>
    <p><strong>Confidencialidad:</strong> ${p.confidentialitySigned ? "Aceptada" : "—"}</p>
    <h2 style="margin-top:12px">Familiares</h2>
    <table>
      <thead><tr><th>Nombre</th><th>Parentesco</th><th>Teléfono</th></tr></thead>
      <tbody>${famRows || `<tr><td colspan="3">—</td></tr>`}</tbody>
    </table>
    <h2 style="margin-top:12px">Referencias personales</h2>
    <table>
      <thead><tr><th>Nombre</th><th>Relación</th><th>Teléfono</th><th>Años</th></tr></thead>
      <tbody>${refRows || `<tr><td colspan="4">—</td></tr>`}</tbody>
    </table>
    <p style="margin-top:10px"><strong>Notas:</strong> ${escapeHtml(emp.note || "—")}</p>
    <p style="margin-top:14px;font-size:11px">Declaro que la información es correcta y firmo esta hoja de contratación / expediente.</p>
    <div class="sign-box">
      <div><div class="sign-line">Firma del empleado<br/>${escapeHtml(emp.name || "")}</div></div>
      <div><div class="sign-line">Firma autorizado RFS<br/>Fecha: _______________</div></div>
    </div>`;
}

function printEmployeeHireSheet(emp) {
  if (!emp) {
    toast("No hay empleado para imprimir.");
    return;
  }
  if (!emp.photo || !String(emp.photo).startsWith("data:image")) {
    toast("No se puede imprimir: sube la foto del empleado primero.");
    return;
  }
  openPrintWindow(`Hoja de contratación — ${emp.name}`, buildEmployeeHirePrintHtml(emp));
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
  if (!canWriteEmployees()) {
    toast("No tienes permiso para editar empleados.");
    return;
  }
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
  const similar = findSimilarEmployees(name, current.id);
  if (similar.some((m) => m.exact)) {
    toast("Ese nombre ya pertenece a otro empleado.");
    updateEmployeeNameDupHint("eName", "eNameDupHint", current.id);
    return;
  }
  if (similar.length && employeeKey(name) !== employeeKey(current.name)) {
    const msg = "El nuevo nombre se parece a:\n" + formatDupHint(similar) + "\n\n¿Guardar de todos modos?";
    if (!window.confirm(msg)) return;
  }
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
    hrApplicationId: current.hrApplicationId || "",
    hrProfile: current.hrProfile || {},
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
  logActivity("employee_update", `Actualizó empleado: ${updated.name}`);
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

let cloudSavePending = false;

async function pushToCloud() {
  if (!window.RFSCloudApi) return;
  if (cloudSaving) {
    cloudSavePending = true;
    return;
  }
  cloudSaving = true;
  cloudSavePending = false;
  setCloudStatus("Nube: guardando…");
  try {
    await window.RFSCloudApi.saveCloud(posts, reports, employees, loans, monorrielReports, appUsers, chatMessages, radioState, activityLog, lvaState, pettyCash, hrData);
    cloudReady = true;
    setCloudStatus("Nube: guardado ✓ (todas las PCs)");
  } catch (err) {
    console.error(err);
    setCloudStatus("Nube: error al guardar (se mantiene copia local)");
  } finally {
    cloudSaving = false;
    if (cloudSavePending) {
      cloudSavePending = false;
      pushToCloud().catch(() => {});
    }
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
      await window.RFSCloudApi.saveCloud(localPosts, localReports, employees, localLoans, localMono, appUsers, chatMessages, radioState, activityLog, lvaState, pettyCash, hrData);
      localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees));
      localStorage.setItem(LOANS_KEY, JSON.stringify(loans));
      localStorage.setItem(MONORRIEL_REPORTS_KEY, JSON.stringify(monorrielReports));
      localStorage.setItem(USERS_KEY, JSON.stringify(appUsers));
      localStorage.setItem(MESSAGES_KEY, JSON.stringify(chatMessages));
      localStorage.setItem(RADIO_KEY, JSON.stringify(radioState));
      localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activityLog));
      localStorage.setItem(LVA_KEY, JSON.stringify(lvaState));
      localStorage.setItem(PETTY_KEY, JSON.stringify(pettyCash));
      localStorage.setItem(HR_KEY, JSON.stringify(hrData));
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
    if (remote.radio && typeof remote.radio === "object") {
      applyRemoteRadio(remote.radio);
    }
    if (Array.isArray(remote.activity)) {
      activityLog = mergeActivity(activityLog, remote.activity);
    }
    if (remote.lva && typeof remote.lva === "object") {
      applyRemoteLva(remote.lva);
    }
    if (remote.pettyCash && typeof remote.pettyCash === "object") {
      const remoteEpoch = Number(remote.pettyCash.epoch) || 1;
      applyRemotePettyCash(remote.pettyCash);
      // Si la nube aún trae datos de prueba (sin epoch de reinicio), fuerza guardar limpio
      if (remoteEpoch < CAJA_RESET_EPOCH) {
        savePettyCash(true);
      }
    }
    if (remote.hr && typeof remote.hr === "object") {
      applyRemoteHrData(remote.hr);
    } else if (!(hrData.applications && hrData.applications.length)) {
      hrData = emptyHrData();
    }
    rebuildEmployeesFromPosts(employees);
    ensureMonorrielEmployeesImported();
    localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
    localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
    localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees));
    localStorage.setItem(LOANS_KEY, JSON.stringify(loans));
    localStorage.setItem(MONORRIEL_REPORTS_KEY, JSON.stringify(monorrielReports));
    localStorage.setItem(USERS_KEY, JSON.stringify(appUsers));
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(chatMessages));
    localStorage.setItem(RADIO_KEY, JSON.stringify(radioState));
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activityLog));
    localStorage.setItem(LVA_KEY, JSON.stringify(lvaState));
    localStorage.setItem(PETTY_KEY, JSON.stringify(pettyCash));
    localStorage.setItem(HR_KEY, JSON.stringify(hrData));
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
  const showMoney = canSeeClientMoney();
  const writeCli = canWriteClients();
  list.innerHTML = sortPostsByClientNumber(posts)
    .map((p) => {
      const g = primaryGuard(p);
      const moneyLine = showMoney
        ? `<p>${serviceLabel(p.serviceType)} · ${money(p.priceMonth)} / mes · ${escapeHtml(p.hours || 0)} h</p>`
        : `<p>${serviceLabel(p.serviceType)}</p>`;
      const actions = writeCli
        ? `<button class="btn secondary btn-open" type="button" data-id="${p.id}">Ver datos</button>
          <button class="btn secondary btn-edit" type="button" data-id="${p.id}">Editar</button>
          <button class="btn danger btn-delete" type="button" data-id="${p.id}">Eliminar</button>`
        : `<button class="btn secondary btn-open" type="button" data-id="${p.id}">Ver datos</button>`;
      return `
      <article class="report-card admin-card" data-id="${p.id}">
        <div class="row">
          <div>
            <h3><span class="client-num">#${escapeHtml(String(p.clientNumber || "—"))}</span> ${escapeHtml(p.site)}</h3>
            <p>${escapeHtml(guardsSummary(p))} · ${escapeHtml(p.guardCount)} vigilante(s)</p>
            <p>Supervisor: ${escapeHtml(p.supervisor || "—")} · Tel: ${escapeHtml(g.phone || "—")}</p>
            ${moneyLine}
            <p>${Number.isFinite(p.lat) ? "📍 Con ubicación" : "⚠ Sin ubicación en mapa"} · ${escapeHtml(p.region || "")}</p>
          </div>
          <span class="status-pill ${statusClass(p.status)}">${STATUS_LABEL[p.status]}</span>
        </div>
        <div class="admin-actions">
          ${actions}
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

  const showMoney = canSeeClientMoney();
  const moneyRows = showMoney
    ? `<div><span>Horas</span><strong>${escapeHtml(post.hours || 0)}</strong></div>
        <div><span>Precio / hora</span><strong>${money(post.hourlyRate)}</strong></div>
        <div><span>Cobro mensual</span><strong>${money(post.priceMonth)}</strong></div>`
    : "";

  document.getElementById("detailBody").innerHTML = `
    <article class="report-card">
      <h3>Datos del servicio</h3>
      <div class="detail-grid" style="margin-top:10px">
        <div><span>Inicio</span><strong>${escapeHtml(post.startDate || "—")}</strong></div>
        <div><span>Vigilantes</span><strong>${escapeHtml(post.guardCount)}</strong></div>
        ${moneyRows}
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
  applyCapsUi();
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
  { key: "lavega", label: "La Vega Autopista", view: "lvaView" },
  { key: "finance", label: "Finanzas", view: "financeView" },
  { key: "cajachica", label: "Caja chica", view: "cajaView" },
  { key: "rrhh", label: "Recursos Humanos", view: "hrView" },
  { key: "reports", label: "Reportes", view: "reportsView" },
  { key: "messages", label: "Mensajes", view: "messagesView" },
  { key: "radio", label: "Radio", view: "radioView" },
  { key: "admin", label: "Admin", view: "adminView" },
];

/** Capacidades dentro de un módulo (no abren pestaña propia) */
const CAP_DEFS = [
  { key: "clientsMoney", label: "Ver dinero en Clientes" },
  { key: "clientsWrite", label: "Crear / editar / eliminar clientes" },
  { key: "employeesWrite", label: "Crear / editar / eliminar empleados" },
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
  lvaView: "lavega",
  financeView: "finance",
  reportsView: "reports",
  messagesView: "messages",
  radioView: "radio",
  adminView: "admin",
  detailView: "clients",
  cajaView: "cajachica",
  hrView: "rrhh",
  loginView: null,
};

function allModulesTrue() {
  const mods = {};
  MODULE_DEFS.forEach((m) => {
    mods[m.key] = true;
  });
  CAP_DEFS.forEach((c) => {
    mods[c.key] = true;
  });
  return mods;
}

function normalizeUser(u = {}) {
  const incoming = u.modules || {};
  const modules = { ...allModulesTrue(), ...incoming };
  MODULE_DEFS.forEach((m) => {
    // Caja chica / RRHH: solo si el dueño las marca (no se heredan solas al actualizar).
    if (m.key === "cajachica" && !Object.prototype.hasOwnProperty.call(incoming, "cajachica")) {
      modules.cajachica = false;
      return;
    }
    if (m.key === "rrhh" && !Object.prototype.hasOwnProperty.call(incoming, "rrhh")) {
      modules.rrhh = false;
      return;
    }
    if (typeof modules[m.key] !== "boolean") modules[m.key] = !!modules[m.key];
  });
  // Capacidades: si el usuario ya existía sin la clave, mantener permiso (compatibilidad).
  // Solo usuarios nuevos en el formulario nacen sin ellas.
  CAP_DEFS.forEach((c) => {
    if (!Object.prototype.hasOwnProperty.call(incoming, c.key)) {
      modules[c.key] = true;
    } else {
      modules[c.key] = !!incoming[c.key];
    }
  });
  const username = String(u.username || "").trim().toLowerCase();
  const role = u.role === "owner" || username === OWNER_USERNAME ? "owner" : "user";
  if (role === "owner") {
    MODULE_DEFS.forEach((m) => {
      modules[m.key] = true;
    });
    CAP_DEFS.forEach((c) => {
      modules[c.key] = true;
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

/** Capacidades: ver dinero, crear/editar clientes o empleados */
function canCap(capKey) {
  if (!currentUser) return false;
  if (currentUser.role === "owner") return true;
  if (!currentUser.modules || typeof currentUser.modules[capKey] === "undefined") return true;
  return !!currentUser.modules[capKey];
}

function canSeeClientMoney() {
  return canCap("clientsMoney");
}

function canWriteClients() {
  return canCap("clientsWrite");
}

function canWriteEmployees() {
  return canCap("employeesWrite");
}

function canAccessView(viewId) {
  if (viewId === "loginView") return true;
  if (viewId === "cajaView") return canAccessCajaChica();
  if (viewId === "hrView") return canAccessRrhh();
  const mod = VIEW_TO_MODULE[viewId];
  if (!mod) return !!currentUser;
  return canAccessModule(mod);
}

function firstAllowedView() {
  const order = ["homeView", "mapView", "shiftsView", "employeesView", "messagesView", "radioView", "loansView", "monorrielView", "lvaView", "financeView", "cajaView", "hrView", "reportsView", "adminView"];
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

  applyCapsUi();
}

function applyCapsUi() {
  const writeEmp = canWriteEmployees();
  const writeCli = canWriteClients();

  const addEmp = document.getElementById("btnAddEmployee");
  if (addEmp) {
    const inactiveTab = typeof employeeListFilter !== "undefined" && employeeListFilter === "inactive";
    addEmp.hidden = !writeEmp || inactiveTab;
  }

  const adminForm = document.getElementById("adminFormCard");
  if (adminForm) adminForm.hidden = !writeCli;

  const detailEdit = document.getElementById("btnDetailEdit");
  if (detailEdit) detailEdit.hidden = !writeCli;

  applyEmployeeWriteUi();
}

function applyEmployeeWriteUi() {
  const write = canWriteEmployees();
  const empIds = [
    "eName",
    "eMonorriel",
    "ePhone",
    "eCedula",
    "eEntry",
    "eWeapons",
    "eSerial",
    "eNote",
    "ePhotoFile",
    "eDocFile",
    "eInactiveReason",
  ];
  empIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !write;
  });
  const saveBtn = document.getElementById("btnSaveEmployee");
  if (saveBtn) saveBtn.hidden = !write;
  const clearPhoto = document.getElementById("btnClearEmpPhoto");
  if (clearPhoto) clearPhoto.hidden = !write;
  const clearDoc = document.getElementById("btnClearEmpDoc");
  if (clearDoc) clearDoc.hidden = !write;
  const photoUpload = document.getElementById("ePhotoUploadLabel");
  if (photoUpload) photoUpload.hidden = !write;
  const docUpload = document.getElementById("eDocUploadLabel");
  if (docUpload) docUpload.hidden = !write;

  const emp = selectedEmployeeId ? getEmployee(selectedEmployeeId) : null;
  const deactBox = document.getElementById("empDeactivateBox");
  const btnReact = document.getElementById("btnReactivateEmployee");
  if (!write) {
    if (deactBox) deactBox.hidden = true;
    if (btnReact) btnReact.hidden = true;
  } else if (emp) {
    const active = isEmployeeActive(emp);
    if (deactBox) deactBox.hidden = !active;
    if (btnReact) btnReact.hidden = active;
  }
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


/* ==== FACE ID / BIOMETRÍA (teléfonos) ==== */
const BIOMETRIC_KEY = "rfs-ops-biometric";

function bufferToBase64Url(buf) {
  const bytes = new Uint8Array(buf);
  let str = "";
  bytes.forEach((b) => {
    str += String.fromCharCode(b);
  });
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBuffer(str) {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const base64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

function randomChallenge(len = 32) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return arr.buffer;
}

function getBiometricRpId() {
  const host = window.location.hostname || "";
  if (!host || host === "localhost" || host === "127.0.0.1") return host || "localhost";
  return host;
}

function isBiometricPlatformAvailable() {
  return !!(window.PublicKeyCredential && navigator.credentials && window.isSecureContext);
}

async function canUsePlatformAuthenticator() {
  if (!isBiometricPlatformAvailable()) return false;
  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function") {
      return !!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
    }
  } catch (_) {}
  return true;
}

function loadBiometricEnrollment() {
  try {
    const raw = localStorage.getItem(BIOMETRIC_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.userId || !data.credentialId) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function saveBiometricEnrollment(data) {
  if (!data) localStorage.removeItem(BIOMETRIC_KEY);
  else localStorage.setItem(BIOMETRIC_KEY, JSON.stringify(data));
}

function clearBiometricEnrollment() {
  localStorage.removeItem(BIOMETRIC_KEY);
}

function completeAppLogin(found, via = "password") {
  currentUser = found;
  setSessionUserId(found.id);
  const error = document.getElementById("loginError");
  if (error) error.hidden = true;
  const passEl = document.getElementById("loginPassword");
  if (passEl) passEl.value = "";
  if (found.role === "owner" || found.modules.admin) setAdminUnlocked(true);
  else setAdminUnlocked(false);
  logActivity("login", `Entró al sistema: ${found.displayName || found.username}${via === "biometric" ? " (Face ID/huella)" : ""}`, "login");
  applyAccessControl();
  refreshBiometricLoginUi();
  switchView(firstAllowedView());
  toast(`Bienvenido, ${found.displayName || found.username}`);
}

async function refreshBiometricLoginUi() {
  const btn = document.getElementById("btnBiometricLogin");
  const hint = document.getElementById("biometricHint");
  const disableBtn = document.getElementById("btnBiometricDisable");
  if (!btn) return;
  const enrolled = loadBiometricEnrollment();
  const available = await canUsePlatformAuthenticator();
  const enrolledUser = enrolled ? appUsers.find((u) => u.id === enrolled.userId && u.active) : null;
  const showLogin = !!(available && enrolled && enrolledUser && !currentUser);
  btn.hidden = !showLogin;
  if (disableBtn) disableBtn.hidden = !(available && enrolled && !currentUser);
  if (hint) {
    if (!available) {
      hint.hidden = true;
      hint.textContent = "";
    } else if (enrolled && enrolledUser) {
      hint.hidden = false;
      hint.textContent = `Face ID / huella listo para: ${enrolledUser.displayName || enrolledUser.username}`;
    } else {
      hint.hidden = false;
      hint.textContent = "En este teléfono puedes activar Face ID o huella después de entrar con tu clave.";
    }
  }
}

async function enrollBiometricForUser(user) {
  if (!user) return false;
  const available = await canUsePlatformAuthenticator();
  if (!available) {
    toast("Este teléfono no permite Face ID / huella en la app.");
    return false;
  }
  const rpId = getBiometricRpId();
  const userIdBytes = new TextEncoder().encode(String(user.id)).buffer;
  try {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: randomChallenge(),
        rp: { name: "Reaction Force Security", id: rpId },
        user: {
          id: userIdBytes,
          name: user.username || user.id,
          displayName: user.displayName || user.username || "Usuario",
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
        timeout: 60000,
        attestation: "none",
      },
    });
    if (!cred || !cred.rawId) {
      toast("No se pudo activar Face ID / huella.");
      return false;
    }
    saveBiometricEnrollment({
      userId: user.id,
      username: user.username,
      displayName: user.displayName || user.username,
      credentialId: bufferToBase64Url(cred.rawId),
      createdAt: new Date().toISOString(),
    });
    refreshBiometricLoginUi();
    toast("Face ID / huella activado en este teléfono.");
    return true;
  } catch (err) {
    console.error(err);
    if (err && (err.name === "NotAllowedError" || err.name === "AbortError")) {
      toast("Activación cancelada.");
    } else {
      toast("No se pudo activar Face ID / huella en este dispositivo.");
    }
    return false;
  }
}

async function maybeOfferBiometricEnrollment(user) {
  const available = await canUsePlatformAuthenticator();
  if (!available || !user) return;
  const enrolled = loadBiometricEnrollment();
  if (enrolled && enrolled.userId === user.id) return;
  const label = /iPhone|iPad|Mac/.test(navigator.userAgent) ? "Face ID / Touch ID" : "Face ID / huella";
  const ok = window.confirm(
    `¿Activar ${label} para entrar más rápido en este teléfono?\n\nUsuario: ${user.displayName || user.username}\nSolo funciona en este dispositivo.`
  );
  if (!ok) return;
  await enrollBiometricForUser(user);
}

async function tryBiometricLogin() {
  const error = document.getElementById("loginError");
  if (error) error.hidden = true;
  const enrolled = loadBiometricEnrollment();
  if (!enrolled) {
    toast("Primero entra con usuario y clave y activa Face ID / huella.");
    return;
  }
  const found = appUsers.find((u) => u.id === enrolled.userId && u.active);
  if (!found) {
    clearBiometricEnrollment();
    refreshBiometricLoginUi();
    toast("Ese usuario ya no existe. Entra con clave otra vez.");
    return;
  }
  const available = await canUsePlatformAuthenticator();
  if (!available) {
    toast("La biometría no está disponible ahora.");
    return;
  }
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomChallenge(),
        rpId: getBiometricRpId(),
        allowCredentials: [
          {
            type: "public-key",
            id: base64UrlToBuffer(enrolled.credentialId),
            transports: ["internal"],
          },
        ],
        userVerification: "required",
        timeout: 60000,
      },
    });
    if (!assertion) {
      toast("No se pudo verificar Face ID / huella.");
      return;
    }
    completeAppLogin(found, "biometric");
  } catch (err) {
    console.error(err);
    if (err && (err.name === "NotAllowedError" || err.name === "AbortError")) {
      toast("Face ID / huella cancelado.");
    } else {
      toast("No se pudo entrar con Face ID / huella.");
    }
  }
}

function disableBiometricOnThisDevice() {
  const enrolled = loadBiometricEnrollment();
  if (!enrolled) {
    toast("No hay Face ID activado en este teléfono.");
    return;
  }
  const ok = window.confirm("¿Quitar Face ID / huella de este teléfono?");
  if (!ok) return;
  clearBiometricEnrollment();
  refreshBiometricLoginUi();
  toast("Face ID / huella desactivado en este teléfono.");
}
/* ==== FIN FACE ID / BIOMETRÍA ==== */

function tryAppLogin() {
  const user = document.getElementById("loginUsername").value.trim().toLowerCase();
  const pass = document.getElementById("loginPassword").value;
  const error = document.getElementById("loginError");
  const found = appUsers.find((u) => u.active && u.username === user && u.password === pass);
  if (!found) {
    if (error) error.hidden = false;
    toast("Usuario o clave incorrectos.");
    return;
  }
  completeAppLogin(found, "password");
  maybeOfferBiometricEnrollment(found);
}

function logoutAppUser() {
  if (currentUser) {
    logActivity("logout", `Salió del sistema: ${currentUser.displayName || currentUser.username}`, "logout");
  }
  currentUser = null;
  setSessionUserId("");
  setAdminUnlocked(false);
  applyAccessControl();
  refreshBiometricLoginUi();
  switchView("loginView");
  toast("Sesión cerrada.");
}

function readUserFormModules() {
  const modules = allModulesTrue();
  MODULE_DEFS.forEach((m) => {
    const el = document.querySelector(`#uPermGrid [data-perm="${m.key}"]`);
    modules[m.key] = !!(el && el.checked);
  });
  CAP_DEFS.forEach((c) => {
    const el = document.querySelector(`#uCapGrid [data-cap="${c.key}"]`);
    modules[c.key] = !!(el && el.checked);
  });
  const homeEl = document.querySelector(`#uPermGrid [data-perm="home"]`);
  modules.home = !!(homeEl && homeEl.checked);
  return modules;
}

function fillUserFormModules(modules) {
  MODULE_DEFS.forEach((m) => {
    const el = document.querySelector(`#uPermGrid [data-perm="${m.key}"]`);
    if (el) el.checked = modules && typeof modules[m.key] === "boolean" ? modules[m.key] : true;
  });
  CAP_DEFS.forEach((c) => {
    const el = document.querySelector(`#uCapGrid [data-cap="${c.key}"]`);
    if (el) el.checked = modules && typeof modules[c.key] === "boolean" ? modules[c.key] : false;
  });
}

function clearUserForm() {
  document.getElementById("uEditingId").value = "";
  document.getElementById("uDisplayName").value = "";
  document.getElementById("uUsername").value = "";
  document.getElementById("uPassword").value = "";
  document.getElementById("uPassword").type = "text";
  document.getElementById("uUsername").disabled = false;
  const toggle = document.getElementById("btnToggleUserPass");
  if (toggle) toggle.textContent = "Ocultar";
  fillUserFormModules({
    home: true,
    map: true,
    clients: true,
    employees: true,
    loans: false,
    monorriel: true,
    lavega: true,
    finance: false,
    cajachica: false,
    rrhh: false,
    reports: true,
    messages: true,
    radio: true,
    admin: false,
    clientsMoney: false,
    clientsWrite: false,
    employeesWrite: false,
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
      const caps = CAP_DEFS.filter((c) => u.modules[c.key]).map((c) => c.label).join(", ");
      const capsDenied = CAP_DEFS.filter((c) => !u.modules[c.key]).map((c) => c.label);
      const passText = u.password ? escapeHtml(u.password) : "(sin clave)";
      return `<article class="report-card">
        <div class="row">
          <div>
            <h3>${escapeHtml(u.displayName || u.username)} ${u.role === "owner" ? "(Dueño)" : ""}</h3>
            <p>Usuario: <strong>${escapeHtml(u.username)}</strong> · ${u.active ? "Activo" : "Inactivo"}</p>
            <p class="user-pass-line">Clave: <strong class="user-pass-value">${passText}</strong>
              <button class="btn ghost btn-copy-pass" type="button" data-id="${escapeHtml(u.id)}" style="width:auto;margin:0 0 0 6px;padding:4px 8px;font-size:12px">Copiar</button>
            </p>
            <p style="margin-top:6px">${escapeHtml(allowed || "Sin módulos")}</p>
            <p style="margin-top:4px" class="muted">${caps ? `Extra: ${escapeHtml(caps)}` : "Sin dinero ni altas (solo consulta)"}</p>
            ${capsDenied.length ? `<p style="margin-top:2px" class="muted">Bloqueado: ${escapeHtml(capsDenied.join(", "))}</p>` : ""}
          </div>
        </div>
        <div class="admin-actions">
          ${
            u.role === "owner"
              ? `<button class="btn secondary btn-edit-user" type="button" data-id="${escapeHtml(u.id)}">Ver / editar</button>`
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
  list.querySelectorAll(".btn-copy-pass").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const u = appUsers.find((x) => x.id === btn.dataset.id);
      const pass = u && u.password ? String(u.password) : "";
      if (!pass) {
        toast("Este usuario no tiene clave guardada.");
        return;
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(pass);
        } else {
          window.prompt("Copia la clave:", pass);
        }
        toast("Clave copiada.");
      } catch (_) {
        window.prompt("Copia la clave:", pass);
      }
    });
  });
}

function editUser(id) {
  const u = appUsers.find((x) => x.id === id);
  if (!u) return;
  document.getElementById("uEditingId").value = u.id;
  document.getElementById("uDisplayName").value = u.displayName || "";
  document.getElementById("uUsername").value = u.username;
  document.getElementById("uUsername").disabled = u.role === "owner";
  // Mostrar la clave actual al administrador para recordarla o cambiarla
  document.getElementById("uPassword").value = u.password || "";
  document.getElementById("uPassword").placeholder = "Clave del usuario";
  document.getElementById("uPassword").type = "text";
  const toggle = document.getElementById("btnToggleUserPass");
  if (toggle) toggle.textContent = "Ocultar";
  fillUserFormModules(u.modules);
  document.getElementById("btnCancelUserEdit").hidden = false;
  document.getElementById("btnSaveUser").textContent = u.role === "owner" ? "Actualizar dueño" : "Actualizar usuario";
  toast("Clave visible abajo. Puedes copiarla o cambiarla y guardar.");
}

function deleteUser(id) {
  const u = appUsers.find((x) => x.id === id);
  if (!u || u.role === "owner") return;
  const ok = window.confirm(`¿Eliminar el usuario "${u.username}"?`);
  if (!ok) return;
  const uname = u.username;
  appUsers = appUsers.filter((x) => x.id !== id);
  saveUsers();
  logActivity("user_delete", `Eliminó usuario: ${uname}`);
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
  if (!editingId && username === OWNER_USERNAME) {
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
    if (!password) {
      toast("La clave no puede quedar vacía.");
      return;
    }
    appUsers[idx] = normalizeUser({
      ...prev,
      displayName: displayName || prev.displayName,
      password,
      modules: prev.role === "owner" ? allModulesTrue() : modules,
      role: prev.role === "owner" ? "owner" : "user",
      username: prev.role === "owner" ? OWNER_USERNAME : prev.username,
      updatedAt: new Date().toISOString(),
    });
    logActivity("user_update", `Actualizó usuario: ${prev.username}`);
    toast("Usuario actualizado. Clave: " + password);
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
    logActivity("user_create", `Creó usuario: ${username}`);
    toast("Usuario creado. Clave: " + password);
  }
  saveUsers();
  clearUserForm();
  document.getElementById("uPassword").placeholder = "Clave del usuario";
  document.getElementById("uPassword").type = "text";
  const toggle = document.getElementById("btnToggleUserPass");
  if (toggle) toggle.textContent = "Ocultar";
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
  renderActivityLog();
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
  const appHref = (() => {
    try {
      return String(window.location.href || "./");
    } catch (_) {
      return "./";
    }
  })();
  const win = window.open("", "_blank");
  if (!win) {
    toast("Permite ventanas emergentes para imprimir, o elige una impresora en el diálogo del sistema.");
    return null;
  }
  win.document.write(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
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
  .print-bar{position:sticky;top:0;z-index:20;display:flex;flex-wrap:wrap;gap:10px;align-items:center;background:#111;color:#fff;padding:12px;margin:-22px -22px 18px;border-bottom:1px solid #333}
  .print-bar button{padding:12px 16px;font-size:15px;font-weight:800;border:0;border-radius:10px;cursor:pointer}
  .print-bar .btn-back{background:#fff;color:#111}
  .print-bar .btn-print{background:#d41414;color:#fff}
  .print-bar .hint{font-size:12px;color:#ccc;flex:1;min-width:160px}
  @media print{body{padding:0} .no-print{display:none !important}}
</style></head><body>
  <div class="print-bar no-print">
    <button type="button" class="btn-back" id="btnPrintBack">← Volver a la aplicación</button>
    <button type="button" class="btn-print" id="btnPrintNow">Imprimir ahora</button>
    <span class="hint">Elige impresora USB, Wi‑Fi o PDF. Luego pulsa Volver.</span>
  </div>
  <div class="brand">
    <img src="logo.jpg" alt="RFS" />
    <div>
      <h1>Reaction Force Security</h1>
      <div>${escapeHtml(title)}</div>
    </div>
  </div>
  ${bodyHtml}
  <p class="footer">Impreso: ${escapeHtml(new Date().toLocaleString("es"))} · Uso interno</p>
  <div class="no-print" style="margin-top:20px">
    <button type="button" id="btnPrintBackBottom" style="padding:12px 16px;font-weight:800;font-size:15px;border-radius:10px;border:1px solid #111;background:#fff;cursor:pointer">← Volver a la aplicación</button>
  </div>
  <script>
    (function () {
      var appHref = ${JSON.stringify(appHref)};
      function goBackToApp() {
        try {
          if (window.opener && !window.opener.closed) {
            try { window.opener.focus(); } catch (e1) {}
            window.close();
            setTimeout(function () {
              try { window.location.replace(appHref); } catch (e2) {}
            }, 200);
            return;
          }
        } catch (e3) {}
        try {
          if (history.length > 1) {
            history.back();
            setTimeout(function () {
              try { window.location.replace(appHref); } catch (e4) {}
            }, 250);
            return;
          }
        } catch (e5) {}
        try { window.location.replace(appHref); } catch (e6) {}
      }
      var backTop = document.getElementById("btnPrintBack");
      var backBottom = document.getElementById("btnPrintBackBottom");
      var printBtn = document.getElementById("btnPrintNow");
      if (backTop) backTop.addEventListener("click", goBackToApp);
      if (backBottom) backBottom.addEventListener("click", goBackToApp);
      if (printBtn) printBtn.addEventListener("click", function () { window.print(); });
      setTimeout(function () {
        try { window.focus(); window.print(); } catch (e7) {}
      }, 350);
    })();
  </script>
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
  const showMoney = canSeeClientMoney();
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
        ${showMoney ? `<td class="right">${money(p.priceMonth)}</td>` : ""}
      </tr>`;
    })
    .join("");
  openPrintWindow("Listado de clientes", `
    <h2>Clientes activos: ${posts.length}</h2>
    <table>
      <thead><tr><th>No.</th><th>Cliente / Sitio</th><th>Vigilantes</th><th>Supervisor</th><th>Tel.</th><th>Estado</th>${showMoney ? `<th class="right">Mes</th>` : ""}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${showMoney ? 7 : 6}">Sin clientes</td></tr>`}</tbody>
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
  // Hoja completa de contratación / emergencia (exige foto)
  printEmployeeHireSheet(emp);
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
  if (id === "cajaView") return printCajaSheet();
  if (id === "monoReportDetailView") return printMonoReport();
  if (id === "monorrielView" || id === "monoStaffView") return printMonorrielIndexSheet();
  if (id === "detailView") {
    const post = getPost(selectedId);
    if (!post) return toast("No hay ficha para imprimir.");
    ensureClientNumbers(false);
    const moneyBlock = canSeeClientMoney()
      ? `<div><strong>Mes:</strong><br/>${money(post.priceMonth)}</div>`
      : "";
    return openPrintWindow(`Cliente #${post.clientNumber || "—"} ${post.site}`, `
      <h2>#${escapeHtml(String(post.clientNumber || "—"))} ${escapeHtml(post.site)}</h2>
      <div class="meta">
        <div><strong>Supervisor:</strong><br/>${escapeHtml(post.supervisor || "—")}</div>
        <div><strong>Horario:</strong><br/>${escapeHtml(post.shift || "—")}</div>
        <div><strong>Servicio:</strong><br/>${escapeHtml(serviceLabel(post.serviceType))}</div>
        <div><strong>Estado:</strong><br/>${escapeHtml(STATUS_LABEL[post.status] || post.status)}</div>
        ${moneyBlock}
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

/* ==== LA VEGA AUTOPISTA ==== */
const LVA_KEY = "rfs-ops-lva";
const LVA_SITE = "La Vega Autopista";
const MAX_LVA_HISTORY = 200;

let lvaState = {
  posts: [],
  staff: [],
  history: [],
};

function emptyLvaState() {
  return { posts: [], staff: [], history: [] };
}

function normalizeLvaPost(p = {}) {
  return {
    id: p.id || `lva-post-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: String(p.name || "").trim(),
    note: String(p.note || "").trim(),
    createdAt: p.createdAt || new Date().toISOString(),
  };
}

function normalizeLvaStaff(s = {}) {
  return {
    id: s.id || `lva-staff-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    postId: s.postId || "",
    postName: String(s.postName || "").trim(),
    name: String(s.name || "").trim(),
    phone: String(s.phone || "").trim(),
    cedula: String(s.cedula || "").trim(),
    employeeId: s.employeeId || "",
    active: s.active === false ? false : true,
    createdAt: s.createdAt || new Date().toISOString(),
    updatedAt: s.updatedAt || new Date().toISOString(),
  };
}

function normalizeLvaHistory(h = {}) {
  return {
    id: h.id || `lva-h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    at: h.at || new Date().toISOString(),
    userName: h.userName || "",
    action: String(h.action || "").trim(),
    detail: String(h.detail || "").slice(0, 280),
  };
}

function normalizeLvaState(raw = {}) {
  return {
    posts: Array.isArray(raw.posts) ? raw.posts.map(normalizeLvaPost).filter((p) => p.name) : [],
    staff: Array.isArray(raw.staff) ? raw.staff.map(normalizeLvaStaff).filter((s) => s.name) : [],
    history: Array.isArray(raw.history)
      ? raw.history.map(normalizeLvaHistory).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, MAX_LVA_HISTORY)
      : [],
  };
}

function saveLvaState(push = true) {
  lvaState = normalizeLvaState(lvaState);
  localStorage.setItem(LVA_KEY, JSON.stringify(lvaState));
  if (push) queueCloudSave();
}

function applyRemoteLva(remote) {
  if (!remote || typeof remote !== "object") return false;
  const prev = JSON.stringify(lvaState);
  const remoteNorm = normalizeLvaState(remote);
  const hasRemoteData = remoteNorm.posts.length || remoteNorm.staff.length || remoteNorm.history.length;
  if (!hasRemoteData) return false;

  const histMap = new Map();
  [...(lvaState.history || []), ...(remoteNorm.history || [])].forEach((h) => {
    if (h && h.id) histMap.set(h.id, normalizeLvaHistory(h));
  });

  // Puestos/empleados: la nube manda (todas las PCs ven lo mismo)
  lvaState = normalizeLvaState({
    posts: remoteNorm.posts,
    staff: remoteNorm.staff,
    history: [...histMap.values()],
  });
  localStorage.setItem(LVA_KEY, JSON.stringify(lvaState));
  return JSON.stringify(lvaState) !== prev;
}

function pushLvaHistory(action, detail) {
  const entry = normalizeLvaHistory({
    action,
    detail,
    userName: currentUser ? currentUser.displayName || currentUser.username : "sistema",
  });
  lvaState.history = [entry, ...(lvaState.history || [])].slice(0, MAX_LVA_HISTORY);
  logActivity("lva_change", `${action}: ${detail}`);
}

function upsertEmployeeFromLva(staff) {
  const name = (staff.name || "").trim();
  if (!name) return null;
  const key = employeeKey(name);
  const keyBase = employeeKey(monoBaseName(name));
  let idx = employees.findIndex(
    (e) => employeeKey(e.name) === key || employeeKey(monoBaseName(e.name)) === keyBase
  );
  if (idx >= 0) {
    const cur = employees[idx];
    employees[idx] = normalizeEmployee({
      ...cur,
      phone: staff.phone || cur.phone,
      cedula: staff.cedula || cur.cedula,
      sites: [...new Set([...(cur.sites || []), LVA_SITE])],
      roles: [...new Set([...(cur.roles || []), LVA_SITE])],
      status: cur.status === "inactive" ? "inactive" : "active",
      updatedAt: new Date().toISOString(),
    });
    return employees[idx];
  }
  const emp = normalizeEmployee({
    name,
    phone: staff.phone || "",
    cedula: staff.cedula || "",
    sites: [LVA_SITE],
    roles: [LVA_SITE],
    status: "active",
  });
  employees.unshift(emp);
  employees.sort((a, b) => a.name.localeCompare(b.name, "es"));
  return emp;
}

function removeLvaSiteFromEmployee(employeeIdOrName) {
  const idx = employees.findIndex(
    (e) => e.id === employeeIdOrName || employeeKey(e.name) === employeeKey(employeeIdOrName)
  );
  if (idx < 0) return;
  const cur = employees[idx];
  employees[idx] = normalizeEmployee({
    ...cur,
    sites: (cur.sites || []).filter((s) => s !== LVA_SITE),
    roles: (cur.roles || []).filter((r) => r !== LVA_SITE),
    updatedAt: new Date().toISOString(),
  });
}

function getLvaPostName(postId) {
  const p = lvaState.posts.find((x) => x.id === postId);
  return p ? p.name : "";
}

function fillLvaPostSelect() {
  const sel = document.getElementById("lvaStaffPost");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML =
    `<option value="">Selecciona puesto</option>` +
    lvaState.posts
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`)
      .join("");
  if (current && [...sel.options].some((o) => o.value === current)) sel.value = current;
}

function renderLvaPosts() {
  const list = document.getElementById("lvaPostsList");
  if (!list) return;
  const rows = lvaState.posts
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "es"))
    .map((p) => {
      const count = lvaState.staff.filter((s) => s.active && s.postId === p.id).length;
      return `<article class="report-card">
        <div class="row">
          <div>
            <h3>${escapeHtml(p.name)}</h3>
            <p class="muted tight">${count} empleado(s) asignado(s)${p.note ? ` · ${escapeHtml(p.note)}` : ""}</p>
          </div>
        </div>
        <div class="admin-actions">
          <button class="btn danger btn-lva-del-post" type="button" data-id="${escapeHtml(p.id)}">Quitar puesto</button>
        </div>
      </article>`;
    })
    .join("");
  list.innerHTML = rows || `<p class="empty">Aún no hay puestos. Agrega el primero abajo.</p>`;
  list.querySelectorAll(".btn-lva-del-post").forEach((btn) => {
    btn.addEventListener("click", () => removeLvaPost(btn.dataset.id));
  });
}

function renderLvaStaff() {
  const list = document.getElementById("lvaStaffList");
  if (!list) return;
  const active = lvaState.staff.filter((s) => s.active);
  const rows = active
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "es"))
    .map((s) => {
      const post = s.postName || getLvaPostName(s.postId) || "Sin puesto";
      return `<article class="report-card">
        <div class="row">
          <div>
            <h3>${escapeHtml(s.name)}</h3>
            <p><strong>Puesto:</strong> ${escapeHtml(post)}</p>
            <p class="muted tight">Tel: ${escapeHtml(s.phone || "—")} · Cédula: ${escapeHtml(s.cedula || "—")}</p>
          </div>
        </div>
        <div class="admin-actions">
          <button class="btn secondary btn-lva-open-emp" type="button" data-id="${escapeHtml(s.employeeId || "")}" data-name="${escapeHtml(s.name)}">Ver en Empleados</button>
          <button class="btn danger btn-lva-del-staff" type="button" data-id="${escapeHtml(s.id)}">Quitar</button>
        </div>
      </article>`;
    })
    .join("");
  list.innerHTML = rows || `<p class="empty">No hay empleados en este proyecto todavía.</p>`;
  const summary = document.getElementById("lvaSummary");
  if (summary) {
    summary.textContent = `${lvaState.posts.length} puestos · ${active.length} empleados en el proyecto`;
  }
  list.querySelectorAll(".btn-lva-del-staff").forEach((btn) => {
    btn.addEventListener("click", () => removeLvaStaff(btn.dataset.id));
  });
  list.querySelectorAll(".btn-lva-open-emp").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const name = btn.dataset.name;
      let emp = id ? employees.find((e) => e.id === id) : null;
      if (!emp && name) {
        emp = employees.find(
          (e) => employeeKey(e.name) === employeeKey(name) || employeeKey(monoBaseName(e.name)) === employeeKey(monoBaseName(name))
        );
      }
      if (!emp) {
        toast("No está en la lista general todavía.");
        return;
      }
      openEmployeeDetail(emp.id);
    });
  });
}

function renderLvaHistory() {
  const list = document.getElementById("lvaHistoryList");
  if (!list) return;
  list.innerHTML = lvaState.history.length
    ? lvaState.history
        .map((h) => {
          const when = (h.at || "").replace("T", " ").slice(0, 16);
          return `<article class="report-card">
            <h3>${escapeHtml(h.action)}</h3>
            <p class="muted tight">${escapeHtml(when)} · ${escapeHtml(h.userName || "Usuario")}</p>
            <p style="margin-top:6px">${escapeHtml(h.detail)}</p>
          </article>`;
        })
        .join("")
    : `<p class="empty">Sin cambios registrados.</p>`;
}

function renderLvaModule() {
  if (!canAccessModule("lavega")) return;
  fillLvaPostSelect();
  renderLvaPosts();
  renderLvaStaff();
  renderLvaHistory();
}

function addLvaPost() {
  const name = document.getElementById("lvaPostName").value.trim();
  const note = document.getElementById("lvaPostNote").value.trim();
  if (!name) {
    toast("Escribe el nombre del puesto.");
    return;
  }
  const dup = lvaState.posts.find((p) => employeeKey(p.name) === employeeKey(name));
  if (dup) {
    toast("Ese puesto ya existe.");
    return;
  }
  const post = normalizeLvaPost({ name, note });
  lvaState.posts.push(post);
  pushLvaHistory("Puesto agregado", post.name);
  document.getElementById("lvaPostName").value = "";
  document.getElementById("lvaPostNote").value = "";
  saveLvaState(true);
  renderLvaModule();
  toast("Puesto agregado.");
}

function removeLvaPost(postId) {
  const post = lvaState.posts.find((p) => p.id === postId);
  if (!post) return;
  const assigned = lvaState.staff.filter((s) => s.active && s.postId === postId);
  const ok = window.confirm(
    assigned.length
      ? `El puesto "${post.name}" tiene ${assigned.length} empleado(s). Se quitarán del proyecto. ¿Continuar?`
      : `¿Quitar el puesto "${post.name}"?`
  );
  if (!ok) return;
  assigned.forEach((s) => {
    s.active = false;
    s.updatedAt = new Date().toISOString();
    if (s.employeeId) removeLvaSiteFromEmployee(s.employeeId);
    else removeLvaSiteFromEmployee(s.name);
  });
  lvaState.posts = lvaState.posts.filter((p) => p.id !== postId);
  pushLvaHistory("Puesto quitado", `${post.name}${assigned.length ? ` (${assigned.length} empleados liberados)` : ""}`);
  saveEmployees();
  saveLvaState(true);
  renderEmployees();
  renderLvaModule();
  toast("Puesto quitado.");
}

function addLvaStaff() {
  if (!canWriteEmployees()) {
    toast("No tienes permiso para crear empleados.");
    return;
  }
  const name = document.getElementById("lvaStaffName").value.trim();
  const postId = document.getElementById("lvaStaffPost").value;
  const phone = document.getElementById("lvaStaffPhone").value.trim();
  const cedula = document.getElementById("lvaStaffCedula").value.trim();
  if (!name) {
    toast("Escribe el nombre del empleado.");
    return;
  }
  if (!postId) {
    toast("Selecciona el puesto.");
    return;
  }
  const postName = getLvaPostName(postId);
  if (!postName) {
    toast("El puesto no es válido.");
    return;
  }
  const similar = findSimilarEmployees(name);
  const exactInLva = lvaState.staff.find(
    (s) => s.active && employeeKey(s.name) === employeeKey(name)
  );
  if (exactInLva) {
    toast("Ese empleado ya está en La Vega Autopista.");
    return;
  }
  if (similar.length) {
    const msg = "Hay nombres parecidos en empleados:\n" + formatDupHint(similar) + "\n\n¿Agregar de todos modos a este proyecto?";
    if (!window.confirm(msg)) return;
  }
  let staff = normalizeLvaStaff({
    name,
    postId,
    postName,
    phone,
    cedula,
    active: true,
  });
  const emp = upsertEmployeeFromLva(staff);
  staff.employeeId = emp ? emp.id : "";
  lvaState.staff.push(staff);
  pushLvaHistory("Empleado agregado", `${name} → ${postName}`);
  document.getElementById("lvaStaffName").value = "";
  document.getElementById("lvaStaffPhone").value = "";
  document.getElementById("lvaStaffCedula").value = "";
  saveEmployees();
  saveLvaState(true);
  renderEmployees();
  renderLvaModule();
  toast("Empleado agregado al proyecto y a la lista general.");
}

function removeLvaStaff(staffId) {
  const idx = lvaState.staff.findIndex((s) => s.id === staffId);
  if (idx < 0) return;
  const staff = lvaState.staff[idx];
  const ok = window.confirm(`¿Quitar a "${staff.name}" de La Vega Autopista? Seguirá en Empleados generales.`);
  if (!ok) return;
  lvaState.staff[idx] = {
    ...staff,
    active: false,
    updatedAt: new Date().toISOString(),
  };
  if (staff.employeeId) removeLvaSiteFromEmployee(staff.employeeId);
  else removeLvaSiteFromEmployee(staff.name);
  pushLvaHistory("Empleado quitado", `${staff.name} (puesto: ${staff.postName || getLvaPostName(staff.postId) || "—"})`);
  saveEmployees();
  saveLvaState(true);
  renderEmployees();
  renderLvaModule();
  toast("Empleado quitado del proyecto.");
}

function bindLvaUi() {
  if (!document.getElementById("lvaView")) return;
  document.getElementById("btnLvaAddPost")?.addEventListener("click", addLvaPost);
  document.getElementById("btnLvaAddStaff")?.addEventListener("click", addLvaStaff);
  document.getElementById("lvaPostName")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addLvaPost();
    }
  });
}
/* ==== FIN LA VEGA AUTOPISTA ==== */




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

/* ==== RADIO EN VIVO ==== */
const RADIO_KEY = "rfs-ops-radio";
const RADIO_VOL_KEY = "rfs-ops-radio-volume";
const DEFAULT_RADIO_STREAM = "https://ice1.somafm.com/groovesalad-128-mp3";

let radioState = {
  stationName: "RFS Radio",
  streamUrl: DEFAULT_RADIO_STREAM,
  enabled: true,
  playing: false,
  updatedAt: null,
  updatedBy: "",
};

let radioListening = false;
let radioPollTimer = null;
let radioSyncLock = false;

function emptyRadioState() {
  return {
    stationName: "RFS Radio",
    streamUrl: DEFAULT_RADIO_STREAM,
    enabled: true,
    playing: false,
    updatedAt: null,
    updatedBy: "",
  };
}

function cleanStreamUrl(raw) {
  let url = String(raw || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url) && /^[\w.-]+\.[a-z]{2,}/i.test(url)) {
    url = `https://${url}`;
  }
  return url;
}

function normalizeRadioState(r = {}) {
  const streamUrl = cleanStreamUrl(r.streamUrl || r.url || r.stream || "") || DEFAULT_RADIO_STREAM;
  return {
    stationName: String(r.stationName || "RFS Radio").trim() || "RFS Radio",
    streamUrl,
    enabled: r.enabled === false ? false : true,
    playing: !!r.playing,
    updatedAt: r.updatedAt || null,
    updatedBy: r.updatedBy || "",
  };
}

function radioSignature(state = radioState) {
  return [state.playing ? "1" : "0", state.streamUrl || "", state.stationName || ""].join("|");
}

function canControlRadio() {
  return !!(currentUser && (currentUser.role === "owner" || canAccessModule("admin")));
}

function saveRadioState(push = true) {
  radioState = normalizeRadioState(radioState);
  radioState.updatedAt = new Date().toISOString();
  radioState.updatedBy = currentUser ? currentUser.username || currentUser.displayName : "";
  localStorage.setItem(RADIO_KEY, JSON.stringify(radioState));
  if (push) {
    // Guardado inmediato para no perder la URL si hay otra sync en curso
    pushToCloud().catch(() => queueCloudSave());
  }
}

function applyRemoteRadio(remoteRadio) {
  if (!remoteRadio || typeof remoteRadio !== "object") return false;
  const remote = normalizeRadioState(remoteRadio);
  const local = normalizeRadioState(radioState);
  const remoteHasUrl = !!(remoteRadio.streamUrl || remoteRadio.url || remoteRadio.stream);
  // No dejar que una nube vacía borre una URL local ya configurada
  if (!remoteHasUrl && local.streamUrl) {
    if (!radioState.streamUrl) {
      radioState = local;
      localStorage.setItem(RADIO_KEY, JSON.stringify(radioState));
      return true;
    }
    return false;
  }
  const remoteTs = Date.parse(remote.updatedAt || "") || 0;
  const localTs = Date.parse(local.updatedAt || "") || 0;
  // Si lo local es más reciente, conservar local y re-subir
  if (local.streamUrl && localTs > remoteTs && local.streamUrl !== remote.streamUrl) {
    return false;
  }
  const prevSig = radioSignature(radioState);
  radioState = remote;
  localStorage.setItem(RADIO_KEY, JSON.stringify(radioState));
  return prevSig !== radioSignature(radioState);
}

function getRadioAudio() {
  return document.getElementById("radioAudio");
}

function setRadioEq(on) {
  const eq = document.getElementById("radioEq");
  if (eq) eq.classList.toggle("on", !!on);
}

async function syncRadioPlayback(forceReload = false) {
  const audio = getRadioAudio();
  if (!audio || radioSyncLock) return;
  radioSyncLock = true;
  try {
    const title = document.getElementById("radioNowTitle");
    const meta = document.getElementById("radioNowMeta");
    const station = document.getElementById("radioStationLabel");
    if (station) station.textContent = radioState.stationName || "RFS Radio";

    if (!radioState.streamUrl || !radioState.enabled) {
      if (title) title.textContent = "Sin stream asignado";
      if (meta) meta.textContent = "El administrador aún no ha puesto una URL continua.";
      setRadioEq(false);
      if (radioListening) audio.pause();
      return;
    }

    if (title) title.textContent = radioState.stationName || "Stream en vivo";
    if (meta) {
      meta.textContent = radioState.playing
        ? `En el aire · stream continuo${radioState.updatedBy ? ` · por @${radioState.updatedBy}` : ""}`
        : "En pausa (el admin detuvo la radio)";
    }

    const urlChanged = audio.getAttribute("data-url") !== radioState.streamUrl;
    if (urlChanged || forceReload) {
      audio.setAttribute("data-url", radioState.streamUrl);
      audio.src = radioState.streamUrl;
      try {
        audio.load();
      } catch (_) {}
    }

    const volEl = document.getElementById("radioVolume");
    const vol = volEl ? Number(volEl.value) / 100 : 0.8;
    audio.volume = Math.min(1, Math.max(0, vol));

    if (!radioListening) {
      setRadioEq(false);
      return;
    }

    if (!radioState.playing) {
      audio.pause();
      setRadioEq(false);
      return;
    }

    try {
      await audio.play();
      setRadioEq(true);
    } catch (_) {
      setRadioEq(false);
      radioListening = false;
      updateRadioListenButtons();
      toast("Pulsa “Unirme a la radio” para escuchar (el navegador lo pide).");
    }
  } finally {
    radioSyncLock = false;
  }
}

function updateRadioListenButtons() {
  const join = document.getElementById("btnRadioJoin");
  const leave = document.getElementById("btnRadioLeave");
  if (join) join.hidden = radioListening;
  if (leave) leave.hidden = !radioListening;
}

function renderRadioStreamInfo() {
  const list = document.getElementById("radioStreamInfo");
  if (!list) return;
  if (!radioState.streamUrl) {
    list.innerHTML = `<p class="empty">No hay URL de stream configurada.</p>`;
    return;
  }
  list.innerHTML = `<article class="radio-track-row ${radioState.playing ? "on-air" : ""}">
    <div>
      <strong>${escapeHtml(radioState.stationName || "RFS Radio")}</strong>
      <div class="meta">${radioState.playing ? "● En el aire" : "En pausa"} · ${escapeHtml(radioState.streamUrl)}</div>
    </div>
  </article>`;
}

function renderRadioAdminPanel(forceFields = false) {
  const card = document.getElementById("radioAdminCard");
  if (!card) return;
  const show = canControlRadio();
  card.hidden = !show;
  if (!show) return;
  const nameEl = document.getElementById("radioStationName");
  const urlEl = document.getElementById("radioStreamUrl");
  const active = document.activeElement;
  // No pisar lo que el admin está escribiendo
  if (nameEl && (forceFields || active !== nameEl)) nameEl.value = radioState.stationName || "RFS Radio";
  if (urlEl && (forceFields || active !== urlEl)) urlEl.value = radioState.streamUrl || DEFAULT_RADIO_STREAM;
}

function renderRadioModule(forceFields = false) {
  if (!canAccessModule("radio")) return;
  const summary = document.getElementById("radioSummary");
  if (summary) {
    summary.textContent = radioState.playing && radioState.streamUrl
      ? `En vivo: ${radioState.stationName || "RFS Radio"}`
      : "Todos escuchan el mismo stream asignado por el administrador.";
  }
  renderRadioStreamInfo();
  renderRadioAdminPanel(forceFields);
  updateRadioListenButtons();
  syncRadioPlayback(false).catch(() => {});
}

function adminCaptureMetaFromForm() {
  const nameEl = document.getElementById("radioStationName");
  const urlEl = document.getElementById("radioStreamUrl");
  const name = (nameEl && nameEl.value ? nameEl.value : "").trim();
  let streamUrl = cleanStreamUrl(urlEl && urlEl.value ? urlEl.value : "");
  if (!streamUrl) streamUrl = radioState.streamUrl || DEFAULT_RADIO_STREAM;
  if (name) radioState.stationName = name;
  radioState.streamUrl = streamUrl;
  if (urlEl) urlEl.value = streamUrl;
}

function adminRadioSaveMeta() {
  if (!canControlRadio()) {
    toast("Solo el administrador puede configurar la radio.");
    return;
  }
  adminCaptureMetaFromForm();
  if (!radioState.streamUrl || !/^https?:\/\//i.test(radioState.streamUrl)) {
    toast("Coloca una URL válida (http:// o https://).");
    return;
  }
  saveRadioState(true);
  renderRadioModule(true);
  syncRadioPlayback(true).catch(() => {});
  toast("URL guardada: " + radioState.streamUrl);
}

function adminRadioPlay() {
  if (!canControlRadio()) {
    toast("Solo el administrador puede poner Play para todos.");
    return;
  }
  adminCaptureMetaFromForm();
  if (!radioState.streamUrl) {
    radioState.streamUrl = DEFAULT_RADIO_STREAM;
  }
  if (!/^https?:\/\//i.test(radioState.streamUrl)) {
    toast("La URL debe empezar con http:// o https://");
    return;
  }
  radioState.playing = true;
  saveRadioState(true);
  renderRadioModule(true);
  syncRadioPlayback(true).catch(() => {});
  toast("Radio en vivo: " + radioState.streamUrl);
}

function adminRadioPause() {
  if (!canControlRadio()) return;
  radioState.playing = false;
  saveRadioState(true);
  renderRadioModule();
  syncRadioPlayback(false).catch(() => {});
  toast("Radio en pausa.");
}

function joinRadio() {
  if (!currentUser) {
    toast("Inicia sesión para escuchar.");
    return;
  }
  radioListening = true;
  updateRadioListenButtons();
  syncRadioPlayback(true).catch(() => {});
  toast("Te uniste a la radio.");
}

function leaveRadio() {
  radioListening = false;
  const audio = getRadioAudio();
  if (audio) audio.pause();
  setRadioEq(false);
  updateRadioListenButtons();
}

function startRadioPolling() {
  stopRadioPolling();
  radioPollTimer = setInterval(() => {
    if (!currentUser || !canAccessModule("radio")) return;
    if (!window.RFSCloudApi) return;
    window.RFSCloudApi
      .loadCloud()
      .then((remote) => {
        if (!remote || remote.empty) return;
        const changed = applyRemoteRadio(remote.radio);
        if (changed) {
          renderRadioModule();
          syncRadioPlayback(true).catch(() => {});
        } else if (radioListening && radioState.playing) {
          syncRadioPlayback(false).catch(() => {});
        }
      })
      .catch(() => {});
  }, 8000);
}

function stopRadioPolling() {
  if (radioPollTimer) {
    clearInterval(radioPollTimer);
    radioPollTimer = null;
  }
}

function bindRadioUi() {
  if (!document.getElementById("radioView")) return;
  document.getElementById("btnRadioJoin")?.addEventListener("click", joinRadio);
  document.getElementById("btnRadioLeave")?.addEventListener("click", leaveRadio);
  document.getElementById("btnRefreshRadio")?.addEventListener("click", () => {
    if (!window.RFSCloudApi) {
      renderRadioModule();
      return;
    }
    window.RFSCloudApi
      .loadCloud()
      .then((remote) => {
        if (remote && remote.radio) applyRemoteRadio(remote.radio);
        renderRadioModule();
        syncRadioPlayback(true).catch(() => {});
        toast("Radio actualizada.");
      })
      .catch(() => {
        renderRadioModule();
        toast("Sin conexión. Mostrando radio local.");
      });
  });
  document.getElementById("radioVolume")?.addEventListener("input", (e) => {
    const v = Number(e.target.value) || 0;
    localStorage.setItem(RADIO_VOL_KEY, String(v));
    const audio = getRadioAudio();
    if (audio) audio.volume = Math.min(1, Math.max(0, v / 100));
  });
  document.getElementById("btnRadioPlay")?.addEventListener("click", adminRadioPlay);
  document.getElementById("btnRadioPause")?.addEventListener("click", adminRadioPause);
  document.getElementById("btnRadioSaveMeta")?.addEventListener("click", adminRadioSaveMeta);
  const urlEl = document.getElementById("radioStreamUrl");
  if (urlEl) {
    urlEl.addEventListener("change", () => {
      if (!canControlRadio()) return;
      adminCaptureMetaFromForm();
      saveRadioState(true);
    });
    urlEl.addEventListener("blur", () => {
      if (!canControlRadio()) return;
      adminCaptureMetaFromForm();
      if (urlEl.value !== radioState.streamUrl) urlEl.value = radioState.streamUrl;
    });
  }
  document.querySelectorAll("[data-radio-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!canControlRadio()) return;
      const preset = btn.getAttribute("data-radio-preset");
      const name = btn.getAttribute("data-radio-name") || "RFS Radio";
      if (!preset) return;
      radioState.stationName = name;
      radioState.streamUrl = cleanStreamUrl(preset);
      radioState.playing = true;
      saveRadioState(true);
      renderRadioModule(true);
      syncRadioPlayback(true).catch(() => {});
      toast("Radio lista: " + radioState.streamUrl);
    });
  });
  const savedVol = Number(localStorage.getItem(RADIO_VOL_KEY));
  const volEl = document.getElementById("radioVolume");
  if (volEl && Number.isFinite(savedVol)) volEl.value = String(Math.min(100, Math.max(0, savedVol)));
  startRadioPolling();
}
/* ==== FIN RADIO ==== */








/* ==== MÓDULO CAJA CHICA ==== */
const PETTY_KEY = "rfs-ops-petty-cash";
const CAJA_CLOSE_HOUR = 17; // 5:00 p.m.

const CAJA_CATEGORIES = [
  { key: "gasolina", label: "Gasolina" },
  { key: "uniformes", label: "Uniformes" },
  { key: "transporte", label: "Transporte / peaje" },
  { key: "comida", label: "Alimentos / merienda" },
  { key: "materiales", label: "Materiales / equipos" },
  { key: "mantenimiento", label: "Mantenimiento" },
  { key: "servicios", label: "Pago de días" },
  { key: "otros", label: "Otros" },
];

/** Subir este número vacía gastos de prueba antiguos en todos los dispositivos al sincronizar */
const CAJA_RESET_EPOCH = 2;

let pettyCash = { expenses: [], closings: [], people: [], deletedExpenses: [], epoch: CAJA_RESET_EPOCH };
let cajaTab = "hoy";
let pendingCajaCheckPhoto = null;
let selectedCajaPersonId = null;

function emptyPettyCash() {
  return { expenses: [], closings: [], people: [], deletedExpenses: [], epoch: CAJA_RESET_EPOCH };
}

function cajaCategoryLabel(key) {
  const found = CAJA_CATEGORIES.find((c) => c.key === key);
  return found ? found.label : key || "Otros";
}

function cajaNameKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCajaPerson(p = {}) {
  const name = String(p.name || "").trim();
  const code = String(p.code || "").trim().toUpperCase();
  return {
    id: p.id || `caja-p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    code: code || "",
    name,
    nameKey: cajaNameKey(name),
    createdAt: p.createdAt || new Date().toISOString(),
  };
}

function normalizeCajaExpense(e = {}) {
  const amount = Number(e.amount);
  const date = String(e.date || "").slice(0, 10) || localDateISO();
  const category = CAJA_CATEGORIES.some((c) => c.key === e.category) ? e.category : "otros";
  const checkPhoto = typeof e.checkPhoto === "string" && e.checkPhoto.startsWith("data:image") ? e.checkPhoto : "";
  return {
    id: e.id || `caja-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date,
    createdAt: e.createdAt || new Date().toISOString(),
    recipient: String(e.recipient || "").trim(),
    personId: String(e.personId || "").trim(),
    personCode: String(e.personCode || "").trim().toUpperCase(),
    purpose: String(e.purpose || "").trim(),
    amount: Number.isFinite(amount) ? amount : 0,
    category,
    note: String(e.note || "").trim(),
    createdBy: e.createdBy || "",
    receiptNo: e.receiptNo || "",
    checkPhoto,
    checkPhotoName: checkPhoto ? String(e.checkPhotoName || "cheque.jpg").trim() : "",
  };
}

function normalizeCajaClosing(c = {}) {
  const closingAmount = Number(c.closingAmount);
  const totalExpenses = Number(c.totalExpenses);
  const totalGasolina = Number(c.totalGasolina);
  const totalOther = Number(c.totalOther);
  return {
    id: c.id || `cierre-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date: String(c.date || "").slice(0, 10),
    closedAt: c.closedAt || new Date().toISOString(),
    closedBy: c.closedBy || "",
    totalExpenses: Number.isFinite(totalExpenses) ? totalExpenses : 0,
    totalGasolina: Number.isFinite(totalGasolina) ? totalGasolina : 0,
    totalOther: Number.isFinite(totalOther) ? totalOther : 0,
    closingAmount: Number.isFinite(closingAmount) ? closingAmount : 0,
    note: String(c.note || "").trim(),
    expenseCount: Number(c.expenseCount) || 0,
  };
}

function nextCajaPersonCode(people) {
  let max = 0;
  (people || []).forEach((p) => {
    const m = String(p.code || "").match(/^P-(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  });
  return `P-${String(max + 1).padStart(4, "0")}`;
}

function findCajaPersonByCode(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;
  return (pettyCash.people || []).find((p) => String(p.code).toUpperCase() === c) || null;
}

function findCajaPersonByName(name) {
  const key = cajaNameKey(name);
  if (!key) return null;
  return (pettyCash.people || []).find((p) => p.nameKey === key) || null;
}

function findCajaPersonById(id) {
  if (!id) return null;
  return (pettyCash.people || []).find((p) => p.id === id) || null;
}

function ensureCajaPersonForName(name, peopleBag = null) {
  const clean = String(name || "").trim();
  if (!clean) return null;
  const list = peopleBag || (pettyCash.people = pettyCash.people || []);
  const key = cajaNameKey(clean);
  let person = list.find((p) => p.nameKey === key);
  if (person) {
    if (!person.name && clean) person.name = clean;
    return person;
  }
  person = normalizeCajaPerson({
    name: clean,
    code: nextCajaPersonCode(list),
    createdAt: new Date().toISOString(),
  });
  list.push(person);
  return person;
}

function backfillCajaPeople(expenses, peopleIn) {
  const people = Array.isArray(peopleIn) ? peopleIn.map(normalizeCajaPerson).filter((p) => p.name || p.code) : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const byCode = new Map(people.filter((p) => p.code).map((p) => [p.code.toUpperCase(), p]));
  const byName = new Map(people.filter((p) => p.nameKey).map((p) => [p.nameKey, p]));

  const ensureFromExpense = (e) => {
    if (e.personId && byId.has(e.personId)) return byId.get(e.personId);
    if (e.personCode && byCode.has(e.personCode.toUpperCase())) return byCode.get(e.personCode.toUpperCase());
    const key = cajaNameKey(e.recipient);
    if (key && byName.has(key)) return byName.get(key);
    if (!e.recipient && !e.personCode) return null;
    const person = normalizeCajaPerson({
      id: e.personId || undefined,
      name: e.recipient || e.personCode || "Sin nombre",
      code: e.personCode || nextCajaPersonCode([...byId.values()]),
      createdAt: e.createdAt,
    });
    if (!person.code) person.code = nextCajaPersonCode([...byId.values()]);
    byId.set(person.id, person);
    byCode.set(person.code.toUpperCase(), person);
    if (person.nameKey) byName.set(person.nameKey, person);
    return person;
  };

  const expensesOut = (expenses || []).map((raw) => {
    const e = normalizeCajaExpense(raw);
    const person = ensureFromExpense(e);
    if (person) {
      e.personId = person.id;
      e.personCode = person.code;
      if (!e.recipient) e.recipient = person.name;
      if (person.name && person.name !== e.recipient) {
        // keep expense recipient as typed; sync person name if empty
      }
    }
    return e;
  });

  return {
    expenses: expensesOut,
    people: [...byId.values()].sort((a, b) => String(a.code).localeCompare(String(b.code))),
  };
}

function normalizeDeletedCajaExpense(e = {}) {
  const base = normalizeCajaExpense(e);
  return {
    ...base,
    deletedAt: e.deletedAt || new Date().toISOString(),
    deletedBy: String(e.deletedBy || "").trim(),
    deleteReason: String(e.deleteReason || "").trim(),
  };
}

function normalizePettyCash(raw = {}) {
  const epoch = Number(raw.epoch) || 1;
  // Descarta gastos/cierres de prueba anteriores al reinicio pedido por el dueño
  if (epoch < CAJA_RESET_EPOCH) {
    return emptyPettyCash();
  }
  const closings = Array.isArray(raw.closings) ? raw.closings.map(normalizeCajaClosing) : [];
  const deletedExpenses = Array.isArray(raw.deletedExpenses)
    ? raw.deletedExpenses.map(normalizeDeletedCajaExpense)
    : [];
  const filled = backfillCajaPeople(raw.expenses || [], raw.people || []);
  // Un gasto activo no debe quedar también en eliminados
  const deletedIds = new Set(deletedExpenses.map((e) => e.id));
  const active = filled.expenses.filter((e) => !deletedIds.has(e.id));
  return {
    expenses: active,
    closings,
    people: filled.people,
    deletedExpenses: deletedExpenses.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt))),
    epoch: CAJA_RESET_EPOCH,
  };
}

function savePettyCash(push = true) {
  pettyCash = normalizePettyCash(pettyCash);
  localStorage.setItem(PETTY_KEY, JSON.stringify(pettyCash));
  if (push) queueCloudSave();
}

function applyRemotePettyCash(remote) {
  const remoteNorm = normalizePettyCash(remote || {});
  const local = normalizePettyCash(pettyCash);
  const deletedMap = new Map();
  [...local.deletedExpenses, ...remoteNorm.deletedExpenses].forEach((e) => {
    if (!e || !e.id) return;
    const prev = deletedMap.get(e.id);
    if (!prev || String(e.deletedAt) > String(prev.deletedAt)) deletedMap.set(e.id, e);
  });
  const deletedIds = new Set(deletedMap.keys());
  const expMap = new Map();
  [...local.expenses, ...remoteNorm.expenses].forEach((e) => {
    if (!e || !e.id || deletedIds.has(e.id)) return;
    const prev = expMap.get(e.id);
    if (!prev || String(e.createdAt) > String(prev.createdAt)) expMap.set(e.id, e);
  });
  const closeMap = new Map();
  [...local.closings, ...remoteNorm.closings].forEach((c) => {
    if (!c || !c.id) return;
    const prev = closeMap.get(c.id);
    if (!prev || String(c.closedAt) > String(prev.closedAt)) closeMap.set(c.id, c);
  });
  // Also unique by date for closings (one closing per day)
  const byDate = new Map();
  [...closeMap.values()].forEach((c) => {
    const prev = byDate.get(c.date);
    if (!prev || String(c.closedAt) > String(prev.closedAt)) byDate.set(c.date, c);
  });
  const peopleMap = new Map();
  [...local.people, ...remoteNorm.people].forEach((p) => {
    if (!p || !p.id) return;
    const prev = peopleMap.get(p.id);
    if (!prev || String(p.createdAt) > String(prev.createdAt)) peopleMap.set(p.id, p);
  });
  // Prefer unique by code
  const byCode = new Map();
  [...peopleMap.values()].forEach((p) => {
    const code = String(p.code || "").toUpperCase();
    if (!code) {
      byCode.set(p.id, p);
      return;
    }
    const prev = byCode.get(code);
    if (!prev || String(p.createdAt) > String(prev.createdAt)) byCode.set(code, p);
  });
  const merged = backfillCajaPeople([...expMap.values()], [...byCode.values()]);
  pettyCash = {
    expenses: merged.expenses.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    closings: [...byDate.values()].sort((a, b) => String(b.date).localeCompare(String(a.date))),
    people: merged.people,
    deletedExpenses: [...deletedMap.values()].sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt))),
    epoch: CAJA_RESET_EPOCH,
  };
  localStorage.setItem(PETTY_KEY, JSON.stringify(pettyCash));
}

function canAccessCajaChica() {
  if (!currentUser) return false;
  if (currentUser.role === "owner") return true;
  // Permiso explícito que el dueño marca en Admin → Usuarios
  return canAccessModule("cajachica");
}

function localDateISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocalDate(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function weekRangeFromPivot(iso) {
  const d = parseLocalDate(iso) || new Date();
  const day = d.getDay(); // 0 Sun
  const diffToMon = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + diffToMon);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { from: localDateISO(start), to: localDateISO(end) };
}

function expensesBetween(from, to) {
  return (pettyCash.expenses || []).filter((e) => e.date >= from && e.date <= to);
}

function expensesOnDate(date) {
  return (pettyCash.expenses || []).filter((e) => e.date === date);
}

function sumExpenses(list) {
  return (list || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
}

function getClosingForDate(date) {
  return (pettyCash.closings || []).find((c) => c.date === date) || null;
}

function nextCajaReceiptNo() {
  const n = (pettyCash.expenses || []).length + (pettyCash.deletedExpenses || []).length + 1;
  return `CC-${String(n).padStart(4, "0")}`;
}

function setCajaTab(tab) {
  cajaTab = tab || "hoy";
  document.querySelectorAll(".caja-tabs .emp-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.cajaTab === cajaTab);
  });
  const map = {
    hoy: "cajaTabHoy",
    personas: "cajaTabPersonas",
    gasolina: "cajaTabGasolina",
    uniformes: "cajaTabUniformes",
    pagodias: "cajaTabPagoDias",
    eliminados: "cajaTabEliminados",
    cierres: "cajaTabCierres",
    semana: "cajaTabSemana",
    mes: "cajaTabMes",
  };
  Object.entries(map).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.hidden = key !== cajaTab;
  });
  renderCajaModule();
}

function expensesForPerson(person) {
  if (!person) return [];
  return (pettyCash.expenses || []).filter(
    (e) => e.personId === person.id || (e.personCode && e.personCode === person.code) || cajaNameKey(e.recipient) === person.nameKey
  );
}

function fillCajaPeopleDatalist() {
  const dl = document.getElementById("cajaPeopleList");
  if (!dl) return;
  const people = [...(pettyCash.people || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));
  dl.innerHTML = people
    .map((p) => `<option value="${escapeHtml(p.code)} — ${escapeHtml(p.name)}"></option>`)
    .join("");
}

function updateCajaPersonCodeHint() {
  const hint = document.getElementById("cajaPersonCodeHint");
  const raw = document.getElementById("cajaRecipient")?.value || "";
  if (!hint) return;
  const person = resolveCajaRecipientPreview(raw);
  if (person) {
    selectedCajaPersonId = person.id;
    hint.textContent = `Código: ${person.code} · ${person.name}`;
  } else if (String(raw).trim()) {
    selectedCajaPersonId = null;
    hint.textContent = "Código: se asignará al guardar (persona nueva)";
  } else {
    selectedCajaPersonId = null;
    hint.textContent = "Código: se asignará al guardar";
  }
}

function resolveCajaRecipientPreview(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;
  const codeOnly = t.match(/^(P-\d+)$/i);
  if (codeOnly) return findCajaPersonByCode(codeOnly[1]);
  const labeled = t.match(/^(P-\d+)\s*[—\-]\s*(.+)$/i);
  if (labeled) return findCajaPersonByCode(labeled[1]) || findCajaPersonByName(labeled[2]);
  return findCajaPersonByName(t);
}

function resolveCajaRecipientForSave(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;
  const preview = resolveCajaRecipientPreview(t);
  if (preview) return preview;
  const labeled = t.match(/^(P-\d+)\s*[—\-]\s*(.+)$/i);
  if (labeled) return ensureCajaPersonForName(labeled[2].trim());
  return ensureCajaPersonForName(t);
}

function clearCajaCheckPhoto() {
  pendingCajaCheckPhoto = null;
  const input = document.getElementById("cajaCheckPhoto");
  if (input) input.value = "";
  const wrap = document.getElementById("cajaCheckPreviewWrap");
  const img = document.getElementById("cajaCheckPreview");
  if (wrap) wrap.hidden = true;
  if (img) img.removeAttribute("src");
}

function renderCajaCheckPreview() {
  const wrap = document.getElementById("cajaCheckPreviewWrap");
  const img = document.getElementById("cajaCheckPreview");
  if (!wrap || !img) return;
  if (pendingCajaCheckPhoto) {
    img.src = pendingCajaCheckPhoto;
    wrap.hidden = false;
  } else {
    wrap.hidden = true;
    img.removeAttribute("src");
  }
}

async function onCajaCheckPhotoSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    pendingCajaCheckPhoto = await compressImage(file, 1280, 0.7);
    renderCajaCheckPreview();
    toast("Foto del cheque lista.");
  } catch (_) {
    toast("No se pudo procesar la foto del cheque.");
    clearCajaCheckPhoto();
  }
}

function renderCajaCloseBanner() {
  const banner = document.getElementById("cajaCloseBanner");
  if (!banner) return;
  const today = localDateISO();
  const closed = !!getClosingForDate(today);
  const hour = new Date().getHours();
  const show = !closed && hour >= CAJA_CLOSE_HOUR;
  banner.hidden = !show;
  const text = document.getElementById("cajaCloseBannerText");
  if (text) {
    text.textContent = show
      ? `Pasaron las 5:00 p.m. Hay ${expensesOnDate(today).length} gasto(s) y la caja de hoy aún no está cerrada.`
      : "";
  }
}

function renderCajaExpenseList(listEl, items, emptyMsg) {
  if (!listEl) return;
  if (!items.length) {
    listEl.innerHTML = `<p class="empty">${emptyMsg}</p>`;
    return;
  }
  listEl.innerHTML = items
    .map((e) => {
      const code = e.personCode || "—";
      const catClass =
        e.category === "gasolina" ? "gasolina" : e.category === "uniformes" ? "uniformes" : e.category === "servicios" ? "pagodias" : "";
      return `<article class="report-card caja-expense-card" data-id="${escapeHtml(e.id)}">
        <div class="row">
          <div style="flex:1;min-width:0">
            <h3>${escapeHtml(e.recipient || "—")}</h3>
            <span class="caja-code-pill">${escapeHtml(code)}</span>
            <p>${escapeHtml(e.purpose || "—")}</p>
            <p style="margin-top:6px">${escapeHtml(e.date)} · Recibo ${escapeHtml(e.receiptNo || "—")}${e.note ? ` · ${escapeHtml(e.note)}` : ""}</p>
            <span class="caja-cat-pill ${catClass}">${escapeHtml(cajaCategoryLabel(e.category))}</span>
            ${e.checkPhoto ? `<span class="caja-cat-pill" style="margin-left:6px">Cheque adjunto</span>` : ""}
          </div>
          <div style="text-align:right">
            <div class="caja-amount">${money(e.amount)}</div>
            <button class="btn ghost btn-print-caja-receipt" type="button" data-id="${escapeHtml(e.id)}" style="width:auto;margin-top:8px;padding:6px 8px;font-size:12px">Recibo</button>
            ${e.checkPhoto ? `<button class="btn secondary btn-view-caja-check" type="button" data-id="${escapeHtml(e.id)}" style="width:auto;margin-top:6px;padding:6px 8px;font-size:12px">Ver cheque</button>` : ""}
            <button class="btn danger btn-del-caja" type="button" data-id="${escapeHtml(e.id)}" style="width:auto;margin-top:6px;padding:6px 8px;font-size:12px">Eliminar</button>
          </div>
        </div>
      </article>`;
    })
    .join("");
  listEl.querySelectorAll(".btn-print-caja-receipt").forEach((btn) => {
    btn.addEventListener("click", () => printCajaReceipt(btn.dataset.id));
  });
  listEl.querySelectorAll(".btn-del-caja").forEach((btn) => {
    btn.addEventListener("click", () => deleteCajaExpense(btn.dataset.id));
  });
  listEl.querySelectorAll(".btn-view-caja-check").forEach((btn) => {
    btn.addEventListener("click", () => viewCajaCheckPhoto(btn.dataset.id));
  });
}

function viewCajaCheckPhoto(id) {
  const exp = (pettyCash.expenses || []).find((e) => e.id === id);
  if (!exp || !exp.checkPhoto) {
    toast("No hay foto de cheque en este gasto.");
    return;
  }
  openMediaLightbox({
    title: `Cheque · ${exp.personCode || ""} · ${exp.recipient || ""}`,
    dataUrl: exp.checkPhoto,
    mime: "image/jpeg",
    name: exp.checkPhotoName || "cheque.jpg",
  });
}

function setCajaExpenseFormEnabled(enabled) {
  ["cajaRecipient", "cajaPurpose", "cajaAmount", "cajaCategory", "cajaNote", "cajaCheckPhoto", "btnSaveCajaExpense", "btnClearCajaCheck", "btnViewCajaCheck"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = !enabled;
  });
  // La fecha siempre se puede cambiar para registrar en otro día
  const dateEl = document.getElementById("cajaDate");
  if (dateEl) dateEl.disabled = false;
}

function renderCajaHoy() {
  const today = document.getElementById("cajaDate")?.value || localDateISO();
  const items = expensesOnDate(today).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const gas = items.filter((e) => e.category === "gasolina");
  const total = sumExpenses(items);
  const gasTotal = sumExpenses(gas);
  const closed = getClosingForDate(today);
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set("cajaTodayCount", String(items.length));
  set("cajaTodayGas", money(gasTotal));
  set("cajaTodayTotal", money(total));
  set(
    "cajaTodayStatus",
    closed
      ? `Día cerrado · efectivo ${money(closed.closingAmount)} · por ${closed.closedBy || "—"}`
      : "Día abierto (cierre habitual 5:00 p.m.)"
  );
  const formCard = document.getElementById("cajaExpenseFormCard");
  const closeCard = document.getElementById("cajaCloseFormCard");
  const closedNotice = document.getElementById("cajaClosedNotice");
  if (formCard) formCard.hidden = false;
  if (closeCard) closeCard.hidden = !!closed;
  if (closedNotice) closedNotice.hidden = !closed;
  setCajaExpenseFormEnabled(!closed);
  renderCajaExpenseList(document.getElementById("cajaTodayList"), items, "No hay gastos registrados para esta fecha.");
}

function focusCajaNuevoGasto() {
  setCajaTab("hoy");
  const dateEl = document.getElementById("cajaDate");
  if (dateEl && !dateEl.value) dateEl.value = localDateISO();
  // Si el día de hoy está cerrado, dejar la fecha en hoy para que vea el aviso y pueda reabrir
  renderCajaHoy();
  const form = document.getElementById("cajaExpenseFormCard");
  if (form) {
    form.hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const recipient = document.getElementById("cajaRecipient");
  if (recipient && !recipient.disabled) {
    setTimeout(() => recipient.focus(), 250);
  }
}

function reopenCajaDay() {
  if (!canAccessCajaChica()) {
    toast("No tienes permiso de caja chica.");
    return;
  }
  const date = document.getElementById("cajaDate")?.value || localDateISO();
  const closing = getClosingForDate(date);
  if (!closing) {
    toast("Ese día no está cerrado.");
    return;
  }
  const ok = window.confirm(`¿Reabrir la caja del ${date} para poder registrar más gastos?`);
  if (!ok) return;
  pettyCash.closings = (pettyCash.closings || []).filter((c) => c.date !== date);
  savePettyCash(true);
  logActivity("caja_reopen", `Reabrió caja del ${date}`);
  renderCajaModule();
  toast("Día reabierto. Ya puedes digitar gastos.");
  focusCajaNuevoGasto();
}

function renderCajaCategoryFolder({ category, fromId, toId, totalId, listId, emptyMsg }) {
  const fromEl = document.getElementById(fromId);
  const toEl = document.getElementById(toId);
  const today = localDateISO();
  if (fromEl && !fromEl.value) {
    const d = parseLocalDate(today);
    d.setDate(1);
    fromEl.value = localDateISO(d);
  }
  if (toEl && !toEl.value) toEl.value = today;
  const from = fromEl?.value || today;
  const to = toEl?.value || today;
  const items = expensesBetween(from, to)
    .filter((e) => e.category === category)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
  const totalEl = document.getElementById(totalId);
  if (totalEl) totalEl.textContent = money(sumExpenses(items));
  renderCajaExpenseList(document.getElementById(listId), items, emptyMsg);
}

function renderCajaGasolina() {
  renderCajaCategoryFolder({
    category: "gasolina",
    fromId: "cajaGasFrom",
    toId: "cajaGasTo",
    totalId: "cajaGasTotal",
    listId: "cajaGasList",
    emptyMsg: "No hay gastos de gasolina en este rango.",
  });
}

function renderCajaUniformes() {
  renderCajaCategoryFolder({
    category: "uniformes",
    fromId: "cajaUniformesFrom",
    toId: "cajaUniformesTo",
    totalId: "cajaUniformesTotal",
    listId: "cajaUniformesList",
    emptyMsg: "No hay gastos de uniformes en este rango.",
  });
}

function renderCajaPagoDias() {
  renderCajaCategoryFolder({
    category: "servicios",
    fromId: "cajaPagoDiasFrom",
    toId: "cajaPagoDiasTo",
    totalId: "cajaPagoDiasTotal",
    listId: "cajaPagoDiasList",
    emptyMsg: "No hay pagos de días en este rango.",
  });
}

function renderCajaEliminados() {
  const list = document.getElementById("cajaEliminadosList");
  if (!list) return;
  const items = [...(pettyCash.deletedExpenses || [])].sort((a, b) =>
    String(b.deletedAt).localeCompare(String(a.deletedAt))
  );
  if (!items.length) {
    list.innerHTML = `<p class="empty">No hay gastos en la carpeta de eliminados.</p>`;
    return;
  }
  list.innerHTML = items
    .map((e) => {
      const when = e.deletedAt
        ? new Date(e.deletedAt).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" })
        : "—";
      return `<article class="report-card caja-expense-card caja-deleted-card" data-id="${escapeHtml(e.id)}">
        <div class="row">
          <div style="flex:1;min-width:0">
            <h3>${escapeHtml(e.recipient || "—")}</h3>
            <span class="caja-code-pill">${escapeHtml(e.personCode || "—")}</span>
            <p>${escapeHtml(e.purpose || "—")}</p>
            <p style="margin-top:6px">${escapeHtml(e.date)} · Recibo ${escapeHtml(e.receiptNo || "—")} · ${escapeHtml(cajaCategoryLabel(e.category))}</p>
            <p class="caja-delete-reason"><strong>Razón:</strong> ${escapeHtml(e.deleteReason || "Sin razón")}</p>
            <p class="muted" style="margin-top:6px;font-size:12px">Eliminado ${escapeHtml(when)} por ${escapeHtml(e.deletedBy || "—")}</p>
          </div>
          <div style="text-align:right">
            <div class="caja-amount" style="opacity:.7">${money(e.amount)}</div>
            <span class="caja-cat-pill" style="margin-top:8px">No contabiliza</span>
            <button class="btn ghost btn-print-caja-receipt" type="button" data-id="${escapeHtml(e.id)}" style="width:auto;margin-top:8px;padding:6px 8px;font-size:12px">Recibo</button>
            ${e.checkPhoto ? `<button class="btn secondary btn-view-caja-check-del" type="button" data-id="${escapeHtml(e.id)}" style="width:auto;margin-top:6px;padding:6px 8px;font-size:12px">Ver cheque</button>` : ""}
          </div>
        </div>
      </article>`;
    })
    .join("");
  list.querySelectorAll(".btn-print-caja-receipt").forEach((btn) => {
    btn.addEventListener("click", () => printCajaReceipt(btn.dataset.id));
  });
  list.querySelectorAll(".btn-view-caja-check-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const exp = (pettyCash.deletedExpenses || []).find((e) => e.id === btn.dataset.id);
      if (!exp?.checkPhoto) return;
      openMediaLightbox({
        title: `Cheque · ${exp.personCode || ""} · ${exp.recipient || ""}`,
        dataUrl: exp.checkPhoto,
        mime: "image/jpeg",
        name: exp.checkPhotoName || "cheque.jpg",
      });
    });
  });
}

function renderCajaCierres() {
  const list = document.getElementById("cajaClosingsList");
  if (!list) return;
  const rows = [...(pettyCash.closings || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!rows.length) {
    list.innerHTML = `<p class="empty">Aún no hay cierres diarios.</p>`;
    return;
  }
  list.innerHTML = rows
    .map(
      (c) => `<article class="report-card">
        <div class="row">
          <div>
            <h3>Cierre ${escapeHtml(c.date)}</h3>
            <p>${c.expenseCount || 0} gastos · Total salidas ${money(c.totalExpenses)}</p>
            <p style="margin-top:6px">Gasolina ${money(c.totalGasolina)} · Otros ${money(c.totalOther)}</p>
            <p>Cerrado por ${escapeHtml(c.closedBy || "—")} · ${escapeHtml((c.closedAt || "").slice(0, 16).replace("T", " "))}</p>
            ${c.note ? `<p style="margin-top:6px">${escapeHtml(c.note)}</p>` : ""}
          </div>
          <div style="text-align:right">
            <div class="caja-amount">${money(c.closingAmount)}</div>
            <span class="muted" style="font-size:12px">efectivo</span>
          </div>
        </div>
      </article>`
    )
    .join("");
}

function renderCajaPeriodStats(statsEl, listEl, from, to, emptyMsg) {
  const items = expensesBetween(from, to).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const gas = items.filter((e) => e.category === "gasolina");
  const closings = (pettyCash.closings || []).filter((c) => c.date >= from && c.date <= to);
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat-box"><span class="muted">Gastos</span><strong>${items.length}</strong></div>
      <div class="stat-box"><span class="muted">Total</span><strong>${money(sumExpenses(items))}</strong></div>
      <div class="stat-box"><span class="muted">Gasolina</span><strong>${money(sumExpenses(gas))}</strong></div>
      <div class="stat-box"><span class="muted">Cierres</span><strong>${closings.length}</strong></div>
    `;
  }
  renderCajaExpenseList(listEl, items, emptyMsg);
  return items;
}

function renderCajaSemana() {
  const pivotEl = document.getElementById("cajaWeekPivot");
  if (pivotEl && !pivotEl.value) pivotEl.value = localDateISO();
  const { from, to } = weekRangeFromPivot(pivotEl?.value || localDateISO());
  const summary = document.getElementById("cajaSummary");
  if (summary && cajaTab === "semana") summary.textContent = `Semana ${from} → ${to}`;
  renderCajaPeriodStats(
    document.getElementById("cajaWeekStats"),
    document.getElementById("cajaWeekList"),
    from,
    to,
    "Sin gastos en esta semana."
  );
}

function renderCajaMes() {
  const monthEl = document.getElementById("cajaMonth");
  const today = localDateISO();
  if (monthEl && !monthEl.value) monthEl.value = today.slice(0, 7);
  const ym = monthEl?.value || today.slice(0, 7);
  const from = `${ym}-01`;
  const end = parseLocalDate(from);
  end.setMonth(end.getMonth() + 1);
  end.setDate(0);
  const to = localDateISO(end);
  const items = renderCajaPeriodStats(
    document.getElementById("cajaMonthStats"),
    document.getElementById("cajaMonthList"),
    from,
    to,
    "Sin gastos en este mes."
  );
  const byCat = {};
  CAJA_CATEGORIES.forEach((c) => {
    byCat[c.key] = 0;
  });
  items.forEach((e) => {
    byCat[e.category] = (byCat[e.category] || 0) + (Number(e.amount) || 0);
  });
  const catBox = document.getElementById("cajaMonthByCat");
  if (catBox) {
    catBox.innerHTML =
      `<h2 style="margin:0 0 10px">Por categoría</h2>` +
      CAJA_CATEGORIES.map(
        (c) => `<div class="row" style="margin-bottom:8px"><span>${escapeHtml(c.label)}</span><strong>${money(byCat[c.key] || 0)}</strong></div>`
      ).join("");
  }
}

function renderCajaModule() {
  if (!canAccessCajaChica()) return;
  const dateEl = document.getElementById("cajaDate");
  const closeDateEl = document.getElementById("cajaCloseDate");
  if (dateEl && !dateEl.value) dateEl.value = localDateISO();
  if (closeDateEl && !closeDateEl.value) closeDateEl.value = dateEl?.value || localDateISO();
  fillCajaPeopleDatalist();
  updateCajaPersonCodeHint();
  renderCajaCloseBanner();
  if (cajaTab === "hoy") renderCajaHoy();
  else if (cajaTab === "personas") renderCajaPersonas();
  else if (cajaTab === "gasolina") renderCajaGasolina();
  else if (cajaTab === "uniformes") renderCajaUniformes();
  else if (cajaTab === "pagodias") renderCajaPagoDias();
  else if (cajaTab === "eliminados") renderCajaEliminados();
  else if (cajaTab === "cierres") renderCajaCierres();
  else if (cajaTab === "semana") renderCajaSemana();
  else if (cajaTab === "mes") renderCajaMes();
  const summary = document.getElementById("cajaSummary");
  if (summary) {
    if (cajaTab === "personas") {
      summary.textContent = "Busca por código único para ver historial, recibos, cheques y suma por persona.";
    } else if (cajaTab === "eliminados") {
      summary.textContent = "Gastos eliminados con su razón. No se suman a totales ni cierres.";
    } else if (cajaTab === "uniformes") {
      summary.textContent = "Carpeta de uniformes: solo lo gastado en esa categoría.";
    } else if (cajaTab === "pagodias") {
      summary.textContent = "Carpeta de pago de días: solo lo gastado en esa categoría.";
    } else if (cajaTab === "hoy" || cajaTab === "gasolina" || cajaTab === "cierres") {
      summary.textContent = "Gastos del día, carpetas por categoría y cierres. Cada persona tiene código único.";
    }
  }
}

function renderCajaPersonas() {
  const q = String(document.getElementById("cajaPersonSearch")?.value || "")
    .trim()
    .toLowerCase();
  const cards = document.getElementById("cajaPeopleListCards");
  const detail = document.getElementById("cajaPersonDetail");
  const people = [...(pettyCash.people || [])].sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const filtered = people.filter((p) => {
    if (!q) return true;
    return (
      String(p.code).toLowerCase().includes(q) ||
      String(p.name).toLowerCase().includes(q) ||
      cajaNameKey(p.name).includes(cajaNameKey(q))
    );
  });
  if (!cards) return;
  if (!filtered.length) {
    cards.innerHTML = `<p class="empty">${q ? "Ninguna persona coincide con esa búsqueda." : "Aún no hay personas con pagos de caja."}</p>`;
  } else {
    cards.innerHTML = filtered
      .map((p) => {
        const items = expensesForPerson(p);
        const total = sumExpenses(items);
        const checks = items.filter((e) => e.checkPhoto).length;
        return `<article class="report-card" data-person-id="${escapeHtml(p.id)}">
          <div class="row">
            <div style="flex:1;min-width:0">
              <h3>${escapeHtml(p.name || "—")}</h3>
              <span class="caja-code-pill">${escapeHtml(p.code)}</span>
              <p style="margin-top:8px">${items.length} pago(s) · ${checks} cheque(s)</p>
            </div>
            <div style="text-align:right">
              <div class="caja-amount">${money(total)}</div>
              <button class="btn secondary btn-open-caja-person" type="button" data-person-id="${escapeHtml(p.id)}" style="width:auto;margin-top:8px;padding:6px 10px;font-size:12px">Ver historial</button>
            </div>
          </div>
        </article>`;
      })
      .join("");
    cards.querySelectorAll(".btn-open-caja-person").forEach((btn) => {
      btn.addEventListener("click", () => openCajaPersonDetail(btn.dataset.personId));
    });
  }

  if (selectedCajaPersonId && findCajaPersonById(selectedCajaPersonId)) {
    openCajaPersonDetail(selectedCajaPersonId, false);
  } else if (detail) {
    detail.hidden = true;
  }
}

function openCajaPersonDetail(personId, scroll = true) {
  const person = findCajaPersonById(personId);
  const detail = document.getElementById("cajaPersonDetail");
  if (!person || !detail) return;
  selectedCajaPersonId = person.id;
  const items = expensesForPerson(person).sort(
    (a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt))
  );
  const total = sumExpenses(items);
  const checks = items.filter((e) => e.checkPhoto).length;
  const title = document.getElementById("cajaPersonDetailTitle");
  const meta = document.getElementById("cajaPersonDetailMeta");
  const stats = document.getElementById("cajaPersonDetailStats");
  if (title) title.textContent = person.name || "Persona";
  if (meta) meta.textContent = `Código ${person.code}`;
  if (stats) {
    stats.innerHTML = `
      <div class="stat-box"><span class="muted">Pagos</span><strong>${items.length}</strong></div>
      <div class="stat-box"><span class="muted">Cheques</span><strong>${checks}</strong></div>
      <div class="stat-box"><span class="muted">Total entregado</span><strong>${money(total)}</strong></div>
    `;
  }
  detail.hidden = false;
  renderCajaExpenseList(document.getElementById("cajaPersonExpenseList"), items, "Sin pagos registrados para esta persona.");
  if (scroll) detail.scrollIntoView({ behavior: "smooth", block: "start" });
}

function printCajaPersonHistory(personId) {
  const person = findCajaPersonById(personId || selectedCajaPersonId);
  if (!person) {
    toast("Selecciona una persona.");
    return;
  }
  const items = expensesForPerson(person).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const total = sumExpenses(items);
  const rows = items
    .map(
      (e) => `<tr>
        <td>${escapeHtml(e.date)}</td>
        <td>${escapeHtml(e.receiptNo || "—")}</td>
        <td>${escapeHtml(e.purpose)}</td>
        <td>${escapeHtml(cajaCategoryLabel(e.category))}</td>
        <td class="right">${money(e.amount)}</td>
        <td>${e.checkPhoto ? "Sí" : "—"}</td>
      </tr>`
    )
    .join("");
  openPrintWindow(`Historial ${person.code}`, `
    <h2>Expediente de caja — ${escapeHtml(person.name)}</h2>
    <p>Código: <strong>${escapeHtml(person.code)}</strong> · Pagos: ${items.length} · Total: <strong>${money(total)}</strong></p>
    <table>
      <thead><tr><th>Fecha</th><th>Recibo</th><th>Concepto</th><th>Categoría</th><th class="right">Monto</th><th>Cheque</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6">Sin pagos</td></tr>`}</tbody>
    </table>
  `);
}

function saveCajaExpense() {
  if (!canAccessCajaChica()) {
    toast("Solo el administrador o dueño puede registrar gastos.");
    return;
  }
  const date = document.getElementById("cajaDate").value || localDateISO();
  if (getClosingForDate(date)) {
    toast("Ese día ya está cerrado. No se pueden agregar gastos.");
    return;
  }
  const recipientRaw = document.getElementById("cajaRecipient").value.trim();
  const purpose = document.getElementById("cajaPurpose").value.trim();
  const amount = Number(document.getElementById("cajaAmount").value);
  const category = document.getElementById("cajaCategory").value || "otros";
  const note = document.getElementById("cajaNote").value.trim();
  if (!recipientRaw) {
    toast("Indica a quién se le dio el dinero.");
    return;
  }
  if (!purpose) {
    toast("Indica para qué se dio el dinero.");
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    toast("Escribe un monto válido.");
    return;
  }
  const person = resolveCajaRecipientForSave(recipientRaw);
  if (!person) {
    toast("No se pudo asignar el código de persona.");
    return;
  }
  const expense = normalizeCajaExpense({
    date,
    recipient: person.name,
    personId: person.id,
    personCode: person.code,
    purpose,
    amount,
    category,
    note,
    createdBy: currentUser ? currentUser.displayName || currentUser.username : "",
    receiptNo: nextCajaReceiptNo(),
    checkPhoto: pendingCajaCheckPhoto || "",
    checkPhotoName: pendingCajaCheckPhoto ? "cheque.jpg" : "",
  });
  pettyCash.expenses.unshift(expense);
  savePettyCash(true);
  logActivity(
    "caja_expense",
    `Caja chica: ${money(amount)} a ${person.name} [${person.code}] (${cajaCategoryLabel(category)})${expense.checkPhoto ? " +cheque" : ""}`
  );
  document.getElementById("cajaRecipient").value = "";
  document.getElementById("cajaPurpose").value = "";
  document.getElementById("cajaAmount").value = "";
  document.getElementById("cajaNote").value = "";
  document.getElementById("cajaCategory").value = "otros";
  clearCajaCheckPhoto();
  selectedCajaPersonId = person.id;
  updateCajaPersonCodeHint();
  renderCajaModule();
  toast(`Gasto guardado · código ${person.code}`);
  printCajaReceipt(expense.id);
}

function deleteCajaExpense(id) {
  if (!canAccessCajaChica()) return;
  const exp = (pettyCash.expenses || []).find((e) => e.id === id);
  if (!exp) return;
  const reason = window.prompt(
    `Eliminar gasto de ${exp.recipient} por ${money(exp.amount)}.\n\nEscribe la razón del borrado (obligatorio):\nEl gasto pasará a la carpeta Eliminados y no se contabilizará.`,
    ""
  );
  if (reason === null) return;
  const cleanReason = String(reason).trim();
  if (!cleanReason) {
    toast("Debes indicar la razón del borrado.");
    return;
  }
  if (!window.confirm(`¿Confirmar eliminación?\nRazón: ${cleanReason}`)) return;
  const archived = normalizeDeletedCajaExpense({
    ...exp,
    deletedAt: new Date().toISOString(),
    deletedBy: currentUser ? currentUser.displayName || currentUser.username : "",
    deleteReason: cleanReason,
  });
  pettyCash.expenses = (pettyCash.expenses || []).filter((e) => e.id !== id);
  pettyCash.deletedExpenses = [archived, ...(pettyCash.deletedExpenses || []).filter((e) => e.id !== id)];
  savePettyCash(true);
  logActivity(
    "caja_delete",
    `Eliminó gasto caja: ${exp.recipient} ${money(exp.amount)} [${exp.personCode || ""}] — ${cleanReason}`
  );
  renderCajaModule();
  toast("Gasto enviado a Eliminados (no contabiliza).");
}

function closeCajaDay() {
  if (!canAccessCajaChica()) {
    toast("Solo el administrador o dueño puede cerrar la caja.");
    return;
  }
  const date = document.getElementById("cajaCloseDate").value || localDateISO();
  if (getClosingForDate(date)) {
    toast("Ese día ya está cerrado.");
    return;
  }
  const items = expensesOnDate(date);
  const gas = items.filter((e) => e.category === "gasolina");
  const other = items.filter((e) => e.category !== "gasolina");
  const closingAmount = Number(document.getElementById("cajaCloseAmount").value);
  if (!Number.isFinite(closingAmount) || closingAmount < 0) {
    toast("Escribe el monto de cierre.");
    return;
  }
  const note = document.getElementById("cajaCloseNote").value.trim();
  const ok = window.confirm(
    `Cerrar caja del ${date}?\nGastos: ${items.length} · Total salidas: ${money(sumExpenses(items))}\nEfectivo de cierre: ${money(closingAmount)}`
  );
  if (!ok) return;
  const closing = normalizeCajaClosing({
    date,
    closedBy: currentUser ? currentUser.displayName || currentUser.username : "",
    totalExpenses: sumExpenses(items),
    totalGasolina: sumExpenses(gas),
    totalOther: sumExpenses(other),
    closingAmount,
    note,
    expenseCount: items.length,
  });
  pettyCash.closings.unshift(closing);
  savePettyCash(true);
  logActivity("caja_close", `Cerró caja ${date}: salidas ${money(closing.totalExpenses)}, efectivo ${money(closingAmount)}`);
  document.getElementById("cajaCloseAmount").value = "";
  document.getElementById("cajaCloseNote").value = "";
  renderCajaModule();
  toast("Día cerrado y guardado.");
}

function printCajaReceipt(id) {
  const exp =
    (pettyCash.expenses || []).find((e) => e.id === id) ||
    (pettyCash.deletedExpenses || []).find((e) => e.id === id);
  if (!exp) {
    toast("No se encontró el gasto.");
    return;
  }
  const when = exp.createdAt
    ? new Date(exp.createdAt).toLocaleString("es-DO", { dateStyle: "long", timeStyle: "short" })
    : exp.date;
  const checkBlock = exp.checkPhoto
    ? `<p><strong>Cheque / comprobante adjunto</strong></p>
       <img src="${exp.checkPhoto}" alt="Cheque" style="max-width:100%;max-height:280px;border:1px solid #ccc;margin:8px 0 16px" />`
    : "";
  const body = `
    <h2 style="margin:0 0 4px">Recibo de caja chica</h2>
    <p style="margin:0 0 16px">Reaction Force Security · ${escapeHtml(exp.receiptNo || "")}</p>
    <div class="meta">
      <div><strong>Fecha:</strong><br/>${escapeHtml(when)}</div>
      <div><strong>Categoría:</strong><br/>${escapeHtml(cajaCategoryLabel(exp.category))}</div>
      <div><strong>Monto:</strong><br/>${money(exp.amount)}</div>
      <div><strong>Código persona:</strong><br/>${escapeHtml(exp.personCode || "—")}</div>
      <div><strong>Registró:</strong><br/>${escapeHtml(exp.createdBy || "—")}</div>
    </div>
    <p><strong>Se entregó a:</strong> ${escapeHtml(exp.recipient || "—")} ${exp.personCode ? `(${escapeHtml(exp.personCode)})` : ""}</p>
    <p><strong>Para qué / concepto:</strong> ${escapeHtml(exp.purpose || "—")}</p>
    ${exp.note ? `<p><strong>Nota:</strong> ${escapeHtml(exp.note)}</p>` : ""}
    ${checkBlock}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:48px">
      <div>
        <div style="border-top:1px solid #111;padding-top:8px;min-height:70px">
          Firma quien recibe<br/>
          Nombre: ${escapeHtml(exp.recipient || "________________")}
        </div>
      </div>
      <div>
        <div style="border-top:1px solid #111;padding-top:8px;min-height:70px">
          Firma autorizado RFS<br/>
          Fecha: _______________
        </div>
      </div>
    </div>
  `;
  openPrintWindow(`Recibo caja ${exp.receiptNo || ""}`, body);
}

function printCajaSheet() {
  if (!canAccessCajaChica()) return;
  let from = localDateISO();
  let to = from;
  let title = "Caja chica — Hoy";
  if (cajaTab === "gasolina") {
    from = document.getElementById("cajaGasFrom")?.value || from;
    to = document.getElementById("cajaGasTo")?.value || to;
    title = "Caja chica — Gasolina";
  } else if (cajaTab === "semana") {
    const range = weekRangeFromPivot(document.getElementById("cajaWeekPivot")?.value || from);
    from = range.from;
    to = range.to;
    title = `Caja chica — Semana ${from} a ${to}`;
  } else if (cajaTab === "mes") {
    const ym = document.getElementById("cajaMonth")?.value || from.slice(0, 7);
    from = `${ym}-01`;
    const end = parseLocalDate(from);
    end.setMonth(end.getMonth() + 1);
    end.setDate(0);
    to = localDateISO(end);
    title = `Caja chica — Mes ${ym}`;
  } else if (cajaTab === "cierres") {
    const rows = [...(pettyCash.closings || [])]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map(
        (c) => `<tr>
          <td>${escapeHtml(c.date)}</td>
          <td class="right">${c.expenseCount || 0}</td>
          <td class="right">${money(c.totalExpenses)}</td>
          <td class="right">${money(c.totalGasolina)}</td>
          <td class="right">${money(c.closingAmount)}</td>
          <td>${escapeHtml(c.closedBy || "—")}</td>
        </tr>`
      )
      .join("");
    openPrintWindow("Cierres de caja chica", `
      <h2>Historial de cierres</h2>
      <table>
        <thead><tr><th>Fecha</th><th class="right">Gastos</th><th class="right">Salidas</th><th class="right">Gasolina</th><th class="right">Efectivo</th><th>Cerrado por</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6">Sin cierres</td></tr>`}</tbody>
      </table>`);
    return;
  } else if (cajaTab === "personas") {
    printCajaPersonHistory(selectedCajaPersonId);
    return;
  } else if (cajaTab === "eliminados") {
    const dels = [...(pettyCash.deletedExpenses || [])].sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
    const rows = dels
      .map(
        (e) => `<tr>
          <td>${escapeHtml(e.date)}</td>
          <td>${escapeHtml(e.receiptNo || "—")}</td>
          <td>${escapeHtml(e.personCode || "—")}</td>
          <td>${escapeHtml(e.recipient)}</td>
          <td class="right">${money(e.amount)}</td>
          <td>${escapeHtml(e.deleteReason || "—")}</td>
          <td>${escapeHtml(e.deletedBy || "—")}</td>
        </tr>`
      )
      .join("");
    openPrintWindow("Gastos eliminados", `
      <h2>Carpeta de eliminados (no contabilizan)</h2>
      <table>
        <thead><tr><th>Fecha</th><th>Recibo</th><th>Código</th><th>Persona</th><th class="right">Monto</th><th>Razón</th><th>Eliminó</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7">Sin eliminados</td></tr>`}</tbody>
      </table>`);
    return;
  } else if (cajaTab === "uniformes") {
    from = document.getElementById("cajaUniformesFrom")?.value || from;
    to = document.getElementById("cajaUniformesTo")?.value || to;
    title = "Caja chica — Uniformes";
  } else if (cajaTab === "pagodias") {
    from = document.getElementById("cajaPagoDiasFrom")?.value || from;
    to = document.getElementById("cajaPagoDiasTo")?.value || to;
    title = "Caja chica — Pago de días";
  } else {
    from = document.getElementById("cajaDate")?.value || from;
    to = from;
  }
  let items = expensesBetween(from, to);
  if (cajaTab === "gasolina") items = items.filter((e) => e.category === "gasolina");
  if (cajaTab === "uniformes") items = items.filter((e) => e.category === "uniformes");
  if (cajaTab === "pagodias") items = items.filter((e) => e.category === "servicios");
  items = items.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt).localeCompare(String(b.createdAt)));
  const rows = items
    .map(
      (e) => `<tr>
        <td>${escapeHtml(e.date)}</td>
        <td>${escapeHtml(e.receiptNo || "—")}</td>
        <td>${escapeHtml(e.personCode || "—")}</td>
        <td>${escapeHtml(e.recipient)}</td>
        <td>${escapeHtml(e.purpose)}</td>
        <td>${escapeHtml(cajaCategoryLabel(e.category))}</td>
        <td class="right">${money(e.amount)}</td>
        <td>${e.checkPhoto ? "Sí" : "—"}</td>
      </tr>`
    )
    .join("");
  openPrintWindow(title, `
    <h2>${escapeHtml(title)}</h2>
    <p>Total: ${money(sumExpenses(items))} · ${items.length} movimiento(s)</p>
    <table>
      <thead><tr><th>Fecha</th><th>Recibo</th><th>Código</th><th>Recibió</th><th>Concepto</th><th>Categoría</th><th class="right">Monto</th><th>Cheque</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8">Sin gastos</td></tr>`}</tbody>
    </table>`);
}

function bindCajaUi() {
  document.querySelectorAll(".caja-tabs .emp-tab").forEach((btn) => {
    btn.addEventListener("click", () => setCajaTab(btn.dataset.cajaTab));
  });
  document.getElementById("btnCajaNuevoGasto")?.addEventListener("click", focusCajaNuevoGasto);
  document.getElementById("btnReopenCajaDay")?.addEventListener("click", reopenCajaDay);
  document.getElementById("btnSaveCajaExpense")?.addEventListener("click", saveCajaExpense);
  document.getElementById("btnCloseCajaDay")?.addEventListener("click", closeCajaDay);
  document.getElementById("btnCajaGoClose")?.addEventListener("click", () => {
    setCajaTab("hoy");
    document.getElementById("cajaCloseFormCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.getElementById("btnPrintCaja")?.addEventListener("click", printCajaSheet);
  document.getElementById("cajaDate")?.addEventListener("change", () => {
    const d = document.getElementById("cajaDate").value;
    const closeDate = document.getElementById("cajaCloseDate");
    if (closeDate && d) closeDate.value = d;
    renderCajaHoy();
    renderCajaCloseBanner();
  });
  document.getElementById("cajaGasFrom")?.addEventListener("change", renderCajaGasolina);
  document.getElementById("cajaGasTo")?.addEventListener("change", renderCajaGasolina);
  document.getElementById("cajaUniformesFrom")?.addEventListener("change", renderCajaUniformes);
  document.getElementById("cajaUniformesTo")?.addEventListener("change", renderCajaUniformes);
  document.getElementById("cajaPagoDiasFrom")?.addEventListener("change", renderCajaPagoDias);
  document.getElementById("cajaPagoDiasTo")?.addEventListener("change", renderCajaPagoDias);
  document.getElementById("cajaWeekPivot")?.addEventListener("change", renderCajaSemana);
  document.getElementById("cajaMonth")?.addEventListener("change", renderCajaMes);
  document.getElementById("cajaRecipient")?.addEventListener("input", updateCajaPersonCodeHint);
  document.getElementById("cajaRecipient")?.addEventListener("change", updateCajaPersonCodeHint);
  document.getElementById("cajaCheckPhoto")?.addEventListener("change", onCajaCheckPhotoSelected);
  document.getElementById("btnClearCajaCheck")?.addEventListener("click", clearCajaCheckPhoto);
  document.getElementById("btnViewCajaCheck")?.addEventListener("click", () => {
    if (!pendingCajaCheckPhoto) {
      toast("Aún no hay foto de cheque.");
      return;
    }
    openMediaLightbox({
      title: "Foto del cheque",
      dataUrl: pendingCajaCheckPhoto,
      mime: "image/jpeg",
      name: "cheque.jpg",
    });
  });
  document.getElementById("cajaPersonSearch")?.addEventListener("input", () => {
    if (cajaTab === "personas") renderCajaPersonas();
  });
  document.getElementById("btnCajaPersonPrint")?.addEventListener("click", () => printCajaPersonHistory());
}
/* ==== FIN CAJA CHICA ==== */


function switchView(viewId) {
  if (!currentUser) {
    viewId = "loginView";
  } else if (viewId !== "loginView" && !canAccessView(viewId)) {
    toast("Tu usuario no tiene acceso a esa sección.");
    viewId = firstAllowedView();
  }
  closeMediaLightbox();
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
  if (viewId === "cajaView") renderCajaModule();
  if (viewId === "hrView") renderHrModule();
  if (viewId === "employeesView") renderEmployees();
  if (viewId === "employeeNewView") {}
  if (viewId === "loansView") renderLoans();
  if (viewId === "loanNewView") {
    renderLoanEmployeePicker();
    renderLoanPreview();
  }
  if (viewId === "monorrielView") renderMonorrielHome();
  if (viewId === "lvaView") renderLvaModule();
  if (viewId === "monoReportEditView") renderMonoPostsEditor();
  if (viewId === "monoStaffView") renderMonoStaffList();
  if (viewId === "messagesView") renderMessagesModule();
  if (viewId === "radioView") renderRadioModule();
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
  if (!canWriteClients()) {
    toast("No tienes permiso para editar clientes.");
    return;
  }
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
  if (!canWriteClients()) {
    toast("No tienes permiso para crear o editar clientes.");
    return;
  }
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
    logActivity("post_update", `Actualizó puesto: ${data.site || data.id}`);
    toast("Puesto actualizado.");
  } else {
    pushHistory(data, "Servicio creado", historyNote || `Alta del servicio con ${data.guardCount} vigilante(s).`);
    posts.unshift(data);
    logActivity("post_create", `Creó puesto: ${data.site || data.id}`);
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
  if (!canWriteClients()) {
    toast("No tienes permiso para eliminar clientes.");
    return;
  }
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
  logActivity("post_delete", `Eliminó puesto: ${post.site || id}`);
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
    radio: radioState,
    activity: activityLog,
    lva: lvaState,
    pettyCash,
    hr: hrData,
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
      if (data.radio && typeof data.radio === "object") {
        applyRemoteRadio(data.radio);
        saveRadioState(true);
      }
      if (Array.isArray(data.activity)) {
        activityLog = mergeActivity(activityLog, data.activity);
        localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activityLog));
      }
      if (data.lva && typeof data.lva === "object") {
        applyRemoteLva(data.lva);
        saveLvaState(true);
      }
      if (data.pettyCash && typeof data.pettyCash === "object") {
        applyRemotePettyCash(data.pettyCash);
        savePettyCash(true);
      }
      if (data.hr && typeof data.hr === "object") {
        applyRemoteHrData(data.hr);
        saveHrData(true);
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
      renderCajaModule();
      renderHrModule();
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
      if (data.radio && typeof data.radio === "object") {
        radioState = normalizeRadioState(data.radio);
      }
      if (Array.isArray(data.activity)) {
        activityLog = pruneActivity(data.activity.map(normalizeActivity));
        localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activityLog));
      }
      if (data.lva && typeof data.lva === "object") {
        lvaState = normalizeLvaState(data.lva);
        localStorage.setItem(LVA_KEY, JSON.stringify(lvaState));
      }
      if (data.pettyCash && typeof data.pettyCash === "object") {
        pettyCash = normalizePettyCash(data.pettyCash);
        localStorage.setItem(PETTY_KEY, JSON.stringify(pettyCash));
      }
      if (data.hr && typeof data.hr === "object") {
        hrData = normalizeHrData(data.hr);
        localStorage.setItem(HR_KEY, JSON.stringify(hrData));
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
      saveRadioState(true);
      savePettyCash(true);
      saveHrData(true);
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
    if (!canWriteClients()) {
      toast("No tienes permiso para editar clientes.");
      return;
    }
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
  document.getElementById("nName")?.addEventListener("input", () => updateEmployeeNameDupHint("nName", "nNameDupHint"));
  document.getElementById("eName")?.addEventListener("input", () => updateEmployeeNameDupHint("eName", "eNameDupHint", selectedEmployeeId));
  document.querySelectorAll(".activity-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      activityFilter = btn.dataset.activityFilter || "all";
      renderActivityLog();
    });
  });
  document.getElementById("btnSaveEmployee").addEventListener("click", saveEmployeeDetail);
  document.getElementById("btnPrintEmpHrSheet")?.addEventListener("click", () => {
    const emp = getEmployee(selectedEmployeeId);
    printEmployeeHireSheet(emp);
  });
  document.getElementById("btnDeactivateEmployee").addEventListener("click", deactivateSelectedEmployee);
  document.getElementById("btnReactivateEmployee").addEventListener("click", reactivateSelectedEmployee);
  document.querySelectorAll(".emp-tab[data-emp-filter]").forEach((tab) => {
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
  document.getElementById("btnOpenEmpPhoto")?.addEventListener("click", openEmpPhotoPreview);
  document.getElementById("btnEmpPhotoExpand")?.addEventListener("click", openEmpPhotoPreview);
  document.getElementById("btnEmpDocExpand")?.addEventListener("click", openEmpDocument);
  document.getElementById("btnCloseLightbox")?.addEventListener("click", closeMediaLightbox);
  document.getElementById("mediaLightbox")?.addEventListener("click", (e) => {
    if (e.target && e.target.id === "mediaLightbox") closeMediaLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMediaLightbox();
  });
  bindLoansUi();
  bindCajaUi();
  bindHrUi();
  bindMonorrielUi();
  bindLvaUi();
  bindPrintUi();
  bindMessagesUi();
  bindRadioUi();

  document.getElementById("btnAppLogin").addEventListener("click", tryAppLogin);
  document.getElementById("btnBiometricLogin")?.addEventListener("click", () => {
    tryBiometricLogin();
  });
  document.getElementById("btnBiometricDisable")?.addEventListener("click", disableBiometricOnThisDevice);

  document.getElementById("loginPassword").addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryAppLogin();
  });
  document.getElementById("loginUsername").addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryAppLogin();
  });
  document.getElementById("btnLogoutUser").addEventListener("click", logoutAppUser);
  document.getElementById("btnSaveUser").addEventListener("click", saveUserFromForm);
  document.getElementById("btnCancelUserEdit").addEventListener("click", clearUserForm);
  document.getElementById("btnToggleUserPass")?.addEventListener("click", () => {
    const input = document.getElementById("uPassword");
    const btn = document.getElementById("btnToggleUserPass");
    if (!input || !btn) return;
    const hide = input.type === "text";
    input.type = hide ? "password" : "text";
    btn.textContent = hide ? "Mostrar" : "Ocultar";
  });
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
  activityLog = pruneActivity(loadJson(ACTIVITY_KEY, []));
  lvaState = normalizeLvaState(loadJsonObject(LVA_KEY, emptyLvaState()));
  radioState = normalizeRadioState(loadJsonObject(RADIO_KEY, emptyRadioState()));
  pettyCash = normalizePettyCash(loadJsonObject(PETTY_KEY, emptyPettyCash()));
  hrData = normalizeHrData(loadJsonObject(HR_KEY, emptyHrData()));
  if (!radioState.streamUrl) radioState.streamUrl = DEFAULT_RADIO_STREAM;
  ensureOwnerUser();
  localStorage.setItem(USERS_KEY, JSON.stringify(appUsers));
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(chatMessages));
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activityLog));
  localStorage.setItem(LVA_KEY, JSON.stringify(lvaState));
  localStorage.setItem(RADIO_KEY, JSON.stringify(radioState));
  localStorage.setItem(PETTY_KEY, JSON.stringify(pettyCash));
  localStorage.setItem(HR_KEY, JSON.stringify(hrData));
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
    localStorage.setItem(RADIO_KEY, JSON.stringify(radioState));
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
    localStorage.setItem(RADIO_KEY, JSON.stringify(radioState));
    // Sube el listado consolidado a la nube (sin borrar servicios)
    if (cloud.usedCloud && (employees.length || loans.length || monorrielReports.length || appUsers.length || chatMessages.length || radioState.streamUrl)) await pushToCloud();
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
  refreshBiometricLoginUi();

  if (cloud.usedCloud && !added && currentUser) {
    toast("Datos sincronizados desde la nube.");
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js?v=45").then((reg) => {
      reg.update().catch(() => {});
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }).catch(() => {});
    // limpia caches viejas que dejaban el inicio vertical
    if (window.caches) {
      caches.keys().then((keys) => {
        keys.filter((k) => k.startsWith("rfs-ops-") && k !== "rfs-ops-v45").forEach((k) => caches.delete(k));
      }).catch(() => {});
    }
  }
});
