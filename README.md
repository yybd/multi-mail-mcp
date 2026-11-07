*English · [עברית](README.he.md)*

# multi-mail MCP

An MCP server for **several Gmail accounts at once**. It searches, reads, drafts and sends mail, and works with **Claude Desktop**, **Claude Code** and **ChatGPT**.

It has two transports:
- **stdio** (`dist/server.js`) runs locally, for Claude Desktop and Claude Code.
- **Streamable HTTP** (`dist/http.js`) is for ChatGPT, or any client that connects by URL. A token is required.

Each user brings **their own Google OAuth client**. Because of that, no Google app verification is needed and nothing passes through a third party. Mail goes only between your machine and Google.

## Tools

| Tool | What it does |
|---|---|
| `list_accounts` | Lists the connected accounts and their aliases |
| `search_emails` | Searches one mailbox, or all of them with `account="all"`, using Gmail search syntax |
| `read_email` | Returns a full message: headers, the body as text (HTML is converted), and attachment names |
| `read_thread` | Returns a whole conversation |
| `list_labels` | Lists a mailbox's labels and folders |
| `create_draft` | Saves a new message or reply as a draft, without sending it |
| `send_email` | Sends a new message or reply right away |
| `list_drafts` / `send_draft` | Lists pending drafts, or sends one of them |
| `search` / `fetch` | Searches every mailbox and fetches one message, in the shape ChatGPT expects (connectors, deep research) |

**Choosing a mailbox:**
- `account` accepts a full address, an alias (`work`), or the part before the `@`.
- With a single account connected, you can leave it out.
- `MULTI_MAIL_DEFAULT` sets a default account.

**Replying:**
- `reply_to_message_id` puts the reply in the right thread and fills in the recipient and subject.
- `reply_all` adds every original recipient.

**Permissions:** only `gmail.readonly` and `gmail.compose`. The server **cannot delete** mail, move it to trash, or change settings.

## How it compares

Checked on 2026-11-07, with star counts from that day. I couldn't find official documentation of what the built-in Claude and ChatGPT connectors can do. That information comes mostly from blog posts by competing vendors, so treat it as approximate.

