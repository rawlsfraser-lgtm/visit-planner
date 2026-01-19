import { putVisit, getAllVisits, deleteVisit as idbDeleteVisit, setMeta, getMeta } from "./idb.js";
import { initGoogleAuth, signIn, syncBackupToDrive, GOOGLE_CLIENT_ID } from "./drive.js";

// --- Service worker registration (offline loading) ---
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

// --- DOM helpers ---
const el = (id) => document.getElementById(id);

const fields = {
  customerName: el("customerName"),
  location: el("location"),
  contact: el("contact"),
  date: el("date"),
  machines: el("machines"),
  product: el("product"),
  tooling: el("tooling"),
  bladeChange: el("bladeChange"),
  grindInterval: el("grindInterval"),
  issues: el("issues"),
  slitter: el("slitter"),
  cutoff: el("cutoff"),
  perf: el("perf"),
  grinding: el("grinding"),
  goal: el("goal"),
  nextStep: el("nextStep"),
};

let currentId = null;
let records = [];
let searchTerm = "";

// --- UI status ---
function setStatus(text, pill) {
  el("statusText").textContent = text;
  el("recordPill").textContent = pill;
}

function setSyncStatus(text) {
  el("syncStatus").textContent = text;
}

function showOnlineBanner() {
  const banner = el("onlineBanner");
  const isOnline = navigator.onLine;
  banner.style.display = "block";
  banner.textContent = isOnline
    ? "Online: Drive sync is available."
    : "Offline: All features work. Drive sync will resume when internet is available.";
}

// --- Data helpers ---
function newId() {
  return (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
}

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function gather() {
  return {
    id: currentId || newId(),
    customerName: fields.customerName.value.trim(),
    location: fields.location.value.trim(),
    contact: fields.contact.value.trim(),
    date: fields.date.value,
    machines: fields.machines.value.trim(),
    product: fields.product.value.trim(),
    tooling: fields.tooling.value.trim(),
    bladeChangeInterval: fields.bladeChange.value.trim(),
    grindInterval: fields.grindInterval.value.trim(),
    issues: fields.issues.value.trim(),
    slitterTooling: fields.slitter.value.trim(),
    cutoffTooling: fields.cutoff.value.trim(),
    perfTooling: fields.perf.value.trim(),
    grindingSystems: fields.grinding.value.trim(),
    goal: fields.goal.value.trim(),
    nextStep: fields.nextStep.value.trim(),
    updatedAt: new Date().toISOString(),
  };
}

function fill(rec) {
  currentId = rec.id;
  fields.customerName.value = rec.customerName || "";
  fields.location.value = rec.location || "";
  fields.contact.value = rec.contact || "";
  fields.date.value = rec.date || todayISO();
  fields.machines.value = rec.machines || "";
  fields.product.value = rec.product || "";
  fields.tooling.value = rec.tooling || "";
  fields.bladeChange.value = rec.bladeChangeInterval || "";
  fields.grindInterval.value = rec.grindInterval || "";
  fields.issues.value = rec.issues || "";
  fields.slitter.value = rec.slitterTooling || "";
  fields.cutoff.value = rec.cutoffTooling || "";
  fields.perf.value = rec.perfTooling || "";
  fields.grinding.value = rec.grindingSystems || "";
  fields.goal.value = rec.goal || "";
  fields.nextStep.value = rec.nextStep || "";

  setStatus(`Editing: ${rec.customerName || "Unnamed"}`, "Saved (offline)");
}

function clearForm() {
  currentId = newId();
  Object.values(fields).forEach((f) => (f.value = ""));
  fields.date.value = todayISO();
  setStatus("New record", "Unsaved");
}

// --- Rendering list ---
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (s) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[s]));
}

function matchesSearch(rec) {
  if (!searchTerm) return true;
  const hay = `${rec.customerName||""} ${rec.location||""}`.toLowerCase();
  return hay.includes(searchTerm);
}

