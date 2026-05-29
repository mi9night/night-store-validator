import { log } from '../utils.js';
import { createConnection } from 'net';
import { connect as tlsConnect } from 'tls';

// ─── IMAP server configs by domain ─────────────────────────────────────────
const IMAP_SERVERS = {
  // Google
  'gmail.com':        { host: 'imap.gmail.com',         port: 993, tls: true },
  'googlemail.com':   { host: 'imap.gmail.com',         port: 993, tls: true },

  // Yandex
  'yandex.ru':        { host: 'imap.yandex.ru',         port: 993, tls: true },
  'yandex.com':       { host: 'imap.yandex.com',        port: 993, tls: true },
  'ya.ru':            { host: 'imap.yandex.ru',         port: 993, tls: true },

  // Mail.ru
  'mail.ru':          { host: 'imap.mail.ru',           port: 993, tls: true },
  'inbox.ru':         { host: 'imap.mail.ru',           port: 993, tls: true },
  'list.ru':          { host: 'imap.mail.ru',           port: 993, tls: true },
  'bk.ru':            { host: 'imap.mail.ru',           port: 993, tls: true },
  'internet.ru':      { host: 'imap.mail.ru',           port: 993, tls: true },

  // Microsoft
  'outlook.com':      { host: 'outlook.office365.com',  port: 993, tls: true },
  'hotmail.com':      { host: 'outlook.office365.com',  port: 993, tls: true },
  'live.com':         { host: 'outlook.office365.com',  port: 993, tls: true },

  // Rambler
  'rambler.ru':       { host: 'imap.rambler.ru',        port: 993, tls: true },

  // iCloud
  'icloud.com':       { host: 'imap.mail.me.com',       port: 993, tls: true },
  'me.com':           { host: 'imap.mail.me.com',       port: 993, tls: true },

  // ProtonMail (no IMAP without bridge)
  'protonmail.com':   null,
  'proton.me':        null,

  // Yahoo
  'yahoo.com':        { host: 'imap.mail.yahoo.com',    port: 993, tls: true },
};

/**
 * Get IMAP server config by email domain
 */
function getImapServer(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;

  if (IMAP_SERVERS[domain] !== undefined) {
    return IMAP_SERVERS[domain]; // null for unsupported (ProtonMail etc.)
  }

  // Generic fallback: try imap.domain.com
  return { host: `imap.${domain}`, port: 993, tls: true, fallback: true };
}

/**
 * Try to authenticate via IMAP (minimal raw IMAP check)
 * Returns: { success, error?, server? }
 */
function imapLogin(host, port, email, password, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ success: false, error: 'timeout' });
      try { socket.destroy(); } catch {}
    }, timeoutMs);

    let socket;
    let buffer = '';
    let phase = 'greeting'; // greeting → login → done

    const onData = (data) => {
      buffer += data.toString();
      const lines = buffer.split('\r\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (phase === 'greeting' && line.startsWith('* OK')) {
          phase = 'login';
          // Send LOGIN command
          const loginCmd = `A001 LOGIN "${email.replace(/"/g, '\\"')}" "${password.replace(/"/g, '\\"')}"\r\n`;
          socket.write(loginCmd);
        } else if (phase === 'login') {
          if (line.startsWith('A001 OK')) {
            clearTimeout(timer);
            // Success! Logout gracefully
            socket.write('A002 LOGOUT\r\n');
            setTimeout(() => { try { socket.destroy(); } catch {} }, 500);
            resolve({ success: true, server: host });
          } else if (line.startsWith('A001 NO') || line.startsWith('A001 BAD')) {
            clearTimeout(timer);
            try { socket.destroy(); } catch {}
            const reason = line.replace(/^A001 (NO|BAD)\s*/i, '');
            resolve({ success: false, error: reason || 'auth_failed' });
          }
        }
      }
    };

    const onError = (err) => {
      clearTimeout(timer);
      resolve({ success: false, error: err.message || 'connection_error' });
    };

    try {
      socket = tlsConnect({ host, port, rejectUnauthorized: false }, () => {
        // Connected via TLS
      });
      socket.on('data', onData);
      socket.on('error', onError);
      socket.on('close', () => {
        clearTimeout(timer);
      });
    } catch (err) {
      clearTimeout(timer);
      resolve({ success: false, error: err.message || 'connect_failed' });
    }
  });
}

/**
 * Check email access via IMAP
 * @param {string} email - email address
 * @param {string} password - email password
 * @returns {{ email_verified, email_server, email_error? }}
 */
export async function checkEmailAccess(email, password) {
  if (!email || !password) {
    return {
      email_verified: false,
      email_error: 'no_credentials',
    };
  }

  const serverConfig = getImapServer(email);

  if (serverConfig === null) {
    return {
      email_verified: false,
      email_error: 'unsupported_provider',
      email_note: 'ProtonMail и подобные не поддерживают IMAP без Bridge',
    };
  }

  if (!serverConfig) {
    return {
      email_verified: false,
      email_error: 'unknown_domain',
    };
  }

  log('info', `  📧 Checking email: ${email} via ${serverConfig.host}:${serverConfig.port}`);

  const result = await imapLogin(
    serverConfig.host,
    serverConfig.port,
    email,
    password,
    12000
  );

  if (result.success) {
    log('info', `  ✅ Email verified: ${email}`);
    return {
      email_verified: true,
      email_server: serverConfig.host,
      email_checked_at: new Date().toISOString(),
    };
  } else {
    log('warn', `  ❌ Email check failed: ${email} — ${result.error}`);
    return {
      email_verified: false,
      email_error: result.error,
      email_server: serverConfig.host,
      email_checked_at: new Date().toISOString(),
    };
  }
}
