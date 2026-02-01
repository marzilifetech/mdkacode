const { v4: uuidv4 } = require('uuid');
const {
  putTeam,
  getTeam,
  listTeamsByOwner,
  updateTeamPaymentOrder,
  putMember,
  getMembersByTeam,
  getUserProfile,
  putUserProfile,
  getPaymentOrder,
  updatePaymentOrderWithAntakshari
} = require('./utils/dynamodb');
const { verifyAccess } = require('./utils/jwt');
const { log } = require('./utils/logger');

/** When true, use in-memory store (no DynamoDB) for local testing. */
const LOCAL_MOCK_ANTAKSHARI = process.env.LOCAL_MOCK_ANTAKSHARI === 'true' || process.env.LOCAL_MOCK_ANTAKSHARI === '1';
const mockTeams = new Map();
const mockMembers = new Map();
const mockProfiles = new Map();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

function parseBody(event) {
  try {
    const body = event.body;
    if (!body) return {};
    return typeof body === 'string' ? JSON.parse(body) : body;
  } catch {
    return {};
  }
}

function respond(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  };
}

function getRequestId(event) {
  return event.requestContext?.requestId || event.headers?.['x-request-id'] || `req-${Date.now()}`;
}

function getMobileFromAuth(event) {
  const auth = event.headers?.Authorization || event.headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  try {
    const decoded = verifyAccess(token);
    return decoded.sub || null;
  } catch {
    return null;
  }
}

const DOB_REGEX = /^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/;
function isValidDob(str) {
  return typeof str === 'string' && DOB_REGEX.test(str.trim());
}

function normalizePhone(phone) {
  const s = String(phone).replace(/\D/g, '');
  if (s.length === 10) return s;
  if (s.length === 12 && s.startsWith('91')) return s;
  return null;
}

// --- Handlers ---

/** POST /antakshari/team — create team; return teamId */
async function handlePostTeam(event) {
  const requestId = getRequestId(event);
  const mobile = getMobileFromAuth(event);
  if (!mobile) {
    log('team_create_unauthorized', { requestId });
    return respond(401, { success: false, error: 'Unauthorized' });
  }

  const body = parseBody(event);
  const teamName = body.teamName != null ? String(body.teamName).trim() : '';
  const ref = body.ref != null ? String(body.ref).trim() : undefined;

  if (!teamName) {
    return respond(400, { success: false, error: 'teamName is required (non-empty string)' });
  }

  const teamId = uuidv4();
  const now = Date.now();
  const item = {
    teamId,
    teamName,
    ownerMobile: mobile,
    ref: ref || undefined,
    createdAt: now,
    updatedAt: now
  };

  if (LOCAL_MOCK_ANTAKSHARI) {
    mockTeams.set(teamId, { ...item });
    log('team_created', { requestId, mobile, teamId, ref: ref || null });
    return respond(200, { success: true, teamId });
  }

  await putTeam(item);
  log('team_created', { requestId, mobile, teamId, ref: ref || null });
  return respond(200, { success: true, teamId });
}

/** GET /antakshari/profile — return owner name from UserProfile; 404 if not found */
async function handleGetProfile(event) {
  const requestId = getRequestId(event);
  const mobile = getMobileFromAuth(event);
  if (!mobile) {
    log('profile_get_unauthorized', { requestId });
    return respond(401, { success: false, error: 'Unauthorized' });
  }

  if (LOCAL_MOCK_ANTAKSHARI) {
    const profile = mockProfiles.get(mobile) || null;
    if (!profile) {
      log('profile_not_found', { requestId, mobile });
      return respond(404, { success: false, error: 'Profile not found' });
    }
    log('profile_get', { requestId, mobile });
    return respond(200, { success: true, name: profile.name || null, dob: profile.dob || null });
  }

  const profile = await getUserProfile(mobile);
  if (!profile) {
    log('profile_not_found', { requestId, mobile });
    return respond(404, { success: false, error: 'Profile not found' });
  }
  log('profile_get', { requestId, mobile });
  return respond(200, { success: true, name: profile.name || null, dob: profile.dob || null });
}

