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
/** Build de esta App (subir en cada deploy). Candado anti-versión-vieja. */
const APP_BUILD = 187;
const APP_VERSION_LABEL = "v187";
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
/** Límite del archivo final (tras comprimir imágenes). Antes no se rechaza la cámara en bruto. */
const EMP_DOC_MAX_BYTES = 450 * 1024;
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

/** Misma persona aunque el nombre lleve (Monorriel) / (La Vega). */
function employeeIdentityKey(name) {
  const base =
    typeof monoBaseName === "function"
      ? monoBaseName(name)
      : String(name || "")
          .replace(/\s*\(monorriel\)\s*$/i, "")
          .replace(/\s*\(la vega(?: autopista)?\)\s*$/i, "")
          .trim();
  return employeeKey(base || name);
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
    hiredPosition: String(p.hiredPosition || "").trim(),
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
    hiredPosition: preferFill(a.hiredPosition, b.hiredPosition),
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
    photoUrl: e.photoUrl || "",
    photoMediaId: e.photoMediaId || "",
    photoStoragePath: e.photoStoragePath || "",
    documentData: e.documentData || "",
    documentUrl: e.documentUrl || "",
    documentMediaId: e.documentMediaId || "",
    documentStoragePath: e.documentStoragePath || "",
    documentName: e.documentName || "",
    documentMime: e.documentMime || "",
    roles: Array.isArray(e.roles) ? e.roles.filter(Boolean) : [],
    sites: Array.isArray(e.sites) ? e.sites.filter(Boolean) : [],
    status,
    inactiveReason: e.inactiveReason || "",
    inactiveAt: e.inactiveAt || "",
    hrApplicationId: String(e.hrApplicationId || "").trim(),
    officeEmployeeId: String(e.officeEmployeeId || "").trim(),
    salary: Math.max(0, Number(e.salary) || 0),
    hrProfile: normalizeEmployeeHrProfile(e.hrProfile || {}),
    monoUnifyAliases: Array.isArray(e.monoUnifyAliases)
      ? [...new Set(e.monoUnifyAliases.map((a) => String(a || "").trim()).filter(Boolean))]
      : [],
    updatedAt: e.updatedAt || new Date().toISOString(),
  };
}

function isEmployeeActive(emp) {
  return !emp || emp.status !== "inactive";
}

