// ─── FamilyCrate API Client ───────────────────────────────────────────────────
const BASE = import.meta.env.VITE_API_URL || "";

function getToken() { return localStorage.getItem("fc_token") || ""; }
function setToken(t) { localStorage.setItem("fc_token", t); }
function clearToken() { localStorage.removeItem("fc_token"); localStorage.removeItem("fc_family_id"); }

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getToken()}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed: ${path}`);
  return data;
}

// ─── Field transformers (DB snake_case → app camelCase) ───────────────────────
function transformMember(m) {
  return {
    id:         m.id,
    name:       m.name,
    color:      m.color,
    photo:      m.photo || null,
    email:      m.email || "",
    role:       m.role,
    sort_order: m.sort_order,
  };
}

function transformItem(i) {
  return {
    id:         i.id,
    text:       i.text,
    points:     i.points ?? 0,
    category:   i.category,
    assignedTo: i.assigned_to || i.assignedTo || [],
    repeat:     i.repeat || "none",
    startDate:  i.start_date || i.startDate || null,
    date:       i.date || null,
    time:       i.time || "",
    duration:   i.duration || 30,
    note:       i.note || "",
  };
}

function transformEvent(e) {
  return {
    id:        e.id,
    title:     e.title,
    memberIds: e.member_ids || e.memberIds || [],
    time:      e.time || "",
    duration:  e.duration || 60,
    type:      e.type || "family",
    color:     e.color || "#6A7A8A",
    repeat:    e.repeat || "none",
    startDate: e.start_date || e.startDate || null,
    date:      e.date || null,
  };
}

function transformReward(r) {
  return {
    id:     r.id,
    title:  r.title,
    points: r.points,
    icon:   r.icon || "gift",
  };
}

function transformFamily(data) {
  return {
    members:     (data.members     || []).map(transformMember),
    items:       (data.items       || []).map(transformItem),
    events:      (data.events      || []).map(transformEvent),
    rewards:     (data.rewards     || []).map(transformReward),
    doneLog:     data.doneLog      || data.done_log     || {},
    redeemReqs:  data.redeemReqs   || data.redeem_reqs  || [],
    spentPoints: data.spentPoints  || data.spent_points || {},
    rate:        data.rate         || 0.25,
    periodStart: data.periodStart  || data.period_start || null,
    periodDays:  data.periodDays   || data.period_days  || 14,
  };
}

// ─── Auth ──────────────────────────────────────────────────────────────────────
export async function apiLogin(email, password) {
  const data = await req("POST", "/api/auth/login", { email, password });
  setToken(data.session.access_token);
  localStorage.setItem("fc_family_id", data.family?.id || "");
  return data;
}

export async function apiRegister(payload) {
  return req("POST", "/api/auth/register", payload);
}

export async function apiMe() {
  return req("GET", "/api/auth/me");
}

export function apiLogout() {
  clearToken();
}

// ─── Family data ──────────────────────────────────────────────────────────────
export async function apiGetFamily() {
  const data = await req("GET", "/api/family");
  return transformFamily(data);
}

// ─── Outbound transformers (app camelCase → DB snake_case) ──────────────────
function toDbItem(d) {
  const o = {};
  if (d.text       !== undefined) o.text        = d.text;
  if (d.points     !== undefined) o.points      = d.points;
  if (d.category   !== undefined) o.category    = d.category;
  if (d.assignedTo !== undefined) o.assigned_to = d.assignedTo;
  if (d.repeat     !== undefined) o.repeat      = d.repeat;
  if (d.startDate  !== undefined) o.start_date  = d.startDate;
  if (d.date       !== undefined) o.date        = d.date;
  if (d.time       !== undefined) o.time        = d.time;
  if (d.duration   !== undefined) o.duration    = d.duration;
  if (d.note       !== undefined) o.note        = d.note;
  return o;
}

function toDbEvent(d) {
  const o = {};
  if (d.title     !== undefined) o.title      = d.title;
  if (d.memberIds !== undefined) o.member_ids = d.memberIds;
  if (d.time      !== undefined) o.time       = d.time;
  if (d.duration  !== undefined) o.duration   = d.duration;
  if (d.type      !== undefined) o.type       = d.type;
  if (d.color     !== undefined) o.color      = d.color;
  if (d.repeat    !== undefined) o.repeat     = d.repeat;
  if (d.startDate !== undefined) o.start_date = d.startDate;
  if (d.date      !== undefined) o.date       = d.date;
  return o;
}

function toDbMember(d) {
  const o = {};
  if (d.name      !== undefined) o.name       = d.name;
  if (d.color     !== undefined) o.color      = d.color;
  if (d.photo     !== undefined) o.photo      = d.photo;
  if (d.email     !== undefined) o.email      = d.email;
  if (d.role      !== undefined) o.role       = d.role;
  if (d.sortOrder !== undefined) o.sort_order = d.sortOrder;
  return o;
}

// Members
export async function apiAddMember(data)        { return req("POST",   "/api/family/members",      toDbMember(data)); }
export async function apiUpdateMember(id, data)  { return req("PUT",    `/api/family/members/${id}`, toDbMember(data)); }
export async function apiDeleteMember(id)        { return req("DELETE", `/api/family/members/${id}`); }

// Items
export async function apiAddItem(data)           { return req("POST",   "/api/family/items",        toDbItem(data)); }
export async function apiUpdateItem(id, data)    { return req("PUT",    `/api/family/items/${id}`,   toDbItem(data)); }
export async function apiDeleteItem(id)          { return req("DELETE", `/api/family/items/${id}`); }

// Events
export async function apiAddEvent(data)          { return req("POST",   "/api/family/events",       toDbEvent(data)); }
export async function apiUpdateEvent(id, data)   { return req("PUT",    `/api/family/events/${id}`,  toDbEvent(data)); }
export async function apiDeleteEvent(id)         { return req("DELETE", `/api/family/events/${id}`); }

// Done log
export async function apiToggleDone(key, done)   { return req("POST",   "/api/family/done",         { key, done }); }

// Rewards
export async function apiAddReward(data)         { return req("POST",   "/api/family/rewards",      data); }
export async function apiUpdateReward(id, data)  { return req("PUT",    `/api/family/rewards/${id}`, data); }
export async function apiDeleteReward(id)        { return req("DELETE", `/api/family/rewards/${id}`); }

// Redemptions
export async function apiRedeem(data)            { return req("POST",   "/api/family/redeem",               data); }
export async function apiApproveRedeem(id)       { return req("PUT",    `/api/family/redeem/${id}/approve`); }
export async function apiDeclineRedeem(id)       { return req("PUT",    `/api/family/redeem/${id}/decline`); }

// Settings
export async function apiUpdateSettings(data)    { return req("PUT",    "/api/family/settings",     data); }

// ─── Stripe ───────────────────────────────────────────────────────────────────
export async function apiCheckoutSession()       { return req("POST",   "/api/stripe/checkout"); }
export async function apiBillingPortal()         { return req("POST",   "/api/stripe/portal"); }
export async function apiSubscriptionStatus()    { return req("GET",    "/api/stripe/status"); }
