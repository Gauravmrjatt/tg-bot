# Telegram Management Bot

A Telegram bot written in TypeScript (Telegraf + Express) with webhook support, MongoDB persistence, and Redis caching.

## Features

- **Join Request Approval** — User requests to join a private channel, admins get Approve/Decline inline buttons. Redis-backed for instant response.
- **Auto-Approve Mode** — Admin toggles via `/autoapprove`. When ON, join requests are approved automatically (still logged for audit).
- **Broadcast with Delivery Tracking** — Send messages to all users with delivered/failed/blocked counters. Check status anytime with `/bcast <id>`.
- **Admin Relay** — Users DM the bot, message forwards to all admins. User gets confirmation. Admin replies by directly replying to the forwarded message in Telegram (or use `/reply <userId> <message>`).
- **Stats Dashboard** — `/stats` shows user count, join request history, and broadcast delivery rates.
- **User Tracking** — Every interacting user is persisted in MongoDB automatically.

## Performance Optimizations

- **Redis caching** — Auto-approve setting and pending requests cached (sub-ms lookups vs MongoDB queries)
- **Concurrent broadcast** — Up to 50 simultaneous Telegram API requests instead of serial sending
- **Non-blocking user tracking** — Database writes don't block message handling
- **Rate limiting** — Max 1000 requests/minute on the webhook endpoint
- **Webhook secret validation** — Optional `WEBHOOK_SECRET` env var to reject unauthorized requests

## Quick Start

### 1. Clone & Install

```bash
npm install
```

### 2. Environment Variables

Copy `.env.example` to `.env` and configure:

```env
# Required
BOT_TOKEN=your-bot-token-from-botfather
MONGO_URI=mongodb://localhost:27017/bot
WEBHOOK_URL=https://your-domain.com
ADMIN_IDS=123456,789012

# Optional
REDIS_URL=redis://localhost:6379
SERVER_PORT=3000
WEBHOOK_PATH=/tg-webhook
LOG_LEVEL=info
```

### 3. Runtime Configuration

After the bot starts, configure these with admin commands (stored in DB + Redis):

| Command | Description |
|---------|-------------|
| `/setchannelid -100xxxxxxxxx` | Set the private channel chat ID |
| `/setchannellink https://...` | Set the invite link for `/rejoin` |
| `/config` | View current config |

### 3. Run with Docker

```bash
docker compose up -d
```

This starts MongoDB, Redis, and the bot.

### 4. Run Locally

```bash
# Start MongoDB and Redis manually first, then:
npm run dev
```

## Setup in Telegram

1. **Make the bot an admin** of your target channel with "Manage Join Requests" permission.
2. **Create a "Request Admin Approval" invite link** for the channel (not an open link).
3. **Set your admin user IDs** (find them by messaging the bot and checking logs, or use a bot like `@userinfobot`).

## Commands

### For Users

| Command | Description |
|---------|-------------|
| `/start` | Get a welcome message |
| `/help` | List available commands |
| `/rejoin` | Get the channel invite link |
| *(any DM)* | Send a message to admins. You'll get a confirmation reply. |

### For Admins

| Command | Description |
|---------|-------------|
| `/autoapprove` | Toggle auto-approve for join requests (ON/OFF) |
| `/broadcast <message>` | Send a message to all registered users |
| `/bcast <id>` | Check delivery status of a broadcast |
| `/stats` | View bot statistics |
| `/reply <userId> <message>` | Reply to a user who messaged the bot |
| `/setchannelid <id>` | Set the private channel chat ID |
| `/setchannellink <url>` | Set the invite link for `/rejoin` |
| `/config` | View current runtime configuration |

### Admin Inline Actions

- **Join requests**: Approve/Decline buttons sent to admins
- **User DMs**: Admins can reply directly to the forwarded message in Telegram (no command needed)

### Admin Inline Actions

When a join request comes in, admins receive a message with:

```
[Approve] [Decline]
```

Clicking either updates the request instantly.

## Broadcast Flow

1. Admin sends `/broadcast Hello everyone!`
2. Bot sends to all registered users and tracks results
3. Returns: `Broadcast complete! Delivered: 50, Failed: 2, Blocked: 3, Total: 55`
4. Admin can check status later with `/bcast bc_12345_abcde`

## Project Structure

```
src/
  bot.ts              - Entry point, Express webhook, middleware
  models/
    index.ts          - Mongoose schemas (User, JoinRequest, Broadcast, GlobalSettings)
  handlers/
    joinRequest.ts    - Join request approval flow
    broadcast.ts      - Broadcast with delivery tracking
    adminRelay.ts     - User-to-admin message relay
    stats.ts          - Stats dashboard commands
  utils/
    db.ts             - MongoDB connection
    redis.ts          - Redis connection + caching helpers
```
