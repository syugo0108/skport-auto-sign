// 環境変数からconfig読み取り
const https = require('https');
const crypto = require('crypto');
let profiles;
try {
  profiles = JSON.parse(process.env.PROFILES || '[]');
} catch (e) {
  console.error('PROFILES is not valid JSON. Fix the PROFILES secret.');
  process.exit(1);
}
const discordWebhook = process.env.DISCORD_WEBHOOK || '';
const myDiscordID = process.env.DISCORD_USER_ID || '';
const discord_notify = !!discordWebhook;

/** The above is the config. Environment variables are used instead of hardcoded values. **/
/** The following is the script code. Please DO NOT modify. **/

const PLATFORM = '3';
const VNAME = '1.0.0';
const APP_CODE = '6eb76d4e13aa36e6';
const CLIENT_HEADERS = {
  'User-Agent': 'Skport/0.7.0 (com.gryphline.skport; build:700089; Android 33; ) Okhttp/5.1.0',
  Origin: 'https://game.skport.com',
  Referer: 'https://game.skport.com/',
};

const URLS = {
  GRANT: 'https://as.gryphline.com/user/oauth2/v2/grant',
  GENERATE_CRED: 'https://zonai.skport.com/web/v1/user/auth/generate_cred_by_code',
  REFRESH_TOKEN: 'https://zonai.skport.com/web/v1/auth/refresh',
  BINDING: 'https://zonai.skport.com/api/v1/game/player/binding',
  ATTENDANCE: 'https://zonai.skport.com/web/v1/game/endfield/attendance',
};

// --- HTTP helpers using https.request (preserves header case) ---

function httpsRequest(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: headers,
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: { message: `解析エラー: ${data.slice(0, 200)}` } });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function httpsPost(url, headers, body) {
  return httpsRequest(url, 'POST', headers, body);
}

function httpsGet(url, headers) {
  return httpsRequest(url, 'GET', headers, null);
}

// Public Actions logs must never contain credentials, tokens, user IDs, or role IDs.
function safeApiMessage(message) {
  if (message === undefined || message === null) return '';
  return String(message).replace(/[A-Za-z0-9_-]{24,}/g, '[masked]').slice(0, 200);
}

function logApiDiagnostic(label, res, details = {}) {
  const data = res && res.data ? res.data : {};
  console.log(`[diagnostic] ${label} status=${res && res.status !== undefined ? res.status : 'unknown'} code=${data.code !== undefined ? data.code : 'unknown'} message="${safeApiMessage(data.message)}"${Object.entries(details).map(([key, value]) => ` ${key}=${value}`).join('')}`);
}

// --- Crypto: sign computation ---

function computeSign(path, body, timestamp, signToken) {
  const headerObj = { platform: PLATFORM, timestamp: timestamp, dId: '', vName: VNAME };
  const headersJson = JSON.stringify(headerObj);
  const signString = path + body + timestamp + headersJson;
  const hmacHex = crypto.createHmac('sha256', signToken).update(signString).digest('hex');
  const md5Hex = crypto.createHash('md5').update(hmacHex).digest('hex');
  return md5Hex;
}

// --- Token normalization ---

function normalizeToken(token) {
  if (!token) return token;
  // Step 1: URL-decode if the token contains percent-encoded chars (e.g. from cookie copy)
  if (token.includes('%')) {
    try { token = decodeURIComponent(token); } catch (e) { /* keep original */ }
  }
  // Step 2: Convert base64url to standard base64 (- → +, _ → /)
  token = token.replace(/-/g, '+').replace(/_/g, '/');
  // Step 3: Add padding if missing
  const pad = token.length % 4;
  if (pad === 2) token += '==';
  else if (pad === 3) token += '=';
  return token;
}

// --- Auth flow ---

async function getOAuthCode(accountToken) {
  accountToken = normalizeToken(accountToken);
  const payload = JSON.stringify({ token: accountToken, appCode: APP_CODE, type: 0 });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
  const res = await httpsPost(URLS.GRANT, headers, payload);
  logApiDiagnostic('grant', res, { codePresent: !!(res.data && res.data.data && res.data.data.code) });
  if (res.data && res.data.status === 0 && res.data.data && res.data.data.code) {
    return res.data.data.code;
  }
  throw new Error(`OAuthコードの取得に失敗しました: ${JSON.stringify(res.data)}`);
}

async function getCred(oauthCode) {
  const payload = JSON.stringify({ kind: 1, code: oauthCode });
  const headers = { ...CLIENT_HEADERS, platform: PLATFORM, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
  const res = await httpsPost(URLS.GENERATE_CRED, headers, payload);
  logApiDiagnostic('generate_cred', res, {
    credPresent: !!(res.data && res.data.data && res.data.data.cred),
    tokenPresent: !!(res.data && res.data.data && res.data.data.token),
  });
  if (res.data && res.data.code === 0 && res.data.data && res.data.data.cred) {
    return { cred: res.data.data.cred, token: res.data.data.token };
  }
  throw new Error(`認証情報の取得に失敗しました: ${JSON.stringify(res.data)}`);
}

async function getSignToken(cred) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = { ...CLIENT_HEADERS, cred: cred, platform: PLATFORM, vName: VNAME, timestamp: timestamp, 'sk-language': 'en' };
  const res = await httpsGet(URLS.REFRESH_TOKEN, headers);
  logApiDiagnostic('refresh', res, { tokenPresent: !!(res.data && res.data.data && res.data.data.token) });
  if (res.data && res.data.code === 0 && res.data.data && res.data.data.token) {
    return res.data.data.token;
  }
  throw new Error(`署名トークンの取得に失敗しました: ${JSON.stringify(res.data)}`);
}

