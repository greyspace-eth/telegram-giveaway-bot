# Tele Giveaway Bot

A Telegram bot for running transparent, social-verified giveaways. Participants must connect their Twitter and Discord accounts, and can be required to like, retweet, and comment on a specific post before their entry is accepted. Winners are selected randomly and notified automatically via Telegram.

Built in May 2024 by [Grayson Lim](https://github.com/greyspace-eth).

---

## Features

- **Social account linking** — Connect Twitter (OAuth 1.0a) and Discord (OAuth 2.0) directly from Telegram
- **Giveaway creation** — Set prize, participant cap, winner count, required tweet engagement, minimum follower count, and close date
- **Tweet verification** — Participants submit a link to their tweet; the bot validates it matches their connected Twitter handle
- **Random winner selection** — Creator rolls winners at any time; winners are notified privately via Telegram DM
- **Duplicate prevention** — One Twitter/Discord account per user; one entry per giveaway
- **Interactive UI** — Inline Telegram keyboards for all actions; no need to remember commands

---

## Tech Stack

| Layer | Technology |
|---|---|
| Bot framework | [Telegraf](https://telegraf.js.org/) v4 |
| Web server | [Express.js](https://expressjs.com/) |
| Authentication | [Passport.js](https://www.passportjs.org/) (Twitter + Discord strategies) |
| Database | MySQL via [mysql2](https://github.com/sidorares/node-mysql2) |
| Session storage | `telegraf-session-local` (JSON file) + `express-session` |
| Runtime | Node.js |

---

## Prerequisites

- Node.js 18+
- MySQL 8+
- A [Telegram bot token](https://core.telegram.org/bots/tutorial) from @BotFather
- A [Twitter Developer App](https://developer.twitter.com/) with OAuth 1.0a enabled
- A [Discord Application](https://discord.com/developers/applications) with OAuth2 configured
- A public HTTPS URL for OAuth callbacks (e.g. [ngrok](https://ngrok.com/) for local development)

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/graysonlim/tele-giveaway-bot.git
cd tele-giveaway-bot
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Fill in all values in `.env`. See [Environment Variables](#environment-variables) below for details.

### 4. Set up the database

Create the database and tables using the provided schema:

```bash
mysql -u root -p < schema.sql
```

### 5. Configure OAuth callback URLs

Set your **Twitter callback URL** in the Twitter Developer Portal to:
```
https://your-domain.com/auth/twitter/callback
```

Set your **Discord redirect URI** in the Discord Developer Portal to:
```
https://your-domain.com/auth/discord/callback
```

Both must match the `HTTP_URL` value in your `.env`.

### 6. Run the bot

```bash
npm start
```

The Express server listens on port `3000`. The Telegram bot starts in long-polling mode.

---

## Environment Variables

| Variable | Description |
|---|---|
| `TELEGRAM_TOKEN` | Bot token from @BotFather |
| `TWITTER_CONSUMER_KEY` | Twitter app consumer key |
| `TWITTER_CONSUMER_SECRET` | Twitter app consumer secret |
| `TWITTER_TOKEN_KEY` | Twitter app access token |
| `TWITTER_TOKEN_SECRET` | Twitter app access token secret |
| `DISCORD_CONSUMER_KEY` | Discord application client ID |
| `DISCORD_CONSUMER_SECRET` | Discord application client secret |
| `SESSION_SECRET` | Random secret string for Express sessions |
| `HTTP_URL` | Your public base URL (no trailing slash) |
| `DB_HOST` | MySQL host (e.g. `localhost`) |
| `DB_USER` | MySQL username |
| `DB_PASSWORD` | MySQL password |
| `DB_NAME` | MySQL database name (e.g. `tele_giveaway`) |

---

## Bot Commands

| Command | Description |
|---|---|
| `/start` | Register your account |
| `/menu` | Open the main menu |
| `/help` | View usage instructions |
| `/connect_twitter` | Link your Twitter account |
| `/disconnect_twitter` | Unlink your Twitter account |
| `/connect_discord` | Link your Discord account |
| `/disconnect_discord` | Unlink your Discord account |
| `/create` | Start a new giveaway |
| `/join <code>` | Join a giveaway by code |
| `/createdGiveaways` | View your active giveaways |

---

## How It Works

### Connecting Social Accounts

Users connect Twitter and Discord via OAuth from within Telegram. The bot sends a one-time auth link with the Telegram user ID encoded as the OAuth `state` parameter, so the callback can link the social account back to the correct user.

### Creating a Giveaway

The bot walks the creator through 6 questions:

1. Prize description
2. Maximum number of participants
3. Number of winners
4. Twitter post link (like/RT/comment requirement) — optional, enter `skip` or leave blank
5. Minimum follower count for participants
6. Close date/time in `DD/MM/YY-HH:mm` format

A random 6-character hex code is generated as the giveaway identifier.

### Joining a Giveaway

1. User enters the giveaway code via `/join <code>` or the menu
2. Bot checks: Twitter connected, Discord connected, giveaway active, not already joined, participant cap not reached
3. If the giveaway has a required tweet: user is shown the post link and a **Verify** button
4. User clicks Verify, submits the URL of their tweet; bot confirms the handle matches their connected Twitter account
5. Entry is recorded in the database

### Rolling Winners

The giveaway creator clicks **Roll Winners** from the *My Created GAs* view. The bot:

1. Randomly selects up to `num_winners` participants from the database
2. Sends each winner a congratulations DM on Telegram
3. Marks the giveaway as ended

---

## Database Schema

```
users           — telegram_id, telegram_username
socials         — per-user Twitter & Discord connection state + tokens
giveaways       — prize, rules, close_date, isEnded, creator_id
participants    — user_id × giveaway_id join table with isWinner flag
```

Full schema: [schema.sql](schema.sql)

---

## License

[MIT](LICENSE) © 2024 Grayson Lim
