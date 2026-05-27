import { safeFetch, accountAgeDays, log } from '../utils.js';

const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;

/**
 * Check Discord account
 * Account data should contain: { discord_id: "123456789" } or { discord_token: "..." }
 */
export async function checkDiscord(account, config) {
  const accountData = account.data || {};
  const discordId = accountData.discord_id || accountData.discordId;
  const discordToken = accountData.discord_token;

  const result = {};

  // Method 1: Check via Bot API (if we have bot token + user ID)
  if (DISCORD_TOKEN && discordId) {
    try {
      const user = await safeFetch(
        `https://discord.com/api/v10/users/${discordId}`,
        { headers: { Authorization: `Bot ${DISCORD_TOKEN}` } }
      );

      if (user) {
        result.username = user.username;
        result.discriminator = user.discriminator;
        result.global_name = user.global_name;
        result.avatar_url = user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
          : null;
        result.banner = !!user.banner;

        // Account age from snowflake ID
        const snowflake = BigInt(user.id);
        const timestamp = Number(snowflake >> 22n) + 1420070400000;
        result.account_created = new Date(timestamp).toISOString();
        result.account_age_days = accountAgeDays(timestamp);

        // Badges
        const flags = user.public_flags || 0;
        result.badges = [];
        if (flags & (1 << 0)) result.badges.push('Discord Employee');
        if (flags & (1 << 1)) result.badges.push('Partnered Server Owner');
        if (flags & (1 << 2)) result.badges.push('HypeSquad Events');
        if (flags & (1 << 6)) result.badges.push('HypeSquad Bravery');
        if (flags & (1 << 7)) result.badges.push('HypeSquad Brilliance');
        if (flags & (1 << 8)) result.badges.push('HypeSquad Balance');
        if (flags & (1 << 9)) result.badges.push('Early Supporter');
        if (flags & (1 << 14)) result.badges.push('Bug Hunter');
        if (flags & (1 << 17)) result.badges.push('Verified Bot Developer');
        if (flags & (1 << 22)) result.badges.push('Active Developer');

        // Nitro: can't check directly via bot API, but premium_type in user object
        result.nitro_status = (user.premium_type || 0) > 0;
        result.ban_status = false; // If we can fetch the user, they're not banned from Discord
      }
    } catch (err) {
      if (err.message.includes('404')) {
        result.ban_status = 'account_not_found';
      } else if (err.message.includes('403')) {
        result.ban_status = 'unknown'; // Bot doesn't have access
      } else {
        log('warn', `  Discord API error: ${err.message}`);
        result._error = err.message;
      }
    }
  }

  // Method 2: Check via user token (if provided — risky, use carefully)
  if (discordToken && !result.username) {
    try {
      const me = await safeFetch(
        'https://discord.com/api/v10/users/@me',
        { headers: { Authorization: discordToken } }
      );

      if (me) {
        result.username = me.username;
        result.email_verified = me.verified || false;
        result.nitro_status = (me.premium_type || 0) > 0;
        result.ban_status = false;
      }
    } catch (err) {
      if (err.message.includes('401')) {
        result.ban_status = 'token_invalid';
      } else {
        result._error = err.message;
      }
    }
  }

  if (!discordId && !discordToken) {
    result._note = 'no_discord_credentials';
    result.ban_status = 'unknown';
  }

  return result;
}
