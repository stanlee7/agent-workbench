# Agent Workbench

**One desktop app. Any CLI agents you like. Each one drives its own browser, side by side, and you watch every click.**

![Four agents answer the same question in their own browser panes, then the compare board lines up their answers](docs/demo.gif)

Agent Workbench puts AI agents next to each other: Claude Code, Codex and Antigravity out of the box, plus any other CLI or model you add. Every agent gets its own Chromium pane, exposed to it as a small MCP server. Type one task, send it to all three, and compare what each one found and where it found it.

- **Its own browser per agent.** Each pane has a separate persistent profile, so cookies never mix between agents. Sign in to a site in a pane once, and that agent can work there.
- **You see everything.** Every tool call (`navigate`, `read_page`, `click`, `type` …) shows up live under the pane.
- **Compare board.** When the agents finish, one click lines up every answer side by side with time, tool calls, pages visited and the URLs each one cited. Sites cited by more than one agent are flagged, and the whole board copies out as Markdown.
- **Bring your own agents.** Agents are command lines in `agents.json`. Add another CLI, or the same CLI with a different model (`claude --model haiku`), from the Agents screen. Each gets its own pane.
- **Risky clicks wait for you.** Buttons that look like submit, pay, send, post or delete pause the agent and show an approval card. Password fields are refused outright.
- **Uses the subscriptions you already have.** The app launches the official CLIs (`claude`, `codex`, `agy`), so there are no API keys to paste and no extra billing.
- **Local only.** The MCP server listens on `127.0.0.1`. Nothing outside your machine can drive the panes.

> Status: v0.1 prototype. Tested on Windows 11 with Claude Code 2.1, Codex CLI 0.163 and Antigravity CLI 1.4.

![Compare board](docs/compare.png)

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

Start with a task already running (useful for demos and scripts):

```bash
npm start -- --task "Find the current Node.js LTS version and its release date on nodejs.org"
```

## Add your own agent

![Agents screen](docs/agents.png)

Open **Agents** in the toolbar, press **Add agent**, give it a name, a colour and a command, then **Save and restart**. The list lives in `~/.agent-workbench/agents.json` (or the path in `WORKBENCH_AGENTS`), so you can also edit it by hand.

Placeholders in a command:

| Placeholder | Becomes |
|---|---|
| `{url}` | this pane's MCP endpoint, e.g. `http://127.0.0.1:7788/mcp/claude-haiku` |
| `{mcpConfig}` | path to a generated `mcp.json` with that endpoint as server `wb` |
| `{prompt}` | the task as a single argument. Without it, the task goes in on stdin |

Examples:

```json
{ "id": "claude-haiku", "label": "Claude Haiku", "color": "#8a6d3b", "enabled": true,
  "command": "claude -p --model haiku --mcp-config {mcpConfig} --strict-mcp-config --allowedTools mcp__wb --output-format text" }
```

A CLI that only reads MCP servers from its own settings needs the pane registered once, the way Antigravity does above. The pane's id is its name in lower case, and its endpoint is `/mcp/<id>`.

The task bar can sit at the top or the bottom of the window: **Bar at bottom / Bar at top** in the toolbar. The choice is remembered.

## Record a demo

The app can record itself, not the screen, so other windows never end up in a demo:

```bash
WORKBENCH_RECORD=./frames WORKBENCH_RECORD_SECONDS=120 npm start -- --task "What is the #1 story on Hacker News right now?"
```

Frames land in `./frames` as JPEGs, and the compare board opens by itself when every agent is done. `docs/demo.gif` was made this way.

## Smoke test

With the app running:

```bash
npm run smoke            # every enabled agent
npm run smoke -- claude  # just one
```

## Safety notes

- Page text goes to the agent labelled as untrusted data, and the agent is told never to follow instructions found in a page. That reduces prompt injection; it does not eliminate it. Keep panes signed in only where you are comfortable.
- Approval matching is keyword based (`submit`, `pay`, `send`, `post`, `delete`, `제출`, `결제`, `발송`, `게시`, `삭제` …). Treat it as a seatbelt, not a guarantee.
- Claude runs with only `mcp__wb` tools allowed. Codex runs in `read-only` sandbox mode. Antigravity runs with `--dangerously-skip-permissions` in an empty temp folder, because its print mode cannot prompt. Read `src/agents.js` before you change any of this.

## Roadmap

- [x] Compare board: answers and source URLs from all agents in one table
- [ ] Interactive terminal per pane (node-pty) instead of one-shot runs
- [x] Any MCP-capable CLI as a pluggable agent (`agents.json`)
- [ ] Ready-made presets for more CLIs (Gemini CLI, Aider, …)
- [ ] macOS build

## 한국어 요약

AI 에이전트(기본 Claude Code, Codex, Antigravity, 그리고 직접 추가한 CLI나 모델)를 한 화면에 띄우고, 에이전트마다 자기 전용 브라우저 칸을 MCP로 연결한 데스크톱 앱입니다. 질문 하나를 여러 에이전트에게 동시에 주고, 끝나면 비교판(Compare)에서 답, 걸린 시간, 도구 호출 수, 인용한 출처를 나란히 봅니다. 둘 이상이 인용한 사이트는 따로 표시하고, 비교판 전체를 마크다운으로 복사할 수 있습니다. 클릭 하나하나가 화면에 보이고, 제출, 결제, 발송, 게시, 삭제 같은 버튼은 사람이 승인해야 눌립니다. 각자 쓰는 구독(CLI 로그인)을 그대로 쓰므로 API 키가 필요 없습니다.

## License

MIT