function applyMonorrielFlag(emp, isMono) {
  const out = normalizeEmployee(emp);
  const keepLva =
    typeof isLvaEmployee === "function"
      ? isLvaEmployee(out)
      : /\(la vega/i.test(out.name || "") ||
        (out.sites || []).some((s) => /la vega/i.test(s || ""));
  let name = monoBaseName(out.name) || out.name;
  if (isMono) {
    name = monoDisplayName(name);
    out.sites = [...new Set([...(out.sites || []), "Monorriel"])];
    out.roles = [...new Set([...(out.roles || []), "Monorriel"])];
  } else {
    out.sites = (out.sites || []).filter((s) => !/monorriel/i.test(s));
    out.roles = (out.roles || []).filter((r) => !/monorriel/i.test(r));
    if (keepLva && typeof lvaDisplayName === "function") {
      name = lvaDisplayName(name);
      out.sites = [...new Set([...(out.sites || []), typeof LVA_SITE !== "undefined" ? LVA_SITE : "La Vega Autopista"])];
      out.roles = [...new Set([...(out.roles || []), typeof LVA_SITE !== "undefined" ? LVA_SITE : "La Vega Autopista"])];
    }
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

/** Prefiere data URL o http(s) de cualquiera de los dos lados (no perder fotos en merge). */
function preferMediaField(a, b) {
  const aa = String(a || "").trim();
  const bb = String(b || "").trim();
  const score = (v) => {
    if (!v) return 0;
    if (v.startsWith("data:")) return 3;
    if (/^https?:\/\//i.test(v)) return 2;
    return 1;
  };
  return score(bb) > score(aa) ? bb : aa || bb;
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
    photo: preferMediaField(base.photo, incoming.photo),
    photoUrl: preferMediaField(base.photoUrl, incoming.photoUrl),
    photoMediaId: preferFill(base.photoMediaId, incoming.photoMediaId),
    photoStoragePath: preferFill(base.photoStoragePath, incoming.photoStoragePath),
    documentData: preferMediaField(base.documentData, incoming.documentData),
    documentUrl: preferMediaField(base.documentUrl, incoming.documentUrl),
    documentMediaId: preferFill(base.documentMediaId, incoming.documentMediaId),
    documentStoragePath: preferFill(base.documentStoragePath, incoming.documentStoragePath),
    documentName: preferFill(base.documentName, incoming.documentName),
    documentMime: preferFill(base.documentMime, incoming.documentMime),
    roles: [...new Set([...(base.roles || []), ...(incoming.roles || [])].filter(Boolean))],
    sites: [...new Set([...(base.sites || []), ...(incoming.sites || [])].filter(Boolean))],
    status: base.status === "inactive" ? "inactive" : incoming.status === "inactive" ? "inactive" : "active",
    inactiveReason: preferFill(base.inactiveReason, incoming.inactiveReason),
    inactiveAt: preferFill(base.inactiveAt, incoming.inactiveAt),
    hrApplicationId: preferFill(base.hrApplicationId, incoming.hrApplicationId),
    hrProfile: mergeEmployeeHrProfile(base.hrProfile, incoming.hrProfile),
    monoUnifyAliases: [
      ...new Set(
        [...(base.monoUnifyAliases || []), ...(incoming.monoUnifyAliases || [])]
          .map((a) => String(a || "").trim())
          .filter(Boolean)
      ),
    ],
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
    const key = employeeIdentityKey(e.name);
    if (!key) return;
    if (map.has(key)) map.set(key, mergeEmployeeRecord(map.get(key), e));
    else map.set(key, e);
  });

  posts.forEach((post) => {
    (post.guards || []).forEach((g) => {
      const name = (g.name || "").trim();
      if (!name || name.toLowerCase() === "por asignar") return;
      const key = employeeIdentityKey(name);
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

  employees = dedupeEmployeesList([...map.values()]);
  return employees;
}

function employeeRecordScore(e) {
  if (!e) return 0;
  let s = 0;
  ["phone", "cedula", "companyEntryDate", "weapons", "serial", "photo", "photoUrl", "note"].forEach((f) => {
    if (String(e[f] || "").trim()) s += 2;
  });
  s += (e.sites || []).length;
  s += (e.roles || []).length;
  if (e.officeEmployeeId) s += 3;
  if (e.salary > 0) s += 1;
  if (isEmployeeActive(e)) s += 1;
  s += Math.min(5, Math.floor((Date.parse(e.updatedAt || "") || 0) / 1e12));
  return s;
}

function pickCanonicalEmployeeId(a, b) {
  const ugly = (id) => /\(MONORRIEL\)|\(LA-VEGA|\(LA VEGA/i.test(String(id || ""));
  if (a && a.id && b && b.id) {
    if (ugly(a.id) && !ugly(b.id)) return b.id;
    if (ugly(b.id) && !ugly(a.id)) return a.id;
    if (a.officeEmployeeId && a.id === a.officeEmployeeId) return a.id;
    if (b.officeEmployeeId && b.id === b.officeEmployeeId) return b.id;
  }
  const sa = employeeRecordScore(a);
  const sb = employeeRecordScore(b);
  if (sb > sa) return (b && b.id) || (a && a.id) || "";
  return (a && a.id) || (b && b.id) || "";
}

/** Une duplicados de la misma persona (nombre base). Devuelve lista limpia. */
function dedupeEmployeesList(list) {
  const map = new Map();
  const idRemap = {};
  (list || []).forEach((raw) => {
    const e = normalizeEmployee(raw || {});
    if (!e.name || e.name.toLowerCase() === "por asignar") return;
    const key = employeeIdentityKey(e.name);
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, e);
      return;
    }
    const prev = map.get(key);
    const keepId = pickCanonicalEmployeeId(prev, e);
    let merged = mergeEmployeeRecord(prev, e);
    merged.id = keepId || merged.id;
    if (prev.id && prev.id !== merged.id) idRemap[prev.id] = merged.id;
    if (e.id && e.id !== merged.id) idRemap[e.id] = merged.id;
    const wantMono =
      (typeof isMonorrielEmployee === "function" && (isMonorrielEmployee(prev) || isMonorrielEmployee(e))) ||
      (merged.sites || []).some((s) => /monorriel/i.test(s || ""));
    const wantLva =
      (typeof isLvaEmployee === "function" && (isLvaEmployee(prev) || isLvaEmployee(e))) ||
      (merged.sites || []).some((s) => /la vega/i.test(s || ""));
    if (wantMono && typeof applyMonorrielFlag === "function") merged = applyMonorrielFlag(merged, true);
    if (wantLva && typeof applyLvaFlag === "function") merged = applyLvaFlag(merged, true);
    merged.updatedAt = new Date().toISOString();
    map.set(key, normalizeEmployee(merged));
  });
  const out = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  if (typeof loans !== "undefined" && Array.isArray(loans) && Object.keys(idRemap).length) {
    loans.forEach((l) => {
      if (l && l.employeeId && idRemap[l.employeeId]) l.employeeId = idRemap[l.employeeId];
    });
  }
  return out;
}

function dedupeEmployeesNow(opts = {}) {
  const before = (employees || []).length;
  employees = dedupeEmployeesList(employees);
  const after = employees.length;
  const removed = Math.max(0, before - after);
  if (removed || opts.forceSave) {
    localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees));
    if (opts.push !== false) queueCloudSave();
  }
  return { before, after, removed };
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

function normalizeWhatsAppPhone(raw) {
  let digits = String(raw || "").replace(/\D+/g, "");
  if (!digits) return "";
  // RD: 809/829/849… (10 dígitos) → 1 + local
  if (digits.length === 10 && /^[89]/.test(digits)) digits = `1${digits}`;
  // ya con código país 1
  if (digits.length === 11 && digits.startsWith("1")) return digits;
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return "";
}

async function copyAndOpenWhatsAppCall(phone, ev) {
  if (ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }
  const display = String(phone || "").trim();
  const wa = normalizeWhatsAppPhone(display);
  if (!wa) {
    toast("Este empleado no tiene teléfono.");
    return;
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(display || wa);
    }
  } catch (_) {}
  toast("Número copiado · Abriendo WhatsApp…");
  // Chat listo para llamar al contacto de inmediato
  window.open(`https://wa.me/${wa}`, "_blank", "noopener,noreferrer");
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
  const saveAllBtn = document.getElementById("btnSaveAllEmployees");
  if (saveAllBtn) saveAllBtn.hidden = !canWriteEmployees() || employeeListFilter === "inactive";

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
            e.cedula ? `Cédula: ${e.cedula}` : "Cédula: —",
            e.documentData || e.documentUrl ? "Doc ✓" : "Sin doc",
            `${filled}/${total} datos`,
          ].join(" · ")
        : `Causa: ${e.inactiveReason || "—"} · ${e.inactiveAt ? e.inactiveAt.slice(0, 10) : ""}`;
      const initial = escapeHtml((e.name || "?").trim().charAt(0).toUpperCase() || "?");
      const avatar = e.photo
        ? `<img class="avatar" src="${e.photo}" alt="" />`
        : `<span class="avatar placeholder">${initial}</span>`;
      const pill = !isEmployeeActive(e) ? "alert" : filled === total ? "ok" : "warn";
      const pillText = !isEmployeeActive(e) ? "Inactivo" : `${filled}/${total}`;
      const hasPhone = !!(e.phone && normalizeWhatsAppPhone(e.phone));
      const waBtn = hasPhone
        ? `<button class="emp-wa-call" type="button" data-phone="${escapeHtml(e.phone)}" title="Copiar y WhatsApp" aria-label="Llamar por WhatsApp">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
              <path fill="currentColor" d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.5 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.7 21 3 13.3 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.3 0 .7-.2 1L6.6 10.8z"/>
            </svg>
          </button>`
        : `<span class="emp-wa-call emp-wa-call-disabled" title="Sin teléfono" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" focusable="false">
              <path fill="currentColor" d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.5 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.7 21 3 13.3 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.3 0 .7-.2 1L6.6 10.8z"/>
            </svg>
          </span>`;
      return `
      <article class="employee-card" data-id="${escapeHtml(e.id)}">
        <div class="row">
          ${avatar}
          <div class="emp-card-main">
            <h3>${escapeHtml(e.name)}</h3>
            <p>${escapeHtml(sitesFixed)}</p>
            <p class="emp-card-meta">${escapeHtml(meta)}</p>
          </div>
          <div class="emp-card-aside">
            <span class="status-pill ${pill}">${pillText}</span>
            ${waBtn}
          </div>
        </div>
      </article>`;
    })
    .join("");

  list.querySelectorAll(".employee-card").forEach((card) => {
    card.addEventListener("click", (ev) => {
      if (ev.target.closest(".emp-wa-call")) return;
      openEmployeeDetail(card.dataset.id);
    });
  });
  list.querySelectorAll("button.emp-wa-call").forEach((btn) => {
    btn.addEventListener("click", (ev) => copyAndOpenWhatsAppCall(btn.dataset.phone, ev));
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
function findSimilarMonorrielEmployees(name, excludeId = null) {
  const raw = String(name || "").trim();
  if (raw.length < 3) return [];
  return getMonorrielEmployees(true)
    .filter((e) => e && e.id !== excludeId)
    .map((e) => {
      const sim = nameSimilarity(raw, e.name);
      return { emp: e, score: sim.score, exact: sim.exact };
    })
    .filter((x) => x.score >= 0.72)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

/** Alerta antes de crear/asignar nombre Monorriel si hay parecidos. */
function confirmMonoNameNotDuplicate(rawName, excludeId = null) {
  const similar = findSimilarMonorrielEmployees(rawName, excludeId);
  if (!similar.length) return true;
  const msg =
    "⚠ Nombres muy parecidos en Monorriel:\n" +
    formatDupHint(similar) +
    "\n\nPueden ser la misma persona (mala escritura).\n" +
    "¿Continuar de todos modos?\n\nTip: en Personal Monorriel puedes marcarlos y usar Unificar.";
  return window.confirm(msg);
}

function ensureEmployeeFromMonoName(rawName) {
  const base = String(rawName || "").trim();
  if (!base || base.toLowerCase() === "vacante") return null;
  const display = monoDisplayName(base);
  const key = employeeKey(display);
  const keyBase = employeeKey(monoBaseName(display));
  let existing = employees.find(
    (e) => employeeKey(e.name) === key || employeeKey(monoBaseName(e.name)) === keyBase
  );
  // Si ese nombre se unificó antes, reutilizar el Principal
  if (!existing && keyBase) {
    existing = employees.find(
      (e) =>
        Array.isArray(e.monoUnifyAliases) &&
        e.monoUnifyAliases.some((a) => String(a) === keyBase || String(a) === key)
    );
  }
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
  // Alerta nombres parecidos antes de crear otro Monorriel
  if (!confirmMonoNameNotDuplicate(base)) {
    toast("No se creó: revisa Personal Monorriel → Unificar si es el mismo.");
    return null;
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
  return (emp && (emp.photo || emp.photoUrl)) || "";
}

function currentEmpDoc() {
  if (pendingEmpDoc && pendingEmpDoc.dataUrl === "") {
    return { dataUrl: "", name: "", mime: "" };
  }
  if (pendingEmpDoc && pendingEmpDoc.dataUrl) return pendingEmpDoc;
  const emp = getEmployee(selectedEmployeeId);
  if (!emp) return { dataUrl: "", name: "", mime: "" };
  const dataUrl = emp.documentData || emp.documentUrl || "";
  if (!dataUrl) return { dataUrl: "", name: "", mime: "" };
  return {
    dataUrl,
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
  toast("Procesando foto…");
  try {
    // Más liviana para Firebase Storage (~640px / 0.62)
    pendingEmpPhoto = await compressImage(file, 640, 0.62);
    renderEmpPhotoPreview();
    toast("Foto lista. Pulsa Guardar empleado (se sube a Storage).");
  } catch (err) {
    console.error(err);
    toast("No se pudo procesar la foto. Prueba JPG/PNG o otra toma.");
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
  const isImage =
    mime.startsWith("image/") ||
    /\.(jpe?g|png|heic|heif|webp)$/i.test(name) ||
    (!mime && /\.(jpe?g|png|heic|heif|webp)$/i.test(name));
  if (!isPdf && !isImage) {
    toast("Solo se permiten JPG, PNG o PDF.");
    event.target.value = "";
    return;
  }
  // PDF: límite en bruto. Imagen (cámara): comprimir primero — el original suele pesar varios MB.
  if (isPdf && file.size > EMP_DOC_MAX_BYTES) {
    toast("El PDF es muy pesado. Usa uno de máximo ~450 KB.");
    event.target.value = "";
    return;
  }
  toast(isImage ? "Procesando imagen del documento…" : "Leyendo PDF…");
  try {
    let dataUrl;
    let outMime = mime;
    let outName = name;
    if (isImage) {
      dataUrl = await compressImage(file, 1100, 0.68);
      outMime = "image/jpeg";
      if (!/\.jpe?g$/i.test(outName)) outName = outName.replace(/\.[^.]+$/, "") + ".jpg" || "cedula.jpg";
      if (!outName || outName === ".jpg") outName = "cedula.jpg";
    } else {
      dataUrl = await readFileAsDataUrl(file);
      outMime = "application/pdf";
    }
    // data URL ~ +33% size
    if (String(dataUrl).length > EMP_DOC_MAX_BYTES * 1.5) {
      if (isImage) {
        dataUrl = await compressImage(file, 900, 0.55);
        if (String(dataUrl).length > EMP_DOC_MAX_BYTES * 1.5) {
          toast("La imagen quedó muy grande. Acércate menos o toma de nuevo.");
          event.target.value = "";
          return;
        }
      } else {
        toast("El archivo quedó muy grande después de cargarlo.");
        event.target.value = "";
        return;
      }
    }
    pendingEmpDoc = { dataUrl, name: outName, mime: outMime };
    renderEmpDocPreview();
    toast("Documento listo. Pulsa Guardar empleado.");
  } catch (err) {
    console.error(err);
    toast("No se pudo leer el documento. Prueba JPG o PDF más liviano.");
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
  // Si faltó la cédula al contratar (versión anterior), recuperar desde RRHH/Depuración
  try {
    const live = getEmployee(selectedEmployeeId) || emp;
    if (
      live &&
      !(live.documentData || live.documentUrl) &&
      live.hrApplicationId &&
      typeof getHrApp === "function" &&
      typeof attachCedulaDocToEmployee === "function"
    ) {
      const app = getHrApp(live.hrApplicationId);
      if (app && attachCedulaDocToEmployee(live, app)) {
        saveEmployees();
        renderEmpDocPreview();
        toast("Se adjuntó la cédula desde Depuración/RRHH.");
      }
    }
  } catch (_) {}
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
    hiredPosition: app.hiredPosition || "",
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
  const photoSrc = emp.photo || emp.photoUrl || "";
  const photo = photoSrc
    ? `<img src="${photoSrc}" alt="Foto" style="width:110px;height:130px;object-fit:cover;border:1px solid #333;border-radius:6px" />`
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
  const hirePhoto = emp.photo || emp.photoUrl || "";
  if (
    !hirePhoto ||
    !(String(hirePhoto).startsWith("data:image") || /^https?:\/\//i.test(hirePhoto))
  ) {
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
  const isMono = document.getElementById("eMonorriel").checked;
  const similar = findSimilarEmployees(name, current.id);
  if (similar.some((m) => m.exact)) {
    toast("Ese nombre ya pertenece a otro empleado.");
    updateEmployeeNameDupHint("eName", "eNameDupHint", current.id);
    return;
  }
  // Monorriel: alerta de nombres muy parecidos antes de guardar (misma persona mal escrita)
  if (
    (isMono || isMonorrielEmployee(current)) &&
    employeeKey(name) !== employeeKey(current.name) &&
    !confirmMonoNameNotDuplicate(name, current.id)
  ) {
    return;
  }
  if (
    !(isMono || isMonorrielEmployee(current)) &&
    similar.length &&
    employeeKey(name) !== employeeKey(current.name)
  ) {
    const msg = "El nuevo nombre se parece a:\n" + formatDupHint(similar) + "\n\n¿Guardar de todos modos?";
    if (!window.confirm(msg)) return;
  }
  const photo = currentEmpPhoto();
  const doc = currentEmpDoc();
  const clearingPhoto = pendingEmpPhoto === "";
  const clearingDoc = pendingEmpDoc && pendingEmpDoc.dataUrl === "";
  const newPhotoData = !!(pendingEmpPhoto && String(pendingEmpPhoto).startsWith("data:"));
  const newDocData = !!(pendingEmpDoc && pendingEmpDoc.dataUrl && String(pendingEmpDoc.dataUrl).startsWith("data:"));
  const photoIsHttp = /^https?:\/\//i.test(photo || "");
  const docIsHttp = /^https?:\/\//i.test((doc && doc.dataUrl) || "");
  // Nunca borrar foto/doc de Storage solo porque el formulario no la tenía en memoria
  let nextPhoto = current.photo || "";
  let nextPhotoUrl = current.photoUrl || "";
  let nextPhotoMediaId = current.photoMediaId || "";
  let nextPhotoStoragePath = current.photoStoragePath || "";
  if (clearingPhoto) {
    nextPhoto = "";
    nextPhotoUrl = "";
    nextPhotoMediaId = "";
    nextPhotoStoragePath = "";
  } else if (newPhotoData) {
    nextPhoto = pendingEmpPhoto;
    nextPhotoUrl = "";
    nextPhotoMediaId = "";
    // se conserva photoStoragePath para sobrescribir el mismo archivo en Storage
  } else if (photoIsHttp) {
    nextPhoto = photo;
    nextPhotoUrl = photo;
  } else if (photo) {
    nextPhoto = photo;
  }

  let nextDocData = current.documentData || "";
  let nextDocUrl = current.documentUrl || "";
  let nextDocMediaId = current.documentMediaId || "";
  let nextDocStoragePath = current.documentStoragePath || "";
  let nextDocName = current.documentName || "";
  let nextDocMime = current.documentMime || "";
  if (clearingDoc) {
    nextDocData = "";
    nextDocUrl = "";
    nextDocMediaId = "";
    nextDocStoragePath = "";
    nextDocName = "";
    nextDocMime = "";
  } else if (newDocData) {
    nextDocData = pendingEmpDoc.dataUrl;
    nextDocUrl = "";
    nextDocMediaId = "";
    nextDocName = pendingEmpDoc.name || current.documentName || "";
    nextDocMime = pendingEmpDoc.mime || current.documentMime || "";
  } else if (docIsHttp) {
    nextDocData = doc.dataUrl;
    nextDocUrl = doc.dataUrl;
  } else if (doc && doc.dataUrl) {
    nextDocData = doc.dataUrl;
    nextDocName = doc.name || nextDocName;
    nextDocMime = doc.mime || nextDocMime;
  }

  let updated = normalizeEmployee({
    ...current,
    name,
    phone: document.getElementById("ePhone").value.trim(),
    cedula: document.getElementById("eCedula").value.trim(),
    companyEntryDate: document.getElementById("eEntry").value,
    weapons: document.getElementById("eWeapons").value.trim(),
    serial: document.getElementById("eSerial").value.trim(),
    note: document.getElementById("eNote").value.trim(),
    photo: nextPhoto,
    photoUrl: nextPhotoUrl,
    photoMediaId: nextPhotoMediaId,
    photoStoragePath: nextPhotoStoragePath,
    documentData: nextDocData,
    documentUrl: nextDocUrl,
    documentMediaId: nextDocMediaId,
    documentStoragePath: nextDocStoragePath,
    documentName: nextDocName,
    documentMime: nextDocMime,
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
  const prevPhotoPath = current.photoStoragePath || "";
  const prevDocPath = current.documentStoragePath || "";
  const prevPhotoMedia = current.photoMediaId || "";
  const prevDocMedia = current.documentMediaId || "";
  pendingEmpPhoto = null;
  pendingEmpDoc = null;
  // Borrado explícito en Storage / rfs_media solo si el usuario quitó la foto/doc
  if (clearingPhoto && window.RFSCloudApi) {
    if (prevPhotoPath && typeof window.RFSCloudApi.deleteStoragePath === "function") {
      window.RFSCloudApi.deleteStoragePath(prevPhotoPath).catch(() => {});
    }
    if (prevPhotoMedia && typeof window.RFSCloudApi.deleteMedia === "function") {
      window.RFSCloudApi.deleteMedia(prevPhotoMedia).catch(() => {});
    }
  }
  if (clearingDoc && window.RFSCloudApi) {
    if (prevDocPath && typeof window.RFSCloudApi.deleteStoragePath === "function") {
      window.RFSCloudApi.deleteStoragePath(prevDocPath).catch(() => {});
    }
    if (prevDocMedia && typeof window.RFSCloudApi.deleteMedia === "function") {
      window.RFSCloudApi.deleteMedia(prevDocMedia).catch(() => {});
    }
  }
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
    createdAt: p.createdAt || "",
    updatedAt: p.updatedAt || "",
  };
}

/** Fusiona reportes de incidente por id; no pierde altas locales. */
function mergeReportsForCloud(localList, remoteList) {
  if (window.RFSCloudApi && typeof window.RFSCloudApi.mergeReportsPreferUnion === "function") {
    return window.RFSCloudApi.mergeReportsPreferUnion(localList, remoteList);
  }
  const map = new Map();
  const put = (raw, preferIfTie) => {
    if (!raw || !raw.id) return;
    if (!map.has(raw.id)) {
      map.set(raw.id, raw);
      return;
    }
    const prev = map.get(raw.id);
    const ta = Date.parse(prev.updatedAt || prev.createdAt || "") || 0;
    const tb = Date.parse(raw.updatedAt || raw.createdAt || "") || 0;
    if (tb > ta || (tb === ta && preferIfTie)) map.set(raw.id, raw);
  };
  (remoteList || []).forEach((r) => put(r, false));
  (localList || []).forEach((r) => put(r, true));
  return [...map.values()];
}

/** Fusiona clientes/puestos por id; no pierde altas locales al sincronizar. */
function mergePostsForCloud(localList, remoteList) {
  const map = new Map();
  const put = (raw, preferIfTie = false) => {
    const p = normalizePost(raw || {});
    if (!p.id) return;
    if (!map.has(p.id)) {
      map.set(p.id, p);
      return;
    }
    const prev = map.get(p.id);
    const ta = Date.parse(prev.updatedAt || prev.createdAt || "") || 0;
    const tb = Date.parse(p.updatedAt || p.createdAt || "") || 0;
    if (tb > ta || (tb === ta && preferIfTie)) {
      // Conservar historial más largo y número de cliente si el ganador no lo trae
      const winner = { ...p };
      if (!winner.clientNumber && prev.clientNumber) winner.clientNumber = prev.clientNumber;
      if ((prev.history || []).length > (winner.history || []).length) winner.history = prev.history;
      if (!(winner.guards || []).some((g) => g && g.name) && (prev.guards || []).some((g) => g && g.name)) {
        winner.guards = prev.guards;
        winner.guardCount = prev.guardCount;
      }
      map.set(p.id, normalizePost(winner));
    } else {
      const winner = { ...prev };
      if (!winner.clientNumber && p.clientNumber) winner.clientNumber = p.clientNumber;
      if ((p.history || []).length > (winner.history || []).length) winner.history = p.history;
      map.set(p.id, normalizePost(winner));
    }
  };
  (remoteList || []).forEach((p) => put(p, false));
  (localList || []).forEach((p) => put(p, true));
  return [...map.values()];
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
let lastKnownCloudUpdatedAt = null;
let lastLocalEditAt = 0;
let lastLivePullAt = 0;
let livePullInFlight = false;
let liveSyncTimer = null;
const CLOUD_SAVE_DEBOUNCE_MS = 250;
const LIVE_SYNC_INTERVAL_MS = 12000;
const LIVE_PULL_MIN_GAP_MS = 8000;
const LOCAL_EDIT_GRACE_MS = 4000;

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
  employees = dedupeEmployeesList(employees || []);
  localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees));
  queueCloudSave();
}

/** Guarda la lista completa de empleados en local + nube (tras limpiar duplicados). */
function saveAllEmployees() {
  if (typeof canWriteEmployees === "function" && !canWriteEmployees()) {
    toast("No tienes permiso para guardar empleados.");
    return;
  }
  const r = dedupeEmployeesNow({ forceSave: true, push: true });
  flushCloudSave();
  renderEmployees();
  toast(
    r.removed
      ? `Guardado · ${r.after} empleados · se unieron ${r.removed} duplicado(s).`
      : `Guardado · ${r.after} empleados en la nube.`
  );
  if (typeof logActivity === "function") {
    logActivity("employees_save_all", `Guardar todos: ${r.after} (−${r.removed} dup)`);
  }
}

function queueCloudSave() {
  if (!window.RFSCloudApi) return;
  lastLocalEditAt = Date.now();
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => {
    cloudSaveTimer = null;
    pushToCloud().catch(() => {});
  }, CLOUD_SAVE_DEBOUNCE_MS);
}

/** Sube ya (sin esperar el debounce): al cambiar de pestaña/PC o al perder foco. */
function flushCloudSave() {
  if (!window.RFSCloudApi) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = null;
  if (cloudSaving) {
    cloudSavePending = true;
    return;
  }
  pushToCloud().catch(() => {});
}


/** Formulario de reporte de incidente/novedad a medio escribir. */
function isIncidentReportBeingEdited() {
  const active = document.querySelector(".view.active");
  if (!active || active.id !== "reportsView") return false;
  const form = document.getElementById("reportForm") || document.getElementById("reportsView");
  if (form && document.activeElement && form.contains(document.activeElement)) {
    const tag = (document.activeElement.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
  }
  return false;
}

function refreshUiAfterCloudSync() {
  try {
    const active = document.querySelector(".view.active");
    const activeId = active ? active.id : "";

    // Preservar borrador Monorriel: no reconstruir el editor ni cambiar de pantalla
    if (typeof isMonoReportBeingEdited === "function" && isMonoReportBeingEdited()) {
      flushOpenMonoReportDraft();
      applyMonoReportMetaToDom(monoDraftMeta);
      // Actualizar opciones de lista sin recrear filas (conserva lo escrito)
      try {
        refreshMonoStaffSelectOptions();
        updateMonoCoverageHint();
      } catch (_) {}
      applyAccessControl();
      if (typeof updateMessagesTabBadge === "function") updateMessagesTabBadge();
      return;
    }

    // Nómina abierta: no re-renderizar la tabla (pisa teclas a medias)
    if (typeof isPayrollBeingEdited === "function" && isPayrollBeingEdited()) {
      applyAccessControl();
      if (typeof updateMessagesTabBadge === "function") updateMessagesTabBadge();
      return;
    }

    // RRHH / Depuración: ya evitan refill; igual no tocar otras vistas pesadas en exceso
    if (
      (typeof isHrFormBeingEdited === "function" && isHrFormBeingEdited()) ||
      (typeof isDepFormBeingEdited === "function" && isDepFormBeingEdited())
    ) {
      if (typeof renderHrModule === "function" && activeId === "hrView") renderHrModule();
      if (typeof renderDepuracionModule === "function" && activeId === "depuracionView") {
        renderDepuracionModule();
      }
      applyAccessControl();
      if (typeof updateMessagesTabBadge === "function") updateMessagesTabBadge();
      return;
    }

    // Re-render selectivo: solo la vista activa + listados livianos de inicio
    if (activeId === "shiftsView" || activeId === "homeView") renderShifts();
    if (activeId === "reportsView") {
      fillReportPostSelect();
      renderReports();
    }
    if (activeId === "financeView") renderFinance();
    if (activeId === "employeesView" || activeId === "employeeDetailView" || activeId === "employeeNewView") {
      renderEmployees();
    }
    if (activeId === "loansView" || activeId === "loanDetailView" || activeId === "loanNewView") renderLoans();
    if (
      activeId === "monorrielView" ||
      activeId === "monoReportDetailView" ||
      activeId === "monoStaffView" ||
      activeId === "monoEmployeeSummaryView"
    ) {
      renderMonorrielHome();
      if (activeId === "monoStaffView") renderMonoStaffList();
      if (activeId === "monoEmployeeSummaryView") renderMonoEmployeeSummary();
    }
    if (activeId === "monoReportEditView") {
      // Vista de edición abierta pero sin foco reciente: conservar filas, solo refrescar listas
      flushOpenMonoReportDraft();
      applyMonoReportMetaToDom(monoDraftMeta);
      try {
        refreshMonoStaffSelectOptions();
        updateMonoCoverageHint();
      } catch (_) {}
    }
    // Nunca llamar renderMonoPostsEditor aquí: borraría lo que se escribe
    if (activeId === "lvaView" && typeof renderLvaModule === "function") renderLvaModule();
    if (activeId === "cajaView" && typeof renderCajaModule === "function") renderCajaModule();
    if (activeId === "suplidoresView" && typeof renderSuplidoresModule === "function") renderSuplidoresModule();
    if (activeId === "hrView" && typeof renderHrModule === "function") renderHrModule();
    if (activeId === "depuracionView" && typeof renderDepuracionModule === "function") {
      renderDepuracionModule();
    }
    if (activeId === "contabilidadView" && typeof renderContabilidadModule === "function") {
      renderContabilidadModule();
    }
    if (activeId === "nominaView" && typeof renderNominaModule === "function") {
      renderNominaModule();
    }
    if (activeId === "quotesView" && typeof renderQuotesModule === "function") renderQuotesModule();
    if (typeof renderMessagesModule === "function") {
      if (activeId === "messagesView") renderMessagesModule();
      else updateMessagesTabBadge();
    }
    if (typeof renderRadioModule === "function" && activeId === "radioView") renderRadioModule();
    if (typeof renderMarkers === "function" && activeId === "mapView") renderMarkers();
    applyAccessControl();
  } catch (err) {
    console.error(err);
  }
}

/**
 * Pull en vivo: mira updatedAt barato; si cambió (u otra PC guardó), baja todo y refresca UI.
 * force=true ignora throttle (botón Actualizar / al volver a la pestaña).
 */
async function livePullFromCloud(reason, opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  const force = !!options.force;
  // Solo el botón Actualizar puede forzar sync encima de alguien escribiendo
  const bypassEditing = force && reason === "manual";
  if (!window.RFSCloudApi || !navigator.onLine) return { pulled: false };
  if (cloudSaving || livePullInFlight) return { pulled: false, busy: true };
  const now = Date.now();
  if (!force && now - lastLocalEditAt < LOCAL_EDIT_GRACE_MS) {
    return { pulled: false, skipped: "local-edit" };
  }
  // No bajar nube mientras alguien escribe (evita borrar formularios / mandar al inicio)
  if (!bypassEditing) {
    if (typeof isHrFormBeingEdited === "function" && isHrFormBeingEdited()) {
      return { pulled: false, skipped: "hr-editing" };
    }
    if (typeof isDepFormBeingEdited === "function" && isDepFormBeingEdited()) {
      return { pulled: false, skipped: "dep-editing" };
    }
    if (typeof isMonoReportBeingEdited === "function" && isMonoReportBeingEdited()) {
      return { pulled: false, skipped: "mono-editing" };
    }
    if (typeof isPayrollBeingEdited === "function" && isPayrollBeingEdited()) {
      return { pulled: false, skipped: "payroll-editing" };
    }
    if (typeof isIncidentReportBeingEdited === "function" && isIncidentReportBeingEdited()) {
      return { pulled: false, skipped: "report-editing" };
    }
  }
  if (!force && now - lastLivePullAt < LIVE_PULL_MIN_GAP_MS) {
    return { pulled: false, skipped: "throttle" };
  }

  livePullInFlight = true;
  try {
    // Siempre mirar updatedAt primero (barato). force solo salta throttle/gracia local.
    if (typeof window.RFSCloudApi.peekCloudUpdatedAt === "function") {
      const meta = await window.RFSCloudApi.peekCloudUpdatedAt();
      if (
        meta &&
        !meta.empty &&
        meta.updatedAt &&
        lastKnownCloudUpdatedAt &&
        meta.updatedAt === lastKnownCloudUpdatedAt
      ) {
        lastLivePullAt = Date.now();
        if (force || reason === "manual") {
          setCloudStatus(
            `Nube: al día ✓ · sync ${new Date().toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
          );
        }
        return { pulled: false, skipped: "unchanged" };
      }
    }

    const before = lastKnownCloudUpdatedAt;
    if (typeof flushOpenMonoReportDraft === "function") flushOpenMonoReportDraft();
    if (typeof flushOpenPayrollDraft === "function") flushOpenPayrollDraft(false);
    const cloud = await syncFromCloud();
    lastLivePullAt = Date.now();
    if (cloud && cloud.usedCloud) {
      const changed = !before || before !== lastKnownCloudUpdatedAt;
      refreshUiAfterCloudSync();
      if (force || reason === "focus" || reason === "online" || reason === "manual" || changed) {
        setCloudStatus(
          lastKnownCloudUpdatedAt
            ? `Nube: al día ✓ · sync ${new Date().toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
            : "Nube: activa ✓"
        );
      }
      return { pulled: true, changed: !!changed };
    }
    return { pulled: false };
  } catch (err) {
    console.error(err);
    return { pulled: false, error: true };
  } finally {
    livePullInFlight = false;
  }
}

function startLiveCloudSync() {
  if (liveSyncTimer) return;
  liveSyncTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (!currentUser) return;
    livePullFromCloud("poll").catch(() => {});
  }, LIVE_SYNC_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushCloudSave();
      return;
    }
    livePullFromCloud("focus", { force: true }).catch(() => {});
  });
  window.addEventListener("focus", () => {
    if (document.visibilityState !== "visible") return;
    livePullFromCloud("focus", { force: true }).catch(() => {});
  });
  window.addEventListener("online", () => {
    flushCloudSave();
    livePullFromCloud("online", { force: true }).catch(() => {});
  });
  window.addEventListener("pagehide", () => flushCloudSave());
  window.addEventListener("beforeunload", () => flushCloudSave());

  const btn = document.getElementById("btnSyncNow");
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      flushCloudSave();
      livePullFromCloud("manual", { force: true })
        .then((r) => {
          if (r && r.pulled) toast("Datos actualizados desde la nube.");
          else if (r && r.skipped === "unchanged") toast("Ya estás al día.");
          else if (r && r.busy) toast("Sincronizando… espera un momento.");
          else toast("No se pudo actualizar ahora.");
        })
        .catch(() => toast("Sin conexión con la nube."));
    });
  }
}

let cloudSavePending = false;
let cloudRetryAttempt = 0;
let cloudRetryTimer = null;

function hasLocalLvaData() {
  try {
    const postsCount = (lvaState && Array.isArray(lvaState.posts) ? lvaState.posts : []).filter(
      (p) => p && p.active !== false && p.name
    ).length;
    const staffCount = (lvaState && Array.isArray(lvaState.staff) ? lvaState.staff : []).filter(
      (s) => s && s.active !== false && s.name
    ).length;
    return postsCount > 0 || staffCount > 0;
  } catch (_) {
    return false;
  }
}

function scheduleCloudRetry(reason) {
  cloudSavePending = true;
  cloudRetryAttempt += 1;
  const delay = Math.min(180000, 8000 * Math.pow(2, Math.min(cloudRetryAttempt, 4)));
  setCloudStatus(`Nube: ${reason} · reintento en ${Math.round(delay / 1000)}s…`);
  clearTimeout(cloudRetryTimer);
  cloudRetryTimer = setTimeout(() => {
    cloudSavePending = false;
    pushToCloud().catch(() => {});
  }, delay);
}

/** Fusiona listas de empleados por identidad (nombre base) + id; evita duplicados Monorriel. */
function mergeEmployeeListsForCloud(localList, remoteList) {
  const byId = new Map();
  const put = (raw) => {
    const e = normalizeEmployee(raw || {});
    if (!e.name) return;
    const id = e.id || `tmp-${employeeIdentityKey(e.name)}`;
    if (!byId.has(id)) {
      byId.set(id, e);
      return;
    }
    const prev = byId.get(id);
    const ta = Date.parse(prev.updatedAt || "") || 0;
    const tb = Date.parse(e.updatedAt || "") || 0;
    byId.set(id, tb >= ta ? mergeEmployeeRecord(prev, e) : mergeEmployeeRecord(e, prev));
  };
  (remoteList || []).forEach(put);
  (localList || []).forEach(put);
  return dedupeEmployeesList([...byId.values()]);
}

async function mergeRemoteBundleBeforeSave() {
  if (!window.RFSCloudApi) return true;
  try {
    const loader =
      typeof window.RFSCloudApi.loadCloudForMerge === "function"
        ? window.RFSCloudApi.loadCloudForMerge
        : window.RFSCloudApi.loadCloud;
    const remote = await loader.call(window.RFSCloudApi);
    if (!remote) return false;
    if (!remote.empty && Array.isArray(remote.messages)) {
      chatMessages = mergeChatMessages(chatMessages, remote.messages.map(normalizeChatMessage));
      localStorage.setItem(MESSAGES_KEY, JSON.stringify(chatMessages));
    }
    if (remote.lva && typeof remote.lva === "object") {
      applyRemoteLva(remote.lva);
    }
    if (typeof applyRemoteLoans === "function") {
      applyRemoteLoans(remote.loans || [], remote.loanTrash || []);
    }
    // Evita que una PC borre altas/edits de otra al guardar (caso Yimi / oficina)
    if (Array.isArray(remote.employees)) {
      employees = mergeEmployeeListsForCloud(employees, remote.employees);
      localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees));
    }
    // No pisar clientes/puestos nuevos de otra PC o de esta (caso Universidad Isa)
    if (Array.isArray(remote.posts)) {
      posts = mergePostsForCloud(posts, remote.posts);
      ensureClientNumbers(false);
      localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
    }
    // No pisar reportes Monorriel de otra PC (Ashley / supervisión)
    if (Array.isArray(remote.monorrielReports) || (monorrielReports && monorrielReports.length)) {
      monorrielReports = mergeMonorrielReportsForCloud(
        monorrielReports,
        remote.monorrielReports || []
      );
      restoreMonorrielReportsFromSafetyNet();
      localStorage.setItem(MONORRIEL_REPORTS_KEY, JSON.stringify(monorrielReports));
      persistMonorrielReportsSafetyNet(monorrielReports);
    }
    if (typeof flushOpenMonoReportDraft === "function") flushOpenMonoReportDraft();
    if (typeof flushOpenPayrollDraft === "function") flushOpenPayrollDraft(false);
    if (typeof flushOpenHrDraft === "function") flushOpenHrDraft(false);
    if (typeof flushOpenDepDraft === "function") flushOpenDepDraft(false);
    if (remote.hr && typeof remote.hr === "object" && typeof applyRemoteHrData === "function") {
      applyRemoteHrData(remote.hr);
    }
    if (remote.depuracion && typeof remote.depuracion === "object" && typeof applyRemoteDepuracionData === "function") {
      applyRemoteDepuracionData(remote.depuracion);
    }
    if (remote.contabilidad && typeof remote.contabilidad === "object" && typeof applyRemoteContabilidadData === "function") {
      applyRemoteContabilidadData(remote.contabilidad);
    }
    if (remote.suplidores && typeof remote.suplidores === "object" && typeof applyRemoteSuplidoresData === "function") {
      applyRemoteSuplidoresData(remote.suplidores);
    }
    if (remote.vargas && typeof remote.vargas === "object" && typeof applyRemoteVargasData === "function") {
      applyRemoteVargasData(remote.vargas);
    }
    return true;
  } catch (_) {
    return false;
  }
}

async function mergeRemoteMessagesBeforeSave() {
  return mergeRemoteBundleBeforeSave();
}

function cloudDepuracionPayload() {
  return typeof depuracionData !== "undefined" ? depuracionData : { candidates: [], settings: {} };
}

function cloudContabilidadPayload() {
  return typeof contabilidadData !== "undefined"
    ? contabilidadData
    : {
        expenses: [],
        itbisCollected: [],
        officeEmployees: [],
        lotedomEmployees: [],
        payrolls: [],
        payrollBackups: [],
        payrollBackupDeletedIds: [],
        settings: { defaultBook: "EDWARD" },
      };
}

function emptyContabilidadDataSafe() {
  return typeof emptyContabilidadData === "function"
    ? emptyContabilidadData()
    : {
        expenses: [],
        itbisCollected: [],
        officeEmployees: [],
        lotedomEmployees: [],
        payrolls: [],
        payrollBackups: [],
        payrollBackupDeletedIds: [],
        settings: { defaultBook: "EDWARD" },
      };
}

async function saveCloudBundle(options) {
  const opts = Object.assign({ clientBuild: APP_BUILD }, options || {});
  return window.RFSCloudApi.saveCloud(
    posts,
    reports,
    employees,
    loans,
    monorrielReports,
    appUsers,
    chatMessages,
    radioState,
    activityLog,
    lvaState,
    pettyCash,
    hrData,
    cloudDepuracionPayload(),
    cloudContabilidadPayload(),
    typeof suplidoresData !== "undefined" ? suplidoresData : { suppliers: [], payments: [], nextCodeSeq: 1 },
    typeof loanTrashIds !== "undefined" ? loanTrashIds : [],
    typeof vargasData !== "undefined" ? vargasData : { reports: [] },
    opts
  );
}

/** Subida dedicada del chat: no reescribe empleados/fotos y no borra mensajes ajenos */
async function pushMessagesToCloud() {
  if (!window.RFSCloudApi) throw new Error("cloud not configured");
  chatMessages = pruneChatMessages(chatMessages);
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(chatMessages));
  if (typeof window.RFSCloudApi.saveMessages === "function") {
    await window.RFSCloudApi.saveMessages(chatMessages);
  } else {
    await saveCloudBundle({ skipLva: !hasLocalLvaData() });
  }
  cloudReady = true;
}

async function pushToCloud() {
  if (!window.RFSCloudApi) return;
  if (appVersionBlocked) {
    setCloudStatus("Nube: bloqueada · actualiza la App");
    showAppVersionGate(appVersionBlockReason || "Hay una versión nueva. Actualiza antes de guardar.");
    return;
  }
  if (cloudSaving) {
    cloudSavePending = true;
    return;
  }
  cloudSaving = true;
  cloudSavePending = false;
  setCloudStatus("Nube: guardando…");
  try {
    // Lectura ligera (main+loans) para fusionar sin gastar cuota en fotos
    const merged = await mergeRemoteBundleBeforeSave();
    if (!merged) {
      // No bloquear la app: guardar copia local sin pisar La Vega remota si aquí está vacía
      const skipLva = !hasLocalLvaData();
      const saved = await saveCloudBundle({ skipLva });
      if (saved && saved.updatedAt) lastKnownCloudUpdatedAt = saved.updatedAt;
      lastLivePullAt = Date.now();
      cloudReady = true;
      cloudRetryAttempt = 0;
      setCloudStatus(
        skipLva
          ? "Nube: guardado ✓ (La Vega remota conservada)"
          : "Nube: guardado ✓ (sin fusión remota)"
      );
      return;
    }
    const saved = await saveCloudBundle();
    if (saved && saved.updatedAt) lastKnownCloudUpdatedAt = saved.updatedAt;
    lastLivePullAt = Date.now();
    cloudReady = true;
    cloudRetryAttempt = 0;
    setCloudStatus("Nube: guardado ✓ (fusionado · no se pisa)");
  } catch (err) {
    console.error(err);
    const msg = String((err && err.message) || err || "");
    if (msg === "APP_OUTDATED" || (err && err.code === "APP_OUTDATED")) {
      appVersionBlocked = true;
      const need = (err && err.requiredBuild) || "?";
      appVersionBlockReason = `Esta App es ${APP_VERSION_LABEL} (build ${APP_BUILD}). La nube exige build ${need}.`;
      showAppVersionGate(appVersionBlockReason);
      setCloudStatus("Nube: bloqueada · App desactualizada");
      return;
    }
    if (msg.includes("429")) {
      scheduleCloudRetry("cuota temporal");
    } else {
      setCloudStatus("Nube: error al guardar (se mantiene copia local)");
      try {
        await pushMessagesToCloud();
        setCloudStatus("Nube: chat sincronizado (doc completo pendiente)");
      } catch (_) {}
    }
  } finally {
    cloudSaving = false;
    if (cloudSavePending && !cloudRetryTimer) {
      cloudSavePending = false;
      scheduleCloudRetry("pendiente");
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
      ensureLvaEmployeesImported();
      if (typeof ensureOfficeEmployeesImported === "function") ensureOfficeEmployeesImported();
      ensureOwnerUser();
      await saveCloudBundle();
      localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees));
      localStorage.setItem(LOANS_KEY, JSON.stringify(loans));
      if (typeof LOAN_TRASH_KEY !== "undefined") {
        localStorage.setItem(LOAN_TRASH_KEY, JSON.stringify(loanTrashIds || []));
      }
      localStorage.setItem(MONORRIEL_REPORTS_KEY, JSON.stringify(monorrielReports));
      localStorage.setItem(USERS_KEY, JSON.stringify(appUsers));
      localStorage.setItem(MESSAGES_KEY, JSON.stringify(chatMessages));
      localStorage.setItem(RADIO_KEY, JSON.stringify(radioState));
      localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activityLog));
      localStorage.setItem(LVA_KEY, JSON.stringify(lvaState));
      localStorage.setItem(PETTY_KEY, JSON.stringify(pettyCash));
      localStorage.setItem(HR_KEY, JSON.stringify(hrData));
      if (typeof DEPURACION_KEY !== "undefined" && typeof depuracionData !== "undefined") {
        localStorage.setItem(DEPURACION_KEY, JSON.stringify(depuracionData));
      }
      if (typeof CONTABILIDAD_KEY !== "undefined" && typeof contabilidadData !== "undefined") {
        localStorage.setItem(CONTABILIDAD_KEY, JSON.stringify(contabilidadData));
      }
      cloudReady = true;
      lastLivePullAt = Date.now();
      setCloudStatus("Nube: activa ✓ (datos iniciales subidos)");
      return { added: 0, usedCloud: true };
    }

    // Fusionar clientes: no borrar altas locales (p.ej. Universidad Isa recién creada)
    posts = mergePostsForCloud(localPosts, remote.posts || []);
    ensureClientNumbers(false);
    // Reportes: fusionar por id (nunca reemplazo ciego)
    reports = mergeReportsForCloud(localReports, remote.reports || []);
    // Fusionar empleados: no borrar altas locales (p.ej. nombres nuevos en reporte Monorriel)
    if (Array.isArray(remote.employees) && remote.employees.length) {
      employees = mergeEmployeeListsForCloud(
        localEmployees.map(normalizeEmployee),
        remote.employees.map(normalizeEmployee)
      );
    } else {
      employees = dedupeEmployeesList(localEmployees.map(normalizeEmployee));
    }
    employees = dedupeEmployeesList(employees);
    // Préstamos: fusionar por id + papelera de borrados (evita que reaparezcan)
    if (typeof applyRemoteLoans === "function") {
      applyRemoteLoans(remote.loans, remote.loanTrash);
    } else {
      const remoteLoans = Array.isArray(remote.loans) ? remote.loans.map(normalizeLoan) : [];
      loans = remoteLoans.length ? remoteLoans : localLoans.map(normalizeLoan);
    }
    // Monorriel reportes: fusionar (id + fecha/turno) y recuperar red de seguridad local
    monorrielReports = mergeMonorrielReportsForCloud(localMono, remote.monorrielReports || []);
    restoreMonorrielReportsFromSafetyNet();
    persistMonorrielReportsSafetyNet(monorrielReports);
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
    if (typeof flushOpenMonoReportDraft === "function") flushOpenMonoReportDraft();
    if (typeof flushOpenPayrollDraft === "function") flushOpenPayrollDraft(false);
    if (typeof flushOpenHrDraft === "function") flushOpenHrDraft(false);
    if (typeof flushOpenDepDraft === "function") flushOpenDepDraft(false);
    if (remote.hr && typeof remote.hr === "object") {
      applyRemoteHrData(remote.hr);
    } else if (!(hrData.applications && hrData.applications.length)) {
      hrData = emptyHrData();
    }
    if (typeof applyRemoteDepuracionData === "function") {
      if (remote.depuracion && typeof remote.depuracion === "object") {
        applyRemoteDepuracionData(remote.depuracion);
      } else if (typeof emptyDepuracionData === "function" && typeof depuracionData !== "undefined") {
        if (!(depuracionData.candidates && depuracionData.candidates.length)) {
          depuracionData = emptyDepuracionData();
        }
      }
    }
    if (typeof applyRemoteContabilidadData === "function") {
      if (remote.contabilidad && typeof remote.contabilidad === "object") {
        applyRemoteContabilidadData(remote.contabilidad);
      } else if (typeof emptyContabilidadData === "function" && typeof contabilidadData !== "undefined") {
        if (!(contabilidadData.expenses && contabilidadData.expenses.length) &&
            !(contabilidadData.officeEmployees && contabilidadData.officeEmployees.length)) {
          contabilidadData = emptyContabilidadData();
        }
      }
      if (remote.suplidores && typeof remote.suplidores === "object" && typeof applyRemoteSuplidoresData === "function") {
        applyRemoteSuplidoresData(remote.suplidores);
      } else if (typeof emptySuplidoresData === "function" && typeof suplidoresData !== "undefined") {
        if (!(suplidoresData.suppliers && suplidoresData.suppliers.length) &&
            !(suplidoresData.payments && suplidoresData.payments.length)) {
          suplidoresData = emptySuplidoresData();
        }
      }
    }
    if (typeof applyRemoteVargasData === "function") {
      if (remote.vargas && typeof remote.vargas === "object") {
        applyRemoteVargasData(remote.vargas);
      } else if (typeof ensureVargasSeedLoaded === "function") {
        ensureVargasSeedLoaded();
      }
    }
    rebuildEmployeesFromPosts(employees);
    ensureMonorrielEmployeesImported();
    ensureLvaEmployeesImported();
    if (typeof ensureOfficeEmployeesImported === "function") ensureOfficeEmployeesImported();
    localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
    localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
    localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees));
    localStorage.setItem(LOANS_KEY, JSON.stringify(loans));
    if (typeof LOAN_TRASH_KEY !== "undefined") {
      localStorage.setItem(LOAN_TRASH_KEY, JSON.stringify(loanTrashIds || []));
    }
    localStorage.setItem(MONORRIEL_REPORTS_KEY, JSON.stringify(monorrielReports));
    localStorage.setItem(USERS_KEY, JSON.stringify(appUsers));
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(chatMessages));
    localStorage.setItem(RADIO_KEY, JSON.stringify(radioState));
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activityLog));
    localStorage.setItem(LVA_KEY, JSON.stringify(lvaState));
    localStorage.setItem(PETTY_KEY, JSON.stringify(pettyCash));
    localStorage.setItem(HR_KEY, JSON.stringify(hrData));
    if (typeof DEPURACION_KEY !== "undefined" && typeof depuracionData !== "undefined") {
      localStorage.setItem(DEPURACION_KEY, JSON.stringify(depuracionData));
    }
    if (typeof CONTABILIDAD_KEY !== "undefined" && typeof contabilidadData !== "undefined") {
      localStorage.setItem(CONTABILIDAD_KEY, JSON.stringify(contabilidadData));
    }
    if (typeof SUPLIDORES_KEY !== "undefined" && typeof suplidoresData !== "undefined") {
      localStorage.setItem(SUPLIDORES_KEY, JSON.stringify(suplidoresData));
    }
    if (typeof VARGAS_KEY !== "undefined" && typeof vargasData !== "undefined") {
      localStorage.setItem(VARGAS_KEY, JSON.stringify(vargasData));
    }
    if (remote.updatedAt) lastKnownCloudUpdatedAt = remote.updatedAt;
    lastLivePullAt = Date.now();
    cloudReady = true;
    const lvaCount = (lvaState.posts || []).filter((p) => p.active !== false).length;
    setCloudStatus(`Nube: activa ✓ · ${posts.length} servicios · ${employees.length} empleados · ${loans.length} préstamos · LVA ${lvaCount} · ${monorrielReports.length} monorriel`);
    return { added: 0, usedCloud: true, updatedAt: remote.updatedAt || null };
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
    marker.on("click", () => {
      // Al tocar el globo: punto exacto + ruta desde tu ubicación
      selectedId = post.id;
      openSheet(post.id);
      openDirectionsToPost(post);
    });
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
  if (!list || !summary) return;
  ensureClientNumbers(true);
  const q = String(document.getElementById("clientsSearch")?.value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const matchClient = (p) => {
    if (!q) return true;
    const g = primaryGuard(p);
    const hay = [
      p.site,
      String(p.clientNumber || ""),
      p.supervisor,
      p.shift,
      guardsSummary(p),
      g?.name,
      g?.phone,
      ...(p.guards || []).map((x) => `${x.name || ""} ${x.phone || ""} ${x.cedula || ""}`),
    ]
      .join(" ")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return hay.includes(q);
  };
  const activeClients = posts.length;
  const counts = { ok: 0, warn: 0, alert: 0 };
  posts.forEach((p) => {
    counts[p.status] = (counts[p.status] || 0) + 1;
  });
  const ordered = sortPostsByClientNumber(posts).filter(matchClient);
  summary.textContent = activeClients
    ? `Clientes activos: ${activeClients} · mostrando ${ordered.length} · ${counts.ok || 0} en puesto · ${counts.warn || 0} pendientes · ${counts.alert || 0} incidentes`
    : "Clientes activos: 0 · Sin clientes todavía";

  if (!posts.length) {
    list.innerHTML = `<p class="empty">No hay clientes. Entra a Admin con la clave y crea el primero (se numera desde 101).</p>`;
    return;
  }
  if (!ordered.length) {
    list.innerHTML = `<p class="empty">Ningún cliente coincide con «${escapeHtml(document.getElementById("clientsSearch")?.value || "")}».</p>`;
    return;
  }

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
  if (!select) return;
  if (preferredId && getPost(preferredId)) {
    select.dataset.preferredId = preferredId;
  }
  filterReportPostSelect(preferredId || select.dataset.preferredId || select.value || "");
}

