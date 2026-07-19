// netlify/functions/subs.js
//
// Backend for the "Find a Sub" feature.
// Storage: Netlify Blobs (built-in, zero-config key/value store).
// Email:   Resend (https://resend.com) — free tier is generous and the
//          Node SDK is a single fetch call, so no heavy dependency.
//
// Required environment variables (set in Netlify dashboard ->
// Site configuration -> Environment variables):
//   RESEND_API_KEY     - your Resend API key
//   SUB_FROM_EMAIL     - e.g. "subs@2bambirds.com" (must be a verified sender/domain in Resend)
//   BLOBS_SITE_ID      - from Site configuration -> General -> Site details -> Site ID
//   BLOBS_ACCESS_TOKEN - a Personal Access Token (User settings -> Applications
//                          -> Personal access tokens -> New access token)
//   ADMIN_PASSWORD     - any password you pick, used to protect the admin list page
//
// IMPORTANT: don't name these starting with "NETLIFY_" — that prefix is
// reserved for Netlify's own internal variables and custom values there
// get silently ignored, which is a real trap to fall into.
//
// (These two are a manual workaround for a known Netlify Blobs issue —
// "MissingBlobsEnvironmentError" — where automatic detection sometimes
// doesn't kick in for a function. Passing siteID/token explicitly sidesteps it.)
//
// Deploy: this file just needs to live at netlify/functions/subs.js in
// your repo. Netlify picks it up automatically on the next deploy.
// It will be callable at:  /.netlify/functions/subs

const { getStore } = require("@netlify/blobs");

const FROM_EMAIL = process.env.SUB_FROM_EMAIL || "2Bambirds@gmail.com";
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SITE_ID = process.env.BLOBS_SITE_ID;
const BLOBS_TOKEN = process.env.BLOBS_ACCESS_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function subsStore() {
  // One Blobs "store" (namespace) called "subs". Each registered sub is
  // saved under the key "sub:<lowercased email>" so lookups are cheap
  // and emails are naturally deduped (re-registering just overwrites).
  if (SITE_ID && BLOBS_TOKEN) {
    // Explicit config — sidesteps MissingBlobsEnvironmentError.
    return getStore({ name: "subs", siteID: SITE_ID, token: BLOBS_TOKEN });
  }
  // Fallback: let @netlify/blobs try to auto-detect (works on some setups).
  return getStore("subs");
}

function normEmail(email) {
  return (email || "").trim().toLowerCase();
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      // Allow the browser fetch() from your site to call this function.
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
    body: JSON.stringify(body)
  };
}

