const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://tapvkveybfotgskqjeof.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable__BsA8Xl7RTgowZRkw5cjSQ_K-2FaQt5";

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch (error) { return { message: text }; }
}

function bearerToken(request) {
  const authorization = String(request.headers.authorization || "");
  return authorization.startsWith("Bearer ") && authorization.length > 7 ? authorization : null;
}

function supabaseHeaders(authorization) {
  return { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: authorization, "Content-Type": "application/json" };
}

async function getSupabaseUser(authorization) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: supabaseHeaders(authorization) });
  const data = await readJson(response);
  if (!response.ok) throw new Error("Authentication is required.");
  return data;
}

async function supabaseRpc(name, body, authorization) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: supabaseHeaders(authorization),
    body: JSON.stringify(body)
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error((data && data.message) || "The secure session service rejected this request.");
  return data;
}

async function zoomAccessToken() {
  const accountId = process.env.ZOOM_S2S_ACCOUNT_ID;
  const clientId = process.env.ZOOM_S2S_CLIENT_ID;
  const clientSecret = process.env.ZOOM_S2S_CLIENT_SECRET;
  if (!accountId || !clientId || !clientSecret) throw new Error("Zoom account credentials are not configured.");
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}` }
  });
  const data = await readJson(response);
  if (!response.ok || !data.access_token) throw new Error((data && data.reason) || "Zoom authorization failed.");
  return data.access_token;
}

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function meetingSdkJwt(meetingNumber, role) {
  const clientId = process.env.ZOOM_MEETING_SDK_CLIENT_ID;
  const clientSecret = process.env.ZOOM_MEETING_SDK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Zoom Meeting SDK credentials are not configured.");
  const iat = Math.floor(Date.now() / 1000) - 30;
  const exp = iat + 1800;
  const header = base64Url({ alg: "HS256", typ: "JWT" });
  const payload = base64Url({ appKey: clientId, mn: String(meetingNumber), role, iat, exp, tokenExp: exp, video_webrtc_mode: 1 });
  const signature = crypto.createHmac("sha256", clientSecret).update(`${header}.${payload}`).digest("base64url");
  return { signature: `${header}.${payload}.${signature}`, clientId };
}

function siteOrigin(request) {
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || "dev.luxiapc.com");
  const protocol = String(request.headers["x-forwarded-proto"] || "https");
  return `${protocol}://${host}`;
}

module.exports = { SUPABASE_URL, bearerToken, getSupabaseUser, meetingSdkJwt, readJson, sendJson, siteOrigin, supabaseHeaders, supabaseRpc, zoomAccessToken };
