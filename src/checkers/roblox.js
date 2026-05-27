import { safeFetch, accountAgeDays, log } from '../utils.js';

/**
 * Check Roblox account by user ID or username
 * Account data: { roblox_id: 123456 } or { roblox_username: "..." }
 */
export async function checkRoblox(account, config) {
  const accountData = account.data || {};
  let userId = accountData.roblox_id || accountData.robloxId;
  const username = accountData.roblox_username || accountData.robloxUsername;

  const result = {};

  // Resolve username to ID if needed
  if (!userId && username) {
    try {
      const res = await safeFetch(
        'https://users.roblox.com/v1/usernames/users',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
        }
      );
      userId = res?.data?.[0]?.id;
    } catch (err) {
      log('warn', `  Roblox username resolve error: ${err.message}`);
    }
  }

  if (!userId) {
    return { _note: 'no_roblox_id', ban_status: 'unknown' };
  }

  // 1. User info
  try {
    const user = await safeFetch(`https://users.roblox.com/v1/users/${userId}`);
    if (user) {
      result.username = user.name;
      result.display_name = user.displayName;
      result.account_created = user.created;
      result.account_age_days = accountAgeDays(user.created);
      result.ban_status = user.isBanned || false;
      result.description = user.description?.slice(0, 200);
    }
  } catch (err) {
    if (err.message.includes('404')) {
      result.ban_status = 'account_not_found';
      return result;
    }
    log('warn', `  Roblox user API error: ${err.message}`);
  }

  // 2. Friends count
  try {
    const friends = await safeFetch(
      `https://friends.roblox.com/v1/users/${userId}/friends/count`
    );
    result.friends_count = friends?.count || 0;
  } catch (err) { /* not critical */ }

  // 3. Followers count
  try {
    const followers = await safeFetch(
      `https://friends.roblox.com/v1/users/${userId}/followers/count`
    );
    result.followers_count = followers?.count || 0;
  } catch (err) { /* not critical */ }

  // 4. Avatar thumbnail
  try {
    const avatar = await safeFetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`
    );
    result.avatar_url = avatar?.data?.[0]?.imageUrl || null;
  } catch (err) { /* not critical */ }

  return result;
}