function filterReportPostSelect(preferredId) {
  const select = document.getElementById("reportPost");
  if (!select) return;
  const searchEl = document.getElementById("reportPostSearch");
  const needle = String(searchEl?.value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const tokens = needle.split(/\s+/).filter(Boolean);
  const current = preferredId || select.value || "";
  const sorted = sortPostsByClientNumber(posts);
  const filtered = !tokens.length
    ? sorted
    : sorted.filter((p) => {
        const blob = `#${p.clientNumber || ""} ${p.site || ""} ${guardsSummary(p)}`
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
        return tokens.every((t) => blob.includes(t));
      });
  if (!filtered.length) {
    select.innerHTML = `<option value="">Sin coincidencias — limpia la búsqueda</option>`;
    return;
  }
  select.innerHTML = filtered
    .map(
      (p) =>
        `<option value="${p.id}">#${escapeHtml(String(p.clientNumber || "—"))} ${escapeHtml(p.site)} — ${escapeHtml(guardsSummary(p))}</option>`
    )
    .join("");
  if (current && filtered.some((p) => p.id === current)) select.value = current;
  else if (filtered.length === 1) select.value = filtered[0].id;
}

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
    return new URL("logo.jpg", window.location.href).href;
  } catch (_) {
    return "logo.jpg";
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
  { key: "vargas", label: "Ramón Vargas", view: "vargasView" },
  { key: "lavega", label: "La Vega Autopista", view: "lvaView" },
  { key: "finance", label: "Finanzas", view: "financeView" },
  { key: "cajachica", label: "Caja chica", view: "cajaView" },
  { key: "suplidores", label: "Suplidores", view: "suplidoresView" },
  { key: "contabilidad", label: "Contabilidad", view: "contabilidadView" },
  { key: "rrhh", label: "Recursos Humanos", view: "hrView" },
  { key: "depuracion", label: "Depuración", view: "depuracionView" },
  { key: "cotizaciones", label: "Cotizaciones", view: "quotesView" },
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
  vargasView: "vargas",
  monoReportEditView: "monorriel",
  monoReportDetailView: "monorriel",
  monoEmployeeSummaryView: "monorriel",
  monoStaffView: "monorriel",
  lvaView: "lavega",
  financeView: "finance",
  reportsView: "reports",
  messagesView: "messages",
  radioView: "radio",
  adminView: "admin",
  detailView: "clients",
  cajaView: "cajachica",
  suplidoresView: "suplidores",
  contabilidadView: "contabilidad",
  nominaView: "contabilidad",
  hrView: "rrhh",
  depuracionView: "depuracion",
  quotesView: "cotizaciones",
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
    if (m.key === "suplidores" && !Object.prototype.hasOwnProperty.call(incoming, "suplidores")) {
      // Acceso inmediato: owner/admin/fortuna vía canAccessSuplidores; el resto solo si se marca
      modules.suplidores = false;
      return;
    }
    if (m.key === "vargas" && !Object.prototype.hasOwnProperty.call(incoming, "vargas")) {
      modules.vargas = false;
      return;
    }
    if (m.key === "contabilidad" && !Object.prototype.hasOwnProperty.call(incoming, "contabilidad")) {
      modules.contabilidad = false;
      return;
    }
    if (m.key === "rrhh" && !Object.prototype.hasOwnProperty.call(incoming, "rrhh")) {
      modules.rrhh = false;
      return;
    }
    if (m.key === "depuracion" && !Object.prototype.hasOwnProperty.call(incoming, "depuracion")) {
      modules.depuracion = false;
      return;
    }
    if (m.key === "cotizaciones" && !Object.prototype.hasOwnProperty.call(incoming, "cotizaciones")) {
      modules.cotizaciones = false;
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

  // Suplidores: acceso inmediato para admin y fortuna (además del permiso explícito)
  if (role === "owner" || modules.admin || username === "fortuna") {
    modules.suplidores = true;
  }
  // Ramón Vargas: acceso inmediato para owner/admin y usuario vargas10
  if (role === "owner" || modules.admin || username === "vargas10") {
    modules.vargas = true;
  }
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

function canAccessRrhh() {
  if (!currentUser) return false;
  if (currentUser.role === "owner") return true;
  return !!(currentUser.modules && currentUser.modules.rrhh);
}

function canAccessQuotes() {
  if (!currentUser) return false;
  if (currentUser.role === "owner") return true;
  return !!(currentUser.modules && currentUser.modules.cotizaciones);
}

function canAccessDepuracion() {
  if (!currentUser) return false;
  if (currentUser.role === "owner") return true;
  return !!(currentUser.modules && currentUser.modules.depuracion);
}

function canAccessView(viewId) {
  if (viewId === "loginView") return true;
  if (viewId === "cajaView") return canAccessCajaChica();
  if (viewId === "suplidoresView") {
    return typeof canAccessSuplidores === "function" ? canAccessSuplidores() : canAccessModule("suplidores");
  }
  if (viewId === "vargasView") {
    return typeof canAccessVargas === "function" ? canAccessVargas() : canAccessModule("vargas");
  }
  if (viewId === "contabilidadView" || viewId === "nominaView") {
    // Nóminas usa el mismo permiso que Contabilidad (usuarios existentes)
    return typeof canAccessContabilidad === "function" ? canAccessContabilidad() : canAccessModule("contabilidad");
  }
  if (viewId === "hrView") return canAccessRrhh();
  if (viewId === "depuracionView") return canAccessDepuracion();
  if (viewId === "quotesView") return canAccessQuotes();
  const mod = VIEW_TO_MODULE[viewId];
  if (!mod) return !!currentUser;
  return canAccessModule(mod);
}

function firstAllowedView() {
  const order = ["homeView", "mapView", "shiftsView", "employeesView", "messagesView", "radioView", "loansView", "monorrielView", "vargasView", "lvaView", "financeView", "cajaView", "suplidoresView", "nominaView", "contabilidadView", "hrView", "depuracionView", "quotesView", "reportsView", "adminView"];
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
  updateMessagesTabBadge();

  const usersCard = document.getElementById("usersAdminCard");
  if (usersCard) usersCard.hidden = !(currentUser && currentUser.role === "owner");

  const printBtn = document.getElementById("btnPrintCurrent");
  if (printBtn) printBtn.hidden = !loggedIn;
  const refreshBtn = document.getElementById("btnRefreshApp");
  if (refreshBtn) refreshBtn.hidden = !loggedIn;
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
  // Dueño siempre con RRHH y módulos actuales (evita menú viejo sin Recursos Humanos)
  if (found.role === "owner" || found.username === OWNER_USERNAME) {
    found = normalizeUser({ ...found, role: "owner", username: OWNER_USERNAME, modules: allModulesTrue() });
    const idx = appUsers.findIndex((u) => u.id === found.id || u.username === OWNER_USERNAME);
    if (idx >= 0) appUsers[idx] = found;
    localStorage.setItem(USERS_KEY, JSON.stringify(appUsers));
  }
  currentUser = found;
  setSessionUserId(found.id);
  messageNotifyReady = false;
  knownUnreadMessageIds = new Set();
  const error = document.getElementById("loginError");
  if (error) error.hidden = true;
  const passEl = document.getElementById("loginPassword");
  if (passEl) passEl.value = "";
  if (found.role === "owner" || found.modules.admin) setAdminUnlocked(true);
  else setAdminUnlocked(false);
  logActivity("login", `Entró al sistema: ${found.displayName || found.username}${via === "biometric" ? " (Face ID/huella)" : ""}`, "login");
  applyAccessControl();
  updateMessagesTabBadge();
  detectAndNotifyNewMessages();
  if (typeof Notification !== "undefined" && Notification.permission === "default" && canAccessModule("messages")) {
    Notification.requestPermission().catch(() => {});
  }
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
  let found = appUsers.find((u) => u.active && u.username === user && u.password === pass);
  // Rescate: si la nube falló y el dueño local quedó sin clave usable
  if (!found && user === OWNER_USERNAME && pass === ADMIN_PASSWORD) {
    ensureOwnerUser();
    const owner = appUsers.find((u) => u.username === OWNER_USERNAME || u.role === "owner");
    if (owner) {
      owner.password = ADMIN_PASSWORD;
      owner.active = true;
      owner.role = "owner";
      found = normalizeUser(owner);
      const idx = appUsers.findIndex((u) => u.id === found.id || u.username === OWNER_USERNAME);
      if (idx >= 0) appUsers[idx] = found;
      else appUsers.unshift(found);
      if (typeof saveUsers === "function") saveUsers();
      else localStorage.setItem(USERS_KEY, JSON.stringify(appUsers));
    }
  }
  if (!found) {
    if (error) error.hidden = false;
    toast("Usuario o clave incorrectos.");
    return;
  }
  completeAppLogin(found, "password");
  maybeOfferBiometricEnrollment(found);
}

/** Candado de versión: App vieja no entra a secciones ni guarda en la nube. */
let appVersionBlocked = false;
let appVersionBlockReason = "";
let appVersionCheckTimer = null;
let publishedAppBuild = 0;

function showAppVersionGate(detail) {
  const gate = document.getElementById("appVersionGate");
  const detailEl = document.getElementById("appVersionGateDetail");
  if (detailEl) {
    detailEl.textContent =
      detail ||
      `Tu App: ${APP_VERSION_LABEL} (build ${APP_BUILD}). Hay una versión más nueva publicada.`;
  }
  if (gate) gate.hidden = false;
  document.body.classList.add("app-version-locked");
}

function hideAppVersionGate() {
  const gate = document.getElementById("appVersionGate");
  if (gate) gate.hidden = true;
  document.body.classList.remove("app-version-locked");
}

async function fetchPublishedVersionInfo() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      build: Number(data.build) || 0,
      minBuild: Number(data.minBuild) || Number(data.build) || 0,
      label: String(data.label || ""),
    };
  } catch (_) {
    return null;
  }
}

async function checkAppVersionGate(opts = {}) {
  const forceShow = !!opts.forceShow;
  let required = 0;
  let source = "";

  const published = await fetchPublishedVersionInfo();
  if (published && published.build) {
    publishedAppBuild = published.build;
    required = Math.max(required, published.minBuild || published.build);
    source = published.label || `v${published.build}`;
  }

  try {
    if (window.RFSCloudApi && typeof window.RFSCloudApi.peekCloudUpdatedAt === "function") {
      const peek = await window.RFSCloudApi.peekCloudUpdatedAt();
      if (peek && !peek.empty) {
        const cloudMin = Number(peek.minAppBuild) || 0;
        const cloudBuild = Number(peek.appBuild) || 0;
        if (cloudMin > required) {
          required = cloudMin;
          source = `nube build ${cloudMin}`;
        } else if (cloudBuild > required) {
          required = cloudBuild;
          source = `nube build ${cloudBuild}`;
        }
      }
    }
  } catch (_) {}

  if (required > 0 && APP_BUILD < required) {
    appVersionBlocked = true;
    appVersionBlockReason = `Tu App es ${APP_VERSION_LABEL} (build ${APP_BUILD}). Se requiere ${source || "build " + required}.`;
    showAppVersionGate(appVersionBlockReason);
    return false;
  }

  if (published && published.build && APP_BUILD < published.build) {
    appVersionBlocked = true;
    appVersionBlockReason = `Tu App es ${APP_VERSION_LABEL}. Publicada: ${published.label || "v" + published.build}.`;
    showAppVersionGate(appVersionBlockReason);
    return false;
  }

  appVersionBlocked = false;
  appVersionBlockReason = "";
  if (!forceShow) hideAppVersionGate();
  return true;
}

function startAppVersionWatch() {
  if (appVersionCheckTimer) return;
  checkAppVersionGate().catch(() => {});
  appVersionCheckTimer = setInterval(() => {
    checkAppVersionGate().catch(() => {});
  }, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkAppVersionGate().catch(() => {});
  });
}

/** Recarga la app (SW + caché) sin cerrar sesión: botón ⟳ del topbar en todas las pestañas */
async function refreshAppShell() {
  const btn = document.getElementById("btnRefreshApp");
  if (btn) btn.disabled = true;
  toast("Actualizando app…");
  try {
    if (typeof flushCloudSave === "function" && !appVersionBlocked) flushCloudSave();
  } catch (_) {}
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update().catch(() => {});
        if (reg.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
          // controllerchange en boot hace reload; respaldo por si no dispara
          setTimeout(() => {
            window.location.reload();
          }, 900);
          return;
        }
      }
    }
  } catch (_) {}
  try {
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("rfs-ops-")).map((k) => caches.delete(k))
      );
    }
  } catch (_) {}
  window.location.reload();
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
    suplidores: false,
    vargas: false,
    contabilidad: false,
    rrhh: false,
    depuracion: false,
    cotizaciones: false,
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

function mapCoords(post) {
  if (!post || !Number.isFinite(post.lat) || !Number.isFinite(post.lng)) return null;
  return {
    lat: Number(post.lat),
    lng: Number(post.lng),
    latStr: Number(post.lat).toFixed(6),
    lngStr: Number(post.lng).toFixed(6),
    label: String(post.site || "Servicio RFS").trim() || "Servicio RFS",
  };
}

/** Punto exacto del servicio (pin). No usar /maps/dir/ — en Android abre el formulario vacío. */
function placeLink(post) {
  const c = mapCoords(post);
  if (!c) return "";
  return `https://maps.google.com/?q=${c.latStr},${c.lngStr}`;
}

function openExternalMap(url) {
  if (!url) return false;
  try {
    // En PWA/celular location.href es más fiable con mapas/intents
    window.location.href = url;
    return true;
  } catch (_) {
    try {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch (_) {
      return false;
    }
  }
}

/**
 * Abre el punto exacto del servicio y la ruta / navegación.
 * Evita URLs /maps/dir/ que en Google Maps móvil salen sin destino.
 */
function openDirectionsToPost(postOrId) {
  const post = typeof postOrId === "string" ? getPost(postOrId) : postOrId;
  const c = mapCoords(post);
  if (!c) {
    toast("Este servicio no tiene ubicación cargada.");
    return false;
  }

  const pinHttps = placeLink(post);
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);

  toast(`Cómo llegar: ${c.label}`);

  if (isAndroid) {
    // 1) Navegación directa al punto exacto (app Google Maps)
    // 2) Si el esquema no abre, Intent con destino (daddr)
    // 3) Fallback: pin exacto en el mapa
    const nav = `google.navigation:q=${c.latStr},${c.lngStr}&mode=d`;
    const intent =
      `intent://maps.google.com/maps?daddr=${c.latStr},${c.lngStr}&directionsmode=driving` +
      `#Intent;scheme=https;package=com.google.android.apps.maps;` +
      `S.browser_fallback_url=${encodeURIComponent(pinHttps)};end`;

    try {
      window.location.href = nav;
    } catch (_) {}

    setTimeout(() => {
      if (document.hidden) return; // ya abrió Maps
      try {
        window.location.href = intent;
      } catch (_) {
        openExternalMap(pinHttps);
      }
      setTimeout(() => {
        if (!document.hidden) openExternalMap(pinHttps);
      }, 700);
    }, 500);
    return true;
  }

  if (isIOS) {
    // Apple Maps con destino = coordenadas del servicio
    openExternalMap(
      `https://maps.apple.com/?daddr=${c.latStr},${c.lngStr}&q=${encodeURIComponent(c.label)}&dirflg=d`
    );
    return true;
  }

  // Escritorio u otros: pin exacto
  openExternalMap(pinHttps);
  return true;
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
const LOAN_TRASH_KEY = "rfs-ops-loan-trash";
const LOAN_RATE_AUTH = "021112";
const DEFAULT_LOAN_RATE = 0.1;
const ADVANCE_PACKAGES = {
  1000: { lend: 1000, collect: 1150 },
  2000: { lend: 2000, collect: 2250 },
  3000: { lend: 3000, collect: 3350 },
  4000: { lend: 4000, collect: 4450 },
  5000: { lend: 5000, collect: 5550 },
};

let loans = [];
let loanTrashIds = [];
let selectedLoanId = null;
let loanSelectedEmployeeId = null;
let loanRateUnlocked = false;

function normalizeLoanTrash(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))].slice(0, 500);
}

function mergeLoanTrash(localIds, remoteIds) {
  return normalizeLoanTrash([...(localIds || []), ...(remoteIds || [])]);
}

function mergeLoansById(localList, remoteList) {
  const map = new Map();
  [...(localList || []), ...(remoteList || [])].forEach((row) => {
    if (!row) return;
    const next = normalizeLoan(row);
    if (!next.id) return;
    const prev = map.get(next.id);
    if (!prev || String(next.updatedAt || "") >= String(prev.updatedAt || "")) {
      map.set(next.id, next);
    }
  });
  return [...map.values()];
}

function persistLoanTrashLocal() {
  loanTrashIds = normalizeLoanTrash(loanTrashIds);
  localStorage.setItem(LOAN_TRASH_KEY, JSON.stringify(loanTrashIds));
}

function isExcelSeedLoanId(id) {
  return String(id || "").startsWith("loan-xlsx-");
}

function getExcelSeedLoanIdSet() {
  const seed = Array.isArray(window.RFS_LOANS_SEED) ? window.RFS_LOANS_SEED : [];
  return new Set(seed.map((l) => l && l.id).filter(Boolean));
}

/** La nube llegó a guardar IDs del Excel en papelera; nunca deben borrarse. */
function purgeExcelSeedIdsFromTrash(ids) {
  return normalizeLoanTrash(ids).filter((id) => !isExcelSeedLoanId(id));
}