/** POST /antakshari/profile — create/update owner in UserProfile */
async function handlePostProfile(event) {
  const requestId = getRequestId(event);
  const mobile = getMobileFromAuth(event);
  if (!mobile) {
    log('profile_post_unauthorized', { requestId });
    return respond(401, { success: false, error: 'Unauthorized' });
  }

  const body = parseBody(event);
  const name = body.name != null ? String(body.name).trim() : '';
  const ref = body.ref != null ? String(body.ref).trim() : undefined;
  const dobRaw = body.dob != null ? String(body.dob).trim() : '';

  if (!name) {
    return respond(400, { success: false, error: 'name is required' });
  }
  if (dobRaw && !isValidDob(dobRaw)) {
    return respond(400, { success: false, error: 'dob must be dd/mm/yyyy' });
  }
  const dobProvided = dobRaw || undefined;

  if (LOCAL_MOCK_ANTAKSHARI) {
    const now = Date.now();
    const existing = mockProfiles.get(mobile);
    const dob = dobProvided !== undefined ? dobProvided : (existing?.dob || undefined);
    mockProfiles.set(mobile, { mobile, name, ref, dob, profileType: 'PRIMARY', updatedAt: now, createdAt: existing?.createdAt || now });
    log('profile_updated', { requestId, mobile, ref: ref || null });
    return respond(200, { success: true });
  }

  const existing = await getUserProfile(mobile);
  const dob = dobProvided !== undefined ? dobProvided : (existing?.dob || undefined);
  await putUserProfile({ mobile, name, ref, dob });
  log('profile_updated', { requestId, mobile, ref: ref || null });
  return respond(200, { success: true });
}

/** POST /antakshari/team/:teamId/members — exactly 5 members; DOB dd/mm/yyyy; save members + UserProfile per member */
async function handlePostTeamMembers(event, teamId) {
  const requestId = getRequestId(event);
  const mobile = getMobileFromAuth(event);
  if (!mobile) {
    log('members_post_unauthorized', { requestId });
    return respond(401, { success: false, error: 'Unauthorized' });
  }

  let team;
  if (LOCAL_MOCK_ANTAKSHARI) {
    team = mockTeams.get(teamId) || null;
  } else {
    team = await getTeam(teamId);
  }
  if (!team) {
    log('team_not_found', { requestId, teamId });
    return respond(404, { success: false, error: 'Team not found' });
  }
  if (team.ownerMobile !== mobile) {
    log('team_forbidden', { requestId, mobile, teamId });
    return respond(403, { success: false, error: 'Forbidden' });
  }

  const body = parseBody(event);
  const members = Array.isArray(body.members) ? body.members : [];
  const ref = body.ref != null ? String(body.ref).trim() : undefined;

  if (members.length !== 5) {
    return respond(400, { success: false, error: 'members must be an array of exactly 5 items' });
  }

  const memberList = [];
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    const name = m.name != null ? String(m.name).trim() : '';
    const phone = m.phone != null ? String(m.phone).trim() : '';
    const dob = m.dob != null ? String(m.dob).trim() : '';
    if (!name) {
      return respond(400, { success: false, error: `members[${i}].name is required` });
    }
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return respond(400, { success: false, error: `members[${i}].phone must be 10 digits or 12 with country code` });
    }
    if (!isValidDob(dob)) {
      return respond(400, { success: false, error: `members[${i}].dob must be dd/mm/yyyy` });
    }

    const memberIndex = String(i + 1);
    const memberItem = { teamId, memberIndex, name, phone: normalizedPhone, dob, ref: ref || undefined };
    memberList.push(memberItem);

    if (LOCAL_MOCK_ANTAKSHARI) {
      const now = Date.now();
      const existing = mockProfiles.get(normalizedPhone);
      mockProfiles.set(normalizedPhone, { mobile: normalizedPhone, name, ref: ref || undefined, profileType: 'PRIMARY', updatedAt: now, createdAt: existing?.createdAt || now });
    } else {
      await putMember(memberItem);
      const existing = await getUserProfile(normalizedPhone);
      await putUserProfile({
        mobile: normalizedPhone,
        name,
        ref: ref || undefined,
        ...(existing?.createdAt && { createdAt: existing.createdAt })
      });
    }
  }

  if (LOCAL_MOCK_ANTAKSHARI) {
    mockMembers.set(teamId, memberList);
  }

  log('team_members_saved', { requestId, mobile, teamId, ref: ref || null });
  return respond(200, { success: true });
}

