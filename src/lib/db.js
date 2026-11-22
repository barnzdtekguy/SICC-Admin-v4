import { apiRequest, mutationResult } from './api';

function queryString(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  });
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
}

// The server now records every action itself (tamper-evident). Kept as a no-op so older call sites still work.
export async function addLog() { return { ignored: true }; }

export async function getLogs(limit = 50) {
  return apiRequest(`/activity-logs${queryString({ limit })}`);
}

export async function getProfiles() {
  return apiRequest('/profiles');
}

export async function createProfile(profile, password) {
  return mutationResult('/profiles', { method: 'POST', body: { ...profile, password } });
}

// Accounts are deactivated, never erased, so history stays attributable.
export async function deleteProfile(id) {
  const { error } = await mutationResult(`/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { error };
}

export const updateProfile = (id, body) => mutationResult(`/profiles/${encodeURIComponent(id)}`, { method: 'PATCH', body });
export const resetProfilePassword = id => mutationResult(`/profiles/${encodeURIComponent(id)}/reset-password`, { method: 'POST', body: {} });
export const resetProfileMfa = id => mutationResult(`/profiles/${encodeURIComponent(id)}/reset-mfa`, { method: 'POST', body: {} });
export const unlockProfile = id => mutationResult(`/profiles/${encodeURIComponent(id)}/unlock`, { method: 'POST', body: {} });

export async function getMembers(filters = {}) {
  return apiRequest(`/members${queryString({
    registeredBy: filters.registeredBy,
    kdfArea: filters.kdfArea,
    department: filters.department,
  })}`);
}

export async function createMember(member) {
  return mutationResult('/members', { method: 'POST', body: member });
}

export async function getFollowUps(filters = {}) {
  return apiRequest(`/follow-ups${queryString({
    pastorId: filters.pastorId,
    kdfArea: filters.kdfArea,
  })}`);
}

export async function createFollowUp(followUp) {
  return mutationResult('/follow-ups', { method: 'POST', body: followUp });
}

export async function getAttendance() {
  return apiRequest('/attendance');
}

// queueable: saved on the phone and sent later if there is no signal.
export async function createAttendance(record) {
  return mutationResult('/attendance', { method: 'POST', body: record, queueable: true });
}
export const updateAttendance = (id, body) => mutationResult(`/attendance/${encodeURIComponent(id)}`, { method: 'PATCH', body });
export const verifyAttendance = id => mutationResult(`/attendance/${encodeURIComponent(id)}/verify`, { method: 'POST', body: {} });

export async function getAssignments() {
  return apiRequest('/assignments');
}

export async function createAssignment(assignment) {
  return mutationResult('/assignments', { method: 'POST', body: assignment });
}

export async function updateAssignment(id, updates) {
  return mutationResult(`/assignments/${encodeURIComponent(id)}`, { method: 'PATCH', body: updates });
}

export async function deleteAssignment(id) {
  const { error } = await mutationResult(`/assignments/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { error };
}

export async function getSMSConfig() {
  return apiRequest('/sms-config');
}

export async function saveSMSConfig(config) {
  const { data, error } = await mutationResult('/sms-config', { method: 'PUT', body: config });
  return { data, error };
}
export const sendSms = (audience, message) => mutationResult('/messages/sms', { method: 'POST', body: { audience, message } });
export const getMessageStatus = () => apiRequest('/messages/status');

export async function getProgrammes(publicCheckIn = false) {
  return apiRequest(`/programmes${queryString({ public: publicCheckIn ? '1' : '' })}`);
}

export async function createProgramme(programme) {
  return mutationResult('/programmes', { method: 'POST', body: programme });
}

export async function getProgrammeRecords(filters = {}) {
  return apiRequest(`/programme-attendance-records${queryString({
    programmeId: filters.programmeId,
    date: filters.date,
  })}`);
}

export async function saveProgrammeRecord(record) {
  return mutationResult('/programme-attendance-records', { method: 'POST', body: record, queueable: true });
}

export async function savePublicCheckIn(record) {
  return mutationResult('/public/attendance/check-in', { method: 'POST', body: record });
}

// ---- v4 additions -------------------------------------------------------------
export const getCheckInSession = programmeId => apiRequest(`/checkin/session${queryString({ programme_id: programmeId })}`);
export const updateProgramme = (id, body) => mutationResult(`/programmes/${encodeURIComponent(id)}`, { method: 'PATCH', body });
export const getCorrections = (status) => apiRequest(`/corrections${queryString({ status })}`);
export const requestCorrection = body => mutationResult('/corrections', { method: 'POST', body });
export const approveCorrection = (id, note) => mutationResult(`/corrections/${encodeURIComponent(id)}/approve`, { method: 'POST', body: { note } });
export const rejectCorrection = (id, note) => mutationResult(`/corrections/${encodeURIComponent(id)}/reject`, { method: 'POST', body: { note } });
export const getAudit = params => apiRequest(`/audit${queryString(params)}`);
export const verifyAuditChain = () => apiRequest('/audit/verify');
export const getBrief = () => apiRequest('/brief');
export const getReportOverview = params => apiRequest(`/reports/overview${queryString(params)}`);
export const getNotifications = () => apiRequest('/notifications');
export const markNotificationRead = id => apiRequest(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', body: {} });
export const searchEverything = q => apiRequest(`/search${queryString({ q })}`);
export const getMemberTimeline = id => apiRequest(`/members/${encodeURIComponent(id)}/timeline`);
export const updateMember = (id, body) => mutationResult(`/members/${encodeURIComponent(id)}`, { method: 'PATCH', body });
export const deleteMember = (id, reason) => mutationResult(`/members/${encodeURIComponent(id)}`, { method: 'DELETE', body: { reason } });
export const updateFollowUp = (id, body) => mutationResult(`/follow-ups/${encodeURIComponent(id)}`, { method: 'PATCH', body });
export const getDepartments = () => apiRequest('/meta/departments');
export const getKdfAreas = () => apiRequest('/meta/kdf-areas');
export const submitReport = body => mutationResult('/reports/submit', { method: 'POST', body: { body } });
export const getSubmittedReports = () => apiRequest('/reports/submitted');
