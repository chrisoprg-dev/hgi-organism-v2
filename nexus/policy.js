export const AUTO_ALLOWED = new Set([
  'read',
  'search',
  'reconcile',
  'research',
  'draft',
  'internal_state_write',
  'dependency_check',
  'evidence_package',
  'classify',
  'deduplicate',
]);

export const RESERVED = new Set([
  'send_external_message',
  'legal_filing',
  'government_filing',
  'insurance_submission',
  'move_money',
  'pay_invoice',
  'trade',
  'accept_offer',
  'reject_offer',
  'publish_external',
  'delete_material_record',
  'production_schema_change',
  'production_infrastructure_change',
  'grant_oauth_scope',
  'grant_credential',
  'alter_legal_rights',
]);

export function authorize(actionType, config) {
  if (!config?.enabled) {
    return { allowed: false, reason: 'NEXUS_DISABLED' };
  }

  if (RESERVED.has(actionType)) {
    return { allowed: false, reason: 'NEEDS_USER' };
  }

  if (AUTO_ALLOWED.has(actionType)) {
    return { allowed: true, reason: config.shadow ? 'SHADOW_ALLOWED' : 'AUTO_ALLOWED' };
  }

  return { allowed: false, reason: 'UNKNOWN_ACTION_FAIL_CLOSED' };
}
