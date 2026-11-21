'use strict';
// Single source of truth for who may do what. Routes ask for a permission, never a role list.
const ROLES = ['bishop', 'admin', 'pastor', 'department_leader', 'kdf_coordinator'];
const PRIVILEGED = ['bishop', 'admin'];

const PERMISSIONS = {
  'profiles.read': PRIVILEGED,
  'profiles.manage': PRIVILEGED,
  'audit.read': PRIVILEGED,
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
  'corrections.decide': PRIVILEGED,
  'programmes.manage': ['bishop', 'admin', 'pastor'],
  'checkin.control': ['bishop', 'admin', 'pastor'],
  'training.mark': ['bishop', 'admin', 'pastor'],
  'messages.send': PRIVILEGED,
  'sms.config': PRIVILEGED,
  'assignments.manage': PRIVILEGED,
  'exports.run': PRIVILEGED,
  'reports.org': PRIVILEGED,
};

const can = (role, permission) => (PERMISSIONS[permission] || []).includes(role);

// Who may create / change / deactivate whom. Only the Bishop manages privileged accounts.
function canManageRole(actorRole, targetRole) {
  if (actorRole === 'bishop') return true;
  if (actorRole === 'admin') return !PRIVILEGED.includes(targetRole);
  return false;
}

module.exports = { ROLES, PRIVILEGED, PERMISSIONS, can, canManageRole };
