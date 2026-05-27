import { checkSteam } from './checkers/steam.js';
import { checkDiscord } from './checkers/discord.js';
import { checkMinecraft } from './checkers/minecraft.js';
import { checkRoblox } from './checkers/roblox.js';
import { checkTelegram } from './checkers/telegram.js';
import { checkGeneric } from './checkers/generic.js';
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