async function getPlayerBinding(cred, signToken) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const path = '/api/v1/game/player/binding';
  const sign = computeSign(path, '', timestamp, signToken);
  const headers = { ...CLIENT_HEADERS, cred: cred, platform: PLATFORM, vName: VNAME, timestamp: timestamp, 'sk-language': 'en', sign: sign };
  const res = await httpsGet(URLS.BINDING, headers);
  const list = res.data && res.data.data && res.data.data.list;
  const endfield = Array.isArray(list) && list.find(app => app && app.appCode === 'endfield');
  const bindingListPresent = !!(endfield && Array.isArray(endfield.bindingList));
  let roleConstructed = false;
  if (bindingListPresent && endfield.bindingList[0]) {
    const binding = endfield.bindingList[0];
    roleConstructed = !!(binding.defaultRole || (binding.roles && binding.roles[0]));
  }
  logApiDiagnostic('binding', res, {
    listPresent: Array.isArray(list),
    endfieldPresent: !!endfield,
    bindingListPresent,
    roleConstructed,
  });
  const apiOk = !!(res.data && res.data.code === 0);
  if (apiOk && res.data.data && res.data.data.list) {
    for (const app of res.data.data.list) {
      if (app.appCode === 'endfield' && app.bindingList) {
        const binding = app.bindingList[0];
        const role = binding.defaultRole || (binding.roles && binding.roles[0]);
        if (role) return { role: `3_${role.roleId}_${role.serverId}`, ok: true };
      }
    }
  }
  return { role: null, ok: apiOk };
}

// --- Main logic ---

async function main() {
  if (!Array.isArray(profiles) || profiles.length === 0) {
    console.error('[result] PROFILES is empty; nothing to do');
    process.exit(1);
  }
  const results = await Promise.all(profiles.map(autoSignFunction));
  const skportResp = results.map(result => result.message).join('\n\n');
  console.log(skportResp);
  if (discord_notify && discordWebhook) {
    await postWebhook(skportResp);
  }
  const failed = results.filter(result => !result.ok);
  if (failed.length > 0) {
    // Exit non-zero so that a broken token or an API error is visible in GitHub Actions.
    console.error(`[result] ${failed.length}/${results.length} profile(s) failed`);
    process.exit(1);
  }
  process.exit(0);
}

function discordPing() {
  return myDiscordID ? `<@${myDiscordID}> ` : '';
}

async function autoSignFunction({
  ACCOUNT_TOKEN,
  language = 'en',
  accountName
}) {
  let response = `${accountName} のチェックイン`;
  let ok = true;
  try {
    // Step 1: OAuth grant
    const oauthCode = await getOAuthCode(ACCOUNT_TOKEN);

    // Step 2: Generate cred
    const credResult = await getCred(oauthCode);
    const cred = credResult.cred;

    // Step 3: Use the generate_cred_by_code token as the HMAC salt.
    // Keep refresh only as a compatibility fallback for responses without data.token.
    const signToken = credResult.token || await getSignToken(cred);

    // Step 4: Get player binding (game role)
    const binding = await getPlayerBinding(cred, signToken);
    const gameRole = binding.role;
    const bindingNote = binding.ok ? '' : '（ロール情報の取得に失敗しました）';
    if (!binding.ok) ok = false;

    // Step 5: Attendance request
    const timestamp = String(Math.floor(Date.now() / 1000));
    const path = '/web/v1/game/endfield/attendance';
    const sign = computeSign(path, '', timestamp, signToken);
    const headers = {
      cred: cred,
      platform: PLATFORM,
      vName: VNAME,
      timestamp: timestamp,
      'sk-language': language,
      sign: sign,
      'Content-Type': 'application/json',
      ...CLIENT_HEADERS,
    };
    if (gameRole) headers['sk-game-role'] = gameRole;

    const res = await httpsPost(URLS.ATTENDANCE, headers, null);
    const json = res.data;
    logApiDiagnostic('attendance', res, { gameRolePresent: !!gameRole });
    const apiMessage = json.code === 19001 ? '現在のキャラクター位置を取得できません。ゲームにログインしていることを確認してください。' : (json.message || JSON.stringify(json));

    if (json.code === 0) {
      response += `\nEndfield: 成功${bindingNote}`;
    } else if (json.code === 1001 || json.code === 10001) {
      response += `\nEndfield: 本日はチェックイン済み${bindingNote}`;
    } else {
      ok = false;
      response += `\nEndfield: ${discordPing()}${apiMessage}${bindingNote}`;
    }
  } catch (e) {
    ok = false;
    response += `\nEndfield: ${discordPing()}エラー - ${e.message}`;
  }
  return { message: response, ok };
}

async function postWebhook(data) {
  const payload = JSON.stringify({
    username: 'auto-sign',
    avatar_url: 'https://i.imgur.com/TguAOiA.png',
    content: data,
  });
  try {
    await httpsPost(discordWebhook, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, payload);
  } catch (e) {
    console.error('Discord Webhookエラー:', e);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
