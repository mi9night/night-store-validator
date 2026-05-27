import { log } from '../utils.js';

/**
 * Generic checker for categories without specific API
 * (Epic, EA, Ubisoft, TikTok, Instagram, VPN, AI, miHoYo, etc.)
 *
 * Returns whatever data the seller provided + marks as "unverifiable"
 * These categories need manual verification or specific API integration.
 *
 * To add a real checker:
 * 1. Create a new file in /checkers/ (e.g., epic.js)
 * 2. Export checkEpic(account, config)
 * 3. Register it in validator.js CHECKER_MAP
 */
export async function checkGeneric(account, config) {
  const accountData = account.data || {};

  const result = {
    _checker: 'generic',
    _note: `No specific API checker for "${account.category}". Using seller-provided data.`,
    _verified_by_api: false,
  };

  // Copy over any data the seller provided
  if (accountData.level != null) result.level = accountData.level;
  if (accountData.hours != null) result.hours_played = accountData.hours;
  if (accountData.games_count != null) result.games_count = accountData.games_count;
  if (accountData.ban_status != null) result.ban_status = accountData.ban_status;
  if (accountData.subscription_active != null) result.subscription_active = accountData.subscription_active;
  if (accountData.subscription_expires != null) result.subscription_expires = accountData.subscription_expires;
  if (accountData.plan_type != null) result.plan_type = accountData.plan_type;
  if (accountData.followers != null) result.followers = accountData.followers;
  if (accountData.verified != null) result.verified = accountData.verified;
  if (accountData.region != null) result.region = accountData.region;

  // For VPN accounts — check expiry
  if (account.category === 'vpn' && accountData.subscription_expires) {
    const expires = new Date(accountData.subscription_expires);
    result.subscription_active = expires > new Date();
    result.days_remaining = Math.max(0, Math.floor((expires.getTime() - Date.now()) / 86400000));
  }

  // For AI/Neural accounts — check expiry
  if (['ai', 'neural'].includes(account.category) && accountData.subscription_expires) {
    const expires = new Date(accountData.subscription_expires);
    result.subscription_active = expires > new Date();
    result.days_remaining = Math.max(0, Math.floor((expires.getTime() - Date.now()) / 86400000));
  }

  log('debug', `  Generic check for [${account.category}]: ${Object.keys(result).length} fields`);

  return result;
}