/** POST /antakshari/team/:teamId/link-order — link orderId to team */
async function handlePostLinkOrder(event, teamId) {
  const requestId = getRequestId(event);
  const mobile = getMobileFromAuth(event);
  if (!mobile) {
    log('link_order_unauthorized', { requestId });
    return respond(401, { success: false, error: 'Unauthorized' });
  }

  let team;
  if (LOCAL_MOCK_ANTAKSHARI) {
    team = mockTeams.get(teamId) || null;
  } else {
    team = await getTeam(teamId);
  }
  if (!team) {
    log('team_not_found', { requestId, teamId });
    return respond(404, { success: false, error: 'Team not found' });
  }
  if (team.ownerMobile !== mobile) {
    log('team_forbidden', { requestId, mobile, teamId });
    return respond(403, { success: false, error: 'Forbidden' });
  }

  const body = parseBody(event);
  const orderId = body.orderId != null ? String(body.orderId).trim() : '';
  if (!orderId) {
    return respond(400, { success: false, error: 'orderId is required' });
  }

  if (!LOCAL_MOCK_ANTAKSHARI) {
    const order = await getPaymentOrder(orderId);
    if (order && order.mobile !== mobile) {
      log('link_order_mismatch', { requestId, mobile, teamId, orderId });
      return respond(403, { success: false, error: 'Order does not belong to you' });
    }
    await updateTeamPaymentOrder(teamId, orderId);
    if (team.teamName) {
      await updatePaymentOrderWithAntakshari(orderId, team.teamName);
    }
  } else {
    const t = mockTeams.get(teamId);
    if (t) mockTeams.set(teamId, { ...t, paymentOrderId: orderId, updatedAt: Date.now() });
  }
  log('order_linked', { requestId, mobile, teamId, orderId });
  return respond(200, { success: true });
}

/** GET /antakshari/users — optional ref, teamId; return users (members + profile) with team info and payment status */
async function handleGetUsers(event) {
  const requestId = getRequestId(event);
  const mobile = getMobileFromAuth(event);
  if (!mobile) {
    log('users_get_unauthorized', { requestId });
    return respond(401, { success: false, error: 'Unauthorized' });
  }

  const ref = event.queryStringParameters?.ref;
  const teamIdParam = event.queryStringParameters?.teamId;

  let teams;
  if (LOCAL_MOCK_ANTAKSHARI) {
    teams = Array.from(mockTeams.values()).filter((t) => t.ownerMobile === mobile).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } else {
    teams = await listTeamsByOwner(mobile, 100);
  }
  if (ref) teams = teams.filter((t) => t.ref === ref);
  if (teamIdParam) {
    const t = teams.find((x) => x.teamId === teamIdParam);
    teams = t ? [t] : [];
  }

  const results = [];
  for (const team of teams) {
    const members = LOCAL_MOCK_ANTAKSHARI ? (mockMembers.get(team.teamId) || []) : await getMembersByTeam(team.teamId);
    let paymentStatus = null;
    if (team.paymentOrderId && !LOCAL_MOCK_ANTAKSHARI) {
      const order = await getPaymentOrder(team.paymentOrderId);
      paymentStatus = order ? order.status : null;
    }
    for (const m of members) {
      const profile = LOCAL_MOCK_ANTAKSHARI ? mockProfiles.get(m.phone) || null : await getUserProfile(m.phone);
      results.push({
        teamId: team.teamId,
        teamName: team.teamName,
        ref: team.ref,
        paymentOrderId: team.paymentOrderId || null,
        paymentStatus,
        memberIndex: m.memberIndex,
        name: m.name,
        phone: m.phone,
        dob: m.dob,
        profileName: profile?.name || null
      });
    }
  }

  log('users_listed', { requestId, mobile, count: results.length });
  return respond(200, { success: true, users: results });
}