function renderList() {
  const list = el("visitList");
  list.innerHTML = "";

  const filtered = records
    .slice()
    .sort((a,b) => (b.updatedAt||"").localeCompare(a.updatedAt||""))
    .filter(matchesSearch);

  if (filtered.length === 0) {
    list.innerHTML = `<div class="muted">${records.length ? "No matches." : "No saved visits yet."}</div>`;
    return;
  }

  for (const rec of filtered) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div>
        <b>${escapeHtml(rec.customerName || "Unnamed Customer")}</b>
        <div class="muted">${escapeHtml(rec.location || "")}</div>
      </div>
      <div class="muted">${escapeHtml(rec.date || "")}</div>
    `;
    div.onclick = () => fill(rec);
    list.appendChild(div);
  }
}

// --- Save / delete ---
async function save() {
  const rec = gather();
  await putVisit(rec);

  // Update in-memory list
  const idx = records.findIndex((r) => r.id === rec.id);
  if (idx >= 0) records[idx] = rec;
  else records.unshift(rec);

  setStatus(`Saved: ${rec.customerName || "Unnamed"}`, "Saved (offline)");
  renderList();
}

async function deleteCurrent() {
  if (!currentId) return;
  await idbDeleteVisit(currentId);
  records = records.filter((r) => r.id !== currentId);
  clearForm();
  renderList();
}

// --- Print / Save as PDF ---
function recordToPrintableHTML(rec) {
  const safe = (v) => escapeHtml(v || "");
  return `
    <h1 style="margin:0 0 6px 0;">Visit Worksheet</h1>
    <div style="color:#555;margin-bottom:12px;">${safe(rec.customerName)} — ${safe(rec.location)} — ${safe(rec.date)}</div>

    <h2>Customer</h2>
    <p><b>Contact:</b> ${safe(rec.contact)}</p>

    <h2>Operations</h2>
    <p><b>Machines / Lines:</b><br>${safe(rec.machines).replaceAll("\n","<br>")}</p>
    <p><b>Product Produced:</b><br>${safe(rec.product).replaceAll("\n","<br>")}</p>
    <p><b>Current Tooling:</b><br>${safe(rec.tooling).replaceAll("\n","<br>")}</p>

    <h2>Performance</h2>
    <p><b>Blade Change Interval:</b> ${safe(rec.bladeChangeInterval)}</p>
    <p><b>Grind Interval:</b> ${safe(rec.grindInterval)}</p>
    <p><b>Known Issues:</b><br>${safe(rec.issues).replaceAll("\n","<br>")}</p>

    <h2>Opportunity Areas</h2>
    <p><b>Slitter Knives:</b><br>${safe(rec.slitterTooling).replaceAll("\n","<br>")}</p>
    <p><b>Cutoff Knives:</b><br>${safe(rec.cutoffTooling).replaceAll("\n","<br>")}</p>
    <p><b>Perf Knives:</b><br>${safe(rec.perfTooling).replaceAll("\n","<br>")}</p>
    <p><b>Grinding Systems:</b><br>${safe(rec.grindingSystems).replaceAll("\n","<br>")}</p>

    <h2>Sales Plan</h2>
    <p><b>Visit Goal:</b><br>${safe(rec.goal).replaceAll("\n","<br>")}</p>
    <p><b>Next Step:</b><br>${safe(rec.nextStep).replaceAll("\n","<br>")}</p>
  `;
}

async function printPdf() {
  await save(); // ensures print reflects latest edits
  const rec = records.find(r => r.id === currentId) || gather();

  const w = window.open("", "_blank");
  w.document.write(`
    <html>
      <head>
        <title>${(rec.customerName || "Visit")} - Worksheet</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: Arial, sans-serif; margin: 18px; }
          h1 { font-size: 20px; }
          h2 { font-size: 14px; margin-top: 16px; }
          p { font-size: 12px; line-height: 1.35; }
        </style>
      </head>
      <body>
        ${recordToPrintableHTML(rec)}
        <script>window.onload = () => window.print();</script>
      </body>
    </html>
  `);
  w.document.close();
}

// --- Backup import/export (offline, manual) ---
async function exportBackupJSON() {
  const all = await getAllVisits();
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "VisitPlanner_Backup.json";
  a.click();
  URL.revokeObjectURL(url);
}

async function importBackupJSON(file) {
  const text = await file.text();
  const imported = JSON.parse(text);
  if (!Array.isArray(imported)) throw new Error("Backup file format is invalid.");

  for (const rec of imported) {
    if (rec && rec.id) await putVisit(rec);
  }
  records = await getAllVisits();
  renderList();
}

// --- Drive Sync ---
async function driveSyncNow() {
  if (!navigator.onLine) {
    setSyncStatus("Offline. Sync will work when internet is available.");
    return;
  }
  const all = await getAllVisits();
  const payload = JSON.stringify({
    exportedAt: new Date().toISOString(),
    records: all
  }, null, 2);

  try {
    await syncBackupToDrive(payload, setSyncStatus);
    await setMeta("lastDriveSync", new Date().toISOString());
  } catch (e) {
    setSyncStatus(`Sync failed: ${e.message}`);
  }
}

async function loadLastSync() {
  const last = await getMeta("lastDriveSync");
  if (last) setSyncStatus(`Last Drive sync: ${new Date(last).toLocaleString()}`);
  else setSyncStatus("No Drive sync yet.");
}

// --- Event wiring ---
el("newBtn").onclick = clearForm;
el("saveBtn").onclick = save;
el("deleteBtn").onclick = deleteCurrent;
el("printBtn").onclick = printPdf;

el("backupBtn").onclick = exportBackupJSON;
el("importBtn").onclick = () => el("importFile").click();
el("importFile").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try { await importBackupJSON(f); }
  catch (err) { alert(`Import failed: ${err.message}`); }
  e.target.value = "";
});

el("searchBox").addEventListener("input", (e) => {
  searchTerm = (e.target.value || "").trim().toLowerCase();
  renderList();
});

window.addEventListener("online", showOnlineBanner);
window.addEventListener("offline", showOnlineBanner);

// Google auth init and buttons
el("googleSignInBtn").onclick = () => {
  initGoogleAuth(setSyncStatus);
  // After init, call signIn (user action)
  signIn(setSyncStatus);
};

el("syncBtn").onclick = driveSyncNow;

// --- App startup ---
(async function start() {
  showOnlineBanner();
  records = await getAllVisits();
  renderList();
  clearForm();
  await loadLastSync();
})();
