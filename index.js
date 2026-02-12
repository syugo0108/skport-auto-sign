// 環境変数からconfig読み取り
const https = require('https');
const zlib = require('zlib');
const profiles = JSON.parse(process.env.PROFILES || '[]');
const discordWebhook = process.env.DISCORD_WEBHOOK || '';
const myDiscordID = process.env.DISCORD_USER_ID || '';
const discord_notify = !!discordWebhook;

/** The above is the config. Environment variables are used instead of hardcoded values. **/
/** The following is the script code. Please DO NOT modify. **/

const urlDict = {
  Endfield: 'https://zonai.skport.com/web/v1/game/endfield/attendance',
};

const headerDict = {
  default: {
    'Accept': '*/*',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Referer': 'https://game.skport.com/',
    'platform': '3',
    'vName': '1.0.0',
    'Origin': 'https://game.skport.com',
    'Connection': 'keep-alive',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
    'Priority': 'u=0',
    'Content-Length': '0',
    'TE': 'trailers',
  },
};

function decompressResponse(res) {
  const encoding = res.headers['content-encoding'];
  if (encoding === 'gzip') return res.pipe(zlib.createGunzip());
  if (encoding === 'deflate') return res.pipe(zlib.createInflate());
  if (encoding === 'br') return res.pipe(zlib.createBrotliDecompress());
  return res;
}

function httpsPost(url, headers) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: headers,
    }, (res) => {
      const stream = decompressResponse(res);
      let data = '';
      stream.on('data', chunk => data += chunk);
      stream.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, json: { message: `Parse error: ${data}` } });
        }
      });
      stream.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

function httpsPostWithBody(url, headers, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: headers,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const messages = await Promise.all(profiles.map(autoSignFunction));
  const skportResp = `${messages.join('\n\n')}`;
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
  SK_OAUTH_CRED_KEY,
  id,
  server,
  language = "en",
  accountName
}) {
  const urlsnheaders = [];

  urlsnheaders.push({
    url: urlDict.Endfield,
    headers: { ...headerDict["default"], "cred": SK_OAUTH_CRED_KEY, "sk-game-role": `3_${id}_${server}`, "sk-language": language, "timestamp": String(Math.floor(Date.now() / 1000)) }
  });

  let response = `Check-in completed for ${accountName}`;
  var sleepTime = 0;
  const httpResponses = [];
  for (const urlnheaders of urlsnheaders) {
    await new Promise(r => setTimeout(r, sleepTime));
    try {
      const res = await httpsPost(urlnheaders.url, urlnheaders.headers);
      httpResponses.push(res);
    } catch (e) {
      console.error(`Fetch error for ${accountName}:`, e);
      httpResponses.push(null);
    }
    sleepTime = 1000;
  }

  for (const [i, skportResponse] of httpResponses.entries()) {
    if (!skportResponse) {
      const gameName = Object.keys(urlDict)[i]?.replace(/_/g, ' ');
      response += `\n${gameName}: fetch failed`;
      continue;
    }
    const responseJson = skportResponse.json;
    const checkInResult = responseJson.message;
    const gameName = Object.keys(urlDict).find(key => urlDict[key] === urlsnheaders[i].url)?.replace(/_/g, ' ');
    const isError = checkInResult != "OK";
    response += `\n${gameName}: ${isError ? discordPing() : ""}${checkInResult}`;
  }

  return response;
}

async function postWebhook(data) {
  const payload = JSON.stringify({
    'username': 'auto-sign',
    'avatar_url': 'https://i.imgur.com/TguAOiA.png',
    'content': data
  });

  try {
    await httpsPostWithBody(discordWebhook, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, payload);
  } catch (e) {
    console.error('Discord webhook error:', e);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