/** GET /antakshari/teams — optional ref; list teams with members and payment status */
async function handleGetTeams(event) {
  const requestId = getRequestId(event);
  const mobile = getMobileFromAuth(event);
  if (!mobile) {
    log('teams_get_unauthorized', { requestId });
    return respond(401, { success: false, error: 'Unauthorized' });
  }

  const ref = event.queryStringParameters?.ref;
  let teams;
  if (LOCAL_MOCK_ANTAKSHARI) {
    teams = Array.from(mockTeams.values()).filter((t) => t.ownerMobile === mobile).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } else {
    teams = await listTeamsByOwner(mobile, 100);
  }
  if (ref) teams = teams.filter((t) => t.ref === ref);

  const results = [];
  for (const team of teams) {
    const members = LOCAL_MOCK_ANTAKSHARI ? (mockMembers.get(team.teamId) || []) : await getMembersByTeam(team.teamId);
    let paymentStatus = null;
    if (team.paymentOrderId && !LOCAL_MOCK_ANTAKSHARI) {
      const order = await getPaymentOrder(team.paymentOrderId);
      paymentStatus = order ? order.status : null;
    }
    results.push({
      teamId: team.teamId,
      teamName: team.teamName,
      ref: team.ref,
      paymentOrderId: team.paymentOrderId || null,
      paymentStatus,
      members: members.map((m) => ({ memberIndex: m.memberIndex, name: m.name, phone: m.phone, dob: m.dob }))
    });
  }

  log('teams_listed', { requestId, mobile, count: results.length });
  return respond(200, { success: true, teams: results });
}

exports.handler = async (event) => {
  const path = event.path || event.requestContext?.http?.path || '';
  const method = (event.httpMethod || event.requestContext?.http?.method || '').toUpperCase();
  const pathParams = event.pathParameters || {};

  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    if (path === '/antakshari/team' && method === 'POST') {
      return await handlePostTeam(event);
    }
    if (path === '/antakshari/profile' && method === 'GET') {
      return await handleGetProfile(event);
    }
    if (path === '/antakshari/profile' && method === 'POST') {
      return await handlePostProfile(event);
    }

    const teamMembersMatch = path.match(/^\/antakshari\/team\/([^/]+)\/members$/);
    if (teamMembersMatch && method === 'POST') {
      return await handlePostTeamMembers(event, teamMembersMatch[1]);
    }
    const linkOrderMatch = path.match(/^\/antakshari\/team\/([^/]+)\/link-order$/);
    if (linkOrderMatch && method === 'POST') {
      return await handlePostLinkOrder(event, linkOrderMatch[1]);
    }

    if (path === '/antakshari/users' && method === 'GET') {
      return await handleGetUsers(event);
    }
    if (path === '/antakshari/teams' && method === 'GET') {
      return await handleGetTeams(event);
    }

    return respond(404, { success: false, error: 'Not found' });
  } catch (err) {
    const requestId = getRequestId(event);
    console.error(JSON.stringify({ event: 'antakshari_error', requestId, error: err.message }));
    return respond(500, { success: false, error: 'Internal server error' });
  }
};
