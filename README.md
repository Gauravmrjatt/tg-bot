# Telegram Management Bot

A Telegram bot written in TypeScript (Telegraf + Express) with webhook support, MongoDB persistence, and Redis caching.

## Features

- **Join Request Approval** — User requests to join a private channel, admins get Approve/Decline inline buttons. Redis-backed for instant response.
- **Auto-Approve Mode** — Global toggle. When ON, join requests are approved automatically (still logged for audit).
- **Reply Keyboards** — Persistent buttons at the bottom, no commands needed. User buttons (Help, Rejoin, My Info, Message Admin). Admin buttons (Stats, Broadcast, Auto Approve, Admin Management, Config, Channel Settings).
- **Conversational Flows** — Click a button → bot prompts for input → done. Every step has a Cancel button to return to main menu.
- **Broadcast with Delivery Tracking** — Rate-limited batch sending with `retry_after` handling. Delivered/failed/blocked counters.
- **Admin Relay** — Users DM the bot, ALL message types (text, photos, docs, video, audio, stickers, polls) are forwarded to admins. Each admin can reply directly to the forwarded message — reply resolves correctly per admin.
- **Admin Management** — Add/remove admins at runtime via interactive flow with Cancel support.
- **User Info** — `/info` shows name, username, ID, join date, last active, admin status.
- **Stats Dashboard** — User count, join request history, broadcast delivery rates.
- **User Tracking** — Every interacting user persists in MongoDB automatically.
- **Runtime Config** — Channel ID, invite link set via buttons. Stored in both DB and Redis.

## Performance Optimizations

- **Redis caching** — Settings and pending requests cached with 1h TTL (auto-renewed on update)
- **Cursor-based pagination** — Broadcast reads users in small batches, never loads all users into memory
- **Rate-limited broadcast** — 10 concurrent sends with 1.5s batch delays, plus automatic `retry_after` handling for Telegram 429 responses
- **Non-blocking user tracking** — Database writes are fire-and-forget, never block message handling
- **Duplicate broadcast protection** — Only one broadcast runs at a time
- **Concurrent join request handling** — Admin approve/decline reads from Redis cache (sub-ms) with MongoDB fallback

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

### 4. Run with Docker

```bash
docker compose up -d
```

This starts MongoDB, Redis, and the bot.

### 5. Run Locally

```bash
# Start MongoDB and Redis manually first, then:
npm run dev
```

## Setup in Telegram

1. **Make the bot an admin** of your target channel with "Manage Join Requests" permission.
2. **Create a "Request Admin Approval" invite link** for the channel (not an open link).
3. **Set your admin user IDs** (find them by messaging the bot and checking logs, or use a bot like `@userinfobot`).

## How It Works

### For Users

| Action | Description |
|--------|-------------|
| `/start` | Shows welcome message with **reply keyboard** buttons |
| 🔘 **📋 Help** | Shows available options |
| 🔘 **🔗 Rejoin** | Get the channel invite link |
| 🔘 **👤 My Info** | View your account details |
| 🔘 **💬 Message Admin** | Prompts to type a message — it gets forwarded to admins |
| *(any DM)* | Send ANY message type (text, photo, doc, video, audio, sticker, poll) — forwarded to admins |

### For Admins

| Button | Flow |
|--------|------|
| 🔘 **📊 Stats** | Shows user count, join requests, broadcast stats |
| 🔘 **📢 Broadcast** | Prompts for message text → sends to all users with delivery tracking |
| 🔘 **⚡ Auto Approve** | Toggles auto-approve for join requests (ON/OFF) |
| 🔘 **🔍 Bcast Status** | Prompts for broadcast ID → shows delivery status |
| 🔘 **➕ Add Admin** | Prompts for user ID → adds as admin |
| 🔘 **➖ Remove Admin** | Prompts for user ID → removes from admins |
| 🔘 **👥 List Admins** | Shows all current admin IDs |
| 🔘 **⚙️ Config** | Shows current channel ID and invite link |
| 🔘 **📍 Set Channel** | Prompts for channel chat ID |
| 🔘 **🔗 Set Link** | Prompts for invite link URL |

### Admin Actions

- **Join requests**: Approve/Decline inline buttons sent to admins when someone requests to join
- **Reply to users**: Tap "reply" on any forwarded user message — response is delivered to them. Each admin's reply mapping is cached separately, no failures.
- **Cancel anytime**: Every conversational flow shows a **❌ Cancel** button to return to the main menu

### Commands (Fallback)

All interactive features work through buttons, but these commands still work as fallback:
`/autoapprove`, `/broadcast`, `/bcast <id>`, `/info`, `/addadmin`, `/removeadmin`, `/rejoin`, `/config`, `/setchannelid`, `/setchannellink`

## Broadcast Flow

1. Admin taps **📢 Broadcast** button
2. Bot prompts: "Send the broadcast message now"
3. Admin types the message text
4. Bot broadcasts to all users with delivery tracking
5. Returns: `📢 Broadcast Complete. Delivered: 50, Failed: 2, Blocked: 3, Total: 55`
6. Admin can check status later by tapping **🔍 Bcast Status** and sending the broadcast ID

## Project Structure

```
src/
  bot.ts              - Entry point, Express webhook, middleware, admin management
  models/
    index.ts          - Mongoose schemas (User, JoinRequest, Broadcast, GlobalSettings)
  handlers/
    joinRequest.ts    - Join request approval flow (with Redis caching)
    broadcast.ts      - Broadcast with rate limiting, retry_after, cursor pagination
    adminRelay.ts     - User-to-admin message relay (all message types + reply)
    stats.ts          - Stats dashboard commands
    menu.ts           - Inline keyboard handlers (user + admin menus)
  utils/
    db.ts             - MongoDB connection
    redis.ts          - Redis connection + caching helpers (settings, admins, tracking)
    settings.ts       - getTargetChatId, setTargetChatId, get/set channel link
    format.ts         - Inline keyboard builders (user/admin keyboards)
```
