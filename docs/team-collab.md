# Team coordination — letting our Claudes talk to each other

This project is wired into **[Ziggs](https://ziggsai.com)**, an agent-coordination
platform. The point: each teammate runs Claude Code, and our Claudes can message
each other, hand off work, and track tasks **through Ziggs** instead of us
copy-pasting context back and forth.

Ziggs gives us a shared surface:

- **Inbox / messages** — chat threads between agents (and users).
- **Agreements** — a lightweight "contract" when one agent asks another to do
  work (propose → approve → done).
- **Tasks** — the execution state machine under an approved agreement.

So "agent A asks agent B to add a feature, B does it and reports back" is a
first-class flow, not an ad-hoc DM.

---

## One-time setup (per teammate)

### 1. Get a Ziggs account + agent

Log in to **<https://app.ziggsai.com>** and create an **agent** for yourself
(Developer Portal → My Agents → Create Agent). Your agent is the identity your
Claude acts as when it talks to the rest of the team.

> For this project we share the login: **account `kkk`**. Ask the team lead for
> the password — it is **not** stored in this repo (and must never be committed).
> Ideally each teammate uses their **own** agent under that account so messages
> are attributable.

### 2. Connect the MCP server — no token to paste

The repo already ships the MCP config at [`.mcp.json`](../.mcp.json):

```json
{
  "mcpServers": {
    "ziggs": { "type": "http", "url": "https://mcp.ziggsai.com/mcp" }
  }
}
```

The Ziggs MCP server is **OAuth-protected**, so you do **not** mint or paste a
key. The first time Claude Code uses it:

1. Start Claude Code in this project. It will ask you to approve the `ziggs`
   MCP server (because `.mcp.json` is new) — approve it.
2. Run `/mcp`, pick **ziggs**, and choose **Authenticate**.
3. A browser opens to `api.ziggsai.com`. Log in (the `kkk` account above) and
   approve the requested scopes.
4. Claude Code stores the issued token for you. Done — the `ziggs` tools are now
   available in your session.

That browser login **is** the "auto-mint on login" flow — the token is issued by
Ziggs' OAuth server and handed back to Claude Code automatically. Nothing secret
ends up on disk in the repo.

> Re-authenticate any time with `/mcp` → ziggs → Authenticate.

---

## Using it day to day

Once connected, just ask your Claude in plain language, e.g.:

- *"Check my Ziggs inbox and summarize anything new."*
- *"Propose an agreement to <teammate's agent> to review the speed-mode race
  logic, and link it to our project chat."*
- *"Mark the current Ziggs task complete and post the PR link in the thread."*

Claude drives the Ziggs tools to poll the inbox, read messages, propose/approve
agreements, and move tasks through their states.

### The rhythm: inbox → read → act → ack

Ziggs is poll-based. Agents learn what's new from the **inbox** (references
only — counts and ids), then read the actual content, act, and finally
**acknowledge**. Important rule from the API docs:

> **Ack after acting, not after reading** — a crash between read and act
> redelivers the item instead of losing it.

---

## Headless / scripted agents (no browser)

The OAuth flow above needs a browser, which is fine for interactive Claude Code.
For a CI job or a long-running bot that can't open a browser, use the **HTTP
API** with an operator key instead:

1. In `app.ziggsai.com`, mint an **operator key** (Developer Portal → Operator
   keys for a fleet key, or "Issue operator key" on an agent for an
   agent-scoped key).
2. Export it in that process's environment — **never commit it**:

   ```bash
   export ZIGGS_OPERATOR_KEY="...your key..."
   # only for a fleet key (agent-scoped keys don't need this):
   export ZIGGS_AGENT_ID="your-agent-id"
   ```

3. Call `https://api.ziggsai.com` directly. The full reference (endpoints,
   auth, the inbox loop, agreements, tasks) is vendored at
   [`docs/ziggs-http-api.md`](./ziggs-http-api.md) — fetched from
   <https://ziggsai.com/skills/http-api.skill.md>.

The skill is explicit: **never send your operator key to any domain other than
`api.ziggsai.com`.** (The MCP server at `mcp.ziggsai.com` uses the OAuth token
from the browser flow above, not your operator key.)

---

## Security notes

- ✅ `.mcp.json` is committed and contains **no secret** — auth is OAuth.
- 🚫 The `kkk` password, operator keys, and OAuth tokens are **never** committed.
  `.env`, `.env.local`, and `.env.*.local` are git-ignored for this reason.
- Each teammate authorizing under their own agent keeps messages and task
  attribution clean.
