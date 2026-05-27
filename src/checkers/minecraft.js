import { safeFetch, log } from '../utils.js';

/**
 * Check Minecraft account by username
 * Account data should contain: { minecraft_username: "Steve" }
 */
export async function checkMinecraft(account, config) {
  const accountData = account.data || {};
  const username = accountData.minecraft_username || accountData.username || accountData.login;

  if (!username) {
    return { _note: 'no_minecraft_username', ban_status: false };
  }

  const result = {};

  // 1. Get UUID from username (Mojang API — free, no key needed)
  try {
    const profile = await safeFetch(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`
    );

    if (profile?.id) {
      result.uuid = profile.id;
      result.uuid_valid = true;
      result.current_name = profile.name;

      // 2. Get skin/cape
      try {
        const sessionProfile = await safeFetch(
          `https://sessionserver.mojang.com/session/minecraft/profile/${profile.id}`
        );

        if (sessionProfile?.properties) {
          const textures = sessionProfile.properties.find(p => p.name === 'textures');
          if (textures) {
            const decoded = JSON.parse(
              Buffer.from(textures.value, 'base64').toString('utf-8')
            );
            result.skin_url = decoded?.textures?.SKIN?.url || null;
            result.cape = !!decoded?.textures?.CAPE;
          }
        }
      } catch (err) {
        log('warn', `  Minecraft session API error: ${err.message}`);
      }

      // 3. Name history (deprecated but try)
      result.name_history = [profile.name]; // Mojang removed name history API

    } else {
      result.uuid_valid = false;
      result.current_name = username;
    }
  } catch (err) {
    if (err.message.includes('404') || err.message.includes('204')) {
      result.uuid_valid = false;
      result.ban_status = 'account_not_found';
    } else {
      log('warn', `  Mojang API error: ${err.message}`);
      result._error = err.message;
    }
  }

  // Ban status — Mojang doesn't have public ban API
  // We can only check if account exists
  result.ban_status = result.uuid_valid === false ? 'unknown' : false;

  return result;
}