function loanDedupeKey(l) {
  if (!l) return "";
  const name = String(l.employeeName || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return `${name}|${Number(l.principal) || 0}|${String(l.startDate || "").slice(0, 10)}|${Number(l.periods) || 0}`;
}

function buildNormalizedSeedLoans() {
  const seed = Array.isArray(window.RFS_LOANS_SEED) ? window.RFS_LOANS_SEED : [];
  return seed.map((raw) => {
    const linked = typeof resolveLoanEmployee === "function" ? resolveLoanEmployee(raw) : {};
    return normalizeLoan({
      ...raw,
      employeeId: (linked && linked.employeeId) || raw.employeeId || "",
      // Conservar el nombre del libro/seed; el vínculo solo aporta employeeId
      employeeName: raw.employeeName || (linked && linked.employeeName) || "",
      note: raw.note || "",
      rateUnlocked: true,
      // paid flags del Excel (verde) ya vienen en schedule
      schedule: raw.schedule,
    });
  });
}

/** Quita duplicados: mismo id, o mismo nombre+capital+fecha si uno es del Excel. */
function dedupeLoansPreferSeed(list) {
  const byId = new Map();
  (list || []).forEach((l) => {
    if (!l || !l.id) return;
    const prev = byId.get(l.id);
    if (!prev || String(l.updatedAt || "") >= String(prev.updatedAt || "")) byId.set(l.id, l);
  });
  const keyMap = new Map();
  [...byId.values()].forEach((l) => {
    const k = loanDedupeKey(l);
    if (!k) {
      keyMap.set(`id:${l.id}`, l);
      return;
    }
    const prev = keyMap.get(k);
    if (!prev) {
      keyMap.set(k, l);
      return;
    }
    if (isExcelSeedLoanId(l.id) && !isExcelSeedLoanId(prev.id)) {
      keyMap.set(k, l);
      return;
    }
    if (isExcelSeedLoanId(prev.id) && !isExcelSeedLoanId(l.id)) return;
    if (String(l.updatedAt || "") >= String(prev.updatedAt || "")) keyMap.set(k, l);
  });
  return [...keyMap.values()].sort((a, b) =>
    String(a.employeeName || "").localeCompare(String(b.employeeName || ""), "es")
  );
}

function isLoansSeedAuthoritative() {
  const meta = window.RFS_LOANS_SEED_META || {};
  const ver = Number(meta.version) || 0;
  const prev = Number(localStorage.getItem(LOANS_SEED_FLAG_KEY) || 0);
  return ver > 0 && prev >= ver && Array.isArray(window.RFS_LOANS_SEED) && window.RFS_LOANS_SEED.length > 0;
}

/**
 * Tras sync/merge: quitar seed de papelera, reponer préstamos del Excel si faltan,
 * y eliminar duplicados de prueba.
 */
function protectExcelSeedLoans() {
  loanTrashIds = purgeExcelSeedIdsFromTrash(loanTrashIds);
  if (!isLoansSeedAuthoritative()) {
    loans = dedupeLoansPreferSeed(loans);
    return false;
  }
  const seedLoans = buildNormalizedSeedLoans();
  const seedIds = new Set(seedLoans.map((l) => l.id));
  const seedKeys = new Set(seedLoans.map(loanDedupeKey));
  // Conservar préstamos nuevos manuales (no Excel) que no dupliquen al seed
  const extras = (loans || []).filter((l) => {
    if (!l || !l.id) return false;
    if (seedIds.has(l.id) || isExcelSeedLoanId(l.id)) return false;
    if (loanTrashIds.includes(l.id)) return false;
    if (seedKeys.has(loanDedupeKey(l))) return false;
    return true;
  });
  loans = dedupeLoansPreferSeed([...seedLoans, ...extras]);
  localStorage.setItem(LOANS_KEY, JSON.stringify(loans));
  persistLoanTrashLocal();
  return true;
}

function applyRemoteLoans(remoteLoans, remoteTrash) {
  // Nunca aceptar IDs del Excel en la papelera remota (bug v141)
  loanTrashIds = purgeExcelSeedIdsFromTrash(mergeLoanTrash(loanTrashIds, remoteTrash));
  const remoteNorm = Array.isArray(remoteLoans) ? remoteLoans.map(normalizeLoan) : [];
  loans = mergeLoansById(loans, remoteNorm).filter((l) => !loanTrashIds.includes(l.id));
  protectExcelSeedLoans();
  localStorage.setItem(LOANS_KEY, JSON.stringify(loans));
  persistLoanTrashLocal();
  return true;
}

async function mergeRemoteLoansBeforeSave() {
  return mergeRemoteBundleBeforeSave();
}

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

/** Próximas fechas de cobro por nómina: días 5 y 20 de cada mes. */
function nextPayrollPayDateAfter(isoDate, countFrom = 1) {
  const base = String(isoDate || todayIso()).slice(0, 10);
  let y = Number(base.slice(0, 4)) || new Date().getFullYear();
  let m = Number(base.slice(5, 7)) || new Date().getMonth() + 1;
  let d = Number(base.slice(8, 10)) || 1;
  const out = [];
  // Arranca en el siguiente 5 o 20 estricto después de la fecha base
  let guard = 0;
  while (out.length < Math.max(1, countFrom) && guard < 80) {
    guard += 1;
    const candidates = [
      `${y}-${String(m).padStart(2, "0")}-05`,
      `${y}-${String(m).padStart(2, "0")}-20`,
    ];
    for (const c of candidates) {
      if (c > base && !out.includes(c)) out.push(c);
      if (out.length >= countFrom) break;
    }
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
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
  const dueDates = nextPayrollPayDateAfter(startDate || todayIso(), n);
  const schedule = [];
  for (let i = 1; i <= n; i += 1) {
    const interest = roundMoney(balance * r);
    let principalPart = roundMoney(payment - interest);
    let pay = payment;
    if (i === n) {
      principalPart = roundMoney(balance);
      pay = roundMoney(principalPart + interest);
    }
    balance = roundMoney(Math.max(0, balance - principalPart));
    schedule.push({
      n: i,
      dueDate: dueDates[i - 1] || addDaysIso(startDate, 15 * i),
      principal: principalPart,
      interest,
      payment: pay,
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
  const due = (nextPayrollPayDateAfter(startDate || todayIso(), 1)[0] || addDaysIso(startDate, 15));
  return [
    {
      n: 1,
      dueDate: due,
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
  loanTrashIds = purgeExcelSeedIdsFromTrash(loanTrashIds);
  loans = dedupeLoansPreferSeed(
    (loans || []).filter((l) => l && l.id && !loanTrashIds.includes(l.id))
  );
  // Si el Excel es la fuente, no permitir que queden en 0
  if (isLoansSeedAuthoritative() && !(loans || []).some((l) => isExcelSeedLoanId(l.id))) {
    protectExcelSeedLoans();
  }
  localStorage.setItem(LOANS_KEY, JSON.stringify(loans));
  persistLoanTrashLocal();
  queueCloudSave();
}

const LOANS_SEED_FLAG_KEY = "rfs-loans-seed-version";

function normalizePersonKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(tv|oficina|ofic|isa|lot|tamboril|mediterraneo|unificado|Wanda)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function personNameTokens(name) {
  const stop = new Set(["de", "del", "la", "el", "los", "las", "y", "da", "do"]);
  return normalizePersonKey(name)
    .split(" ")
    .filter((t) => t && !stop.has(t) && t.length > 1);
}

/** Coincidencia estricta préstamo ↔ empleado (evita falsos positivos). */
function loanNameMatchScore(loanName, empName) {
  const a = normalizePersonKey(loanName);
  const b = normalizePersonKey(empName);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = personNameTokens(loanName);
  const tb = personNameTokens(empName);
  if (!ta.length || !tb.length) return 0;
  // todos los tokens del más corto están en el más largo
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const longSet = new Set(long);
  if (short.every((t) => longSet.has(t))) {
    return short.length >= 2 ? 0.95 : short.length === 1 && long.length === 1 ? 0.9 : 0.55;
  }
  const inter = short.filter((t) => longSet.has(t)).length;
  return inter / Math.max(short.length, long.length);
}

const LOAN_NAME_ALIASES = {
  "hector lopez": "HECTOR MANUEL LOPEZ",
  "feliz maria estevez": "FELIX MARIA ESTEVEZ",
  "felix maria estevez": "FELIX MARIA ESTEVEZ",
  "francisco cerda": "FRANCISCO ANT CERDA",
  "jose tineo": "JOSE DEL CARMEN TINEO",
  "lucio contreras": "LUCIO CONTRERA ALCANTARA",
  "jose luis aquino": "JOSE LUIS AQUINO",
  "jose manuel minaya": "JOSE MANUEL MINAYA",
  "juan carlos tavares": "JUAN CARLOS TAVARES",
  "carlos polanco": "CARLOS POLANCO DOMINGUEZ",
  "carlos polanco dominguez": "CARLOS POLANCO DOMINGUEZ",
  "juan carlos polanco garcia": "CARLOS POLANCO DOMINGUEZ",
};

function resolveLoanEmployee(loan) {
  if (!loan) return { employeeId: "", employeeName: loan && loan.employeeName, score: 0 };
  const alias = LOAN_NAME_ALIASES[normalizePersonKey(loan.employeeName)];
  const targetName = alias || loan.employeeName;
  const pool = typeof employees !== "undefined" ? employees : [];
  let best = null;
  let bestScore = 0;
  pool.forEach((e) => {
    if (!e || !isEmployeeActive(e)) return;
    let s = loanNameMatchScore(targetName, e.name);
    if (alias && normalizePersonKey(e.name) === normalizePersonKey(alias)) s = 1;
    // Preferir Monorriel en empates
    if (s > bestScore || (s === bestScore && s >= 0.9 && isMonorrielEmployee(e) && best && !isMonorrielEmployee(best))) {
      bestScore = s;
      best = e;
    }
  });
  if (bestScore >= 0.9 && best) {
    return {
      employeeId: best.id,
      employeeName: best.name,
      score: bestScore,
      monorriel: isMonorrielEmployee(best),
    };
  }
  return { employeeId: "", employeeName: loan.employeeName, score: bestScore };
}

function isMonorrielEmployee(emp) {
  if (!emp) return false;
  const sites = (emp.sites || []).join(" ").toLowerCase();
  const roles = (emp.roles || []).join(" ").toLowerCase();
  return sites.includes("monorriel") || roles.includes("monorriel") || !!emp.monorriel;
}

/** Nombres con los que comparar un préstamo ↔ nómina (alias + hint del Excel). */
function loanMatchNameCandidates(loan) {
  if (!loan) return [];
  const out = [];
  const push = (n) => {
    const s = String(n || "").trim();
    if (!s) return;
    if (!out.some((x) => normalizePersonKey(x) === normalizePersonKey(s))) out.push(s);
  };
  push(loan.employeeName);
  push(loan.matchHint);
  const alias = LOAN_NAME_ALIASES[normalizePersonKey(loan.employeeName)];
  push(alias);
  if (loan.matchHint) push(LOAN_NAME_ALIASES[normalizePersonKey(loan.matchHint)]);
  return out;
}

/**
 * Cuota(s) de préstamo a descontar en una fecha de pago de nómina (día 5 o 20).
 * Suma todas las cuotas pendientes con dueDate = payDate (o misma quincena).
 * Usa alias/hint para cuadrar con nombres cortos de nómina Monorriel (1+1).
 */
function loanPayrollDeductionForName(employeeName, payDate, employeeId) {
  const pay = String(payDate || "").slice(0, 10);
  if (!pay) return 0;
  let total = 0;
  const name = employeeName || "";
  (loans || []).forEach((loan) => {
    if (!loan || loan.status === "paid") return;
    const idOk = employeeId && loan.employeeId && loan.employeeId === employeeId;
    let score = idOk ? 1 : 0;
    if (!idOk) {
      loanMatchNameCandidates(loan).forEach((cand) => {
        score = Math.max(score, loanNameMatchScore(cand, name));
      });
    }
    if (!idOk && score < 0.9) return;
    (loan.schedule || []).forEach((inst) => {
      if (!inst || inst.paid) return;
      if (String(inst.dueDate || "").slice(0, 10) === pay) {
        total += Number(inst.payment) || 0;
      }
    });
  });
  return roundMoney(total);
}

/** Importa el Excel de amortizaciones: borra pruebas y carga préstamos reales. */
function importLoansSeedFromExcel(opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  const force = !!options.force;
  const meta = window.RFS_LOANS_SEED_META || {};
  const seed = Array.isArray(window.RFS_LOANS_SEED) ? window.RFS_LOANS_SEED : [];
  if (!seed.length) {
    toast("No hay data de préstamos para importar.");
    return { imported: 0 };
  }
  const ver = Number(meta.version) || 148;
  const prev = Number(localStorage.getItem(LOANS_SEED_FLAG_KEY) || 0);
  if (!force && prev >= ver) return { imported: 0, skipped: true };

  // Marcar versión ANTES de merge/sync para que protectExcelSeedLoans sea autoritativo
  localStorage.setItem(LOANS_SEED_FLAG_KEY, String(ver));

  const next = dedupeLoansPreferSeed(buildNormalizedSeedLoans());
  const seedIds = new Set(next.map((l) => l.id).filter(Boolean));

  // Papelera: pruebas y cualquier cosa que no sea el Excel. Limpiar seed de trash (nube contaminada).
  (loans || []).forEach((l) => {
    if (l && l.id && !seedIds.has(l.id)) loanTrashIds.push(l.id);
  });
  loanTrashIds = purgeExcelSeedIdsFromTrash(loanTrashIds);

  // Lista = solo Excel (sin duplicados de prueba)
  loans = next;
  localStorage.setItem(LOANS_KEY, JSON.stringify(loans));
  persistLoanTrashLocal();
  protectExcelSeedLoans();
  queueCloudSave();
  // Limpiar Préstamos ya cargados en nóminas Monorriel (pruebas) y reaplicar cuotas reales
  let payrollUpdated = 0;
  try {
    if (typeof refreshMonorrielPayrollLoanDeductions === "function") {
      payrollUpdated = (refreshMonorrielPayrollLoanDeductions(true) || {}).updated || 0;
    }
  } catch (err) {
    console.error(err);
  }
  try {
    renderLoans();
  } catch (_) {}
  const linkedN = next.filter((l) => l.employeeId).length;
  const notesN = next.filter((l) => /distinta al 10%/i.test(l.note || "")).length;
  const visible = (loans || []).length;
  toast(
    `Préstamos importados: ${visible} · vinculados: ${linkedN} · nota ≠10%: ${notesN}` +
      (payrollUpdated ? ` · nóminas Monorriel actualizadas: ${payrollUpdated}` : "")
  );
  if (!visible && next.length) {
    console.error("Import seed produjo 0 visibles; trash:", loanTrashIds.length);
  }
  return { imported: visible, linked: linkedN, notes: notesN, payrollUpdated };
}

function ensureLoansSeedImported() {
  try {
    const r = importLoansSeedFromExcel({ force: false });
    // Aunque el seed ya esté importado, reaplicar cuotas en nóminas Monorriel
    try {
      if (typeof refreshMonorrielPayrollLoanDeductions === "function") {
        const pay = refreshMonorrielPayrollLoanDeductions(true) || {};
        if (r && typeof r === "object") r.payrollUpdated = pay.updated || 0;
      }
    } catch (_) {}
    return r;
  } catch (err) {
    console.error(err);
    return { imported: 0, error: true };
  }
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
      const blob = [e.name, e.phone, e.cedula, ...(e.sites || []), ...(e.roles || [])]
        .join(" ")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      return blob.includes(needle);
    })
    .sort((a, b) => {
      const ao = (a.sites || []).some((s) => /oficina/i.test(s)) || !!a.officeEmployeeId ? 0 : 1;
      const bo = (b.sites || []).some((s) => /oficina/i.test(s)) || !!b.officeEmployeeId ? 0 : 1;
      if (ao !== bo && !needle) return ao - bo;
      return String(a.name || "").localeCompare(String(b.name || ""), "es");
    })
    .slice(0, needle ? 40 : 40);

  if (!filtered.length) {
    list.innerHTML = `<p class="empty">No hay empleados para mostrar.</p>`;
  } else {
    list.innerHTML = filtered
      .map((e) => {
        const sel = e.id === loanSelectedEmployeeId ? "selected" : "";
        const isOffice = (e.sites || []).some((s) => /oficina/i.test(s)) || !!e.officeEmployeeId;
        const siteHint = isOffice ? "Oficina" : (e.sites || []).slice(0, 2).join(", ") || "—";
        return `<button class="employee-card ${sel}" type="button" data-emp-id="${escapeHtml(e.id)}">
          <div class="row">
            <div>
              <h3>${escapeHtml(e.name)}${isOffice ? ' <span class="muted" style="font-size:12px">(Oficina)</span>' : ""}</h3>
              <p>${escapeHtml(e.cedula || "Sin cédula")} · ${escapeHtml(e.phone || "Sin tel.")} · ${escapeHtml(siteHint)}</p>
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
  try {
    protectExcelSeedLoans();
  } catch (_) {}
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
  const deletedId = selectedLoanId;
  loanTrashIds = mergeLoanTrash(loanTrashIds, [deletedId]);
  loans = loans.filter((l) => l.id !== deletedId);
  selectedLoanId = null;
  persistLoanTrashLocal();
  saveLoans();
  switchView("loansView");
  renderLoans();
  toast("Préstamo eliminado.");
}


/* ==== IMPRESIÓN ==== */
function openPrintWindow(title, bodyHtml, options = {}) {
  const appHref = (() => {
    try {
      return String(window.location.href || "./");
    } catch (_) {
      return "./";
    }
  })();
  const afterPrintKey = options && options.afterPrintKey ? String(options.afterPrintKey) : "";
  const extraCss = options && options.extraCss ? String(options.extraCss) : "";
  const bodyClass = options && options.bodyClass ? String(options.bodyClass) : "";
  const autoPrint = !(options && options.autoPrint === false);
  const autoDownloadPdf = !!(options && options.autoDownloadPdf);
  const returnPdfToOpener = !!(options && options.returnPdfToOpener);
  const share = options && options.share && typeof options.share === "object" ? options.share : null;
  const shareEnabled = !!(share && (share.text || share.subject)) || autoDownloadPdf || returnPdfToOpener;
  const pageSize = String((options && options.pageSize) || "").toLowerCase(); // letter|legal
  const orientation = String((options && options.orientation) || "portrait").toLowerCase();
  const wide = !!(options && options.wide);
  const pdfFormat = String((options && options.pdfFormat) || pageSize || "a4").toLowerCase();
  const pdfOrientation = String((options && options.pdfOrientation) || orientation || "portrait").toLowerCase();
  // Usar keywords letter/legal + landscape (evita hoja en blanco en Chrome)
  const pageRule =
    pageSize === "legal" && orientation === "landscape"
      ? "@page{size:legal landscape;margin:6mm}"
      : pageSize === "legal"
        ? "@page{size:legal portrait;margin:8mm}"
        : pageSize === "letter" && orientation === "landscape"
          ? "@page{size:letter landscape;margin:8mm}"
          : pageSize === "letter"
            ? "@page{size:letter portrait;margin:8mm}"
            : pageSize
              ? `@page{size:${pageSize} ${orientation === "landscape" ? "landscape" : "portrait"};margin:8mm}`
              : "";
  const bodyMax = wide ? "max-width:none;width:100%" : "max-width:900px";
  const logoUrl = (() => {
    try {
      return new URL("logo.jpg", window.location.href).href;
    } catch (_) {
      return "logo.jpg";
    }
  })();
  const win = window.open("", "_blank");
  if (!win) {
    toast("Permite ventanas emergentes para imprimir, o elige una impresora en el diálogo del sistema.");
    return null;
  }
  const shareBtns = shareEnabled
    ? `<button type="button" class="btn-wa" id="btnPrintWhatsApp">WhatsApp PDF</button>
    <button type="button" class="btn-mail" id="btnPrintEmail">Correo PDF</button>
    <button type="button" class="btn-pdf" id="btnPrintPdf">Descargar PDF</button>`
    : "";
  const hint = shareEnabled
    ? orientation === "landscape"
      ? "Hoja horizontal: en Imprimir elige Landscape / Horizontal. También puedes Descargar PDF."
      : "Mismo informe: imprímelo o envíalo en PDF por WhatsApp / correo."
    : orientation === "landscape"
      ? "En el diálogo de impresión elige Horizontal / Landscape."
      : "Elige impresora USB, Wi‑Fi o PDF. Luego pulsa Volver.";
  win.document.write(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  ${pageRule}
  html,body{background:#fff;color:#111}
  body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:22px;${bodyMax};margin:0 auto;font-size:12px;line-height:1.35;-webkit-print-color-adjust:exact;print-color-adjust:exact}
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
  .print-bar{position:sticky;top:0;z-index:20;display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:#111;color:#fff;padding:12px;margin:-22px -22px 18px;border-bottom:1px solid #333}
  .print-bar button{padding:11px 14px;font-size:14px;font-weight:800;border:0;border-radius:10px;cursor:pointer}
  .print-bar .btn-back{background:#fff;color:#111}
  .print-bar .btn-print{background:#d41414;color:#fff}
  .print-bar .btn-wa{background:#25d366;color:#053b1a}
  .print-bar .btn-mail{background:#3b82f6;color:#fff}
  .print-bar .btn-pdf{background:#f5f5f5;color:#111}
  .print-bar .hint{font-size:12px;color:#ccc;flex:1;min-width:160px}
  .print-bar .status{font-size:12px;color:#fde68a;width:100%}
  #rfsPrintRoot{background:#fff;color:#111;visibility:visible}
  @media print{
    html,body{padding:0 !important;margin:0 !important;background:#fff !important;overflow:visible !important}
    .no-print{display:none !important}
    #rfsPrintRoot{display:block !important;visibility:visible !important}
  }
  ${extraCss}
</style></head><body${bodyClass ? ` class="${escapeHtml(bodyClass)}"` : ""}>
  <div class="print-bar no-print">
    <button type="button" class="btn-back" id="btnPrintBack">← Volver</button>
    <button type="button" class="btn-print" id="btnPrintNow">Imprimir</button>
    ${shareBtns}
    <span class="hint">${escapeHtml(hint)}</span>
    <div class="status" id="printShareStatus" hidden></div>
  </div>
  <div id="rfsPrintRoot">
  <div class="brand">
    <img src="${escapeHtml(logoUrl)}" alt="RFS" width="54" height="54" crossorigin="anonymous"
      style="width:54px;height:54px;max-width:54px;max-height:54px;object-fit:contain;display:block;border:1px solid #ccc;border-radius:10px" />
    <div>
      <h1>Reaction Force Security</h1>
      <div>${escapeHtml(title)}</div>
    </div>
  </div>
  ${bodyHtml}
  <p class="footer">Impreso: ${escapeHtml(new Date().toLocaleString("es"))} · Uso interno</p>
  </div>
  <div class="no-print" style="margin-top:20px">
    <button type="button" id="btnPrintBackBottom" style="padding:12px 16px;font-weight:800;font-size:15px;border-radius:10px;border:1px solid #111;background:#fff;cursor:pointer">← Volver a la aplicación</button>
  </div>
  <script>
    (function () {
      var appHref = ${JSON.stringify(appHref)};
      var afterPrintKey = ${JSON.stringify(afterPrintKey)};
      var autoPrint = ${JSON.stringify(autoPrint)};
      var autoDownloadPdf = ${JSON.stringify(autoDownloadPdf)};
      var returnPdfToOpener = ${JSON.stringify(returnPdfToOpener)};
      var shareCfg = ${JSON.stringify(
        shareEnabled
          ? {
              text: String((share && share.text) || title || ""),
              subject: String((share && share.subject) || title),
              fileName: String((share && share.fileName) || "reporte.pdf"),
            }
          : null
      )};
      var pdfCfg = ${JSON.stringify({
        format: pdfFormat === "legal" ? "legal" : pdfFormat || "a4",
        orientation: pdfOrientation === "landscape" ? "landscape" : "portrait",
        wide: !!wide,
      })};
      var notified = false;
      var pdfLibPromise = null;

      function setStatus(msg) {
        var el = document.getElementById("printShareStatus");
        if (!el) return;
        if (!msg) { el.hidden = true; el.textContent = ""; return; }
        el.hidden = false;
        el.textContent = msg;
      }

      function notifyAfterPrint() {
        if (!afterPrintKey || notified) return;
        notified = true;
        try {
          if (window.opener && !window.opener.closed && typeof window.opener.__rfsOnPrintDone === "function") {
            window.opener.__rfsOnPrintDone(afterPrintKey);
          }
        } catch (e0) {}
      }

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

      function loadPdfLib() {
        if (window.html2pdf) return Promise.resolve(window.html2pdf);
        if (pdfLibPromise) return pdfLibPromise;
        pdfLibPromise = new Promise(function (resolve, reject) {
          var s = document.createElement("script");
          s.src = "https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js";
          s.onload = function () {
            if (window.html2pdf) resolve(window.html2pdf);
            else reject(new Error("html2pdf no cargó"));
          };
          s.onerror = function () {
            var s2 = document.createElement("script");
            s2.src = "https://unpkg.com/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js";
            s2.onload = function () {
              if (window.html2pdf) resolve(window.html2pdf);
              else reject(new Error("html2pdf no cargó"));
            };
            s2.onerror = function () { reject(new Error("Sin librería PDF")); };
            document.head.appendChild(s2);
          };
          document.head.appendChild(s);
        });
        return pdfLibPromise;
      }

      function downloadBlob(blob, name) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = name || "reporte.pdf";
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2500);
      }

      function makePdfBlob() {
        var root = document.getElementById("rfsPrintRoot");
        if (!root) return Promise.reject(new Error("Sin contenido"));
        return loadPdfLib().then(function (html2pdf) {
          var fmt = (pdfCfg && pdfCfg.format) || "a4";
          if (fmt === "carta") fmt = "letter";
          var ori = (pdfCfg && pdfCfg.orientation) || "portrait";
          var landscape = ori === "landscape";
          var widePdf = !!(pdfCfg && pdfCfg.wide);
          var jsFormat = fmt === "legal" || fmt === "letter" ? fmt : fmt;
          // Mismo ancho que la impresión (Legal/Carta horizontal)
          var w = Math.max(root.scrollWidth || 0, root.offsetWidth || 0, widePdf ? (landscape ? 1100 : 900) : 800);
          if (landscape && widePdf) w = Math.max(w, fmt === "legal" ? 1340 : 1020);
          var opt = {
            margin: landscape ? [6, 6, 6, 6] : [10, 10, 12, 10],
            filename: (shareCfg && shareCfg.fileName) || "reporte.pdf",
            image: { type: "jpeg", quality: 0.95 },
            html2canvas: {
              scale: landscape ? 1.5 : 1.5,
              useCORS: true,
              allowTaint: true,
              logging: false,
              backgroundColor: "#ffffff",
              windowWidth: w,
              width: w,
              scrollX: 0,
              scrollY: 0,
              onclone: function (doc) {
                try {
                  var imgs = doc.querySelectorAll(".brand img");
                  for (var i = 0; i < imgs.length; i++) {
                    imgs[i].setAttribute("width", "54");
                    imgs[i].setAttribute("height", "54");
                    imgs[i].style.width = "54px";
                    imgs[i].style.height = "54px";
                    imgs[i].style.maxWidth = "54px";
                    imgs[i].style.maxHeight = "54px";
                    imgs[i].style.objectFit = "contain";
                  }
                  var tds = doc.querySelectorAll("#rfsPrintRoot td, #rfsPrintRoot th");
                  for (var j = 0; j < tds.length; j++) {
                    if (!tds[j].closest("thead")) tds[j].style.color = "#111";
                  }
                } catch (eClone) {}
              }
            },
            jsPDF: {
              unit: "mm",
              format: jsFormat,
              orientation: landscape ? "landscape" : "portrait"
            },
            // Misma paginación que la impresión del navegador
            pagebreak: { mode: ["css", "legacy"] }
          };
          return html2pdf().set(opt).from(root).outputPdf("blob").catch(function () {
            return html2pdf().set(opt).from(root).toPdf().get("pdf").then(function (pdf) {
              return pdf.output("blob");
            });
          });
        });
      }

      function deliverPdfToOpenerOrDownload() {
        setStatus("Generando PDF…");
        makePdfBlob().then(function (blob) {
          if (!blob || !blob.size) throw new Error("PDF vacío");
          var fileName = (shareCfg && shareCfg.fileName) || "reporte.pdf";
          if (returnPdfToOpener) {
            return blob.arrayBuffer().then(function (buf) {
              try {
                if (window.opener && !window.opener.closed && typeof window.opener.__rfsPayrollPdfCallback === "function") {
                  window.opener.__rfsPayrollPdfCallback(
                    null,
                    new Blob([buf], { type: "application/pdf" }),
                    fileName
                  );
                }
              } catch (eRet) {}
              setTimeout(function () { try { window.close(); } catch (eClose) {} }, 150);
            });
          }
          downloadBlob(blob, fileName);
          setStatus("PDF descargado.");
        }).catch(function (err) {
          console.error(err);
          setStatus("No se pudo crear el PDF.");
          try {
            if (returnPdfToOpener && window.opener && typeof window.opener.__rfsPayrollPdfCallback === "function") {
              window.opener.__rfsPayrollPdfCallback(err || new Error("PDF falló"), null, "");
            }
          } catch (eErr) {}
        });
      }

      function sharePdf(mode) {
        if (!shareCfg) return;
        setStatus("Generando PDF del informe…");
        makePdfBlob().then(function (blob) {
          if (!blob || !blob.size) throw new Error("PDF vacío");
          var fileName = shareCfg.fileName || "reporte.pdf";
          var file = new File([blob], fileName, { type: "application/pdf" });
          var title = shareCfg.subject || document.title;
          var text = shareCfg.text || title;
          var tryNative = navigator.share
            ? (navigator.canShare && navigator.canShare({ files: [file] })
                ? navigator.share({ title: title, text: text, files: [file] })
                : Promise.reject(new Error("no-files")))
            : Promise.reject(new Error("no-share"));
          return tryNative.then(function () {
            setStatus("PDF listo. Elige WhatsApp o Correo en el menú.");
          }).catch(function (err) {
            if (err && err.name === "AbortError") {
              setStatus("");
              return;
            }
            downloadBlob(blob, fileName);
            if (mode === "wa") {
              // Solo título corto (tipo + servicio); el detalle está en el PDF.
              window.open("https://wa.me/?text=" + encodeURIComponent(text || title || fileName), "_blank");
              setStatus("PDF descargado. Adjúntalo en WhatsApp.");
            } else if (mode === "mail") {
              window.location.href = "mailto:?subject=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(text || title);
              setStatus("PDF descargado. Adjúntalo al correo.");
            } else {
              setStatus("PDF descargado.");
            }
          });
        }).catch(function (err) {
          console.error(err);
          setStatus("No se pudo crear el PDF. Usa Imprimir → Guardar como PDF.");
          if (mode === "wa") {
            window.open("https://wa.me/?text=" + encodeURIComponent(shareCfg.text || ""), "_blank");
          } else if (mode === "mail") {
            window.location.href = "mailto:?subject=" + encodeURIComponent(shareCfg.subject || "") + "&body=" + encodeURIComponent(shareCfg.text || "");
          }
        });
      }

      var backTop = document.getElementById("btnPrintBack");
      var backBottom = document.getElementById("btnPrintBackBottom");
      var printBtn = document.getElementById("btnPrintNow");
      if (backTop) backTop.addEventListener("click", goBackToApp);
      if (backBottom) backBottom.addEventListener("click", goBackToApp);
      if (printBtn) printBtn.addEventListener("click", function () { window.print(); });
      var waBtn = document.getElementById("btnPrintWhatsApp");
      var mailBtn = document.getElementById("btnPrintEmail");
      var pdfBtn = document.getElementById("btnPrintPdf");
      if (waBtn) waBtn.addEventListener("click", function () { sharePdf("wa"); });
      if (mailBtn) mailBtn.addEventListener("click", function () { sharePdf("mail"); });
      if (pdfBtn) pdfBtn.addEventListener("click", function () { sharePdf("pdf"); });
      try { window.addEventListener("afterprint", notifyAfterPrint); } catch (e8) {}
      if (returnPdfToOpener || autoDownloadPdf) {
        setTimeout(function () { deliverPdfToOpenerOrDownload(); }, 450);
      } else if (autoPrint) {
        setTimeout(function () {
          try { window.focus(); window.print(); } catch (e7) {}
        }, 350);
      } else {
        setTimeout(function () { try { window.focus(); } catch (e9) {} }, 200);
      }
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

function printLvaActiveSheet() {
  if (!canAccessModule("lavega")) {
    toast("No tienes acceso a La Vega Autopista.");
    return;
  }
  ensureLvaEmployeesImported();
  const active = (lvaState.staff || [])
    .filter((s) => s && s.active !== false && (s.name || "").trim())
    .slice()
    .sort((a, b) => {
      const pa = (a.postName || getLvaPostName(a.postId) || "").localeCompare(
        b.postName || getLvaPostName(b.postId) || "",
        "es"
      );
      if (pa !== 0) return pa;
      return String(a.name || "").localeCompare(String(b.name || ""), "es");
    });
  const today = new Date().toLocaleDateString("es-DO", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const rows = active
    .map((s, i) => {
      const post = s.postName || getLvaPostName(s.postId) || "—";
      const display = lvaDisplayName(s.name);
      return `<tr>
      <td class="right">${i + 1}</td>
      <td>${escapeHtml(display)}</td>
      <td>${escapeHtml(post)}</td>
      <td>${escapeHtml(s.phone || "—")}</td>
      <td>${escapeHtml(s.cedula || "—")}</td>
    </tr>`;
    })
    .join("");
  openPrintWindow("Lista activa — Autopista La Vega", `
    <h2>Proyecto Autopista La Vega · Lista activa a la fecha</h2>
    <div class="meta">
      <div><strong>Fecha del reporte:</strong><br/>${escapeHtml(today)}</div>
      <div><strong>Servicios / empleados activos:</strong><br/>${active.length}</div>
      <div><strong>Empresa:</strong><br/>Reaction Force Security</div>
    </div>
    <table>
      <thead>
        <tr>
          <th class="right">#</th>
          <th>Empleado</th>
          <th>Puesto</th>
          <th>Teléfono</th>
          <th>Cédula</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="5">Sin personal activo en el proyecto</td></tr>`}</tbody>
    </table>
    <div class="sign-box">
      <div class="sign-line">Supervisión / Coordinación</div>
      <div class="sign-line">Operaciones RFS</div>
    </div>
    <p class="footer">Documento interno · Personal activo del proyecto Autopista La Vega a la fecha indicada.</p>`, {
      share: {
        subject: "Lista activa Autopista La Vega — Reaction Force Security",
        text: `Lista activa del proyecto Autopista La Vega (${active.length} servicios) — ${today}`,
        fileName: `lista-activa-la-vega-${new Date().toISOString().slice(0, 10)}.pdf`,
      },
      autoPrint: false,
    });
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
  if (id === "quotesView") {
    if (typeof printQuoteProposal === "function") return printQuoteProposal();
  }
  if (id === "monoReportDetailView") return printMonoReport();
  if (id === "monorrielView" || id === "monoStaffView") return printMonorrielIndexSheet();
  if (id === "lvaView") return printLvaActiveSheet();
  if (id === "vargasView") {
    if (typeof printVargasReport === "function") return printVargasReport();
    if (typeof window.RFSVargas !== "undefined" && typeof window.RFSVargas.printVargasReport === "function") {
      return window.RFSVargas.printVargasReport();
    }
  }
  if ((id === "nominaView" || id === "contabilidadView") && typeof printOpenPayrollSheet === "function") return printOpenPayrollSheet();
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
  toast("Abre Clientes, Empleados, Préstamos, Finanzas, Monorriel, Vargas o La Vega para imprimir.");
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
    ["btnPrintLvaList", printLvaActiveSheet],
    ["btnPrintLvaRoster", printLvaActiveSheet],
    [
      "btnPrintVargas",
      () => {
        if (typeof printVargasReport === "function") return printVargasReport();
        if (typeof window.RFSVargas !== "undefined" && typeof window.RFSVargas.printVargasReport === "function") {
          return window.RFSVargas.printVargasReport();
        }
        toast("Reporte Vargas no disponible.");
      },
    ],
  ];
  map.forEach(([id, fn]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", fn);
  });
}
/* ==== FIN IMPRESIÓN ==== */


function bindLoansUi() {
  const btnNew = document.getElementById("btnNewLoan");
  const btnImportLoans = document.getElementById("btnImportLoansExcel");
  if (btnImportLoans && !btnImportLoans.dataset.bound) {
    btnImportLoans.dataset.bound = "1";
    btnImportLoans.addEventListener("click", () => {
      const ok = window.confirm(
        "Esto BORRA los préstamos actuales (pruebas) y carga el Excel de amortizaciones reales.\n¿Continuar?"
      );
      if (!ok) return;
      localStorage.removeItem(LOANS_SEED_FLAG_KEY);
      const r = importLoansSeedFromExcel({ force: true });
      if (r && r.imported) {
        // Forzar subida con la lista real (no vacía)
        pushToCloud()
          .then(() => {
            toast(`Listos en nube: ${(loans || []).length} préstamo(s) visibles.`);
            try {
              renderLoans();
            } catch (_) {}
          })
          .catch(() => {});
      }
    });
  }
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
let lastMonoReportEditAt = 0;
let monoDraftMeta = { date: "", shift: "am", supervisor: "", novedades: "" };
const MONO_DRAFT_SESSION_KEY = "rfs-ops-mono-report-draft";

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
    .replace(/\s*\(la vega(?: autopista)?\)\s*$/i, "")
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

/** Importa personal AM/PM (+ roster de nómina Excel) a la lista general sin borrar datos ya llenos */
function ensureMonorrielEmployeesImported() {
  const data = monoData();
  const rosterByKey = new Map();
  (data.payrollRoster || []).forEach((r) => {
    const base = String((r && r.name) || "").trim();
    if (!base) return;
    rosterByKey.set(employeeKey(base), r);
  });
  const names = [
    ...new Set(
      [
        ...(data.staffAm || []),
        ...(data.staffPm || []),
        ...(data.payrollRoster || []).map((r) => (r && r.name) || ""),
      ]
        .map((n) => String(n || "").trim())
        .filter(Boolean)
    ),
  ];
  let added = 0;
  names.forEach((base) => {
    const display = monoDisplayName(base);
    const key = employeeKey(display);
    const keyBase = employeeKey(base);
    const roster = rosterByKey.get(keyBase) || rosterByKey.get(key);
    const salaryFromRoster = roster ? Math.max(0, Number(roster.salaryMonthly) || 0) : 0;
    let existing = employees.find((e) => employeeKey(e.name) === key || employeeKey(monoBaseName(e.name)) === keyBase);
    if (!existing && keyBase) {
      existing = employees.find(
        (e) =>
          Array.isArray(e.monoUnifyAliases) &&
          e.monoUnifyAliases.some((a) => String(a) === keyBase || String(a) === key)
      );
    }
    if (existing) {
      const idx = employees.findIndex((e) => e.id === existing.id);
      const merged = mergeEmployeeRecord(existing, {
        name: /\(monorriel\)/i.test(existing.name) ? existing.name : display,
        sites: ["Monorriel"],
        roles: ["Monorriel"],
        salary: existing.salary > 0 ? existing.salary : salaryFromRoster,
      });
      // Si era un alias unificado, conservar el nombre del Principal (no revivir el typo)
      const isAliasOnly =
        Array.isArray(existing.monoUnifyAliases) &&
        existing.monoUnifyAliases.some((a) => String(a) === keyBase || String(a) === key) &&
        employeeKey(monoBaseName(existing.name)) !== keyBase;
      if (!isAliasOnly && !/\(monorriel\)/i.test(merged.name)) merged.name = display;
      if (!/\(monorriel\)/i.test(merged.name)) merged.name = monoDisplayName(monoBaseName(merged.name) || merged.name);
      merged.sites = [...new Set([...(merged.sites || []), "Monorriel"])];
      merged.roles = [...new Set([...(merged.roles || []), "Monorriel"])];
      if (!(Number(merged.salary) > 0) && salaryFromRoster) merged.salary = salaryFromRoster;
      employees[idx] = merged;
      return;
    }
    employees.push(
      normalizeEmployee({
        name: display,
        sites: ["Monorriel"],
        roles: ["Monorriel"],
        salary: salaryFromRoster || 0,
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

/** Fecha local del dispositivo (RD): evita que UTC cambie el día del reporte. */
function monoLocalToday() {
  return typeof localDateISO === "function" ? localDateISO() : todayIso();
}

function monoLocalYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return typeof localDateISO === "function" ? localDateISO(d) : d.toISOString().slice(0, 10);
}

function normalizeMonoReport(raw = {}) {
  const posts = monoPosts();
  const byPost = new Map((raw.assignments || []).map((a) => [a.postId, normalizeMonoAssignment(a)]));
  const assignments = posts.map((p) => byPost.get(p.id) || { postId: p.id, employeeId: "", employeeName: "" });
  const covered = assignments.filter((a) => (a.employeeName || "").trim()).length;
  return {
    id: raw.id || `mono-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date: String(raw.date || monoLocalToday()).slice(0, 10),
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

const MONORRIEL_REPORTS_SAFETY_KEY = "rfs-ops-monorriel-reports-safety";

/** Fusiona reportes Monorriel por id (updatedAt gana) y por fecha+turno. */
function mergeMonorrielReportsForCloud(localList, remoteList) {
  const byId = new Map();
  const put = (raw) => {
    if (!raw) return;
    const next = normalizeMonoReport(raw);
    if (!next.id) return;
    const prev = byId.get(next.id);
    if (!prev || String(next.updatedAt || "") >= String(prev.updatedAt || "")) {
      byId.set(next.id, next);
    }
  };
  (remoteList || []).forEach(put);
  (localList || []).forEach(put);

  // Misma fecha+turno: quedarse con el más reciente (evita perder el de Ashley si hubo otro id)
  const byDayShift = new Map();
  [...byId.values()].forEach((r) => {
    const k = `${String(r.date || "").slice(0, 10)}|${r.shift === "pm" ? "pm" : "am"}`;
    const prev = byDayShift.get(k);
    if (!prev) {
      byDayShift.set(k, r);
      return;
    }
    const ta = Date.parse(prev.updatedAt || "") || 0;
    const tb = Date.parse(r.updatedAt || "") || 0;
    const ca = Date.parse(prev.createdAt || "") || 0;
    const cb = Date.parse(r.createdAt || "") || 0;
    if (tb > ta || (tb === ta && cb >= ca)) byDayShift.set(k, r);
  });

  return [...byDayShift.values()].sort(
    (a, b) =>
      String(b.date).localeCompare(String(a.date)) || String(a.shift).localeCompare(String(b.shift))
  );
}

function persistMonorrielReportsSafetyNet(list) {
  try {
    const prev = loadJson(MONORRIEL_REPORTS_SAFETY_KEY, []);
    const merged = mergeMonorrielReportsForCloud(prev, list || monorrielReports || []);
    localStorage.setItem(MONORRIEL_REPORTS_SAFETY_KEY, JSON.stringify(merged.slice(0, 240)));
  } catch (_) {}
}

function restoreMonorrielReportsFromSafetyNet() {
  try {
    const safety = loadJson(MONORRIEL_REPORTS_SAFETY_KEY, []);
    if (!safety.length) return 0;
    const before = (monorrielReports || []).length;
    monorrielReports = mergeMonorrielReportsForCloud(monorrielReports, safety);
    persistMonorrielReportsSafetyNet(monorrielReports);
    return Math.max(0, monorrielReports.length - before);
  } catch (_) {
    return 0;
  }
}

function saveMonorrielReports() {
  localStorage.setItem(MONORRIEL_REPORTS_KEY, JSON.stringify(monorrielReports));
  persistMonorrielReportsSafetyNet(monorrielReports);
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

/** IDs de vigilantes ya puestos en otro puesto del reporte (excepto el puesto actual). */
function assignedMonoEmployeeIds(exceptPostId) {
  const ids = new Set();
  Object.entries(monoDraftAssignments || {}).forEach(([postId, slot]) => {
    if (exceptPostId && postId === exceptPostId) return;
    if (slot && slot.employeeId) ids.add(slot.employeeId);
  });
  return ids;
}

function monoStaffOptionsHtml(forPostId) {
  const taken = assignedMonoEmployeeIds(forPostId);
  const currentId = ((monoDraftAssignments || {})[forPostId] || {}).employeeId || "";
  const staff = getMonorrielEmployees(false).filter((e) => e.id === currentId || !taken.has(e.id));
  return [`<option value="">— Vacante / elegir lista —</option>`]
    .concat(staff.map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`))
    .join("");
}

/** Actualiza listas sin recrear filas: quien ya está en un puesto no sale en los demás. */
function refreshMonoStaffSelectOptions() {
  const box = document.getElementById("monoPostsEditor");
  if (!box) return;
  box.querySelectorAll("select[data-mono-post]").forEach((sel) => {
    const postId = sel.dataset.monoPost;
    const desired = ((monoDraftAssignments || {})[postId] || {}).employeeId || "";
    sel.innerHTML = monoStaffOptionsHtml(postId);
    sel.value = desired;
  });
}

function renderMonoPostsEditor() {
  const box = document.getElementById("monoPostsEditor");
  if (!box) return;

  box.innerHTML = monoPosts()
    .map((p) => {
      const slot = monoDraftAssignments[p.id] || { employeeId: "", customName: "" };
      return `<div class="mono-post-row">
        <div class="mono-post-label">${escapeHtml(monoPostLabel(p))}</div>
        <select data-mono-post="${escapeHtml(p.id)}">${monoStaffOptionsHtml(p.id)}</select>
        <input class="mono-name-input" data-mono-name="${escapeHtml(p.id)}" type="text" placeholder="O escribe un nombre nuevo" value="${escapeHtml(slot.customName || "")}" />
        <p class="mono-hint">Si eliges a alguien aquí, no aparecerá en los otros puestos. Nombre nuevo se agrega a Empleados (Monorriel).</p>
      </div>`;
    })
    .join("");

  box.querySelectorAll("select[data-mono-post]").forEach((sel) => {
    const postId = sel.dataset.monoPost;
    const slot = monoDraftAssignments[postId] || { employeeId: "", customName: "" };
    sel.value = slot.employeeId || "";
    sel.addEventListener("change", () => {
      markMonoReportEdited();
      const current = monoDraftAssignments[postId] || { employeeId: "", customName: "" };
      monoDraftAssignments[postId] = { employeeId: sel.value, customName: sel.value ? "" : current.customName };
      const nameInput = box.querySelector(`input[data-mono-name="${postId}"]`);
      if (sel.value && nameInput) nameInput.value = "";
      refreshMonoStaffSelectOptions();
      updateMonoCoverageHint();
      flushOpenMonoReportDraft();
    });
  });

  box.querySelectorAll("input[data-mono-name]").forEach((inp) => {
    const postId = inp.dataset.monoName;
    const commit = () => {
      markMonoReportEdited();
      const typed = inp.value.trim();
      if (!typed) {
        const current = monoDraftAssignments[postId] || { employeeId: "", customName: "" };
        monoDraftAssignments[postId] = { employeeId: current.employeeId || "", customName: "" };
        refreshMonoStaffSelectOptions();
        updateMonoCoverageHint();
        flushOpenMonoReportDraft();
        return;
      }
      const taken = assignedMonoEmployeeIds(postId);
      const emp = ensureEmployeeFromMonoName(typed);
      if (!emp) return;
      if (taken.has(emp.id)) {
        toast("Ese vigilante ya está asignado en otro puesto de este reporte.");
        inp.value = "";
        return;
      }
      monoDraftAssignments[postId] = { employeeId: emp.id, customName: "" };
      inp.value = "";
      renderMonoPostsEditor();
      const sel = document.querySelector(`#monoPostsEditor select[data-mono-post="${postId}"]`);
      if (sel) sel.value = emp.id;
      flushOpenMonoReportDraft();
    };
    inp.addEventListener("input", () => {
      markMonoReportEdited();
      const typed = String(inp.value || "").trim();
      const current = monoDraftAssignments[postId] || { employeeId: "", customName: "" };
      if (!current.employeeId) {
        monoDraftAssignments[postId] = { employeeId: "", customName: typed };
      }
      flushOpenMonoReportDraft();
    });
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


function isMonoReportEditViewActive() {
  const active = document.querySelector(".view.active");
  return !!(active && active.id === "monoReportEditView");
}

/** True si Ashley (u otro) está armando el reporte Monorriel. */
function isMonoReportBeingEdited() {
  if (!isMonoReportEditViewActive()) return false;
  const view = document.getElementById("monoReportEditView");
  if (view && document.activeElement && view.contains(document.activeElement)) return true;
  return Date.now() - lastMonoReportEditAt < 45000;
}

function markMonoReportEdited() {
  lastMonoReportEditAt = Date.now();
  if (typeof lastLocalEditAt !== "undefined") lastLocalEditAt = Date.now();
}

function readMonoReportMetaFromDom() {
  const dateEl = document.getElementById("monoReportDate");
  const shiftEl = document.getElementById("monoReportShift");
  const supEl = document.getElementById("monoReportSupervisor");
  const novEl = document.getElementById("monoReportNovedades");
  return {
    date: dateEl ? dateEl.value || "" : monoDraftMeta.date || "",
    shift: shiftEl && shiftEl.value === "pm" ? "pm" : "am",
    supervisor: supEl ? String(supEl.value || "").trim() : monoDraftMeta.supervisor || "",
    novedades: novEl ? String(novEl.value || "") : monoDraftMeta.novedades || "",
  };
}

function applyMonoReportMetaToDom(meta) {
  if (!meta) return;
  const dateEl = document.getElementById("monoReportDate");
  const shiftEl = document.getElementById("monoReportShift");
  const supEl = document.getElementById("monoReportSupervisor");
  const novEl = document.getElementById("monoReportNovedades");
  if (dateEl && meta.date && document.activeElement !== dateEl) dateEl.value = meta.date;
  if (shiftEl && meta.shift && document.activeElement !== shiftEl) shiftEl.value = meta.shift === "pm" ? "pm" : "am";
  if (supEl && document.activeElement !== supEl) supEl.value = meta.supervisor || "";
  if (novEl && document.activeElement !== novEl) novEl.value = meta.novedades || "";
  try {
    updateMonoReportDateHint();
  } catch (_) {}
}

/** Copia inputs del editor (incl. nombres a medio escribir) a memoria + sessionStorage. */
function flushOpenMonoReportDraft() {
  if (!isMonoReportEditViewActive() && !(Date.now() - lastMonoReportEditAt < 45000)) return false;
  try {
    monoDraftMeta = readMonoReportMetaFromDom();
    const box = document.getElementById("monoPostsEditor");
    if (box) {
      box.querySelectorAll("select[data-mono-post]").forEach((sel) => {
        const postId = sel.dataset.monoPost;
        const current = monoDraftAssignments[postId] || { employeeId: "", customName: "" };
        const nameInput = box.querySelector(`input[data-mono-name="${postId}"]`);
        const typed = nameInput ? String(nameInput.value || "").trim() : "";
        monoDraftAssignments[postId] = {
          employeeId: sel.value || "",
          customName: sel.value ? "" : typed || current.customName || "",
        };
      });
      // Nombres escritos aún sin blur/Enter
      box.querySelectorAll("input[data-mono-name]").forEach((inp) => {
        const postId = inp.dataset.monoName;
        const typed = String(inp.value || "").trim();
        if (!typed) return;
        const current = monoDraftAssignments[postId] || { employeeId: "", customName: "" };
        if (!current.employeeId) {
          monoDraftAssignments[postId] = { employeeId: "", customName: typed };
        }
      });
    }
    try {
      sessionStorage.setItem(
        MONO_DRAFT_SESSION_KEY,
        JSON.stringify({
          editingId: editingMonoReportId || null,
          meta: monoDraftMeta,
          assignments: monoDraftAssignments,
          savedAt: new Date().toISOString(),
        })
      );
    } catch (_) {}
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

function restoreMonoReportDraftFromSession() {
  try {
    const raw = sessionStorage.getItem(MONO_DRAFT_SESSION_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.assignments) return false;
    editingMonoReportId = parsed.editingId || null;
    monoDraftMeta = parsed.meta || monoDraftMeta;
    monoDraftAssignments = parsed.assignments || emptyMonoDraft();
    lastMonoReportEditAt = Date.now();
    return true;
  } catch (_) {
    return false;
  }
}

function clearMonoReportDraftSession() {
  try {
    sessionStorage.removeItem(MONO_DRAFT_SESSION_KEY);
  } catch (_) {}
}

function updateMonoReportDateHint() {
  const hint = document.getElementById("monoReportDateHint");
  const dateEl = document.getElementById("monoReportDate");
  if (!hint || !dateEl) return;
  const d = String(dateEl.value || "").slice(0, 10);
  const today = monoLocalToday();
  if (!d) {
    hint.textContent = "Indica la fecha del turno que estás reportando.";
    return;
  }
  if (d === today) hint.textContent = "Reporte de hoy.";
  else if (d === monoLocalYesterday()) hint.textContent = "Reporte de ayer.";
  else if (d > today) hint.textContent = "Fecha futura: revisa si es correcta.";
  else hint.textContent = `Día anterior · ${d}`;
}

function setMonoReportDate(iso) {
  const dateEl = document.getElementById("monoReportDate");
  const value = String(iso || monoLocalToday()).slice(0, 10);
  if (dateEl) dateEl.value = value;
  monoDraftMeta = { ...readMonoReportMetaFromDom(), date: value };
  markMonoReportEdited();
  updateMonoReportDateHint();
  flushOpenMonoReportDraft();
}

function openMonoReportNew(opts = {}) {
  editingMonoReportId = null;
  const keepAssignments = !!(opts && opts.keepAssignments && monoDraftAssignments);
  if (!keepAssignments) monoDraftAssignments = emptyMonoDraft();
  const date = String((opts && opts.date) || monoLocalToday()).slice(0, 10);
  const shift = opts && opts.shift === "pm" ? "pm" : "am";
  monoDraftMeta = {
    date,
    shift,
    supervisor: (opts && opts.supervisor) || "",
    novedades: (opts && opts.novedades) || "",
  };
  document.getElementById("monoReportEditTitle").textContent = "Nuevo reporte Monorriel";
  document.getElementById("monoReportDate").value = monoDraftMeta.date;
  document.getElementById("monoReportShift").value = monoDraftMeta.shift;
  document.getElementById("monoReportSupervisor").value = monoDraftMeta.supervisor;
  document.getElementById("monoReportNovedades").value = monoDraftMeta.novedades;
  markMonoReportEdited();
  updateMonoReportDateHint();
  renderMonoPostsEditor();
  switchView("monoReportEditView");
  flushOpenMonoReportDraft();
}

function openMonoReportEdit(id) {
  const report = getMonoReport(id);
  if (!report) {
    toast("Reporte no encontrado.");
    return;
  }
  editingMonoReportId = id;
  monoDraftAssignments = draftFromReport(report);
  monoDraftMeta = {
    date: String(report.date || monoLocalToday()).slice(0, 10),
    shift: report.shift === "pm" ? "pm" : "am",
    supervisor: report.supervisor || "",
    novedades: report.novedades || "",
  };
  document.getElementById("monoReportEditTitle").textContent = "Editar reporte Monorriel";
  document.getElementById("monoReportDate").value = monoDraftMeta.date;
  document.getElementById("monoReportShift").value = monoDraftMeta.shift;
  document.getElementById("monoReportSupervisor").value = monoDraftMeta.supervisor;
  document.getElementById("monoReportNovedades").value = monoDraftMeta.novedades;
  markMonoReportEdited();
  updateMonoReportDateHint();
  renderMonoPostsEditor();
  switchView("monoReportEditView");
  flushOpenMonoReportDraft();
}

/** Abre un reporte viejo como plantilla de uno nuevo (otra fecha), sin sobrescribir el original. */
function duplicateMonoReportAsNew(id) {
  const report = getMonoReport(id || selectedMonoReportId);
  if (!report) {
    toast("Reporte no encontrado.");
    return;
  }
  monoDraftAssignments = draftFromReport(report);
  openMonoReportNew({
    keepAssignments: true,
    date: monoLocalToday(),
    shift: report.shift === "pm" ? "pm" : "am",
    supervisor: report.supervisor || "",
    novedades: "",
  });
  toast(`Plantilla del ${report.date}. Cambia la fecha (ej. ayer) y guarda como reporte nuevo.`);
  updateMonoReportDateHint();
}

function copyLastMonoReport() {
  const shift = document.getElementById("monoReportShift").value;
  const keepDate = document.getElementById("monoReportDate")?.value || monoDraftMeta.date || monoLocalToday();
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
  // Conservar la fecha que el usuario eligió (hoy/ayer/otra), no la del reporte copiado
  if (document.getElementById("monoReportDate")) {
    document.getElementById("monoReportDate").value = keepDate;
  }
  monoDraftMeta = { ...readMonoReportMetaFromDom(), date: keepDate };
  renderMonoPostsEditor();
  updateMonoReportDateHint();
  flushOpenMonoReportDraft();
  toast(`Puestos copiados del ${previous.date}. Fecha de este reporte: ${keepDate}.`);
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
  const date = String(document.getElementById("monoReportDate").value || monoLocalToday()).slice(0, 10);
  if (!date) {
    toast("Indica la fecha del reporte (puedes elegir un día anterior).");
    return;
  }
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
  clearMonoReportDraftSession();
  lastMonoReportEditAt = 0;
  // Subir ya a la nube para que otra PC no pise este reporte
  try {
    flushCloudSave();
  } catch (_) {}
  toast("Reporte Monorriel guardado.");
  try {
    if (typeof feedMonorrielPayrollDaysFromReports === "function") {
      const ym = String(date || "").slice(0, 7);
      const day = Number(String(date || "").slice(8, 10)) || 0;
      const half = day >= 16 ? 2 : 1;
      feedMonorrielPayrollDaysFromReports({ period: ym, half, quiet: true, createMissing: true });
    }
  } catch (_) {}
  openMonoReportDetail(normalized.id);
}

function renderMonorrielHome() {
  try {
    const added = restoreMonorrielReportsFromSafetyNet();
    if (added > 0) {
      localStorage.setItem(MONORRIEL_REPORTS_KEY, JSON.stringify(monorrielReports));
      queueCloudSave();
    }
  } catch (_) {}
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
      : `<p class="empty">Aún no hay reportes. Crea uno con “Nuevo reporte Monorriel” (hoy o un día anterior).</p>`;
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

let monoUnifySelected = new Set(); // ids marcados
let monoUnifyKeeperId = ""; // el de doble check (principal)

function findMonoSimilarClusters() {
  const staff = getMonorrielEmployees(false);
  const used = new Set();
  const clusters = [];
  for (let i = 0; i < staff.length; i += 1) {
    if (used.has(staff[i].id)) continue;
    const group = [staff[i]];
    for (let j = i + 1; j < staff.length; j += 1) {
      if (used.has(staff[j].id)) continue;
      const sim = nameSimilarity(staff[i].name, staff[j].name);
      if (sim.score >= 0.78) group.push(staff[j]);
    }
    if (group.length >= 2) {
      group.forEach((e) => used.add(e.id));
      clusters.push(group);
    }
  }
  return clusters;
}

function updateMonoUnifyToolbar() {
  const btn = document.getElementById("btnMonoUnify");
  const count = document.getElementById("monoUnifyCount");
  const n = monoUnifySelected.size;
  const keeperOk = monoUnifyKeeperId && monoUnifySelected.has(monoUnifyKeeperId);
  if (btn) btn.disabled = n < 2 || !keeperOk;
  if (count) {
    count.textContent = n
      ? `${n} seleccionados` + (keeperOk ? " · Principal marcado ✓✓" : " · falta Principal (doble check)")
      : "";
  }
}

function renderMonoSimilarAlert() {
  const box = document.getElementById("monoSimilarAlert");
  if (!box) return;
  const clusters = findMonoSimilarClusters();
  if (!clusters.length) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  const lines = clusters
    .slice(0, 8)
    .map((g) => `• ${g.map((e) => e.name.replace(/\s*\(Monorriel\)\s*$/i, "")).join(" ↔ ")}`)
    .join("<br/>");
  box.hidden = false;
  box.innerHTML = `<strong style="color:#fbbf24">⚠ Nombres muy parecidos (${clusters.length} grupo(s))</strong>
    <p class="muted tight" style="margin:6px 0 0">Pueden ser la misma persona. Márcalos, elige Principal (✓✓) y pulsa Unificar.</p>
    <p style="margin:8px 0 0;font-size:13px;line-height:1.45">${lines}</p>`;
}

function renderMonoStaffList() {
  const list = document.getElementById("monoStaffList");
  if (!list) return;
  // Solo activos: los unificados (borrados) no deben reaparecer
  const staff = getMonorrielEmployees(false);
  renderMonoSimilarAlert();
  // limpiar selección de ids que ya no existen
  const ids = new Set(staff.map((e) => e.id));
  [...monoUnifySelected].forEach((id) => {
    if (!ids.has(id)) monoUnifySelected.delete(id);
  });
  if (monoUnifyKeeperId && !ids.has(monoUnifyKeeperId)) monoUnifyKeeperId = "";

  if (!staff.length) {
    list.innerHTML = `<p class="empty">No hay personal Monorriel importado todavía.</p>`;
    updateMonoUnifyToolbar();
    return;
  }
  list.innerHTML = staff
    .map((e) => {
      const checked = monoUnifySelected.has(e.id);
      const isKeeper = monoUnifyKeeperId === e.id;
      const base = monoBaseName(e.name) || e.name;
      return `<div class="employee-card mono-staff-card${checked ? " mono-selected" : ""}${isKeeper ? " mono-keeper" : ""}" data-emp-id="${escapeHtml(e.id)}">
        <div class="row" style="align-items:flex-start;gap:10px">
          <label class="mono-check-wrap" title="Seleccionar para unificar">
            <input type="checkbox" class="mono-unify-check" data-emp-id="${escapeHtml(e.id)}" ${checked ? "checked" : ""} />
          </label>
          <div style="flex:1;min-width:0">
            <h3 style="margin:0 0 4px">${escapeHtml(base)}${isKeeper ? ' <span class="mono-keeper-tag">✓✓ Principal</span>' : ""}</h3>
            <p class="muted tight">${escapeHtml(e.phone || "Sin teléfono")} · ${escapeHtml(e.cedula || "Sin cédula")}</p>
            <div class="mono-staff-actions" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
              <button type="button" class="btn ghost btn-sm mono-set-keeper" data-emp-id="${escapeHtml(e.id)}" ${checked ? "" : "disabled"} title="Doble check: este nombre se queda">
                ${isKeeper ? "✓✓ Principal" : "Marcar Principal ✓✓"}
              </button>
              <button type="button" class="btn ghost btn-sm mono-open-emp" data-emp-id="${escapeHtml(e.id)}">Abrir ficha</button>
            </div>
          </div>
        </div>
      </div>`;
    })
    .join("");

  list.querySelectorAll(".mono-unify-check").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = cb.dataset.empId;
      if (cb.checked) monoUnifySelected.add(id);
      else {
        monoUnifySelected.delete(id);
        if (monoUnifyKeeperId === id) monoUnifyKeeperId = "";
      }
      // Si solo hay uno seleccionado, no hay keeper aún; si hay 2+ y no keeper, no auto
      renderMonoStaffList();
    });
  });
  list.querySelectorAll(".mono-set-keeper").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const id = btn.dataset.empId;
      if (!monoUnifySelected.has(id)) {
        monoUnifySelected.add(id);
      }
      monoUnifyKeeperId = id;
      renderMonoStaffList();
    });
  });
  list.querySelectorAll(".mono-open-emp").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      openEmployeeDetail(btn.dataset.empId);
    });
  });
  updateMonoUnifyToolbar();
}

function remapMonorrielReportsToKeeper(keeper, otherIds, otherNames) {
  const keepId = keeper.id;
  const keepName = monoDisplayName(monoBaseName(keeper.name) || keeper.name);
  const otherIdSet = new Set(otherIds);
  const otherNameKeys = new Set(
    (otherNames || []).map((n) => employeeKey(monoBaseName(n) || n)).filter(Boolean)
  );
  let touched = 0;
  (monorrielReports || []).forEach((report) => {
    (report.assignments || []).forEach((a) => {
      if (!a) return;
      const aKey = employeeKey(monoBaseName(a.employeeName) || a.employeeName);
      if (otherIdSet.has(a.employeeId) || (aKey && otherNameKeys.has(aKey))) {
        a.employeeId = keepId;
        a.employeeName = keepName;
        touched += 1;
      }
    });
  });
  return touched;
}

function remapMonorrielPayrollNames(keeper, otherNames) {
  if (typeof contabilidadData === "undefined" || !contabilidadData) return 0;
  const keepName = monoBaseName(keeper.name) || keeper.name;
  const otherKeys = new Set(
    (otherNames || []).map((n) => employeeKey(monoBaseName(n) || n)).filter(Boolean)
  );
  let n = 0;
  (contabilidadData.payrolls || []).forEach((p) => {
    if (!p || p.group !== "monorriel") return;
    (p.lines || []).forEach((line) => {
      if (!line) return;
      const lk = employeeKey(monoBaseName(line.fullName) || line.fullName);
      if (lk && otherKeys.has(lk)) {
        line.fullName = keepName;
        if (keeper.id) line.employeeId = keeper.id;
        n += 1;
      }
    });
  });
  if (n && typeof saveContabilidadData === "function") saveContabilidadData(true);
  return n;
}

/** Unifica fichas Monorriel: el Principal (doble check) se queda; los demás salen. */
function unifyMonorrielEmployees() {
  if (typeof canWriteEmployees === "function" && !canWriteEmployees()) {
    toast("No tienes permiso para unificar empleados.");
    return;
  }
  const selected = [...monoUnifySelected];
  if (selected.length < 2) {
    toast("Marca al menos 2 nombres.");
    return;
  }
  if (!monoUnifyKeeperId || !monoUnifySelected.has(monoUnifyKeeperId)) {
    toast("Marca Principal (✓✓) en el nombre que se queda.");
    return;
  }
  const keeper = getEmployee(monoUnifyKeeperId);
  if (!keeper || !isMonorrielEmployee(keeper)) {
    toast("El principal debe ser personal Monorriel.");
    return;
  }
  const others = selected
    .filter((id) => id !== monoUnifyKeeperId)
    .map((id) => getEmployee(id))
    .filter((e) => e && isMonorrielEmployee(e));
  if (!others.length) {
    toast("Selecciona otros nombres además del Principal.");
    return;
  }

  // Alerta si no son parecidos
  const weak = others.filter((o) => nameSimilarity(keeper.name, o.name).score < 0.65);
  if (weak.length) {
    const msg =
      "Algunos nombres no se parecen mucho al Principal:\n" +
      weak.map((o) => `• ${o.name}`).join("\n") +
      "\n\n¿Unificar de todos modos?";
    if (!confirm(msg)) return;
  }

  const otherNames = others.map((o) => o.name);
  const list =
    `Principal (se queda):\n• ${monoBaseName(keeper.name) || keeper.name}\n\n` +
    `Se borran de la lista:\n` +
    others.map((o) => `• ${monoBaseName(o.name) || o.name}`).join("\n") +
    `\n\nReportes, nómina y préstamos pasan al Principal.\n¿Confirmar Unificar?`;
  if (!confirm(list)) return;

  // Fusionar datos al keeper
  let merged = keeper;
  others.forEach((o) => {
    merged = mergeEmployeeRecord(merged, o);
  });
  merged = applyMonorrielFlag(merged, true);
  merged.id = keeper.id;
  merged.name = monoDisplayName(monoBaseName(keeper.name) || keeper.name);
  merged.status = "active";
  merged.inactiveReason = "";
  merged.inactiveAt = "";
  // Alias de nombres borrados: si reaparece la mala escritura, se reusa el Principal
  const aliasKeys = new Set([
    ...((merged.monoUnifyAliases || []).map((k) => String(k || "").trim()).filter(Boolean)),
    ...otherNames.map((n) => employeeKey(monoBaseName(n) || n)).filter(Boolean),
  ]);
  merged.monoUnifyAliases = [...aliasKeys];
  merged.updatedAt = new Date().toISOString();
  const kIdx = employees.findIndex((e) => e.id === keeper.id);
  if (kIdx >= 0) employees[kIdx] = normalizeEmployee(merged);

  const otherIds = others.map((o) => o.id);
  const otherIdSet = new Set(otherIds);
  const reportsTouched = remapMonorrielReportsToKeeper(employees[kIdx] || merged, otherIds, otherNames);
  const payTouched = remapMonorrielPayrollNames(employees[kIdx] || merged, otherNames);

  // Préstamos / avances → Principal (antes de borrar fichas)
  if (typeof loans !== "undefined" && Array.isArray(loans)) {
    loans.forEach((l) => {
      if (l && l.employeeId && otherIdSet.has(l.employeeId)) {
        l.employeeId = keeper.id;
        if (!String(l.employeeName || "").trim()) {
          l.employeeName = monoBaseName(merged.name) || merged.name;
        }
      }
    });
    if (typeof saveLoans === "function") saveLoans();
  }

  // Borrar de la lista los que no son Principal
  employees = employees.filter((e) => e && !otherIdSet.has(e.id));

  saveEmployees();
  if (typeof saveMonorrielReports === "function") saveMonorrielReports();
  if (typeof logActivity === "function") {
    logActivity(
      "mono_unify",
      `Unificó Monorriel: ${merged.name} ← borrados ${others.map((o) => monoBaseName(o.name)).join(", ")}`
    );
  }

  monoUnifySelected = new Set();
  monoUnifyKeeperId = "";
  renderMonoStaffList();
  if (typeof renderEmployees === "function") renderEmployees();
  toast(
    `Unificado: se queda ${monoBaseName(merged.name)}. ${others.length} borrado(s) de la lista` +
      (reportsTouched ? ` · ${reportsTouched} asignaciones en reportes` : "") +
      (payTouched ? ` · ${payTouched} en nómina` : "")
  );
}

function monoEmployeeAttendanceKey(assignment) {
  const id = String((assignment && assignment.employeeId) || "").trim();
  if (id) return `id:${id}`;
  const raw = String((assignment && assignment.employeeName) || "").trim();
  const base = typeof monoBaseName === "function" ? monoBaseName(raw) : raw;
  const name = String(base || raw)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return name ? `name:${name}` : "";
}

/** Agrega asistencia por empleado. shiftFilter: "am" | "pm" | "" (todos). */
function buildMonoEmployeeAttendance(fromDate, toDate, shiftFilter = "") {
  const from = String(fromDate || "").slice(0, 10);
  const to = String(toDate || "").slice(0, 10);
  const want = shiftFilter === "pm" || shiftFilter === "am" ? shiftFilter : "";
  const map = new Map();
  (monorrielReports || []).forEach((report) => {
    const d = String(report.date || "").slice(0, 10);
    if (!d) return;
    if (from && d < from) return;
    if (to && d > to) return;
    const shift = report.shift === "pm" ? "pm" : "am";
    if (want && shift !== want) return;
    (report.assignments || []).forEach((a) => {
      const name = String(a.employeeName || "").trim();
      if (!name) return;
      const key = monoEmployeeAttendanceKey(a);
      if (!key) return;
      let row = map.get(key);
      if (!row) {
        row = {
          key,
          employeeId: a.employeeId || "",
          name,
          daySet: new Set(),
          entries: [],
        };
        map.set(key, row);
      }
      if (!row.employeeId && a.employeeId) row.employeeId = a.employeeId;
      // Primera lectura del nombre queda fija (no reemplazar por variantes)
      row.daySet.add(d);
      row.entries.push({ date: d, shift, postId: a.postId || "" });
    });
  });
  return [...map.values()]
    .map((row) => {
      const days = [...row.daySet].sort();
      const byDay = new Map();
      row.entries.forEach((e) => {
        if (!byDay.has(e.date)) byDay.set(e.date, new Set());
        byDay.get(e.date).add(e.shift);
      });
      const dayDetails = days.map((d) => {
        const shifts = [...(byDay.get(d) || [])].sort();
        const label = want
          ? d
          : `${d} (${shifts.map((s) => (s === "pm" ? "PM" : "AM")).join("+")})`;
        return { date: d, shifts, label };
      });
      return {
        employeeId: row.employeeId,
        name: row.name,
        daysCount: days.length,
        days,
        dayDetails,
        shiftsCount: row.entries.length,
        shiftFilter: want || "",
      };
    })
    .sort(
      (a, b) =>
        b.daysCount - a.daysCount ||
        String(a.name).localeCompare(String(b.name), "es")
    );
}

/** Pestaña activa del resumen: am (día) o pm (noche). */
let monoSummaryShiftTab = "am";

function getMonoSummaryShiftTab() {
  return monoSummaryShiftTab === "pm" ? "pm" : "am";
}

function setMonoSummaryShiftTab(shift) {
  monoSummaryShiftTab = shift === "pm" ? "pm" : "am";
  document.querySelectorAll(".mono-summary-tabs .emp-tab[data-mono-summary-shift]").forEach((btn) => {
    const on = btn.dataset.monoSummaryShift === monoSummaryShiftTab;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
}

function monoSummaryShiftTitle(shift) {
  return shift === "pm" ? "Noche (P.M.)" : "Día (A.M.)";
}

function getMonoSummaryRangeFromDom() {
  const fromEl = document.getElementById("monoSummaryFrom");
  const toEl = document.getElementById("monoSummaryTo");
  return {
    from: fromEl ? String(fromEl.value || "").slice(0, 10) : "",
    to: toEl ? String(toEl.value || "").slice(0, 10) : "",
  };
}

function setMonoSummaryRange(from, to) {
  const fromEl = document.getElementById("monoSummaryFrom");
  const toEl = document.getElementById("monoSummaryTo");
  if (fromEl) fromEl.value = from || "";
  if (toEl) toEl.value = to || "";
}

function monoSummaryDefaultRange() {
  const today = monoLocalToday();
  const [y, m] = today.split("-");
  return { from: `${y}-${m}-01`, to: today };
}

function openMonoEmployeeSummary() {
  const range = monoSummaryDefaultRange();
  const fromEl = document.getElementById("monoSummaryFrom");
  const toEl = document.getElementById("monoSummaryTo");
  if (fromEl && !fromEl.value) fromEl.value = range.from;
  if (toEl && !toEl.value) toEl.value = range.to;
  renderMonoEmployeeSummary();
  switchView("monoEmployeeSummaryView");
}

function renderMonoEmployeeSummary() {
  const body = document.getElementById("monoEmployeeSummaryBody");
  const hint = document.getElementById("monoSummaryHint");
  if (!body) return;
  setMonoSummaryShiftTab(getMonoSummaryShiftTab());
  const shift = getMonoSummaryShiftTab();
  const { from, to } = getMonoSummaryRangeFromDom();
  const rows = buildMonoEmployeeAttendance(from, to, shift);
  const shiftReports = (monorrielReports || []).filter((r) => {
    const d = String(r.date || "").slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return (r.shift === "pm" ? "pm" : "am") === shift;
  }).length;
  if (hint) {
    const span =
      from || to
        ? `${from || "…"} → ${to || "…"}`
        : "todos los reportes";
    hint.textContent = `${monoSummaryShiftTitle(shift)} · ${rows.length} empleado(s) · ${shiftReports} reporte(s) de ese turno · rango ${span}`;
  }
  if (!rows.length) {
    body.innerHTML = `<p class="empty">No hay asistencia de <strong>${escapeHtml(
      monoSummaryShiftTitle(shift)
    )}</strong> en ese rango. Revisa los reportes diarios de ese turno.</p>`;
    return;
  }
  body.innerHTML = `<div class="schedule-wrap"><table class="schedule-table">
    <thead><tr><th>Empleado</th><th>Días</th><th>Puestos</th><th>Fechas trabajadas</th></tr></thead>
    <tbody>${rows
      .map(
        (r) => `<tr>
      <td><strong>${escapeHtml(r.name)}</strong></td>
      <td>${r.daysCount}</td>
      <td>${r.shiftsCount}</td>
      <td style="font-size:12px">${escapeHtml(r.dayDetails.map((d) => d.label).join(" · "))}</td>
    </tr>`
      )
      .join("")}</tbody>
  </table></div>`;
}

function printMonoEmployeeSummary() {
  const shift = getMonoSummaryShiftTab();
  const { from, to } = getMonoSummaryRangeFromDom();
  const rows = buildMonoEmployeeAttendance(from, to, shift);
  const span = from || to ? `${from || "…"} → ${to || "…"}` : "todos";
  const shiftTitle = monoSummaryShiftTitle(shift);
  const tableRows = rows
    .map(
      (r) => `<tr>
      <td>${escapeHtml(r.name)}</td>
      <td style="text-align:center">${r.daysCount}</td>
      <td style="text-align:center">${r.shiftsCount}</td>
      <td>${escapeHtml(r.dayDetails.map((d) => d.label).join(", "))}</td>
    </tr>`
    )
    .join("");
  openPrintWindow(
    `Resumen Monorriel · ${shiftTitle}`,
    `<h2>Asistencia Monorriel · ${escapeHtml(shiftTitle)}</h2>
    <p class="muted">Rango: ${escapeHtml(span)} · ${rows.length} empleado(s) · según reportes diarios ${
      shift === "pm" ? "P.M." : "A.M."
    }</p>
    <table class="print-table">
      <thead><tr><th>Empleado</th><th>Días</th><th>Puestos</th><th>Fechas</th></tr></thead>
      <tbody>${tableRows || `<tr><td colspan="4">Sin datos</td></tr>`}</tbody>
    </table>`
  );
}

function bindMonorrielUi() {
  if (!document.getElementById("btnOpenMonoReportNew")) return;
  ["monoReportDate", "monoReportShift", "monoReportSupervisor", "monoReportNovedades"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el || el.dataset.monoDraftBound === "1") return;
    el.dataset.monoDraftBound = "1";
    const bump = () => {
      markMonoReportEdited();
      monoDraftMeta = readMonoReportMetaFromDom();
      if (id === "monoReportDate") updateMonoReportDateHint();
      flushOpenMonoReportDraft();
    };
    el.addEventListener("input", bump);
    el.addEventListener("change", bump);
  });
  document.getElementById("btnOpenMonoReportNew").addEventListener("click", () => openMonoReportNew());
  document.getElementById("btnMonoStaffInfo").addEventListener("click", () => {
    renderMonoStaffList();
    switchView("monoStaffView");
  });
  document.getElementById("btnMonoEmployeeSummary")?.addEventListener("click", openMonoEmployeeSummary);
  document.getElementById("btnBackMonoFromEdit").addEventListener("click", () => {
    switchView("monorrielView");
    renderMonorrielHome();
  });
  document.getElementById("btnBackMonoFromDetail").addEventListener("click", () => {
    switchView("monorrielView");
    renderMonorrielHome();
  });
  document.getElementById("btnBackMonoFromStaff").addEventListener("click", () => switchView("monorrielView"));
  document.getElementById("btnBackMonoFromSummary")?.addEventListener("click", () => {
    switchView("monorrielView");
    renderMonorrielHome();
  });
  document.getElementById("btnSaveMonoReport").addEventListener("click", saveMonoReport);
  document.getElementById("btnMonoCopyLast").addEventListener("click", copyLastMonoReport);
  document.getElementById("btnMonoClearPosts").addEventListener("click", clearMonoDraftPosts);
  document.getElementById("btnMonoDateToday")?.addEventListener("click", () => setMonoReportDate(monoLocalToday()));
  document.getElementById("btnMonoDateYesterday")?.addEventListener("click", () => setMonoReportDate(monoLocalYesterday()));
  document.getElementById("btnEditMonoReport").addEventListener("click", () => openMonoReportEdit(selectedMonoReportId));
  document.getElementById("btnMonoDuplicateAsNew")?.addEventListener("click", () => duplicateMonoReportAsNew());
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
  document.getElementById("btnMonoSummaryApply")?.addEventListener("click", renderMonoEmployeeSummary);
  document.getElementById("btnMonoSummaryPrint")?.addEventListener("click", printMonoEmployeeSummary);
  document.getElementById("btnMonoSummaryMonth")?.addEventListener("click", () => {
    const r = monoSummaryDefaultRange();
    setMonoSummaryRange(r.from, r.to);
    renderMonoEmployeeSummary();
  });
  document.getElementById("btnMonoSummaryAll")?.addEventListener("click", () => {
    setMonoSummaryRange("", "");
    renderMonoEmployeeSummary();
  });
  ["monoSummaryFrom", "monoSummaryTo"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", renderMonoEmployeeSummary);
  });
  document.querySelectorAll(".mono-summary-tabs .emp-tab[data-mono-summary-shift]").forEach((btn) => {
    if (btn.dataset.monoSummaryBound === "1") return;
    btn.dataset.monoSummaryBound = "1";
    btn.addEventListener("click", () => {
      setMonoSummaryShiftTab(btn.dataset.monoSummaryShift);
      renderMonoEmployeeSummary();
    });
  });
  document.getElementById("btnMonoUnify")?.addEventListener("click", () => unifyMonorrielEmployees());
  document.getElementById("btnMonoUnifyClear")?.addEventListener("click", () => {
    monoUnifySelected = new Set();
    monoUnifyKeeperId = "";
    renderMonoStaffList();
    toast("Selección limpiada.");
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
    active: p.active === false ? false : true,
    createdAt: p.createdAt || new Date().toISOString(),
    updatedAt: p.updatedAt || p.createdAt || new Date().toISOString(),
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

function lvaStamp(row) {
  return String((row && (row.updatedAt || row.createdAt || row.at)) || "");
}

function mergeLvaById(localList, remoteList, normalizeFn) {
  const map = new Map();
  [...(localList || []), ...(remoteList || [])].forEach((row) => {
    if (!row || !row.id) return;
    const next = normalizeFn(row);
    const prev = map.get(next.id);
    if (!prev || lvaStamp(next) >= lvaStamp(prev)) map.set(next.id, next);
  });
  return [...map.values()];
}

function saveLvaState(push = true) {
  lvaState = normalizeLvaState(lvaState);
  // No persistir puestos activos sin personal
  const occupied = new Set(
    (lvaState.staff || []).filter((s) => s.active && s.postId).map((s) => s.postId)
  );
  const now = new Date().toISOString();
  lvaState.posts = (lvaState.posts || []).map((p) => {
    if (p.active === false) return p;
    if (occupied.has(p.id)) return p;
    return { ...p, active: false, updatedAt: now };
  });
  localStorage.setItem(LVA_KEY, JSON.stringify(lvaState));
  if (push) queueCloudSave();
}

function applyRemoteLva(remote) {
  if (!remote || typeof remote !== "object") return false;
  const prev = JSON.stringify(lvaState);
  const localNorm = normalizeLvaState(lvaState);
  const remoteNorm = normalizeLvaState(remote);
  const hasRemoteData = remoteNorm.posts.length || remoteNorm.staff.length || remoteNorm.history.length;
  const hasLocalData = localNorm.posts.length || localNorm.staff.length || localNorm.history.length;

  // Nube vacía no debe borrar lo que ya digitaron en este equipo
  if (!hasRemoteData) {
    if (hasLocalData) {
      // Forzar subida de lo local en el próximo guardado
      queueCloudSave();
    }
    return false;
  }

  const histMap = new Map();
  [...(localNorm.history || []), ...(remoteNorm.history || [])].forEach((h) => {
    if (h && h.id) histMap.set(h.id, normalizeLvaHistory(h));
  });

  // Fusionar puestos y personal por id (gana el más reciente); no pisar a ciegas
  lvaState = normalizeLvaState({
    posts: mergeLvaById(localNorm.posts, remoteNorm.posts, normalizeLvaPost),
    staff: mergeLvaById(localNorm.staff, remoteNorm.staff, normalizeLvaStaff),
    history: [...histMap.values()],
  });
  localStorage.setItem(LVA_KEY, JSON.stringify(lvaState));
  return JSON.stringify(lvaState) !== prev;
}

async function mergeRemoteLvaBeforeSave() {
  return mergeRemoteBundleBeforeSave();
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

const LVA_TAG = "La Vega";

function lvaDisplayName(baseName) {
  const raw = String(baseName || "").trim();
  if (!raw) return "";
  if (/\(la vega(?: autopista)?\)/i.test(raw)) return raw.replace(/\(la vega autopista\)/i, "(La Vega)");
  return `${monoBaseName(raw)} (${LVA_TAG})`;
}

function lvaBaseName(displayName) {
  return monoBaseName(displayName);
}

function isLvaEmployee(emp) {
  if (!emp) return false;
  if (/\(la vega/i.test(emp.name || "")) return true;
  if ((emp.sites || []).some((s) => /la vega/i.test(s || ""))) return true;
  if ((emp.roles || []).some((r) => /la vega/i.test(r || ""))) return true;
  return false;
}

function applyLvaFlag(emp, isLva) {
  const out = normalizeEmployee(emp);
  const keepMono = /\(monorriel\)/i.test(out.name || "") || (out.sites || []).some((s) => /monorriel/i.test(s || ""));
  let base = monoBaseName(out.name) || out.name;
  if (isLva) {
    if (!keepMono) out.name = lvaDisplayName(base);
    out.sites = [...new Set([...(out.sites || []), LVA_SITE])];
    out.roles = [...new Set([...(out.roles || []), LVA_SITE])];
  } else {
    out.sites = (out.sites || []).filter((s) => !/la vega/i.test(s || ""));
    out.roles = (out.roles || []).filter((r) => !/la vega/i.test(r || ""));
    out.name = keepMono ? monoDisplayName(base) : base;
  }
  out.key = employeeKey(out.name);
  return out;
}

function upsertEmployeeFromLva(staff) {
  const base = lvaBaseName((staff.name || "").trim());
  if (!base) return null;
  const display = lvaDisplayName(base);
  const key = employeeKey(display);
  const keyBase = employeeKey(base);
  let idx = employees.findIndex(
    (e) => employeeKey(e.name) === key || employeeKey(monoBaseName(e.name)) === keyBase
  );
  if (idx >= 0) {
    const cur = employees[idx];
    const keepMono = /\(monorriel\)/i.test(cur.name || "");
    employees[idx] = normalizeEmployee({
      ...cur,
      name: keepMono ? cur.name : display,
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
    name: display,
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

/** Sube el personal activo de La Vega a Empleados general con etiqueta (La Vega) */
/** Trae personal de Contabilidad → Oficina a la lista Empleados (para préstamos, etc.). */
function ensureOfficeEmployeesImported() {
  if (typeof contabilidadData === "undefined" || !contabilidadData) return 0;
  const rows = (contabilidadData.officeEmployees || []).filter(
    (o) => o && o.active !== false && String(o.fullName || "").trim()
  );
  if (!rows.length) return 0;
  let added = 0;
  let changed = false;
  rows.forEach((o) => {
    const name = String(o.fullName || "").trim();
    const key = employeeIdentityKey(name);
    const cedula = String(o.cedula || "").replace(/\D/g, "");
    const cedulaFmt =
      cedula.length === 11 ? `${cedula.slice(0, 3)}-${cedula.slice(3, 10)}-${cedula.slice(10)}` : String(o.cedula || "");
    const existing = employees.find(
      (e) =>
        e.id === o.id ||
        e.officeEmployeeId === o.id ||
        employeeIdentityKey(e.name) === key
    );
    if (existing) {
      const idx = employees.findIndex((e) => e.id === existing.id);
      const merged = normalizeEmployee({
        ...existing,
        id: existing.id || o.id,
        name,
        phone: o.phone || existing.phone || "",
        cedula: cedulaFmt || existing.cedula || "",
        salary: Math.max(0, Number(o.salary) || Number(existing.salary) || 0),
        officeEmployeeId: o.id,
        sites: [...new Set([...(existing.sites || []), "Oficina"])],
        roles: [...new Set([...(existing.roles || []), "Oficina", o.position || "Oficina"].filter(Boolean))],
        status: "active",
        inactiveReason: "",
        inactiveAt: "",
        updatedAt: new Date().toISOString(),
      });
      const before = JSON.stringify(employees[idx]);
      employees[idx] = merged;
      if (JSON.stringify(merged) !== before) changed = true;
      return;
    }
    employees.push(
      normalizeEmployee({
        id: o.id,
        name,
        phone: o.phone || "",
        cedula: cedulaFmt,
        salary: Math.max(0, Number(o.salary) || 0),
        officeEmployeeId: o.id,
        sites: ["Oficina"],
        roles: ["Oficina", o.position || "Oficina"].filter(Boolean),
        status: "active",
        note: "Importado desde Contabilidad → Oficina",
      })
    );
    added += 1;
    changed = true;
  });
  if (changed) {
    employees.sort((a, b) => a.name.localeCompare(b.name, "es"));
    saveEmployees();
  }
  return added;
}

function ensureLvaEmployeesImported() {
  const active = (lvaState.staff || []).filter((s) => s && s.active !== false && (s.name || "").trim());
  if (!active.length) return { added: 0, changed: false, lvaTouched: false };
  let added = 0;
  let lvaTouched = false;
  const beforeEmp = JSON.stringify(employees.map((e) => [e.id, e.name, e.phone, e.cedula, e.sites, e.roles]));
  active.forEach((s) => {
    const base = lvaBaseName(s.name);
    const existed = employees.some(
      (e) =>
        employeeKey(monoBaseName(e.name)) === employeeKey(base) ||
        employeeKey(e.name) === employeeKey(lvaDisplayName(base))
    );
    const emp = upsertEmployeeFromLva(s);
    if (!emp) return;
    if (s.employeeId !== emp.id) {
      s.employeeId = emp.id;
      lvaTouched = true;
    }
    const postName = s.postName || getLvaPostName(s.postId) || "";
    if (postName && s.postName !== postName) {
      s.postName = postName;
      lvaTouched = true;
    }
    // Normalizar nombre en LVA sin la etiqueta (la etiqueta vive en Empleados)
    const clean = lvaBaseName(s.name);
    if (clean && s.name !== clean) {
      s.name = clean;
      lvaTouched = true;
    }
    if (!existed) added += 1;
  });
  const afterEmp = JSON.stringify(employees.map((e) => [e.id, e.name, e.phone, e.cedula, e.sites, e.roles]));
  const changed = beforeEmp !== afterEmp;
  if (changed) {
    employees.sort((a, b) => a.name.localeCompare(b.name, "es"));
    saveEmployees();
  }
  return { added, changed, lvaTouched };
}

function removeLvaSiteFromEmployee(employeeIdOrName) {
  const idx = employees.findIndex(
    (e) =>
      e.id === employeeIdOrName ||
      employeeKey(e.name) === employeeKey(employeeIdOrName) ||
      employeeKey(monoBaseName(e.name)) === employeeKey(monoBaseName(employeeIdOrName))
  );
  if (idx < 0) return;
  employees[idx] = applyLvaFlag(employees[idx], false);
  employees[idx].updatedAt = new Date().toISOString();
}

function getLvaPostName(postId) {
  const p = lvaState.posts.find((x) => x.id === postId);
  return p ? p.name : "";
}

function fillLvaPostSelect() {
  // Compat: datalist de puestos existentes (solo con personal)
  const list = document.getElementById("lvaPostSuggestions");
  if (!list) return;
  const names = [
    ...new Set(
      lvaState.staff
        .filter((s) => s.active)
        .map((s) => (s.postName || getLvaPostName(s.postId) || "").trim())
        .filter(Boolean)
    ),
  ].sort((a, b) => a.localeCompare(b, "es"));
  list.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
}

/** Elimina (baja lógica) puestos activos sin ningún empleado activo */
function pruneEmptyLvaPosts(recordHistory = false) {
  const now = new Date().toISOString();
  let removed = 0;
  lvaState.posts = (lvaState.posts || []).map((p) => {
    if (p.active === false) return p;
    const hasStaff = (lvaState.staff || []).some((s) => s.active && s.postId === p.id);
    if (hasStaff) return p;
    removed += 1;
    if (recordHistory) {
      pushLvaHistory("Puesto vacío eliminado", p.name || p.id);
    }
    return { ...p, active: false, updatedAt: now };
  });
  return removed;
}

function renderLvaPosts() {
  // Ya no hay lista aparte de puestos vacíos; el roster es la fuente.
  fillLvaPostSelect();
}

function renderLvaStaff() {
  const list = document.getElementById("lvaStaffList");
  if (!list) return;
  pruneEmptyLvaPosts(false);
  const active = lvaState.staff.filter((s) => s.active);
  const rows = active
    .slice()
    .sort((a, b) => {
      const pa = (a.postName || getLvaPostName(a.postId) || "").localeCompare(
        b.postName || getLvaPostName(b.postId) || "",
        "es"
      );
      if (pa !== 0) return pa;
      return a.name.localeCompare(b.name, "es");
    })
    .map((s) => {
      const post = s.postName || getLvaPostName(s.postId) || "Sin puesto";
      return `<article class="lva-row">
        <div>
          <h3>${escapeHtml(s.name)}</h3>
          <span class="lva-post-pill">${escapeHtml(post)}</span>
          <p class="lva-meta">Tel: ${escapeHtml(s.phone || "—")} · Cédula: ${escapeHtml(s.cedula || "—")}</p>
        </div>
        <div class="lva-row-actions">
          <button class="btn secondary btn-lva-open-emp" type="button" data-id="${escapeHtml(
            s.employeeId || ""
          )}" data-name="${escapeHtml(s.name)}">Ver</button>
          <button class="btn danger btn-lva-del-staff" type="button" data-id="${escapeHtml(
            s.id
          )}">Quitar</button>
        </div>
      </article>`;
    })
    .join("");
  list.innerHTML = rows || `<p class="lva-empty">Aún no hay servicios. Agrega empleado + puesto abajo.</p>`;

  const countEl = document.getElementById("lvaServicesCount");
  if (countEl) countEl.textContent = String(active.length);
  const summary = document.getElementById("lvaSummary");
  if (summary) {
    summary.textContent =
      active.length === 1
        ? "1 servicio activo (empleado con puesto)."
        : `${active.length} servicios activos (empleado + puesto).`;
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
          (e) =>
            employeeKey(e.name) === employeeKey(name) ||
            employeeKey(monoBaseName(e.name)) === employeeKey(monoBaseName(name))
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
  const pruned = pruneEmptyLvaPosts(false);
  const imported = ensureLvaEmployeesImported();
  if (pruned || (imported && imported.lvaTouched)) saveLvaState(true);
  if (imported && imported.added) {
    toast(`${imported.added} empleado(s) de La Vega subidos a Empleados con etiqueta (La Vega).`);
    if (typeof renderEmployees === "function") renderEmployees();
  }
  fillLvaPostSelect();
  renderLvaStaff();
  renderLvaHistory();
}

function ensureLvaPostByName(postName) {
  const name = String(postName || "").trim();
  if (!name) return null;
  const existing = lvaState.posts.find(
    (p) => p.active !== false && employeeKey(p.name) === employeeKey(name)
  );
  if (existing) return existing;
  const now = new Date().toISOString();
  const post = normalizeLvaPost({ name, note: "", active: true, createdAt: now, updatedAt: now });
  lvaState.posts.push(post);
  return post;
}

function addLvaPost() {
  // Los puestos vacíos no se guardan: usa el alta conjunta empleado + puesto.
  toast("Escribe el empleado y el puesto abajo. Un puesto solo se guarda con personal.");
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
  const now = new Date().toISOString();
  assigned.forEach((s) => {
    s.active = false;
    s.updatedAt = now;
    if (s.employeeId) removeLvaSiteFromEmployee(s.employeeId);
    else removeLvaSiteFromEmployee(s.name);
  });
  const idx = lvaState.posts.findIndex((p) => p.id === postId);
  if (idx >= 0) {
    lvaState.posts[idx] = { ...lvaState.posts[idx], active: false, updatedAt: now };
  }
  pushLvaHistory(
    "Puesto quitado",
    `${post.name}${assigned.length ? ` (${assigned.length} empleados liberados)` : ""}`
  );
  pruneEmptyLvaPosts(false);
  saveEmployees();
  saveLvaState(true);
  renderEmployees();
  renderLvaModule();
  toast("Puesto quitado.");
}

function addLvaStaff() {
  if (!canAccessModule("lavega")) {
    toast("No tienes acceso a La Vega Autopista.");
    return;
  }
  const name = document.getElementById("lvaStaffName")?.value.trim() || "";
  const postNameInput = document.getElementById("lvaPostName")?.value.trim() || "";
  const phone = document.getElementById("lvaStaffPhone")?.value.trim() || "";
  const cedula = document.getElementById("lvaStaffCedula")?.value.trim() || "";
  if (!name) {
    toast("Escribe el nombre del empleado.");
    return;
  }
  if (!postNameInput) {
    toast("Escribe el puesto. No se guarda un puesto sin empleado.");
    return;
  }
  const exactInLva = lvaState.staff.find(
    (s) => s.active && employeeKey(s.name) === employeeKey(name)
  );
  if (exactInLva) {
    toast("Ese empleado ya está en La Vega Autopista.");
    return;
  }
  const similar = typeof findSimilarEmployees === "function" ? findSimilarEmployees(name) : [];
  if (similar.length) {
    const msg =
      "Hay nombres parecidos en empleados:\n" +
      (typeof formatDupHint === "function" ? formatDupHint(similar) : similar.map((e) => e.name).join(", ")) +
      "\n\n¿Agregar de todos modos a este proyecto?";
    if (!window.confirm(msg)) return;
  }

  const post = ensureLvaPostByName(postNameInput);
  if (!post) {
    toast("No se pudo crear el puesto.");
    return;
  }
  const postName = post.name;
  const now = new Date().toISOString();
  let staff = normalizeLvaStaff({
    name,
    postId: post.id,
    postName,
    phone,
    cedula,
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  const emp = upsertEmployeeFromLva(staff);
  staff.employeeId = emp ? emp.id : "";
  lvaState.staff.push(staff);
  pushLvaHistory(
    "Servicio agregado",
    `${name} → ${postName} · por ${currentUser ? currentUser.displayName || currentUser.username : "—"}`
  );
  const nameEl = document.getElementById("lvaStaffName");
  const postEl = document.getElementById("lvaPostName");
  const phoneEl = document.getElementById("lvaStaffPhone");
  const cedEl = document.getElementById("lvaStaffCedula");
  if (nameEl) nameEl.value = "";
  if (postEl) postEl.value = "";
  if (phoneEl) phoneEl.value = "";
  if (cedEl) cedEl.value = "";
  pruneEmptyLvaPosts(false);
  saveEmployees();
  saveLvaState(true);
  renderEmployees();
  renderLvaModule();
  toast("Agregado al proyecto. Se sincroniza con la nube.");
}

function removeLvaStaff(staffId) {
  const idx = lvaState.staff.findIndex((s) => s.id === staffId);
  if (idx < 0) return;
  const staff = lvaState.staff[idx];
  const ok = window.confirm(
    `¿Quitar a "${staff.name}" de La Vega Autopista? Seguirá en Empleados generales.`
  );
  if (!ok) return;
  lvaState.staff[idx] = {
    ...staff,
    active: false,
    updatedAt: new Date().toISOString(),
  };
  if (staff.employeeId) removeLvaSiteFromEmployee(staff.employeeId);
  else removeLvaSiteFromEmployee(staff.name);
  pushLvaHistory(
    "Empleado quitado",
    `${staff.name} (puesto: ${staff.postName || getLvaPostName(staff.postId) || "—"})`
  );
  const pruned = pruneEmptyLvaPosts(true);
  saveEmployees();
  saveLvaState(true);
  renderEmployees();
  renderLvaModule();
  toast(pruned ? "Empleado quitado. Puesto vacío eliminado." : "Empleado quitado del proyecto.");
}

function bindLvaUi() {
  if (!document.getElementById("lvaView")) return;
  document.getElementById("btnLvaAddStaff")?.addEventListener("click", addLvaStaff);
  document.getElementById("lvaStaffName")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addLvaStaff();
    }
  });
  document.getElementById("lvaPostName")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addLvaStaff();
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

function saveChatMessages(push = true) {
  chatMessages = pruneChatMessages(chatMessages);
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(chatMessages));
  if (!push) return;
  // Chat usa parche ligero; si falla, cae al guardado general
  pushMessagesToCloud().catch(() => queueCloudSave());
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
  updateMessagesTabBadge();
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

async function sendChatMessage() {
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
  saveChatMessages(false);
  renderMessageThread();
  renderMessagesUsers();
  try {
    await pushMessagesToCloud();
    toast(selectedChatUserId === "*" ? "Aviso enviado a todos ✓" : `Enviado a ${toName} ✓`);
  } catch (err) {
    console.error(err);
    queueCloudSave();
    toast("No se pudo subir el mensaje a la nube. Reintentando…");
  }
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

let knownUnreadMessageIds = new Set();
let messageNotifyReady = false;

function updateMessagesTabBadge() {
  const badge = document.getElementById("msgTabBadge");
  if (!badge) return;
  const n = totalUnreadMessages();
  if (n > 0) {
    badge.hidden = false;
    badge.textContent = n > 99 ? "99+" : String(n);
  } else {
    badge.hidden = true;
    badge.textContent = "0";
  }
}

function notifyNewChatMessages(newOnes) {
  if (!newOnes.length || !currentUser) return;
  const first = newOnes[0];
  const from =
    first.fromUserId === "*"
      ? "Aviso"
      : appUsers.find((u) => u.id === first.fromUserId)?.displayName ||
        appUsers.find((u) => u.id === first.fromUserId)?.username ||
        "Mensaje";
  const preview = (first.text || (first.dataUrl ? "📎 Archivo" : "Nuevo mensaje")).slice(0, 80);
  const more = newOnes.length > 1 ? ` (+${newOnes.length - 1} más)` : "";
  toast(`💬 ${from}: ${preview}${more}`);
  updateMessagesTabBadge();
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      new Notification("RFS · Nuevo mensaje", { body: `${from}: ${preview}${more}`, tag: "rfs-msg" });
    } catch (_) {}
  }
}

function detectAndNotifyNewMessages(prevIds) {
  if (!currentUser || !messageNotifyReady) {
    knownUnreadMessageIds = new Set(
      chatMessages
        .filter(
          (m) =>
            (m.toUserId === currentUser?.id || m.toUserId === "*") &&
            m.fromUserId !== currentUser?.id &&
            !(m.readBy || []).includes(currentUser?.id)
        )
        .map((m) => m.id)
    );
    messageNotifyReady = !!currentUser;
    updateMessagesTabBadge();
    return;
  }
  const unread = chatMessages.filter(
    (m) =>
      (m.toUserId === currentUser.id || m.toUserId === "*") &&
      m.fromUserId !== currentUser.id &&
      !(m.readBy || []).includes(currentUser.id)
  );
  const fresh = unread.filter((m) => !knownUnreadMessageIds.has(m.id) && !(prevIds && prevIds.has(m.id)));
  knownUnreadMessageIds = new Set(unread.map((m) => m.id));
  updateMessagesTabBadge();
  if (fresh.length) notifyNewChatMessages(fresh);
}

function startMessagesPolling() {
  stopMessagesPolling();
  messagesPollTimer = setInterval(() => {
    if (!currentUser || !canAccessModule("messages")) return;
    if (!window.RFSCloudApi) {
      updateMessagesTabBadge();
      return;
    }
    const prevIds = new Set(chatMessages.map((m) => m.id));
    window.RFSCloudApi
      .loadCloud()
      .then((remote) => {
        if (!remote || remote.empty) return;
        const remoteMsgs = Array.isArray(remote.messages) ? remote.messages.map(normalizeChatMessage) : [];
        if (!remoteMsgs.length) {
          updateMessagesTabBadge();
          return;
        }
        chatMessages = mergeChatMessages(chatMessages, remoteMsgs);
        localStorage.setItem(MESSAGES_KEY, JSON.stringify(chatMessages));
        detectAndNotifyNewMessages(prevIds);
        const active = document.querySelector(".view.active");
        if (active && active.id === "messagesView") {
          renderMessagesModule();
        }
      })
      .catch(() => {
        updateMessagesTabBadge();
      });
  }, 10000);
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
  const checkPhotoMediaId = String(e.checkPhotoMediaId || "").trim();
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
    checkPhotoName:
      checkPhoto || checkPhotoMediaId ? String(e.checkPhotoName || "cheque.jpg").trim() : "",
    checkPhotoMediaId,
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


function canAccessVargas() {
  if (!currentUser) return false;
  if (currentUser.role === "owner") return true;
  if (canAccessModule("admin")) return true;
  if (String(currentUser.username || "").toLowerCase() === "vargas10") return true;
  return canAccessModule("vargas");
}

function renderVargasModule() {
  if (!canAccessVargas()) return;
  if (typeof window.RFSVargas !== "undefined" && typeof window.RFSVargas.renderVargasModule === "function") {
    window.RFSVargas.renderVargasModule();
    return;
  }
  const summary = document.getElementById("vargasSummary");
  if (summary) {
    summary.textContent =
      "Reportes de supervisión (Reaction Banco / Efectivo). Formato pendiente del Excel de Ramón.";
  }
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
  // Compat: ya no usamos <datalist>; la lista vive en #cajaPeopleSuggest
  renderCajaPeopleSuggest(document.getElementById("cajaRecipient")?.value || "", { keepHidden: true });
}

function listCajaPeopleForSuggest(query) {
  const q = cajaNameKey(query);
  const people = [...(pettyCash.people || [])].filter((p) => p && (p.name || p.code));
  people.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));
  if (!q) return people;
  return people.filter((p) => {
    const nameKey = p.nameKey || cajaNameKey(p.name);
    const codeKey = String(p.code || "").toUpperCase();
    return (nameKey && nameKey.includes(q)) || codeKey.includes(String(query || "").trim().toUpperCase());
  });
}

function hideCajaPeopleSuggest() {
  const box = document.getElementById("cajaPeopleSuggest");
  if (box) {
    box.hidden = true;
    box.innerHTML = "";
  }
}

function renderCajaPeopleSuggest(query, opts = {}) {
  const box = document.getElementById("cajaPeopleSuggest");
  if (!box) return;
  const keepHidden = !!opts.keepHidden;
  const people = listCajaPeopleForSuggest(query);
  if (!people.length) {
    if (String(query || "").trim()) {
      box.innerHTML = `<div class="caja-suggest-empty">No hay coincidencia · se creará persona nueva al guardar</div>`;
      box.hidden = keepHidden;
    } else {
      box.innerHTML = `<div class="caja-suggest-empty">Aún no hay personas registradas en caja</div>`;
      box.hidden = keepHidden;
    }
    return;
  }
  const max = 40;
  const slice = people.slice(0, max);
  box.innerHTML =
    slice
      .map(
        (p) => `<button type="button" class="caja-suggest-item" role="option" data-person-id="${escapeHtml(p.id)}">
          <span class="caja-suggest-name">${escapeHtml(p.name || "Sin nombre")}</span>
          <span class="caja-suggest-code">${escapeHtml(p.code || "")}</span>
        </button>`
      )
      .join("") +
    (people.length > max
      ? `<div class="caja-suggest-empty">…y ${people.length - max} más. Sigue escribiendo para filtrar.</div>`
      : "");
  box.querySelectorAll(".caja-suggest-item").forEach((btn) => {
    btn.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      selectCajaPersonSuggestion(btn.dataset.personId);
    });
  });
  if (!keepHidden) box.hidden = false;
}

function selectCajaPersonSuggestion(personId) {
  const person = findCajaPersonById(personId);
  const input = document.getElementById("cajaRecipient");
  if (!person || !input) return;
  input.value = person.name || person.code;
  selectedCajaPersonId = person.id;
  updateCajaPersonCodeHint();
  hideCajaPeopleSuggest();
  try {
    input.focus();
  } catch (_) {}
}

function updateCajaPersonCodeHint() {
  const hint = document.getElementById("cajaPersonCodeHint");
  const raw = document.getElementById("cajaRecipient")?.value || "";
  if (!hint) return;
  const person = resolveCajaRecipientPreview(raw);
  if (person) {
    selectedCajaPersonId = person.id;
    hint.textContent = `Código existente: ${person.code} · ${person.name}`;
  } else if (String(raw).trim()) {
    selectedCajaPersonId = null;
    hint.textContent = "Código nuevo al guardar (elige de la lista si ya existe esa persona)";
  } else {
    selectedCajaPersonId = null;
    hint.textContent = "Código: elige un nombre de la lista o escribe uno nuevo";
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

async function clearCajaExpenseCheckPhoto(expenseId) {
  const id = String(expenseId || "");
  if (!id) return false;
  let target = (pettyCash.expenses || []).find((e) => e.id === id);
  let inDeleted = false;
  if (!target) {
    target = (pettyCash.deletedExpenses || []).find((e) => e.id === id);
    inDeleted = !!target;
  }
  if (!target) return false;
  const mediaId = String(target.checkPhotoMediaId || "").trim();
  const hadPhoto = !!(target.checkPhoto || mediaId);
  if (!hadPhoto) return false;

  target.checkPhoto = "";
  target.checkPhotoName = "";
  target.checkPhotoMediaId = "";

  if (inDeleted) {
    pettyCash.deletedExpenses = (pettyCash.deletedExpenses || []).map((e) =>
      e.id === id ? { ...e, checkPhoto: "", checkPhotoName: "", checkPhotoMediaId: "" } : e
    );
  } else {
    pettyCash.expenses = (pettyCash.expenses || []).map((e) =>
      e.id === id ? { ...e, checkPhoto: "", checkPhotoName: "", checkPhotoMediaId: "" } : e
    );
  }

  savePettyCash(true);
  if (mediaId && window.RFSCloudApi && typeof window.RFSCloudApi.deleteMedia === "function") {
    try {
      await window.RFSCloudApi.deleteMedia(mediaId);
    } catch (_) {}
  }
  logActivity("caja_check_deleted", `Borró foto de cheque tras imprimir recibo ${target.receiptNo || id}`);
  renderCajaModule();
  return true;
}

function offerDeleteCajaCheckAfterPrint(expenseId) {
  const id = String(expenseId || "");
  if (!id) return;
  const exp =
    (pettyCash.expenses || []).find((e) => e.id === id) ||
    (pettyCash.deletedExpenses || []).find((e) => e.id === id);
  if (!exp || !(exp.checkPhoto || exp.checkPhotoMediaId)) return;

  // Evitar doble pregunta si afterprint dispara más de una vez
  const guardKey = `caja-check-ask:${id}`;
  if (offerDeleteCajaCheckAfterPrint._busy === guardKey) return;
  offerDeleteCajaCheckAfterPrint._busy = guardKey;

  setTimeout(() => {
    try {
      const ok = window.confirm(
        "¿Desea borrar la foto del cheque de la aplicación?\n\n" +
          "Recomendado: Aceptar (Sí).\n" +
          "Ya quedó en el recibo impreso y así libera espacio en la nube."
      );
      if (!ok) return;
      clearCajaExpenseCheckPhoto(id)
        .then((deleted) => {
          if (deleted) toast("Foto del cheque borrada. El gasto y el recibo se conservan.");
        })
        .catch(() => toast("No se pudo borrar la foto del cheque."));
    } finally {
      if (offerDeleteCajaCheckAfterPrint._busy === guardKey) {
        offerDeleteCajaCheckAfterPrint._busy = "";
      }
    }
  }, 200);
}

window.__rfsOnPrintDone = function (key) {
  const token = String(key || "");
  if (token.startsWith("caja-check:")) {
    offerDeleteCajaCheckAfterPrint(token.slice("caja-check:".length));
  }
};

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
  const opts =
    exp.checkPhoto || exp.checkPhotoMediaId
      ? { afterPrintKey: `caja-check:${exp.id}` }
      : {};
  openPrintWindow(`Recibo caja ${exp.receiptNo || ""}`, body, opts);
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
  const cajaRecipientInput = document.getElementById("cajaRecipient");
  if (cajaRecipientInput) {
    cajaRecipientInput.addEventListener("focus", () => {
      renderCajaPeopleSuggest(cajaRecipientInput.value || "");
    });
    cajaRecipientInput.addEventListener("click", () => {
      renderCajaPeopleSuggest(cajaRecipientInput.value || "");
    });
    cajaRecipientInput.addEventListener("input", () => {
      updateCajaPersonCodeHint();
      renderCajaPeopleSuggest(cajaRecipientInput.value || "");
    });
    cajaRecipientInput.addEventListener("change", updateCajaPersonCodeHint);
    cajaRecipientInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") hideCajaPeopleSuggest();
    });
    cajaRecipientInput.addEventListener("blur", () => {
      setTimeout(() => hideCajaPeopleSuggest(), 180);
    });
  }
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
  } else if (viewId !== "loginView" && appVersionBlocked) {
    showAppVersionGate(appVersionBlockReason);
    toast("Actualiza la App antes de entrar a las secciones.");
    checkAppVersionGate({ forceShow: true }).catch(() => {});
    return;
  } else if (viewId !== "loginView" && !canAccessView(viewId)) {
    toast("Tu usuario no tiene acceso a esa sección.");
    viewId = firstAllowedView();
  }
  // Revisión rápida al entrar a cualquier sección de trabajo
  if (currentUser && viewId !== "loginView") {
    checkAppVersionGate().then((ok) => {
      if (!ok) {
        /* gate ya visible */
      }
    }).catch(() => {});
  }
  closeMediaLightbox();
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === viewId));
  document.querySelectorAll(".tab").forEach((t) => {
    // detailView no tiene tab; no marcar ninguno extra
    t.classList.toggle("active", t.dataset.view === viewId);
  });
  const activeTab = document.querySelector(`.tabbar .tab.active[data-view="${viewId}"]`);
  if (activeTab && typeof activeTab.scrollIntoView === "function") {
    try {
      activeTab.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    } catch (_) {
      try {
        activeTab.scrollIntoView(false);
      } catch (_) {}
    }
  }
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
  if (viewId === "suplidoresView" && typeof renderSuplidoresModule === "function") renderSuplidoresModule();
  if (viewId === "vargasView" && typeof renderVargasModule === "function") renderVargasModule();
  if (viewId === "hrView") renderHrModule();
  if (viewId === "contabilidadView") {
    if (typeof renderContabilidadModule === "function") renderContabilidadModule();
  }
  if (viewId === "nominaView") {
    if (typeof renderNominaModule === "function") renderNominaModule();
  }
  if (viewId === "depuracionView") {
    if (typeof renderDepuracionModule === "function") renderDepuracionModule();
  }
  if (viewId === "quotesView") {
    if (typeof renderQuotesModule === "function") renderQuotesModule();
  }
  if (viewId === "employeesView") renderEmployees();
  if (viewId === "employeeNewView") {}
  if (viewId === "loansView") {
    try {
      ensureLoansSeedImported();
    } catch (_) {}
    renderLoans();
  }
  if (viewId === "loanNewView") {
    renderLoanEmployeePicker();
    renderLoanPreview();
  }
  if (viewId === "monorrielView") renderMonorrielHome();
  if (viewId === "lvaView") renderLvaModule();
  if (viewId === "monoReportEditView") {
    renderMonoPostsEditor();
    updateMonoReportDateHint();
  }
  if (viewId === "monoStaffView") renderMonoStaffList();
  if (viewId === "monoEmployeeSummaryView") renderMonoEmployeeSummary();
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

  const nowIso = new Date().toISOString();
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
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
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
  const gallery = document.getElementById("reportPhoto");
  if (gallery) gallery.value = "";
  const nativeCam = document.getElementById("reportPhotoCameraNative");
  if (nativeCam) nativeCam.value = "";
  document.getElementById("photoPreviewWrap").hidden = true;
  document.getElementById("photoPreview").removeAttribute("src");
}

/** Notas de voz del reporte (máx. 2): dictado → texto en el relato. */
const REPORT_VOICE_MAX = 2;
const REPORT_VOICE_MAX_MS = 45000;
let pendingReportVoices = [];
let reportVoiceActive = false;
let reportVoiceStartedAt = 0;
let reportVoiceTimer = null;
let reportSpeechRec = null;
let reportSpeechDraft = "";
let reportSpeechInterim = "";
let reportSpeechWantRestart = false;

function clearPendingReportVoices() {
  stopReportVoiceSession(true);
  pendingReportVoices = [];
  renderReportVoiceList();
  updateReportVoiceButton();
}

function isReportVoiceRecording() {
  return !!reportVoiceActive;
}

function updateReportVoiceButton() {
  const btn = document.getElementById("btnReportVoice");
  if (!btn) return;
  const recording = isReportVoiceRecording();
  btn.classList.toggle("btnReportVoiceRecording", recording);
  if (recording) {
    btn.disabled = false;
    btn.textContent = "⏹ Detener y pegar texto";
  } else if (pendingReportVoices.length >= REPORT_VOICE_MAX) {
    btn.textContent = "🎙 Límite de 2 notas";
    btn.disabled = true;
  } else {
    btn.disabled = false;
    btn.textContent =
      pendingReportVoices.length === 0
        ? "🎙 Dictar nota de voz"
        : `🎙 Dictar nota ${pendingReportVoices.length + 1} de ${REPORT_VOICE_MAX}`;
  }
}

function setReportVoiceStatus(text, show) {
  const status = document.getElementById("reportVoiceStatus");
  if (!status) return;
  if (!show) {
    status.hidden = true;
    status.textContent = "";
    return;
  }
  status.hidden = false;
  status.textContent = text || "";
}

function renderReportVoiceList() {
  const box = document.getElementById("reportVoiceList");
  if (!box) return;
  if (!pendingReportVoices.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = pendingReportVoices
    .map((v, idx) => {
      const sec = Math.max(1, Math.round((v.durationMs || 0) / 1000));
      return `<div class="report-voice-item" data-voice-id="${escapeHtml(v.id)}">
        <p class="report-voice-meta">Nota ${idx + 1} · ${sec}s · dictada</p>
        <p class="report-voice-transcript">${escapeHtml(v.transcript || "(Sin texto)")}</p>
        <button type="button" class="btn ghost attach-btn btn-report-voice-del" data-id="${escapeHtml(
          v.id
        )}" style="width:auto">Quitar nota</button>
      </div>`;
    })
    .join("");
  box.querySelectorAll(".btn-report-voice-del").forEach((btn) => {
    btn.addEventListener("click", () => removePendingReportVoice(btn.dataset.id));
  });
}

function removePendingReportVoice(id) {
  const idx = pendingReportVoices.findIndex((v) => v.id === id);
  if (idx < 0) return;
  pendingReportVoices.splice(idx, 1);
  renderReportVoiceList();
  updateReportVoiceButton();
  toast("Nota quitada (el texto del relato no se borra solo).");
}

function appendTranscriptToReportText(transcript) {
  const t = String(transcript || "").trim();
  if (!t) return;
  const el = document.getElementById("reportText");
  if (!el) return;
  const cur = String(el.value || "").trim();
  el.value = cur ? `${cur}\n\n${t}` : t;
  try {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  } catch (_) {}
}

function getReportSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  return typeof SR === "function" ? SR : null;
}

function stopReportSpeechHard() {
  reportSpeechWantRestart = false;
  if (!reportSpeechRec) return;
  const rec = reportSpeechRec;
  reportSpeechRec = null;
  try {
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    rec.stop();
  } catch (_) {}
  try {
    rec.abort();
  } catch (_) {}
}

function finishReportVoiceNote() {
  const durationMs = Math.max(0, Date.now() - (reportVoiceStartedAt || Date.now()));
  const transcript = `${reportSpeechDraft} ${reportSpeechInterim}`.replace(/\s+/g, " ").trim();
  reportSpeechDraft = "";
  reportSpeechInterim = "";
  reportVoiceActive = false;
  clearTimeout(reportVoiceTimer);
  reportVoiceTimer = null;
  updateReportVoiceButton();
  setReportVoiceStatus("", false);

  if (durationMs < 700 && !transcript) {
    toast("Quedó muy corto. Mantén pulsado unos segundos y habla claro.");
    return;
  }
  if (!transcript) {
    toast("No se entendió el audio. Habla más cerca del micrófono o escribe el relato.");
    return;
  }

  pendingReportVoices.push({
    id: `rv-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    durationMs,
    transcript,
    recordedAt: new Date().toISOString(),
  });
  appendTranscriptToReportText(transcript);
  renderReportVoiceList();
  updateReportVoiceButton();
  toast(`Nota ${pendingReportVoices.length} agregada al relato.`);
}

function stopReportVoiceSession(silent) {
  const wasActive = reportVoiceActive;
  reportVoiceActive = false;
  clearTimeout(reportVoiceTimer);
  reportVoiceTimer = null;
  stopReportSpeechHard();
  if (!silent && wasActive) {
    // Si el usuario detiene, cerramos y pegamos lo dictado
    finishReportVoiceNote();
    return;
  }
  reportSpeechDraft = "";
  reportSpeechInterim = "";
  setReportVoiceStatus("", false);
  updateReportVoiceButton();
}

function startReportSpeechSession() {
  const SR = getReportSpeechRecognition();
  if (!SR) return false;
  reportSpeechDraft = "";
  reportSpeechInterim = "";
  reportSpeechWantRestart = true;

  const attach = (lang) => {
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      let finalText = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0] && event.results[i][0].transcript;
        if (!piece) continue;
        if (event.results[i].isFinal) finalText += `${piece} `;
        else interim += piece;
      }
      if (finalText) {
        reportSpeechDraft = `${reportSpeechDraft} ${finalText}`.replace(/\s+/g, " ").trim();
      }
      reportSpeechInterim = interim;
      const live = `${reportSpeechDraft} ${interim}`.replace(/\s+/g, " ").trim();
      setReportVoiceStatus(
        live ? `Escuchando: ${live.slice(0, 140)}${live.length > 140 ? "…" : ""}` : "Escuchando… habla ahora",
        true
      );
    };
    rec.onerror = (ev) => {
      const err = String((ev && ev.error) || "");
      if (err === "no-speech" || err === "aborted") return;
      if (err === "not-allowed" || err === "service-not-allowed") {
        reportSpeechWantRestart = false;
        reportVoiceActive = false;
        stopReportSpeechHard();
        updateReportVoiceButton();
        setReportVoiceStatus("", false);
        toast("Permiso de micrófono denegado. Actívalo en el candado del navegador.");
        return;
      }
      if (err === "network") {
        setReportVoiceStatus("Sin red para transcribir. Revisa internet e intenta de nuevo.", true);
      }
    };
    rec.onend = () => {
      if (!reportVoiceActive || !reportSpeechWantRestart) return;
      // Chrome a veces corta solo; reiniciar mientras la sesión siga abierta
      try {
        rec.start();
      } catch (_) {
        try {
          reportSpeechRec = null;
          attach(lang);
        } catch (__) {}
      }
    };
    reportSpeechRec = rec;
    rec.start();
  };

  try {
    attach("es-DO");
    return true;
  } catch (_) {
    try {
      attach("es-ES");
      return true;
    } catch (__) {
      try {
        attach("es");
        return true;
      } catch (___) {
        reportSpeechRec = null;
        reportSpeechWantRestart = false;
        return false;
      }
    }
  }
}

async function toggleReportVoiceRecording() {
  if (isReportVoiceRecording()) {
    // Detener: pegar lo dictado al relato
    reportSpeechWantRestart = false;
    stopReportSpeechHard();
    finishReportVoiceNote();
    return;
  }
  if (pendingReportVoices.length >= REPORT_VOICE_MAX) {
    toast("Ya tienes 2 notas. Quita una o genera el informe.");
    return;
  }
  if (!window.isSecureContext && location.protocol !== "https:" && location.hostname !== "localhost") {
    toast("La nota de voz requiere HTTPS (abre la app publicada, no un archivo local).");
    return;
  }
  const SR = getReportSpeechRecognition();
  if (!SR) {
    toast("Este navegador no transcribe voz. Usa Chrome o Edge en la PC.");
    return;
  }

  // Pedir micrófono primero (permiso claro); SpeechRecognition lo reutiliza mejor después
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
    }
  } catch (_) {
    toast("No se pudo usar el micrófono. Permítelo en el navegador e inténtalo otra vez.");
    return;
  }

  reportVoiceActive = true;
  reportVoiceStartedAt = Date.now();
  const ok = startReportSpeechSession();
  if (!ok) {
    reportVoiceActive = false;
    toast("No se pudo iniciar el dictado. Prueba Chrome/Edge y revisa el micrófono.");
    updateReportVoiceButton();
    return;
  }
  updateReportVoiceButton();
  setReportVoiceStatus("Escuchando… habla ahora. Luego pulsa Detener.", true);
  clearTimeout(reportVoiceTimer);
  reportVoiceTimer = setTimeout(() => {
    if (!isReportVoiceRecording()) return;
    reportSpeechWantRestart = false;
    stopReportSpeechHard();
    finishReportVoiceNote();
  }, REPORT_VOICE_MAX_MS);
}

/** Tope de peso para fotos de reportes (~100 KB JPEG). */
const REPORT_PHOTO_MAX_SIDE = 900;
const REPORT_PHOTO_QUALITY = 0.55;
const REPORT_PHOTO_MAX_BYTES = 100 * 1024;

function dataUrlBinaryBytes(dataUrl) {
  const s = String(dataUrl || "");
  const i = s.indexOf(",");
  const b64 = i >= 0 ? s.slice(i + 1) : s;
  if (!b64) return 0;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

function compressImage(file, maxSide = 1280, quality = 0.72, maxBytes = 0) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la foto"));
    reader.onload = () => {
      compressDataUrl(String(reader.result || ""), maxSide, quality, maxBytes).then(resolve).catch(reject);
    };
    reader.readAsDataURL(file);
  });
}

function compressDataUrl(dataUrl, maxSide = 1280, quality = 0.72, maxBytes = 0) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const srcW = img.naturalWidth || img.width || 0;
      const srcH = img.naturalHeight || img.height || 0;
      if (!srcW || !srcH) {
        reject(new Error("Foto inválida"));
        return;
      }

      const encodeAt = (side, q) => {
        let width = srcW;
        let height = srcH;
        if (width > side || height > side) {
          const ratio = Math.min(side / width, side / height);
          width = Math.max(1, Math.round(width * ratio));
          height = Math.max(1, Math.round(height * ratio));
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        return canvas.toDataURL("image/jpeg", q);
      };

      let side = Math.max(1, Number(maxSide) || 1280);
      let q = Math.min(0.92, Math.max(0.35, Number(quality) || 0.72));
      let out = encodeAt(side, q);
      const target = Number(maxBytes) > 0 ? Number(maxBytes) : 0;

      // Si hay tope de peso: bajar calidad y luego resolución hasta caber
      if (target > 0) {
        const qualitySteps = [q, 0.5, 0.42, 0.35];
        const sideSteps = [side, Math.min(side, 720), 560, 420];
        outer: for (const nextSide of sideSteps) {
          for (const nextQ of qualitySteps) {
            out = encodeAt(nextSide, nextQ);
            if (dataUrlBinaryBytes(out) <= target) break outer;
          }
        }
      }

      resolve(out);
    };
    img.onerror = () => reject(new Error("Foto inválida"));
    img.src = dataUrl;
  });
}

/** Cámara de la PC (webcam) para RRHH / Depuración / Empleados / Caja */
let pcCameraStream = null;
let pcCameraOnCapture = null;

function stopPcCameraStream() {
  if (pcCameraStream) {
    try {
      pcCameraStream.getTracks().forEach((t) => t.stop());
    } catch (_) {}
    pcCameraStream = null;
  }
  const video = document.getElementById("pcCameraVideo");
  if (video) {
    try {
      video.srcObject = null;
    } catch (_) {}
  }
}

function closePcCameraModal() {
  stopPcCameraStream();
  pcCameraOnCapture = null;
  const modal = document.getElementById("pcCameraModal");
  if (modal) modal.hidden = true;
  const status = document.getElementById("pcCameraStatus");
  if (status) {
    status.hidden = true;
    status.textContent = "";
  }
  const shot = document.getElementById("btnPcCameraShot");
  if (shot) shot.disabled = false;
}

/**
 * Abre la webcam de la PC, captura un JPEG y llama onCapture(dataUrl).
 * facingMode: "user" (rostro) | "environment" (documento / cédula).
 */
async function openPcCameraCapture(opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  const title = options.title || "Tomar foto";
  const facingMode = options.facingMode === "user" ? "user" : "environment";
  const maxSide = Number(options.maxSide) || 1100;
  const quality = Number(options.quality) || 0.7;
  const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : 0;
  const onCapture = typeof options.onCapture === "function" ? options.onCapture : null;
  if (!onCapture) return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast("Este navegador no permite abrir la cámara. Usa Chrome o Edge en la PC.");
    return;
  }

  closePcCameraModal();
  const modal = document.getElementById("pcCameraModal");
  const video = document.getElementById("pcCameraVideo");
  const titleEl = document.getElementById("pcCameraTitle");
  const status = document.getElementById("pcCameraStatus");
  const shot = document.getElementById("btnPcCameraShot");
  if (!modal || !video) {
    toast("No se encontró el módulo de cámara.");
    return;
  }
  if (titleEl) titleEl.textContent = title;
  if (status) {
    status.hidden = false;
    status.textContent = "Abriendo cámara…";
  }
  if (shot) shot.disabled = true;
  pcCameraOnCapture = async (rawDataUrl) => {
    const dataUrl = await compressDataUrl(rawDataUrl, maxSide, quality, maxBytes);
    onCapture(dataUrl);
  };
  modal.hidden = false;

  const tryConstraints = [
    { video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: { facingMode }, audio: false },
    { video: true, audio: false },
  ];

  let lastErr = null;
  for (const constraints of tryConstraints) {
    try {
      pcCameraStream = await navigator.mediaDevices.getUserMedia(constraints);
      break;
    } catch (err) {
      lastErr = err;
      pcCameraStream = null;
    }
  }

  if (!pcCameraStream) {
    closePcCameraModal();
    const name = String((lastErr && (lastErr.name || lastErr.message)) || "");
    if (/NotAllowed|Permission/i.test(name)) {
      toast("Permiso de cámara denegado. Actívalo en el navegador (candado de la barra de dirección).");
    } else if (/NotFound|DevicesNotFound/i.test(name)) {
      toast("No se encontró una cámara conectada a esta PC.");
    } else {
      toast("No se pudo abrir la cámara de la PC.");
    }
    return;
  }

  video.srcObject = pcCameraStream;
  try {
    await video.play();
  } catch (_) {}
  if (status) {
    status.hidden = true;
    status.textContent = "";
  }
  if (shot) shot.disabled = false;
}

async function capturePcCameraShot() {
  const video = document.getElementById("pcCameraVideo");
  const canvas = document.getElementById("pcCameraCanvas");
  const shot = document.getElementById("btnPcCameraShot");
  const status = document.getElementById("pcCameraStatus");
  if (!video || !canvas || !pcCameraStream) {
    toast("La cámara no está lista.");
    return;
  }
  const w = video.videoWidth || 0;
  const h = video.videoHeight || 0;
  if (!w || !h) {
    toast("Espera un segundo a que la cámara enfoque.");
    return;
  }
  if (shot) shot.disabled = true;
  if (status) {
    status.hidden = false;
    status.textContent = "Capturando…";
  }
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(video, 0, 0, w, h);
  const raw = canvas.toDataURL("image/jpeg", 0.92);
  const cb = pcCameraOnCapture;
  try {
    if (cb) await cb(raw);
    closePcCameraModal();
  } catch (err) {
    console.error(err);
    if (shot) shot.disabled = false;
    if (status) {
      status.hidden = false;
      status.textContent = "No se pudo guardar la captura.";
    }
    toast("No se pudo procesar la foto de la cámara.");
  }
}

function bindPcCameraUi() {
  document.getElementById("btnPcCameraCancel")?.addEventListener("click", closePcCameraModal);
  document.getElementById("btnPcCameraShot")?.addEventListener("click", () => {
    capturePcCameraShot().catch(() => {});
  });
  document.getElementById("pcCameraModal")?.addEventListener("click", (e) => {
    if (e.target && e.target.id === "pcCameraModal") closePcCameraModal();
  });

  document.getElementById("btnEmpPhotoCamera")?.addEventListener("click", () => {
    openPcCameraCapture({
      title: "Foto del empleado",
      facingMode: "user",
      maxSide: 640,
      quality: 0.62,
      onCapture: (dataUrl) => {
        pendingEmpPhoto = dataUrl;
        renderEmpPhotoPreview();
        toast("Foto lista. Pulsa Guardar empleado.");
      },
    });
  });

  document.getElementById("btnEmpDocCamera")?.addEventListener("click", () => {
    openPcCameraCapture({
      title: "Foto del documento / cédula",
      facingMode: "environment",
      maxSide: 1100,
      quality: 0.68,
      onCapture: (dataUrl) => {
        pendingEmpDoc = { dataUrl, name: "cedula.jpg", mime: "image/jpeg" };
        renderEmpDocPreview();
        toast("Documento listo. Pulsa Guardar empleado.");
      },
    });
  });

  document.getElementById("btnCajaCheckCamera")?.addEventListener("click", () => {
    openPcCameraCapture({
      title: "Foto del cheque",
      facingMode: "environment",
      maxSide: 1280,
      quality: 0.7,
      onCapture: (dataUrl) => {
        pendingCajaCheckPhoto = dataUrl;
        if (typeof renderCajaCheckPreview === "function") renderCajaCheckPreview();
        toast("Foto del cheque lista.");
      },
    });
  });

  // Reportes: galería (sin capture) + cámara (nativa en móvil / modal en PC)
  document.getElementById("reportPhotoCameraNative")?.addEventListener("change", onPhotoSelected);
  document.getElementById("btnReportPhotoCamera")?.addEventListener("click", () => {
    const isTouch =
      "ontouchstart" in window ||
      (typeof navigator !== "undefined" && Number(navigator.maxTouchPoints || 0) > 0) ||
      /Mobi|Android|iPhone|iPad|iPod/i.test(String((typeof navigator !== "undefined" && navigator.userAgent) || ""));
    if (isTouch) {
      const native = document.getElementById("reportPhotoCameraNative");
      if (native) {
        native.value = "";
        native.click();
        return;
      }
    }
    openPcCameraCapture({
      title: "Foto del reporte",
      facingMode: "environment",
      maxSide: REPORT_PHOTO_MAX_SIDE,
      quality: REPORT_PHOTO_QUALITY,
      maxBytes: REPORT_PHOTO_MAX_BYTES,
      onCapture: (dataUrl) => {
        pendingPhotoDataUrl = dataUrl;
        const img = document.getElementById("photoPreview");
        const wrap = document.getElementById("photoPreviewWrap");
        if (img) img.src = dataUrl;
        if (wrap) wrap.hidden = false;
        toast("Foto lista. Pulsa Generar informe ejecutivo.");
      },
    });
  });
}

async function onPhotoSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    pendingPhotoDataUrl = await compressImage(
      file,
      REPORT_PHOTO_MAX_SIDE,
      REPORT_PHOTO_QUALITY,
      REPORT_PHOTO_MAX_BYTES
    );
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
    toast("Escribe en tus palabras lo que ocurrió.");
    return;
  }

  const now = new Date();
  const number = nextIncidentReportNumber(type);
  const createdBy =
    currentUser && (currentUser.displayName || currentUser.username)
      ? currentUser.displayName || currentUser.username
      : "Usuario";
  const polished = polishExecutiveNarrative(text, {
    site: post.site,
    type,
    whenLabel: now.toLocaleString("es"),
    guards: guardsSummary(post),
    number,
  });
  const voiceMeta = pendingReportVoices.map((v, i) => ({
    n: i + 1,
    durationSec: Math.max(1, Math.round((v.durationMs || 0) / 1000)),
    transcript: String(v.transcript || "").trim(),
    recordedAt: v.recordedAt || now.toISOString(),
  }));
  const report = {
    id: `r-${Date.now()}`,
    number,
    postId,
    siteName: post.site,
    guardsLabel: guardsSummary(post),
    type,
    text,
    narrativeTitle: polished.titleLine,
    narrativeHtml: polished,
    photo: pendingPhotoDataUrl || "",
    voiceNotes: voiceMeta,
    createdAt: now.toISOString(),
    whenLabel: now.toLocaleString("es"),
    createdBy,
  };
  reports.unshift(report);
  if (type === "checkin") {
    post.status = "ok";
    pushHistory(post, "Check-in / supervisión", `${number}: ${text}`);
  }
  if (type === "incidente") {
    post.status = "alert";
    pushHistory(post, "Incidente", `${number}: ${text}`);
  }
  if (type === "novedad") {
    pushHistory(post, "Novedad", `${number}: ${text}`);
  }
  reports = reports.slice(0, 80);
  saveReports();
  savePosts();
  renderMarkers();
  renderShifts();
  renderAdminList();
  renderReports();
  document.getElementById("reportText").value = "";
  const reportSearch = document.getElementById("reportPostSearch");
  if (reportSearch) reportSearch.value = "";
  fillReportPostSelect(postId);
  clearPhoto();
  clearPendingReportVoices();
  if (typeof logActivity === "function") {
    const voiceTag = voiceMeta.length ? ` · ${voiceMeta.length} nota(s) de voz` : "";
    logActivity(
      "report_create",
      `${number} · ${TYPE_LABEL[type] || type} · ${post.site} · por ${createdBy}${voiceTag}`
    );
  }
  toast(`Informe ${number} generado.`);
  // Abrir de una vez la versión ejecutiva para imprimir / PDF
  printIncidentReport(report.id);
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
    loanTrash: loanTrashIds,
    monorrielReports,
    users: appUsers,
    messages: chatMessages,
    radio: radioState,
    activity: activityLog,
    lva: lvaState,
    pettyCash,
    hr: hrData,
    depuracion: typeof depuracionData !== "undefined" ? depuracionData : { candidates: [], settings: {} },
    contabilidad: typeof contabilidadData !== "undefined" ? contabilidadData : emptyContabilidadDataSafe(),
    suplidores: typeof suplidoresData !== "undefined" ? suplidoresData : { suppliers: [], payments: [], nextCodeSeq: 1 },
    vargas: typeof vargasData !== "undefined" ? vargasData : { reports: [] },
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
      if (Array.isArray(data.loanTrash)) {
        loanTrashIds = mergeLoanTrash(loanTrashIds, data.loanTrash);
        persistLoanTrashLocal();
      }
      if (Array.isArray(data.loans)) {
        applyRemoteLoans(data.loans, data.loanTrash || []);
      }
      if (Array.isArray(data.monorrielReports)) {
        monorrielReports = mergeMonorrielReportsForCloud(monorrielReports, data.monorrielReports);
        persistMonorrielReportsSafetyNet(monorrielReports);
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
      if (data.depuracion && typeof data.depuracion === "object" && typeof applyRemoteDepuracionData === "function") {
        applyRemoteDepuracionData(data.depuracion);
        saveDepuracionData(true);
      }
      if (data.contabilidad && typeof data.contabilidad === "object" && typeof applyRemoteContabilidadData === "function") {
        applyRemoteContabilidadData(data.contabilidad);
        saveContabilidadData(true);
      }
      if (data.suplidores && typeof data.suplidores === "object" && typeof applyRemoteSuplidoresData === "function") {
        applyRemoteSuplidoresData(data.suplidores);
        saveSuplidoresData(true);
      }
      if (data.vargas && typeof data.vargas === "object" && typeof applyRemoteVargasData === "function") {
        applyRemoteVargasData(data.vargas);
        if (typeof saveVargasData === "function") saveVargasData(true);
      }
      ensureMonorrielEmployeesImported();
    ensureLvaEmployeesImported();
    if (typeof ensureOfficeEmployeesImported === "function") ensureOfficeEmployeesImported();
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
      if (typeof renderDepuracionModule === "function") renderDepuracionModule();
      if (typeof renderContabilidadModule === "function") renderContabilidadModule();
      if (typeof renderSuplidoresModule === "function") renderSuplidoresModule();
      if (typeof renderVargasModule === "function") renderVargasModule();
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
      loanTrashIds = normalizeLoanTrash(data.loanTrash || []);
      loans = (Array.isArray(data.loans) ? data.loans.map(normalizeLoan) : []).filter(
        (l) => l && l.id && !loanTrashIds.includes(l.id)
      );
      persistLoanTrashLocal();
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
      if (data.depuracion && typeof data.depuracion === "object" && typeof normalizeDepuracionData === "function") {
        depuracionData = normalizeDepuracionData(data.depuracion);
        if (typeof DEPURACION_KEY !== "undefined") {
          localStorage.setItem(DEPURACION_KEY, JSON.stringify(depuracionData));
        }
      }
      if (data.contabilidad && typeof data.contabilidad === "object" && typeof normalizeContabilidadData === "function") {
        contabilidadData = normalizeContabilidadData(data.contabilidad);
        if (typeof CONTABILIDAD_KEY !== "undefined") {
          localStorage.setItem(CONTABILIDAD_KEY, JSON.stringify(contabilidadData));
        }
      }
      if (data.suplidores && typeof data.suplidores === "object" && typeof normalizeSuplidoresData === "function") {
        suplidoresData = normalizeSuplidoresData(data.suplidores);
        if (typeof SUPLIDORES_KEY !== "undefined") {
          localStorage.setItem(SUPLIDORES_KEY, JSON.stringify(suplidoresData));
        }
      }
      if (data.vargas && typeof data.vargas === "object" && typeof normalizeVargasData === "function") {
        vargasData = normalizeVargasData(data.vargas);
        if (typeof VARGAS_KEY !== "undefined") {
          localStorage.setItem(VARGAS_KEY, JSON.stringify(vargasData));
        }
      }
      rebuildEmployeesFromPosts(employees);
      ensureMonorrielEmployeesImported();
    ensureLvaEmployeesImported();
    if (typeof ensureOfficeEmployeesImported === "function") ensureOfficeEmployeesImported();
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
      if (typeof saveDepuracionData === "function") saveDepuracionData(true);
      renderMarkers();
      renderShifts();
      fillReportPostSelect();
      renderReports();
      renderFinance();
      renderEmployees();
      renderLoans();
      renderMonorrielHome();
      renderAdminList();
      if (typeof renderCajaModule === "function") renderCajaModule();
      if (typeof renderHrModule === "function") renderHrModule();
      if (typeof renderDepuracionModule === "function") renderDepuracionModule();
      if (typeof renderContabilidadModule === "function") renderContabilidadModule();
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
  document.getElementById("btnBrandHome")?.addEventListener("click", () => {
    if (!currentUser) {
      switchView("loginView");
      return;
    }
    switchView("homeView");
  });
  document.getElementById("clientsSearch")?.addEventListener("input", () => renderShifts());

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
  document.getElementById("reportPostSearch")?.addEventListener("input", () => filterReportPostSelect());
  document.getElementById("reportPostSearch")?.addEventListener("search", () => filterReportPostSelect());
  document.getElementById("btnClearPhoto").addEventListener("click", clearPhoto);
  document.getElementById("btnReportVoice")?.addEventListener("click", () => {
    toggleReportVoiceRecording().catch(() => {});
  });
  updateReportVoiceButton();
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
  document.getElementById("btnDirections")?.addEventListener("click", () => openDirectionsToPost(selectedId));
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
  const btnSaveAllEmp = document.getElementById("btnSaveAllEmployees");
  if (btnSaveAllEmp) btnSaveAllEmp.addEventListener("click", saveAllEmployees);
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
    if (e.key !== "Escape") return;
    const cam = document.getElementById("pcCameraModal");
    if (cam && !cam.hidden) {
      closePcCameraModal();
      return;
    }
    closeMediaLightbox();
  });
  bindPcCameraUi();
  bindLoansUi();
  bindCajaUi();
  if (typeof bindSuplidoresUi === "function") bindSuplidoresUi();
  bindHrUi();
  if (typeof bindDepuracionUi === "function") bindDepuracionUi();
  if (typeof bindContabilidadUi === "function") bindContabilidadUi();
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
  document.getElementById("btnRefreshApp")?.addEventListener("click", refreshAppShell);
  document.getElementById("btnForceAppUpdate")?.addEventListener("click", () => {
    refreshAppShell();
  });
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
  loanTrashIds = normalizeLoanTrash(loadJson(LOAN_TRASH_KEY, []));
  loans = loadJson(LOANS_KEY, [])
    .map(normalizeLoan)
  // Semilla Excel (solo una vez por versión)
  // se aplica tras sync de nube más abajo / al abrir Préstamos

    .filter((l) => l && l.id && !loanTrashIds.includes(l.id));
  loanTrashIds = purgeExcelSeedIdsFromTrash(loanTrashIds);
  protectExcelSeedLoans();
  monorrielReports = loadJson(MONORRIEL_REPORTS_KEY, []).map(normalizeMonoReport);
  persistMonorrielReportsSafetyNet(monorrielReports);
  restoreMonorrielReportsFromSafetyNet();
  appUsers = loadJson(USERS_KEY, []).map(normalizeUser);
  chatMessages = loadJson(MESSAGES_KEY, []).map(normalizeChatMessage);
  activityLog = pruneActivity(loadJson(ACTIVITY_KEY, []));
  lvaState = normalizeLvaState(loadJsonObject(LVA_KEY, emptyLvaState()));
  radioState = normalizeRadioState(loadJsonObject(RADIO_KEY, emptyRadioState()));
  pettyCash = normalizePettyCash(loadJsonObject(PETTY_KEY, emptyPettyCash()));
  hrData = normalizeHrData(loadJsonObject(HR_KEY, emptyHrData()));
  if (typeof normalizeDepuracionData === "function" && typeof emptyDepuracionData === "function") {
    depuracionData = normalizeDepuracionData(loadJsonObject(DEPURACION_KEY, emptyDepuracionData()));
  }
  if (typeof normalizeContabilidadData === "function" && typeof emptyContabilidadData === "function") {
    contabilidadData = normalizeContabilidadData(loadJsonObject(CONTABILIDAD_KEY, emptyContabilidadData()));
  }
  if (typeof normalizeSuplidoresData === "function" && typeof emptySuplidoresData === "function") {
    suplidoresData = normalizeSuplidoresData(loadJsonObject(SUPLIDORES_KEY, emptySuplidoresData()));
  }
  if (typeof normalizeVargasData === "function" && typeof emptyVargasData === "function") {
    vargasData = normalizeVargasData(loadJsonObject(VARGAS_KEY, emptyVargasData()));
    if (typeof ensureVargasSeedLoaded === "function") ensureVargasSeedLoaded();
  }
  if (!radioState.streamUrl) radioState.streamUrl = DEFAULT_RADIO_STREAM;
  ensureOwnerUser();
  localStorage.setItem(USERS_KEY, JSON.stringify(appUsers));
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(chatMessages));
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activityLog));
  localStorage.setItem(LVA_KEY, JSON.stringify(lvaState));
  localStorage.setItem(RADIO_KEY, JSON.stringify(radioState));
  localStorage.setItem(PETTY_KEY, JSON.stringify(pettyCash));
  localStorage.setItem(HR_KEY, JSON.stringify(hrData));
  if (typeof DEPURACION_KEY !== "undefined" && typeof depuracionData !== "undefined") {
    localStorage.setItem(DEPURACION_KEY, JSON.stringify(depuracionData));
  }
  if (typeof CONTABILIDAD_KEY !== "undefined" && typeof contabilidadData !== "undefined") {
    localStorage.setItem(CONTABILIDAD_KEY, JSON.stringify(contabilidadData));
  }
  if (typeof SUPLIDORES_KEY !== "undefined" && typeof suplidoresData !== "undefined") {
    localStorage.setItem(SUPLIDORES_KEY, JSON.stringify(suplidoresData));
  }
  if (typeof VARGAS_KEY !== "undefined" && typeof vargasData !== "undefined") {
    localStorage.setItem(VARGAS_KEY, JSON.stringify(vargasData));
  }
  rebuildEmployeesFromPosts(employees);
  ensureMonorrielEmployeesImported();
    ensureLvaEmployeesImported();
    if (typeof ensureOfficeEmployeesImported === "function") ensureOfficeEmployeesImported();
  restoreSessionUser();
  applyAccessControl();
  if (!currentUser) {
    // Forzar pantalla de login de inmediato (antes de que se usen las pestañas)
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "loginView"));
  }

  // Login usable YA (no esperar la nube: si hay 429 la UI quedaba congelada)
  bindUi();
  if (typeof wireQuotesModule === "function") wireQuotesModule();
  setupInstallPrompt();
  updateAdminGate();
  renderGuardsEditor([emptyGuard()]);
  updateMonthPreview();
  ensureClientNumbers(true);
  try {
    initMap();
  } catch (_) {}
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
  setCloudStatus("Nube: sincronizando en segundo plano…");

  if ("serviceWorker" in navigator) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    navigator.serviceWorker.register("sw.js?v=187").then((reg) => {
      reg.update().catch(() => {});
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            nw.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
    }).catch(() => {});
    if (window.caches) {
      caches.keys().then((keys) => {
        keys
          .filter((k) => k.startsWith("rfs-ops-") && k !== "rfs-ops-v187")
          .forEach((k) => caches.delete(k));
      }).catch(() => {});
    }
  }

  startAppVersionWatch();

  // Nube en segundo plano: no bloquea Entrar
  (async () => {
    try {
      await checkAppVersionGate();
      const cloud = await syncFromCloud();
      await checkAppVersionGate();
      const added = await mergeImportedPosts();
      rebuildEmployeesFromPosts(employees);
      localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
      localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
      localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees));
      localStorage.setItem(LOANS_KEY, JSON.stringify(loans));
      localStorage.setItem(MONORRIEL_REPORTS_KEY, JSON.stringify(monorrielReports));
      localStorage.setItem(USERS_KEY, JSON.stringify(appUsers));
      localStorage.setItem(MESSAGES_KEY, JSON.stringify(chatMessages));
      localStorage.setItem(RADIO_KEY, JSON.stringify(radioState));
      localStorage.setItem(LVA_KEY, JSON.stringify(lvaState));
      if (added > 0) {
        await pushToCloud();
        toast(`Se importaron ${added} servicios y se subieron a la nube.`);
      }
      // No empujar toda la nube al abrir: PCs con datos viejos podían borrar clientes nuevos.
      renderShifts();
      renderEmployees();
      renderLoans();
      renderMonorrielHome();
      renderFinance();
      renderReports();
      if (typeof renderLvaModule === "function") renderLvaModule();
      applyAccessControl();
      refreshBiometricLoginUi();
      if (cloud.usedCloud && !added && currentUser) {
        toast("Datos sincronizados desde la nube.");
      }
      // Tras sync: reemplazar préstamos de prueba por Excel real (una vez)
      try {
        const seeded = ensureLoansSeedImported();
        if (seeded && seeded.imported) {
          await pushToCloud();
        }
      } catch (_) {}
      startLiveCloudSync();
    } catch (err) {
      console.error(err);
      setCloudStatus("Nube: sin conexión (usando datos locales)");
      startLiveCloudSync();
    }
  })();
});