async function sendEmail(to, subject, html, replyTo) {
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not set");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to,
      subject,
      html,
      reply_to: replyTo // so hitting "Reply" goes to the requester, not our sender address
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend error ${res.status}: ${text}`);
  }
  return res.json();
}

// ---- action handlers ----

async function registerSub(store, data) {
  const email = normEmail(data.email);
  const permission = !!data.permission; // agreed to be contacted about sub opportunities
  const wantsEvents = !!data.wantsEvents; // opted in to class/event announcements

  if (!email) {
    return json(400, { ok: false, error: "Missing required fields." });
  }
  if (!permission && !wantsEvents) {
    return json(400, { ok: false, error: "Please select at least one option before submitting." });
  }
  // Cell is only required if joining the sub list — event-only subscribers
  // (e.g. the simple "Get on Our List" email box) don't need to give a
  // phone number, and in that case we don't require a name either.
  if (permission && !data.cell) {
    return json(400, { ok: false, error: "Cell phone is required to join the sub list." });
  }

  // Merge with any existing record so a lightweight submission (e.g. just
  // an email from "Get on Our List") never erases richer info this person
  // already gave us (name/cell/permission from a fuller registration),
  // and vice versa — someone can top up their info over multiple visits
  // without losing anything.
  const existing = (await store.get(`sub:${email}`, { type: "json" })) || {};

  const record = {
    firstName: (data.firstName && String(data.firstName).trim()) || existing.firstName || "",
    lastName: (data.lastName && String(data.lastName).trim()) || existing.lastName || "",
    cell: (data.cell && String(data.cell).trim()) || existing.cell || "",
    email,
    permission: permission || !!existing.permission,
    wantsEvents: wantsEvents || !!existing.wantsEvents,
    joinedAt: existing.joinedAt || new Date().toISOString()
  };
  await store.setJSON(`sub:${email}`, record);
  return json(200, { ok: true });
}

async function checkSub(store, data) {
  const email = normEmail(data.email);
  if (!email) return json(400, { ok: false, error: "Missing email." });
  const record = await store.get(`sub:${email}`, { type: "json" });
  return json(200, { ok: true, isSub: !!record, permission: record ? !!record.permission : false });
}

async function requestSub(store, data) {
  const email = normEmail(data.email);
  if (!email || !data.name || !data.date || !data.time || !data.location || !data.numSubs) {
    return json(400, { ok: false, error: "Missing required fields." });
  }
  const requester = await store.get(`sub:${email}`, { type: "json" });
  if (!requester) {
    return json(403, {
      ok: false,
      error: "This email isn't in our sub database yet. Please become a sub first."
    });
  }

  // Log the request itself for record-keeping.
  const reqRecord = {
    name: String(data.name).trim(),
    email,
    date: String(data.date).trim(),
    time: String(data.time).trim(),
    location: String(data.location).trim(),
    numSubs: Number(data.numSubs) || 1,
    createdAt: new Date().toISOString()
  };
  const reqKey = `request:${Date.now()}-${email}`;
  await store.setJSON(reqKey, reqRecord);

  // Gather everyone who has given permission to be contacted (except the requester).
  const { blobs } = await store.list({ prefix: "sub:" });
  const recipients = [];
  for (const b of blobs) {
    const rec = await store.get(b.key, { type: "json" });
    if (rec && rec.permission && rec.email !== email) {
      recipients.push(rec.email);
    }
  }

  const subject = `Sub needed: ${reqRecord.date} at ${reqRecord.time}`;
  const html = `
    <p>Hi there,</p>
    <p><strong>${reqRecord.name}</strong> is looking for <strong>${reqRecord.numSubs}</strong>
       sub${reqRecord.numSubs === 1 ? "" : "s"} for a game:</p>
    <ul>
      <li><strong>Date:</strong> ${reqRecord.date}</li>
      <li><strong>Time:</strong> ${reqRecord.time}</li>
      <li><strong>Location:</strong> ${reqRecord.location}</li>
    </ul>
    <p>If you're interested and available, reply directly to
       <a href="mailto:${email}">${email}</a> to let ${reqRecord.name} know!</p>
    <p style="color:#888;font-size:12px">You're receiving this because you're on the
       2 Bam Birds sub list. — 2 Bam Birds</p>
  `;

  let sent = 0;
  const errors = [];
  for (const to of recipients) {
    try {
      await sendEmail(to, subject, html, email);
      sent++;
    } catch (err) {
      errors.push({ to, error: String(err.message || err) });
    }
  }

  return json(200, { ok: true, recipientsCount: recipients.length, sent, errors });
}

async function listSubs(store, data) {
  const password = data.password || "";
  if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
    return json(401, { ok: false, error: "Incorrect password." });
  }
  const { blobs } = await store.list({ prefix: "sub:" });
  const records = [];
  for (const b of blobs) {
    const rec = await store.get(b.key, { type: "json" });
    if (rec) records.push(rec);
  }
  records.sort((a, b) => (a.joinedAt < b.joinedAt ? 1 : -1)); // newest first
  return json(200, { ok: true, records });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(200, {});
  }
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const { action, data } = payload;
  const store = subsStore();

  try {
    switch (action) {
      case "register":
        return await registerSub(store, data || {});
      case "check":
        return await checkSub(store, data || {});
      case "request":
        return await requestSub(store, data || {});
      case "list":
        return await listSubs(store, data || {});
      default:
        return json(400, { ok: false, error: "Unknown action" });
    }
  } catch (err) {
    return json(500, { ok: false, error: String(err.message || err) });
  }
};
