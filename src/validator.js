import { checkSteam } from './checkers/steam.js';
import { checkDiscord } from './checkers/discord.js';
import { checkMinecraft } from './checkers/minecraft.js';
import { checkRoblox } from './checkers/roblox.js';
import { checkTelegram } from './checkers/telegram.js';
import { checkGeneric } from './checkers/generic.js';
import { checkEmailAccess } from './checkers/email.js';
import { log } from './utils.js';

// ─── Router: выбирает нужный чекер по категории ───────────────────────────
const CHECKER_MAP = {
  // Gaming
  steam:     checkSteam,
  epic:      checkGeneric,    // Epic не имеет публичного API — generic
  fortnite:  checkGeneric,
  ea:        checkGeneric,
  ubisoft:   checkGeneric,
  minecraft: checkMinecraft,
  supercell: checkGeneric,
  roblox:    checkRoblox,
  wot:       checkGeneric,
  wr:        checkGeneric,
  rockstar:  checkGeneric,
  mihoyo:    checkGeneric,

  // Social
  discord:   checkDiscord,
  tiktok:    checkGeneric,
  instagram: checkGeneric,
  telegram:  checkTelegram,

  // Services
  ai:        checkGeneric,
  neural:    checkGeneric,
  vpn:       checkGeneric,
};

/**
 * Validate an account using the appropriate checker
 * @param {object} account - { id, category, title, data }
 * @param {object} config  - { api_type, fields_to_check, api_config }
 * @returns {{ checked_data: object, error?: string }}
 */
export async function validateAccount(account, config) {
  const checker = CHECKER_MAP[account.category];

  if (!checker) {
    log('warn', `  No checker for category "${account.category}"`);
    return {
      checked_data: { _note: 'no_checker_available' },
      error: `No checker for category: ${account.category}`,
    };
  }

  try {
    const result = await checker(account, config);

    // Also check emails if provided in account data
    const data = account.data || {};

    // Check original email (Родная почта)
    const origEmail = data['Родная почта'] || data['original_email'];
    const origPass = data['Пароль от почты'] || data['original_email_password'];
    if (origEmail && origPass) {
      const emailResult = await checkEmailAccess(origEmail, origPass);
      result.original_email_verified = emailResult.email_verified;
      result.original_email_error = emailResult.email_error || null;
      result.original_email_server = emailResult.email_server || null;
    }

    // Check temp email (Временная почта)
    const tempEmail = data['Временная почта'] || data['temp_email'];
    const tempPass = data['Пароль от врем. почты'] || data['temp_email_password'];
    if (tempEmail && tempPass) {
      const emailResult = await checkEmailAccess(tempEmail, tempPass);
      result.temp_email_verified = emailResult.email_verified;
      result.temp_email_error = emailResult.email_error || null;
    }

    // Check platform-specific emails (Epic, EA, Ubisoft, Rockstar)
    for (const key of ['epic_email', 'ea_email', 'ubi_email', 'rockstar_email']) {
      const platformEmail = data[key];
      // We don't have passwords for these — just note they exist
      if (platformEmail) {
        result[`${key}_provided`] = true;
      }
    }

    return {
      checked_data: result,
      error: null,
    };
  } catch (err) {
    log('error', `  Checker error [${account.category}]:`, err.message);
    return {
      checked_data: {},
      error: err.message,
    };
  }
}
