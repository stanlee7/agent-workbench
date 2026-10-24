# Agent Workbench

**One desktop app. Three AI coding agents. Each one drives its own browser, side by side, and you watch every click.**

Agent Workbench puts Claude Code, Codex and Antigravity next to each other. Every agent gets its own Chromium pane, exposed to it as a small MCP server. Type one task, send it to all three, and compare what each one found and where it found it.

- **Its own browser per agent.** Each pane has a separate persistent profile, so cookies never mix between agents. Sign in to a site in a pane once, and that agent can work there.
- **You see everything.** Every tool call (`navigate`, `read_page`, `click`, `type` …) shows up live under the pane.
- **Risky clicks wait for you.** Buttons that look like submit, pay, send, post or delete pause the agent and show an approval card. Password fields are refused outright.
- **Uses the subscriptions you already have.** The app launches the official CLIs (`claude`, `codex`, `agy`), so there are no API keys to paste and no extra billing.
- **Local only.** The MCP server listens on `127.0.0.1`. Nothing outside your machine can drive the panes.

> Status: v0.1 prototype. Tested on Windows 11 with Claude Code 2.1, Codex CLI 0.163 and Antigravity CLI 1.4.

## How it works

```
 you ──task──▶ Agent Workbench (Electron)
                 ├─ spawns  claude -p   ──MCP──▶ http://127.0.0.1:7788/mcp/claude ─▶ pane 1 (Chromium)
                 ├─ spawns  codex exec  ──MCP──▶ http://127.0.0.1:7788/mcp/codex  ─▶ pane 2 (Chromium)
                 └─ spawns  agy -p      ──MCP──▶ http://127.0.0.1:7788/mcp/agy    ─▶ pane 3 (Chromium)
```

Each pane is an Electron `WebContentsView`. The app hosts a stateless Streamable HTTP MCP server, with one URL per pane, so an agent can only ever reach its own browser.

Tools each agent gets:

| Tool | What it does |
|---|---|
| `navigate(url)` | Open a URL |
| `read_page()` | URL, title, visible text, and numbered interactive elements |
| `click(id)` | Real mouse click on element `id` (risky buttons ask you first) |
| `type(id, text, submit?)` | Type into an input, optionally press Enter (passwords refused) |
| `scroll(direction)` / `back()` | Move around |
| `screenshot()` | JPEG of the pane, for when text is not enough |

## Run it

Requirements: Node 20+, and whichever CLIs you use, already signed in (`claude`, `codex`, `agy`).

```bash
git clone https://github.com/stanlee7/agent-workbench
cd agent-workbench
npm install
npm start
```

Antigravity reads MCP servers from its own config. Register the pane once:

```bash
agy mcp add wb http://127.0.0.1:7788/mcp/agy
```

Claude Code and Codex get their MCP config per run, so they need no setup.

Smoke test, with the app running:

```bash
npm run smoke            # all three agents
npm run smoke -- claude  # just one
```

## Safety notes

- Page text goes to the agent labelled as untrusted data, and the agent is told never to follow instructions found in a page. That reduces prompt injection; it does not eliminate it. Keep panes signed in only where you are comfortable.
- Approval matching is keyword based (`submit`, `pay`, `send`, `post`, `delete`, `제출`, `결제`, `발송`, `게시`, `삭제` …). Treat it as a seatbelt, not a guarantee.
- Claude runs with only `mcp__wb` tools allowed. Codex runs in `read-only` sandbox mode. Antigravity runs with `--dangerously-skip-permissions` in an empty temp folder, because its print mode cannot prompt. Read `src/agents.js` before you change any of this.

## Roadmap

- [ ] Compare board: answers and source URLs from all agents in one table
- [ ] Interactive terminal per pane (node-pty) instead of one-shot runs
- [ ] Gemini CLI and other MCP-capable agents as pluggable presets
- [ ] macOS build

## 한국어 요약

AI 에이전트 세 개(Claude Code, Codex, Antigravity)를 한 화면에 띄우고, 에이전트마다 자기 전용 브라우저 칸을 MCP로 연결한 데스크톱 앱입니다. 질문 하나를 셋에게 동시에 주고 각자 웹에서 찾은 결과를 나란히 비교합니다. 클릭 하나하나가 화면에 보이고, 제출, 결제, 발송, 게시, 삭제 같은 버튼은 사람이 승인해야 눌립니다. 각자 쓰는 구독(CLI 로그인)을 그대로 쓰므로 API 키가 필요 없습니다.

## License

MIT
