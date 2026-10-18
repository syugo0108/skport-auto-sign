<h1 align="center">
    <img width="120" height="120" src="pic/logo.svg" alt=""><br>
    skport-auto-sign
</h1>

<p align="center">
    <img src="https://img.shields.io/github/license/canaria3406/skport-auto-sign?style=flat-square" alt="">
    <img src="https://img.shields.io/github/stars/canaria3406/skport-auto-sign?style=flat-square" alt="">
    <br><a href="/README_zh-tw.md">繁體中文</a>　<b>English</b>
</p>

A lightweight, secure, and free script that automatically collect SKPORT daily check in rewards.  
Supports **Arknights:Endfield**. Support multiple accounts.

## Features
* **Lightweight** - The script only requires minimal configuration and is only 90 lines of code.
* **Secure** - The script can be self-deployed to Google Apps Script, no worries about data leaks.
* **Free** - Google Apps Script is currently a free service.
* **Simple** - The script can run without a browser and will automatically notify you through Discord or Telegram.
* **Flexible** - Supports both Google Apps Script and GitHub Actions deployment.

## Setup
1. Go to [Google Apps Script](https://script.google.com/home/start) and create a new project with your custom name.
2. Select the editor and paste the code( [Discord version](https://github.com/canaria3406/skport-auto-sign/blob/main/src/main-discord.gs) / ~~Telegram version~~ ). Refer to the instructions below to configure the config file and save it.
3. Select "main" and click the "Run" button at the top.
   Grant the necessary permissions and confirm that the configuration is correct (Execution started > completed).
4. Click the trigger button on the left side and add a new trigger.
   Select the function to run: main
   Select the event source: Time-driven
   Select the type of time based trigger: Day timer
   Select the time of day: recommended to choose any off-peak time between 0900 to 1500.

## Setup (GitHub Actions)

An alternative to Google Apps Script. Runs on GitHub Actions (free) with daily cron schedule.

### Prerequisites
- A GitHub account
- Your SKPORT `ACCOUNT_TOKEN` cookie value (see [How to get ACCOUNT_TOKEN](#how-to-get-account_token))

### Steps
1. Fork or clone this repository
2. Go to your repository's Settings → Secrets and variables → Actions
3. Add the following Repository Secrets:

| Secret Name | Required | Description |
|---|---|---|
| PROFILES | Yes | JSON array of profile objects (see below) |
| DISCORD_WEBHOOK | No | Discord webhook URL for notifications |
| DISCORD_USER_ID | No | Your Discord user ID for error pings |

4. PROFILES format (JSON):
```json
[
  {
    "ACCOUNT_TOKEN": "your-account-token",
    "language": "en",
    "accountName": "YOUR NICKNAME"
  }
]
```

| Field | Required | Description |
|---|---|---|
| `ACCOUNT_TOKEN` | Yes | The `ACCOUNT_TOKEN` cookie value from `game.skport.com` (see below) |
| `language` | No | `en` / `ja` / `zh_Hant` / `zh_Hans` / `ko` / `ru_RU` (default: `en`) |
| `accountName` | No | Nickname shown in the notification (if omitted, it is displayed as `undefined のチェックイン`) |
| `id` / `server` | No | Not used by the GitHub Actions script. The game role is detected automatically from the binding API. |

For multiple accounts, add more objects to the array.

5. The workflow runs automatically every day at 22:00 UTC (07:00 JST, next day).
   GitHub may delay scheduled runs by minutes to hours.
   You can also trigger it manually from Actions → SKPORT Auto Sign-in → Run workflow.

> A failing check-in now makes the run fail (exit 1). The Discord notification is still sent, and the `[diagnostic] grant status=` line in the run log shows where it broke.

### How to get ACCOUNT_TOKEN

1. Open the [SKPORT check-in page](https://game.skport.com/endfield/sign-in) and log in.
2. Press F12 and open the **Application** tab.
3. **Keep DevTools open and reload the page (F5)** so that the cookie list is up to date.
4. Expand **Cookies** → `.skport.com` (it may also appear under `https://www.skport.com` or another `skport.com` subdomain) and copy the **Value** of `ACCOUNT_TOKEN`.
   - `ACCOUNT_TOKEN` is an **httpOnly** cookie, so it cannot be read with `document.cookie`; copy it from DevTools.
   - If it is not listed, open the **Network** tab, reload, click a request to `*.skport.com`, and copy the value from the request's `Cookie` header — only the part between `ACCOUNT_TOKEN=` and the next `;`. A URL-encoded value (`%2F`, `%3D`, …) can be pasted as is, because the script decodes it.
5. Keep this value secret. Store it only in the repository Secret — never in a file, an issue, or a log. (The Actions logs of this public repository show `accountName` and the result, but never the token.)

> The lifetime of the token is not published: it has been observed to last about three months here, and other projects report a few weeks to a few months. It also becomes invalid when you log out. If the workflow reports `Login status expired.`, log in again and repeat the steps above. The same message is returned for any token the server does not recognise (for example, a value copied from a different cookie), so make sure you copied `ACCOUNT_TOKEN` itself.

## Configuration (Google Apps Script)

This section applies to the Google Apps Script deployment (`src/main-discord.gs`), which uses `SK_OAUTH_CRED_KEY`. The GitHub Actions deployment uses the `PROFILES` secret instead — see [Setup (GitHub Actions)](#setup-github-actions).

```javascript
const profiles = [
  {
    SK_OAUTH_CRED_KEY: "", // your skport SK_OAUTH_CRED_KEY in cookie
    id: "", // your Endfield game id
    server: "2", // Asia=2 Americas/Europe=3
    language: "en", // english=en 日本語=ja 繁體中文=zh_Hant 简体中文=zh_Hans 한국어=ko Русский=ru_RU
    accountName: "YOUR NICKNAME"
  }
];
```

<details>
<summary><b>SKPORT settings</b></summary>

1. **SK_OAUTH_CRED_KEY** - Please enter the cred for SKPORT check-in page.

   After entering the [SKPORT check-in page](https://game.skport.com/endfield/sign-in), press F12 to enter the console.
   Paste the following code and run it to get the cred. Copy the cred and fill it in "quotes".
   ```javascript
   function getCookie(name) {
   const value = `; ${document.cookie}`;
   const parts = value.split(`; ${name}=`);
   if (parts.length === 2) return parts.pop().split(';').shift();
   }

   let cred = 'Error';
   if (document.cookie.includes('SK_OAUTH_CRED_KEY=')) {
   cred = `${getCookie('SK_OAUTH_CRED_KEY')}`;
   }

   let ask = confirm(cred + '\n\nPress enter, then paste the token into your Google Apps Script Project');
   let msg = ask ? cred : 'Cancel';
   ```

2. **id**

   Please enter your Arknights:Endfield game ID here.  
   (should be number)

3. **server**

   Please enter your Arknights:Endfield game server here.  
   If you're in Asia server, please enter `2`,  
   If you're in Americas/Europe server, please enter `3`.

4. **language**

   Please enter your Arknights:Endfield game language here.  
   If you're using english, please enter `en`,  
   If you're using 日本語, please enter `ja`,  
   If you're using 繁體中文, please enter `zh_Hant`,  
   If you're using 简体中文, please enter `zh_Hans`,  
   If you're using 한국어, please enter `ko`,  
   If you're using Русский, please enter `ru_RU`.

5. **accountName** - Please enter your customized nickname.

   Please enter your customized SKPORT or in-game nickname here.

</details>

<details>
<summary><b>discord notify settings (only for <a href="https://github.com/canaria3406/skport-auto-sign/blob/main/src/main-discord.gs">Discord version</a>)</b></summary>

```javascript
const discord_notify = true
const myDiscordID = "20000080000000040"
const discordWebhook = "https://discord.com/api/webhooks/1050000000000000060/6aXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXnB"
```

1. **discord_notify**

   Whether to enable Discord notify.
   If you want to enable auto check-in notify, set it to true. If not, please set it to false.

2. **myDiscordID** - Please enter your Discord user ID.

   Whether you want to be ping when there is an unsuccessful check-in.
   Copy your Discord user ID which like `23456789012345678` and fill it in "quotes".
   You can refer to [this article](https://support.discord.com/hc/en-us/articles/206346498) to find your Discord user ID.
   If you don't want to be pinged, leave the "quotes" empty.

3. **discordWebhook** - Please enter the Discord webhook for the server channel to send notify.

   You can refer to [this article](https://support.discord.com/hc/en-us/articles/228383668) to create a Discord webhook.
   Once you have finished creating the Discord webhook, you will receive your Discord webhook URL, which like `https://discord.com/api/webhooks/1234567890987654321/PekopekoPekopekoPekopeko06f810494a4dbf07b726924a5f60659f09edcaa1`.
   Copy the webhook URL and paste it in "quotes".

</details>

<details>
<summary><b>telegram notify settings (only for <a href="https://github.com/canaria3406/skport-auto-sign/blob/main/src/main-telegram.gs">Telegram version</a>)</b></summary>

```javascript
const telegram_notify = true
const myTelegramID = "1XXXXXXX0"
const telegramBotToken = "6XXXXXXXXX:AAAAAAAAAAXXXXXXXXXX8888888888Peko"
```

1. **telegram_notify**

   Whether to enable Telegram notify.
   If you want to enable auto check in notify, set it to true. If not, please set it to false.

2. **myTelegramID** - Please enter your Telegram ID.

   Use the `/getid` command to find your Telegram user ID by messaging [@IDBot](https://t.me/myidbot).
   Copy your Telegram ID which like `123456780` and fill it in "quotes".

3. **telegramBotToken** - Please enter your Telegram Bot Token.

   Use the `/newbot` command to create a new bot on Telegram by messaging [@BotFather](https://t.me/botfather).
   Once you have finished creating the bot, you will receive your Telegram Bot Token, which like `110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw`.
   Copy your Telegram Bot Token and fill it in "quotes".
   For more detailed instructions, you can refer to [this article](https://core.telegram.org/bots/features#botfather).

</details>

## Demo
If the auto check in process is success, it will send "OK".  
If you have already check in today, it will give a notify.

![image](https://github.com/canaria3406/skport-auto-sign/blob/main/pic/01.png)

## Changelog
2026-10-18 The GitHub Actions run now fails (exit 1) when a check-in fails, so a broken token is no longer hidden behind a green check.
2026-10-18 Documented the current GitHub Actions `PROFILES` format (`ACCOUNT_TOKEN`). The previous `SK_OAUTH_CRED_KEY` example was outdated and caused HTTP 400 (`token ... failed on the 'required' tag`).
2026-02-11 Added GitHub Actions support.
2026-01-29 Project launched.