| Option | Several accounts | Sends | Claude Desktop / Code | ChatGPT | Where mail goes |
|---|---|---|---|---|---|
| **multi-mail (this)** | yes, including search across all (`all`) | yes, plus drafts and threaded replies | yes (stdio) | yes (HTTP + token) | only you and Google |
| Claude's built-in Gmail connector | no, one account | no, drafts only | Claude only | — | Anthropic |
| ChatGPT's built-in Gmail connector | sources disagree | yes since June 2026, on the web, with approval | — | yes | OpenAI |
| [Google's official Gmail MCP](https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server) (developer preview) | not documented | **no send tool** | Claude | not listed | Google |
| [google_workspace_mcp](https://github.com/taylorwilsdon/google_workspace_mcp) (~3.5k ⭐) | multi-*user*; several accounts of one person in one session isn't documented | yes | yes | yes (developer mode) | only you and Google |
| [navbuildz/gmail-mcp-server](https://github.com/navbuildz/gmail-mcp-server) (16 ⭐) | yes, including `all` | yes | by URL | probably, untested | you, plus Redis |
| [dmorrill/gmail-mcp-multi](https://github.com/dmorrill/gmail-mcp-multi), [jwlutz/gmail_connector](https://github.com/jwlutz/gmail_connector), [3vening/gmail-mcp](https://github.com/3vening/gmail-mcp) and others | yes | yes (some only after you opt in) | yes (stdio) | **no**, local only | only you and Google |
| Composio / Zapier MCP / Pipedream | Composio: yes | yes | yes (URL) | yes (URL) | **through the vendor**, paid |

**Takeaways:**
- The built-in connectors don't give you several accounts plus sending in every client.
- Most existing servers that handle several accounts run locally only, so ChatGPT can't connect to them.
- Hosted brokers route your mail and tokens through a third party.
- multi-mail covers all of this and keeps a narrow scope:
  - It has no delete permission.
  - Tokens stay on your machine with `600` permissions.
  - The HTTP server won't start without a token.
- If you also need Drive, Calendar or Docs, **google_workspace_mcp** is the mature choice.

## Setup

You need Node.js 20 or newer. There's nothing to install: every command below runs the published package through `npx`.

<details>
<summary>Running from source instead</summary>

```bash
git clone https://github.com/yybd/multi-mail-mcp.git multi-mail && cd multi-mail && npm install && npm run build
```

Then use `node dist/main.js` wherever this guide says `npx -y @yybd/multi-mail-mcp`.
</details>

### 1. Create your own Google OAuth client (once)

Do this once, from one Google account. The same client then works for every mailbox you connect. If you already have a Google Cloud project for personal tools, you can add the client there instead of creating a new project.

1. **Project.** Go to [console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate), name the project (for example `multi-mail`) and click **Create**. Make sure it's selected in the top bar.
2. **Gmail API.** On the [Gmail API page](https://console.cloud.google.com/apis/library/gmail.googleapis.com), click **Enable**.
3. **Consent screen.** In [Google Auth Platform](https://console.cloud.google.com/auth/overview), click **Get started** and fill in:
   - App name: anything you like.
   - Support email: yours.
   - Audience: **External**.
   - Contact email: yours.

   Accept the terms and click **Create**. You don't need to add scopes here; the server asks for them itself.
4. **Publish.** Under **Audience**, click **Publish app**, then **Confirm**. The status should read *In production*.
   - ⚠️ In *Testing* mode, access expires **every 7 days**.
   - For personal use, Google doesn't need to verify the app.
   - If you stay in *Testing* anyway, add every Gmail address under *Test users*.
5. **Client.** Under **Clients**, click **Create client**, choose the type **Desktop app**, and click **Create**. Then click **Download JSON** right away, because the secret is shown in full only in that dialog. Save the file like this:

```bash
mkdir -p ~/.multi-mail && mv ~/Downloads/client_secret_*.json ~/.multi-mail/credentials.json && chmod 600 ~/.multi-mail/credentials.json
```

### 2. Connect your mailboxes

Run this once per mailbox, with a different alias each time:

```bash
npx -y @yybd/multi-mail-mcp add --alias work
```

```bash
npx -y @yybd/multi-mail-mcp add --alias home
```

Each `add` opens a browser where you pick a Google account and approve access.
- You'll see **"Google hasn't verified this app"**. That's expected, because it's your own app. Click **Advanced**, then **Go to … (unsafe)**.
- Tick **every** permission box. If one is missing, the CLI stops and tells you which.

**Managing accounts:**
- `npx -y @yybd/multi-mail-mcp list` lists the connected accounts.
- `check` verifies every account still has access.
- `alias <account> <name>` sets or changes an alias. The account can be its current alias, its address, or the part before `@`. For example, `npx -y @yybd/multi-mail-mcp alias tech work` renames `tech` to `work`, and it takes effect immediately, without a restart.
- `remove <account>` disconnects an account.

Tokens live in `~/.multi-mail/accounts/` with `600` permissions; `MULTI_MAIL_HOME` moves that folder. A running server picks up a newly added account without a restart.

## Connect your clients

### Claude Code

```bash
claude mcp add multi-mail -s user -- npx -y @yybd/multi-mail-mcp
```

### Claude Desktop

In `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "multi-mail": {
      "command": "npx",
      "args": ["-y", "@yybd/multi-mail-mcp"]
    }
  }
}
```

Then restart Claude Desktop. If it can't find `npx`, use its full path (`which npx`, for example `/opt/homebrew/bin/npx`).

### ChatGPT

ChatGPT only connects to remote HTTPS servers, so you run the HTTP mode and expose it through a tunnel. Run these one after another:

```bash
npx -y @yybd/multi-mail-mcp token
```

```bash
MCP_AUTH_TOKEN=<token> npx -y @yybd/multi-mail-mcp http
```

```bash
cloudflared tunnel --url http://127.0.0.1:3333
```

`ngrok http 3333` also works instead of cloudflared.

In ChatGPT, open **Settings → Apps & Connectors → Advanced**, turn on **Developer mode**, then click **Create** and fill in:
- URL: `https://<your-tunnel-host>/mcp?api_key=<token>`
- Authentication: **No authentication** (the token is already in the URL).

**Security of HTTP mode:**
- The server listens on `127.0.0.1` only.
- It refuses to start without an `MCP_AUTH_TOKEN` of at least 24 characters.
- Clients that can send headers may use `Authorization: Bearer <token>` instead of `api_key`.
- ⚠️ Anyone with the full URL can read and send from your mailboxes. Treat it like a password, and rotate the token (`token`) if it leaks.

HTTP environment variables: `PORT` (default 3333), `HOST` (default `127.0.0.1`), `MCP_AUTH_TOKEN`.

## Development

```bash
npm test
```

The tests run offline, with no Google account. They cover Hebrew/UTF-8 MIME encoding, account selection, the tool list over stdio and HTTP, and token enforcement.

**Layout:**
- `src/config.ts` — accounts and files
- `src/gmail.ts` — Gmail calls
- `src/mime.ts` — building and parsing messages
- `src/mcp.ts` — the tools
- `src/server.ts` / `src/http.ts` — transports
- `src/cli.ts` — account management

**Not supported yet:** downloading or attaching files, changing labels, marking as read.

## License

MIT — see [LICENSE](LICENSE).
