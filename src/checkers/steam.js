import { safeFetch, accountAgeDays, log } from '../utils.js';

const STEAM_KEY = process.env.STEAM_API_KEY;

/**
 * Check Steam account by SteamID64 or vanity URL
 * Account data should contain: { steam_id: "76561198..." }
 * Also checks: Логин field, profile URL, or vanity name
 */
export async function checkSteam(account, config) {
  const accountData = account.data || {};

  // Try to find Steam ID from various fields
  let steamId = accountData.steam_id || accountData.steamid || accountData.steamId;

  if (!STEAM_KEY) {
    return { _note: 'steam_api_key_not_configured', vac_ban: false, trade_ban: false };
  }

  // If no direct steam_id, try to resolve from vanity URL or profile link
  if (!steamId) {
    // Check if any field contains a Steam profile URL
    const allValues = Object.values(accountData).map(v => String(v));
    for (const val of allValues) {
      // Match steamcommunity.com/profiles/NUMBERS
      const profileMatch = val.match(/steamcommunity\.com\/profiles\/(\d+)/);
      if (profileMatch) {
        steamId = profileMatch[1];
        break;
      }
      // Match steamcommunity.com/id/VANITY
      const vanityMatch = val.match(/steamcommunity\.com\/id\/([^\/\s]+)/);
      if (vanityMatch) {
        steamId = await resolveVanityUrl(vanityMatch[1]);
        break;
      }
      // Match raw SteamID64 (17 digits starting with 7656)
      const rawIdMatch = val.match(/\b(7656\d{13})\b/);
      if (rawIdMatch) {
        steamId = rawIdMatch[1];
        break;
      }
    }
  }

  // Still no steamId — try to resolve vanity from steam_id field (user might put username)
  if (!steamId && accountData.steam_id) {
    steamId = await resolveVanityUrl(accountData.steam_id);
  }

  if (!steamId) {
    log('warn', '  No Steam ID found in account data');
    return { _note: 'no_steam_id_found', vac_ban: false, trade_ban: false };
  }

  log('info', `  Steam ID resolved: ${steamId}`);

  const result = { steam_id: steamId };

  // 1. Player bans (VAC, Trade, Community, Game)
  try {
    const bans = await safeFetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=${STEAM_KEY}&steamids=${steamId}`
    );
    const player = bans?.players?.[0];
    if (player) {
      result.vac_ban = player.VACBanned || false;
      result.vac_bans_count = player.NumberOfVACBans || 0;
      result.trade_ban = player.EconomyBan !== 'none';
      result.community_ban = player.CommunityBanned || false;
      result.game_ban = player.NumberOfGameBans > 0;
      result.game_bans_count = player.NumberOfGameBans || 0;
      result.days_since_last_ban = player.DaysSinceLastBan || 0;
    }
  } catch (err) {
    log('warn', `  Steam bans API error: ${err.message}`);
    result._bans_error = err.message;
  }

  // 2. Player summary (level, last online, country, profile)
  try {
    const summary = await safeFetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_KEY}&steamids=${steamId}`
    );
    const player = summary?.response?.players?.[0];
    if (player) {
      result.persona_name = player.personaname;
      result.profile_url = player.profileurl;
      result.avatar_url = player.avatarfull;
      result.last_online = player.lastlogoff
        ? new Date(player.lastlogoff * 1000).toISOString()
        : null;
      result.region = player.loccountrycode || null;
      result.profile_state = player.communityvisibilitystate;
      result.account_created = player.timecreated
        ? new Date(player.timecreated * 1000).toISOString()
        : null;
      result.account_age_days = accountAgeDays(player.timecreated);
    }
  } catch (err) {
    log('warn', `  Steam summary API error: ${err.message}`);
  }

  // 3. Steam level
  try {
    const levelData = await safeFetch(
      `https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=${STEAM_KEY}&steamid=${steamId}`
    );
    result.level = levelData?.response?.player_level || 0;
  } catch (err) {
    log('warn', `  Steam level API error: ${err.message}`);
  }

  // 4. Owned games count + total hours
  try {
    const games = await safeFetch(
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${STEAM_KEY}&steamid=${steamId}&include_played_free_games=1`
    );
    const resp = games?.response;
    if (resp) {
      result.games_count = resp.game_count || 0;
      const totalMinutes = (resp.games || []).reduce(
        (sum, g) => sum + (g.playtime_forever || 0), 0
      );
      result.hours_played = Math.round(totalMinutes / 60);
    }
  } catch (err) {
    log('warn', `  Steam games API error: ${err.message}`);
  }

  // 5. CS2/CSGO specific hours
  try {
    const recentGames = await safeFetch(
      `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=${STEAM_KEY}&steamid=${steamId}&count=10`
    );
    const cs2 = recentGames?.response?.games?.find(
      g => g.appid === 730
    );
    if (cs2) {
      result.cs2_hours_2weeks = Math.round((cs2.playtime_2weeks || 0) / 60);
      result.cs2_hours_total = Math.round((cs2.playtime_forever || 0) / 60);
    }
  } catch (err) {
    // Not critical
  }

  return result;
}

// ─── Resolve vanity URL to SteamID64 ───────────────────────────────────────
async function resolveVanityUrl(vanityName) {
  if (!STEAM_KEY || !vanityName) return null;

  // If it's already a SteamID64
  if (/^\d{17}$/.test(vanityName)) return vanityName;

  try {
    const data = await safeFetch(
      `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${STEAM_KEY}&vanityurl=${encodeURIComponent(vanityName)}`
    );
    if (data?.response?.success === 1) {
      return data.response.steamid;
    }
  } catch (err) {
    log('warn', `  Vanity URL resolve error: ${err.message}`);
  }

  return null;
}
