// 環境変数からconfig読み取り
const https = require('https');
const crypto = require('crypto');
const profiles = JSON.parse(process.env.PROFILES || '[]');
const discordWebhook = process.env.DISCORD_WEBHOOK || '';
const myDiscordID = process.env.DISCORD_USER_ID || '';
const discord_notify = !!discordWebhook;

/** The above is the config. Environment variables are used instead of hardcoded values. **/
/** The following is the script code. Please DO NOT modify. **/

const PLATFORM = '3';
const VNAME = '1.0.0';
const APP_CODE = '6eb76d4e13aa36e6';

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
          resolve({ status: res.statusCode, data: { message: `Parse error: ${data.slice(0, 200)}` } });
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
  if (res.data && res.data.status === 0 && res.data.data && res.data.data.code) {
    return res.data.data.code;
  }
  throw new Error(`Failed to get OAuth code: ${JSON.stringify(res.data)}`);
}

async function getCred(oauthCode) {
  const payload = JSON.stringify({ kind: 1, code: oauthCode });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
  const res = await httpsPost(URLS.GENERATE_CRED, headers, payload);
  if (res.data && res.data.code === 0 && res.data.data && res.data.data.cred) {
    return res.data.data.cred;
  }
  throw new Error(`Failed to get cred: ${JSON.stringify(res.data)}`);
}

async function getSignToken(cred) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = { cred: cred, platform: PLATFORM, vName: VNAME, timestamp: timestamp, 'sk-language': 'en' };
  const res = await httpsGet(URLS.REFRESH_TOKEN, headers);
  if (res.data && res.data.code === 0 && res.data.data && res.data.data.token) {
    return res.data.data.token;
  }
  throw new Error(`Failed to get sign token: ${JSON.stringify(res.data)}`);
}

async function getPlayerBinding(cred, signToken) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const path = '/api/v1/game/player/binding';
  const sign = computeSign(path, '', timestamp, signToken);
  const headers = { cred: cred, platform: PLATFORM, vName: VNAME, timestamp: timestamp, 'sk-language': 'en', sign: sign };
  const res = await httpsGet(URLS.BINDING, headers);
  if (res.data && res.data.code === 0 && res.data.data && res.data.data.list) {
    for (const app of res.data.data.list) {
      if (app.appCode === 'endfield' && app.bindingList) {
        const binding = app.bindingList[0];
        const role = binding.defaultRole || (binding.roles && binding.roles[0]);
        if (role) return `3_${role.roleId}_${role.serverId}`;
      }
    }
  }
  return null;
}

// --- Main logic ---

async function main() {
  const messages = await Promise.all(profiles.map(autoSignFunction));
  const skportResp = messages.join('\n\n');
  console.log(skportResp);
  if (discord_notify && discordWebhook) {
    await postWebhook(skportResp);
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
  let response = `Check-in for ${accountName}`;
  try {
    // Step 1: OAuth grant
    const oauthCode = await getOAuthCode(ACCOUNT_TOKEN);

    // Step 2: Generate cred
    const cred = await getCred(oauthCode);

    // Step 3: Get sign token
    const signToken = await getSignToken(cred);

    // Step 4: Get player binding (game role)
    const gameRole = await getPlayerBinding(cred, signToken);

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
    };
    if (gameRole) headers['sk-game-role'] = gameRole;

    const res = await httpsPost(URLS.ATTENDANCE, headers, null);
    const json = res.data;

    if (json.code === 0) {
      response += '\nEndfield: OK';
    } else if (json.code === 1001 || json.code === 10001) {
      response += '\nEndfield: Already signed in today';
    } else {
      response += `\nEndfield: ${discordPing()}${json.message || JSON.stringify(json)}`;
    }
  } catch (e) {
    response += `\nEndfield: ${discordPing()}Error - ${e.message}`;
  }
  return response;
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
    console.error('Discord webhook error:', e);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
