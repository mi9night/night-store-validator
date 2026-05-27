import { safeFetch, log } from '../utils.js';

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

/**
 * Check Telegram account/channel
 * Account data: { telegram_username: "@channel" } or { telegram_chat_id: -100123 }
 *
 * Note: Telegram Bot API can only check public info about
 * channels/groups the bot has access to, or users who messaged the bot.
 */
export async function checkTelegram(account, config) {
  const accountData = account.data || {};
  const username = accountData.telegram_username || accountData.tg_username;
  const chatId = accountData.telegram_chat_id || accountData.tg_chat_id;

  const result = {};

  if (!TG_TOKEN) {
    return { _note: 'telegram_bot_token_not_configured' };
  }

  const target = chatId || (username?.startsWith('@') ? username : `@${username}`);
  if (!target) {
    return { _note: 'no_telegram_identifier' };
  }

  // getChat — works for public channels/groups and users who messaged the bot
  try {
    const chat = await safeFetch(
      `https://api.telegram.org/bot${TG_TOKEN}/getChat?chat_id=${encodeURIComponent(target)}`
    );

    if (chat?.ok && chat.result) {
      const c = chat.result;
      result.type = c.type; // 'private', 'group', 'supergroup', 'channel'
      result.title = c.title || null;
      result.username = c.username || null;
      result.first_name = c.first_name || null;
      result.phone_verified = true; // If exists in TG, phone is verified
      result.premium = c.has_premium_subscription || false;
      result.restrictions = [];

      // For channels/groups
      if (c.type === 'channel' || c.type === 'supergroup') {
        // Get member count
        try {
          const count = await safeFetch(
            `https://api.telegram.org/bot${TG_TOKEN}/getChatMemberCount?chat_id=${encodeURIComponent(target)}`
          );
          result.members_count = count?.result || 0;
        } catch (err) { /* not critical */ }
      }

      result.account_active = true;
    } else {
      result.account_active = false;
      result.restrictions = ['not_found_or_private'];
    }
  } catch (err) {
    if (err.message.includes('400') || err.message.includes('chat not found')) {
      result.account_active = false;
      result.restrictions = ['not_found'];
    } else {
      log('warn', `  Telegram API error: ${err.message}`);
      result._error = err.message;
    }
  }

  return result;
}
