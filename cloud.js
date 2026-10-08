(function () {
  const cfg = window.RFS_CLOUD || {};
  const projectId = cfg.projectId;
  const apiKey = cfg.apiKey;
  const docPath = cfg.docPath || "rfs/main";

  function docUrl() {
    return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}?key=${encodeURIComponent(apiKey)}`;
  }

  function encodeFields(posts, reports, employees, loans, monorrielReports, users, messages, radio, activity, lva) {
    return {
      fields: {
        postsJson: { stringValue: JSON.stringify(posts || []) },
        reportsJson: { stringValue: JSON.stringify(reports || []) },
        employeesJson: { stringValue: JSON.stringify(employees || []) },
        loansJson: { stringValue: JSON.stringify(loans || []) },
        monorrielReportsJson: { stringValue: JSON.stringify(monorrielReports || []) },
        usersJson: { stringValue: JSON.stringify(users || []) },
        messagesJson: { stringValue: JSON.stringify(messages || []) },
        radioJson: { stringValue: JSON.stringify(radio || {}) },
        activityJson: { stringValue: JSON.stringify(activity || []) },
        lvaJson: { stringValue: JSON.stringify(lva || {}) },
        updatedAt: { stringValue: new Date().toISOString() },
        app: { stringValue: "Reaction Force Security Ops" },
      },
    };
  }

  function parseJsonField(fields, key) {
    const raw = fields[key] && fields[key].stringValue;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function parseObjectField(fields, key) {
    const raw = fields[key] && fields[key].stringValue;
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function decodeDoc(doc) {
    const fields = (doc && doc.fields) || {};
    return {
      posts: parseJsonField(fields, "postsJson"),
      reports: parseJsonField(fields, "reportsJson"),
      employees: parseJsonField(fields, "employeesJson"),
      loans: parseJsonField(fields, "loansJson"),
      monorrielReports: parseJsonField(fields, "monorrielReportsJson"),
      users: parseJsonField(fields, "usersJson"),
      messages: parseJsonField(fields, "messagesJson"),
      radio: parseObjectField(fields, "radioJson"),
      activity: parseJsonField(fields, "activityJson"),
      lva: parseObjectField(fields, "lvaJson"),
      updatedAt: (fields.updatedAt && fields.updatedAt.stringValue) || null,
    };
  }

  async function loadCloud() {
    if (!projectId || !apiKey) return null;
    const res = await fetch(docUrl(), { method: "GET" });
    if (res.status === 404) {
      return {
        posts: [],
        reports: [],
        employees: [],
        loans: [],
        monorrielReports: [],
        users: [],
        messages: [],
        radio: {},
        activity: [],
        lva: {},
        updatedAt: null,
        empty: true,
      };
    }
    if (!res.ok) throw new Error(`cloud load ${res.status}`);
    const doc = await res.json();
    return { ...decodeDoc(doc), empty: false };
  }

  async function saveCloud(posts, reports, employees, loans, monorrielReports, users, messages, radio, activity, lva) {
    if (!projectId || !apiKey) throw new Error("cloud not configured");
    const body = encodeFields(posts, reports, employees, loans, monorrielReports, users, messages, radio, activity, lva);
    const res = await fetch(docUrl(), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`cloud save ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  window.RFSCloudApi = { loadCloud, saveCloud, decodeDoc };
})();
