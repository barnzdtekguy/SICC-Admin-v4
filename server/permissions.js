'use strict';
// Single source of truth for who may do what. Routes ask for a permission, never a role list.
const CHURCH_ROLES = ['bishop', 'admin', 'pastor', 'department_leader', 'kdf_coordinator'];
const RED_ROLES = ['red_leader', 'red_member'];
const ROLES = [...CHURCH_ROLES, ...RED_ROLES];
const PRIVILEGED = ['bishop', 'admin'];

const PERMISSIONS = {
  'account.self': ROLES,
  'profiles.read': PRIVILEGED,
  'profiles.manage': PRIVILEGED,
  'directory.read': CHURCH_ROLES,
  'member-search.read': CHURCH_ROLES,
  'audit.read': PRIVILEGED,
  'members.read': CHURCH_ROLES,
  'members.read.all': PRIVILEGED,
  'members.write': ['bishop', 'admin', 'pastor'],
  'members.delete': PRIVILEGED,
  'members.anonymize': ['bishop'],
  'followups.read': ['bishop', 'admin', 'pastor', 'kdf_coordinator'],
  'followups.write': ['bishop', 'admin', 'pastor', 'kdf_coordinator'],
  'attendance.read': ['bishop', 'admin', 'department_leader'],
  'attendance.write': ['bishop', 'admin', 'department_leader'],
  'attendance.verify': PRIVILEGED,
  'corrections.request': ['bishop', 'admin', 'pastor', 'department_leader'],
  'corrections.read': CHURCH_ROLES,
  'corrections.decide': PRIVILEGED,
  'programmes.read': CHURCH_ROLES,
  'programmes.manage': ['bishop', 'admin', 'pastor'],
  'checkin.control': ['bishop', 'admin', 'pastor'],
  'training.mark': ['bishop', 'admin', 'pastor'],
  'messages.send': PRIVILEGED,
  'sms.config': PRIVILEGED,
  'assignments.manage': PRIVILEGED,
  'exports.run': PRIVILEGED,
  'reports.org': PRIVILEGED,
  'reports.submit': CHURCH_ROLES,
  'brief.read': CHURCH_ROLES,
  'church-metadata.read': CHURCH_ROLES,
  'activity-logs.legacy': CHURCH_ROLES,
  'notifications.self': ROLES,
  'notifications.read-all': CHURCH_ROLES,
  'push.self': ROLES,
  'red.manage': PRIVILEGED,
  'red.participate': RED_ROLES,
  'red.team.manage': ['red_leader'],
};

const can = (role, permission) => (PERMISSIONS[permission] || []).includes(role);

// Who may create / change / deactivate whom. Only the Bishop manages privileged accounts.
function canManageRole(actorRole, targetRole) {
  if (!CHURCH_ROLES.includes(targetRole)) return false;
  if (actorRole === 'bishop') return true;
  if (actorRole === 'admin') return !PRIVILEGED.includes(targetRole);
  return false;
}

module.exports = { ROLES, CHURCH_ROLES, RED_ROLES, PRIVILEGED, PERMISSIONS, can, canManageRole };
