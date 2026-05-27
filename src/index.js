import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import cron from 'node-cron';
import { validateAccount } from './validator.js';
import { log } from './utils.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '10');
const CHECK_INTERVAL = process.env.CHECK_INTERVAL_MINUTES || '30';

// ─── Main validation loop ──────────────────────────────────────────────────
async function runValidationBatch() {
  log('info', '🔄 Starting validation batch...');

  try {
    // 1. Get accounts that need checking:
    //    - Never checked (validation_status = 'unchecked')
    //    - Recheck pending (from purchase trigger)
    //    - Stale (last_validated_at older than check_interval)
    const cutoff = new Date(Date.now() - parseInt(CHECK_INTERVAL) * 60 * 1000).toISOString();

    const { data: accounts, error } = await supabase
      .from('accounts')
      .select('id, category, title, data, seller_id, validation_status')
      .or(`validation_status.eq.unchecked,validation_status.eq.recheck_pending,last_validated_at.lt.${cutoff},last_validated_at.is.null`)
      .eq('status', 'active')
      .order('last_validated_at', { ascending: true, nullsFirst: true })
      .limit(BATCH_SIZE);

    if (error) {
      log('error', 'Failed to fetch accounts:', error.message);
      return;
    }

    if (!accounts || accounts.length === 0) {
      log('info', '✅ No accounts to validate');
      return;
    }

    log('info', `📦 Found ${accounts.length} accounts to validate`);

    // 2. Load validation configs
    const { data: configs } = await supabase
      .from('validation_configs')
      .select('*')
      .eq('enabled', true);

    const configMap = {};
    (configs || []).forEach(c => { configMap[c.category] = c; });

    // 3. Validate each account
    for (const account of accounts) {
      try {
        await processAccount(account, configMap);
      } catch (err) {
        log('error', `Failed to validate account ${account.id}:`, err.message);

        // Mark as error
        await supabase.from('accounts').update({
          validation_status: 'error',
          last_validated_at: new Date().toISOString(),
        }).eq('id', account.id);
      }
    }

    log('info', `✅ Batch complete: ${accounts.length} accounts processed`);
  } catch (err) {
    log('error', 'Batch failed:', err.message);
  }
}

// ─── Process single account ────────────────────────────────────────────────
async function processAccount(account, configMap) {
  const startTime = Date.now();
  const config = configMap[account.category];

  if (!config) {
    log('warn', `No config for category "${account.category}", skipping ${account.id}`);
    await supabase.from('accounts').update({
      validation_status: 'no_config',
      last_validated_at: new Date().toISOString(),
    }).eq('id', account.id);
    return;
  }

  const isPurchaseRecheck = account.validation_status === 'recheck_pending';

  log('info', `🔍 Validating [${account.category}] "${account.title}" (${isPurchaseRecheck ? 'PURCHASE RECHECK' : 'routine'})...`);

  // 1. Get previous validation (if exists)
  const { data: prevValidation } = await supabase
    .from('account_validations')
    .select('*')
    .eq('account_id', account.id)
    .maybeSingle();

  // 2. Run the actual validation
  const result = await validateAccount(account, config);
  const duration = Date.now() - startTime;

  // 3. Compare with previous data
  const changes = [];
  let severity = 'none';

  if (prevValidation && prevValidation.checked_data) {
    const prev = prevValidation.checked_data;
    const curr = result.checked_data;

    const fieldsToCheck = JSON.parse(config.fields_to_check || '[]');

    for (const field of fieldsToCheck) {
      const oldVal = prev[field];
      const newVal = curr[field];

      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        const change = { field, old: oldVal, new: newVal };

        // Determine severity
        if (['vac_ban', 'trade_ban', 'community_ban', 'game_ban', 'ban_status'].includes(field)) {
          if (newVal === true) {
            change.severity = 'critical';
            severity = 'critical';
          } else {
            change.severity = 'info';
          }
        } else if (['level', 'hours_played', 'games_count'].includes(field)) {
          change.severity = 'warning';
          if (severity !== 'critical') severity = 'warning';
        } else {
          change.severity = 'info';
          if (severity === 'none') severity = 'info';
        }

        changes.push(change);
      }
    }
  }

  const hasChanges = changes.length > 0;
  const status = result.error
    ? 'error'
    : hasChanges
      ? 'changed'
      : 'valid';

  // 4. Upsert validation snapshot
  await supabase.from('account_validations').upsert({
    account_id: account.id,
    category: account.category,
    status,
    checked_data: result.checked_data,
    vac_ban: result.checked_data?.vac_ban || false,
    trade_ban: result.checked_data?.trade_ban || false,
    community_ban: result.checked_data?.community_ban || false,
    game_ban: result.checked_data?.game_ban || false,
    level: result.checked_data?.level,
    hours_played: result.checked_data?.hours_played,
    games_count: result.checked_data?.games_count,
    inventory_value: result.checked_data?.inventory_value,
    account_age_days: result.checked_data?.account_age_days,
    last_online: result.checked_data?.last_online,
    region: result.checked_data?.region,
    subscription_active: result.checked_data?.subscription_active,
    subscription_expires_at: result.checked_data?.subscription_expires,
    checked_at: new Date().toISOString(),
    check_duration_ms: duration,
    error_message: result.error || null,
  }, { onConflict: 'account_id' });

  // 5. Write history
  await supabase.from('validation_history').insert({
    account_id: account.id,
    trigger_type: isPurchaseRecheck ? 'purchase' : 'cron',
    status,
    previous_data: prevValidation?.checked_data || null,
    current_data: result.checked_data,
    changes: changes.length > 0 ? changes : [],
    has_changes: hasChanges,
    changes_count: changes.length,
    changes_severity: severity,
    check_duration_ms: duration,
    error_message: result.error || null,
  });

  // 6. Update account
  await supabase.from('accounts').update({
    validation_status: status,
    last_validated_at: new Date().toISOString(),
    validation_changes: hasChanges ? changes : [],
    validation_severity: severity,
  }).eq('id', account.id);

  // 7. If purchase recheck found changes → notify buyer
  if (isPurchaseRecheck && hasChanges) {
    await notifyBuyerAboutChanges(account, changes, severity);
  }

  log(
    hasChanges ? 'warn' : 'info',
    `  ${hasChanges ? '⚠️' : '✅'} ${status} | ${changes.length} changes | ${duration}ms${severity === 'critical' ? ' ⛔ CRITICAL' : ''}`
  );
}

