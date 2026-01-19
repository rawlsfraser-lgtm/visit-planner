// drive.js
// 1) You MUST set GOOGLE_CLIENT_ID after you create OAuth credentials in Google Cloud Console.
// 2) This module requests an access token (drive.file scope) and uploads a JSON backup to Drive.

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const BACKUP_FOLDER_NAME = "VisitPlanner Backups";
const BACKUP_FILE_NAME = "VisitPlanner_Backup.json";

// Paste your OAuth Client ID here:
export let GOOGLE_CLIENT_ID = "PASTE_YOUR_CLIENT_ID_HERE";

// Token client instance
let tokenClient = null;
let accessToken = null;

export function initGoogleAuth(onStatus) {
  if (!window.google?.accounts?.oauth2) {
    onStatus("Google sign-in library not loaded yet. Try again in a few seconds.");
    return;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: (resp) => {
      if (resp?.access_token) {
        accessToken = resp.access_token;
        onStatus("Signed in. Ready to sync.");
      } else {
        onStatus("Sign-in did not return an access token.");
      }
    }
  });

  onStatus("Ready. Click 'Sign in to Google' to authorize Drive backups.");
}

export function signIn(onStatus) {
  if (!tokenClient) {
    onStatus("Auth not initialized yet.");
    return;
  }
  tokenClient.requestAccessToken({ prompt: "consent" });
}

function requireToken() {
  if (!accessToken) throw new Error("Not signed in. Click 'Sign in to Google' first.");
  return accessToken;
}

async function driveFetch(url, options = {}) {
  const token = requireToken();
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}

async function findOrCreateFolder() {
  // Search for folder
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${BACKUP_FOLDER_NAME}' and trashed=false`
  );
  const listUrl = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`;
  const res = await driveFetch(listUrl);
  if (!res.ok) throw new Error(`Drive folder search failed (${res.status}).`);
  const data = await res.json();
  if (data.files && data.files.length > 0) return data.files[0].id;

  // Create folder
  const createRes = await driveFetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: BACKUP_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder"
    })
  });
  if (!createRes.ok) throw new Error(`Drive folder create failed (${createRes.status}).`);
  const created = await createRes.json();
  return created.id;
}

async function findBackupFile(folderId) {
  const q = encodeURIComponent(
    `name='${BACKUP_FILE_NAME}' and '${folderId}' in parents and trashed=false`
  );
  const listUrl = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)`;
  const res = await driveFetch(listUrl);
  if (!res.ok) throw new Error(`Drive file search failed (${res.status}).`);
  const data = await res.json();
  if (data.files && data.files.length > 0) return data.files[0].id;
  return null;
}

function buildMultipartBody(metadata, content, boundary) {
  const delimiter = `--${boundary}`;
  const closeDelim = `--${boundary}--`;

  return [
    delimiter,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    delimiter,
    "Content-Type: application/json; charset=UTF-8",
    "",
    content,
    closeDelim,
    ""
  ].join("\r\n");
}

async function createBackupFile(folderId, jsonText) {
  const boundary = "----VisitPlannerBoundary" + Math.random().toString(16).slice(2);
  const multipartBody = buildMultipartBody(
    { name: BACKUP_FILE_NAME, parents: [folderId] },
    jsonText,
    boundary
  );

  const url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  const res = await driveFetch(url, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: multipartBody
  });

  if (!res.ok) throw new Error(`Drive upload (create) failed (${res.status}).`);
  return await res.json();
}

async function updateBackupFile(fileId, jsonText) {
  const boundary = "----VisitPlannerBoundary" + Math.random().toString(16).slice(2);
  const multipartBody = buildMultipartBody(
    { name: BACKUP_FILE_NAME },
    jsonText,
    boundary
  );

  const url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
  const res = await driveFetch(url, {
    method: "PATCH",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: multipartBody
  });

  if (!res.ok) throw new Error(`Drive upload (update) failed (${res.status}).`);
  return await res.json();
}

export async function syncBackupToDrive(jsonText, onStatus) {
  onStatus("Syncing to Drive...");
  const folderId = await findOrCreateFolder();
  const fileId = await findBackupFile(folderId);

  if (!fileId) {
    await createBackupFile(folderId, jsonText);
    onStatus("Drive backup created.");
  } else {
    await updateBackupFile(fileId, jsonText);
    onStatus("Drive backup updated.");
  }
}