// ─── Notify buyer about changes ────────────────────────────────────────────
async function notifyBuyerAboutChanges(account, changes, severity) {
  // Find the buyer (latest order)
  const { data: order } = await supabase
    .from('orders')
    .select('buyer_id')
    .eq('account_id', account.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!order?.buyer_id) return;

  const criticalChanges = changes.filter(c => c.severity === 'critical');
  const title = severity === 'critical'
    ? '⛔ Критические изменения в аккаунте!'
    : '⚠️ Аккаунт изменился после проверки';

  const text = criticalChanges.length > 0
    ? `Обнаружены баны: ${criticalChanges.map(c => c.field).join(', ')}`
    : `Изменено ${changes.length} параметров в "${account.title}"`;

  await supabase.from('notifications').insert({
    user_id: order.buyer_id,
    type: 'validation_alert',
    title,
    text,
    link_type: 'account',
    link_id: account.id,
    is_read: false,
    icon: severity === 'critical' ? '⛔' : '⚠️',
  });

  log('info', `  📨 Notified buyer ${order.buyer_id.slice(0, 8)} about changes`);
}

// ─── Listen for realtime purchase events ───────────────────────────────────
function startRealtimeListener() {
  log('info', '📡 Starting realtime listener for purchase rechecks...');

  supabase
    .channel('validation_purchases')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'accounts',
        filter: 'validation_status=eq.recheck_pending',
      },
      async (payload) => {
        log('info', `🛒 Purchase recheck triggered for account ${payload.new.id}`);
        const { data: configs } = await supabase.from('validation_configs').select('*').eq('enabled', true);
        const configMap = {};
        (configs || []).forEach(c => { configMap[c.category] = c; });
        await processAccount(payload.new, configMap);
      }
    )
    .subscribe();
}

// ─── Start ─────────────────────────────────────────────────────────────────
async function main() {
  log('info', '🌙 Night Store Validator Bot starting...');
  log('info', `📋 Batch size: ${BATCH_SIZE}`);
  log('info', `⏱  Check interval: ${CHECK_INTERVAL} minutes`);

  // Run first batch immediately
  await runValidationBatch();

  // Start cron job
  cron.schedule(`*/${CHECK_INTERVAL} * * * *`, runValidationBatch);
  log('info', `⏰ Cron scheduled: every ${CHECK_INTERVAL} minutes`);

  // Start realtime listener for immediate purchase rechecks
  startRealtimeListener();

  log('info', '🚀 Bot is running!');
}

main().catch(err => {
  log('error', 'Fatal error:', err);
  process.exit(1);
});
