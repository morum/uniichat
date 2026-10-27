UniiChat (arteeh's fork)
========================

UniiChat is an AI agent with one chat that never ends. There is no "new
chat" button: you talk to the same agent for days, weeks, years, and it
remembers. This fork runs it as your own server, for you alone. The
original is [VictorTaelin/uniichat](https://github.com/VictorTaelin/uniichat).

**This repo is vibe-coded.** AI agents wrote nearly all of it, and AI
agents reviewed it. Expect bugs.

Features
--------

- **One chat, a memory tree.** Every message is summarized into one line,
  and neighboring lines are merged in pairs, again and again. Each call
  sees the whole chat, recent messages in detail and older ones in
  broader lines, and can zoom into any line down to the original message.
- **Agents and devices.** Unii runs a shell, reads and edits files and
  views images and videos on your computers that run `unii device`. It
  spawns subagents, which work in the background and report back. A
  subagent may spawn its own (Unii's are depth 1, theirs 2, no deeper;
  at most 4 at work under one of Unii's, 12 in all): each report goes to
  the agent that started it, which waits for its agents before its own.
  No subagent may merge, push to main or tags, restart the serve or
  deploy: the serve refuses such a shell command (Guard.ts), and a push
  that doesn't name its branch (`git push`, `git push origin HEAD`),
  which may land on main; `git push origin HEAD:feat/x` goes through.
  The vigia resumes an agent silent for 10 minutes once, telling its
  parent (or the chat), and reports it stalled if it stops again, or if
  its call doesn't end a minute after the vigia stopped it.
- **Schedules, goals, imports.** It can message itself on a schedule,
  keep working until a `/goal` is met, and take in your past Claude Code
  and Codex sessions (or the websites' exports).
- **Web, phone and terminal.** The server hosts the web app (installable,
  with push notifications); `unii` is the same chat in a terminal.
- **Pending list (pendências).** Unii keeps what it needs of you beside
  the chat: approvals, decisions, steps only you can do. A task may wait
  for others (shown once they're closed), ask several things at once
  (fields: one choice, many, a text, yes or no; each answer kept as a
  draft till you conclude), and have a thread: talk with Unii about it
  without resolving it (your message is a message of the chat, marked
  `[Pendência P7: …]`; it shows "aguardando o Unii", then "sua vez" if
  the next step is yours, or "Unii respondeu" on one of Unii's; "Unii
  não respondeu" if the turn ended with no reply). "Aguardando o Unii"
  says how long and why (a turn running, a usage limit, none), and that
  the reply comes when Unii answers there or its turn ends; a server
  that starts with no turn to resume gives such a task back at once,
  "Unii não respondeu (o servidor reiniciou antes da resposta)", so it
  never waits for a turn that may not come. A task that waits for
  something outside the list ("aguarda: CI do #42") is a wait, not your
  move: out of Agora, no push, not counted, never late, till the wait
  is removed.
  On the web, the **Mesa** is the list as a screen of its own, beside
  the **Conversa** (the header's button, or `m`; the Conversa shows no
  list, only the button's count, "Mesa · 3"): tasks grouped by whose
  move it is (Agora, Aguardando o Unii, Em andamento, Aguardando outras
  pendências, Resolvidas recentemente), searched and filtered by project,
  the one picked whole at the right: first a line saying whose move it
  is and what's expected ("Sua vez: escolha uma das 3 opções…", "Com o
  Unii: nada a fazer agora"), then what to read and decide, with its
  ficha beside (whose, origin, front, kind and limit, depends on and
  frees, PRs with verdict and head, fields left, agent, next step,
  dates) (on a phone, list and task one at a time, the ficha after the
  decision, the actions kept at the screen's bottom); `j`/`k` or the arrows move, Enter opens, `/` searches, Esc goes
  back. A task of yours open over a day says how late ("atrasada há
  2 d", as the late push counts it); the GitHub PRs it links show as
  `repo#n` in its row and over its detail; once one is resolved, the
  next of Agora is a click away ("Próxima"); Concluir with a required
  field empty marks it and sends nothing. The site opens on the Mesa when a task is your move, else on the
  Conversa; a tab opened before the server restarted with a new site
  reloads itself.
  No task closes without a concrete, documented solution: Unii closes
  one only with **evidence** the server checks (a Slack message sent,
  by channel and ts; a PR merged, read live with `gh`; a commit and its
  tests, the commit read live; a Terraform Cloud run applied; a file
  that exists; a reason in words only to drop one); the user's own
  resolution is its evidence. Each task says what makes it done
  (`done_when`); one of Unii's, its next step and when it's due
  (`next_step`, `next_due`), "prazo vencido" past it (in the views, in
  Unii's block, and one push, "Pendência P48 do Unii está parada além do
  prazo"; with no `next_due`, `task_stall` hours after it last moved, 4
  by default). A choice of Unii's (acts: unii) picked by the user is an
  **order received**: open, Unii's, closed only with evidence of the
  execution (the user may cancel it). A task may be **blocked** (why,
  what unblocks it) or **waiting for you** (in your Agora). One closed
  before this, without evidence, reads "sem evidência": Unii may prove
  it, or it's opened again; nothing is erased. A reply of Unii's that
  promises something for later with no task of its own gets a note; one
  that asks you something (a question, a decision, an order to give) with
  no task of yours about it gets one, "Pergunta sem pendência" (a decision
  with a text field for your answer, the question in its detail), made by
  the serve, and a note (`Tasks.questions_in`: a heuristic; quotes, code,
  headings, questions Unii answers itself, another's questions reported and
  questions to others don't count). A task of yours is the question's if
  its id is in the question's paragraph, if it was made in that turn with
  words of the question, or if Unii said the question in its thread; one
  about something else doesn't count. Limits: only the turn's last reply is
  read (a question in an earlier message of the turn, followed by tools,
  isn't seen); at most 3 questions of a reply go in the task; a rhetorical
  question said last, or a request in other words, may be misread; a
  short phrase with "?" that isn't a question counts ("Rodei x? ok."
  asks "Rodei x?"); a word in common with a task of yours made in the
  turn about something else spares a question ("Revisar o hospitalar#700"
  spares "Quer que eu mescle o hospitalar?"). A request negated just
  before it ("Não depende de ordem sua.", "Nenhum agente depende de
  ordem.") asks nothing; one on the order of your name ("Depende da ordem
  do Guilherme.") asks you only with `owner_name` set. "Me avise se
  falhar." and "Se falhar, me avise." (an instruction on an event) and
  "Ele não decide, você decide." (who decides, by contrast) ask nothing;
  "Me avise se posso seguir.", "Não está ok?" and "Falta só a sua
  aprovação." ask, as meant ("Não falta a sua aprovação." doesn't), and
  so do "Se quiser, me avise.", "Me avise caso aprove.", "Me avise caso
  discorde." and "Me avise caso não queira." (the user's will, also
  denied), "Me avise caso precise de algo." and "Me avise se não
  gostar." (a need or a liking), and "Se mesclar, me avise." (an act of
  the user's with no subject: mesclar, aplicar, assinar, publicar,
  revisar, validar, confirmar, responder; "Se o CI mesclar, me avise."
  doesn't). Limits: "Me avise quando falhar." and "Quando terminar, me
  avise." ask ("quando" isn't read as an event), and so does "Rodei os
  testes? ok." ("Rodei os testes?"); an event said with one of those
  verbs and no subject ("Se publicar, me avise.", meaning the pipeline)
  asks. "precisar" with no subject is always read as your need, so "Me
  avise caso precise reiniciar o serve." asks you even when it is Unii
  or the pipeline that needs the restart.
  Terminal: `/mesa [projeto]`, `/p`, `/p P7`, `/ok P7 [opção] [campo=valor…] [comentário]`,
  `/ok!`, `/rascunho P7 campo=valor`, `/conversa P7 mensagem`,
  `/descartar`, `/reabrir`, `/avisar`.

What this fork adds: one owner per server, no accounts or email; Claude
and ChatGPT plans as vendors (`claude-sub`, `openai-sub`), and a Cursor
plan (`cursor`), beside API
keys; profiles that fall back to the next model when one is out; waiting
out usage limits; MCP servers (also run on a device); skills; image and
video viewing; an editable user prompt and compaction prompt; a memory
tree browser.

Install and set up
------------------

On Linux or macOS (Windows: WSL):

    curl -fsSL https://github.com/arteeh/uniichat/releases/latest/download/install.sh | sh

This installs `unii` to `~/.local/bin`; `unii update` installs the
newest release. The installer also moves data from older versions.

1. **Start the server** on the computer that keeps your chat (as a
   systemd user service, say): `unii serve` serves http://127.0.0.1:8788;
   its data is in `~/.unii` (`$UNII_DIR`). Put it behind HTTPS (e.g.
   `tailscale serve`) to reach it from elsewhere, and set `site` to that
   address.
2. **Sign in.** On the server's computer, `unii serve link` prints a link
   that signs a browser in. A terminal or a device signs in by a link and
   a code you confirm in that browser. `unii serve sessions` lists them;
   `unii serve revoke <n>` (or `--all`) signs one out.
3. **Pick a vendor.** In the web app, ☰ › Settings: vendors, models and
   API keys (kept in `~/.unii/keys.json`). For a plan instead of keys,
   run `unii serve claude` (Claude), `unii serve chatgpt` (ChatGPT) or
   `unii serve cursor` (Cursor) on the server's computer, then pick
   `claude-sub`, `openai-sub` or `cursor`. Each takes `logout` or
   `status`. Cursor (Cursor.ts) runs the Cursor CLI (`cursor-agent`,
   installed with `curl https://cursor.com/install -fsS | bash`) in
   bubblewrap (`bwrap`, needed): a read-only root, an empty home (of
   `~/.local`, only the CLI's version dir), an empty `/tmp`, `/run` and
   `/var/lib` (no session D-Bus, gpg-agent, keyring nor `docker.sock`;
   only the DNS resolver's dir of `/run` is put back, read-only), its own
   pid and ipc namespaces, umask 077 (so the CLI config it rewrites stays
   0600), its own tools denied, ours over MCP. The network is shared: it
   still reaches this host's ports and abstract sockets. It takes a
   Cursor key on the Settings page instead of a sign-in, too (handed to
   it in its environment, never on a command line). A message sent while
   its turn runs goes in only as that turn ends (the CLI takes no input
   mid-turn, unlike Claude Code): its session is resumed with it, told
   that its reply was already shown, so it doesn't write that reply
   again; the call's end (a subagent's report) holds both replies. Its
   models: opus-5.5, sonnet-5.5 and haiku-5.5 (as at Claude's vendors),
   gpt-5.6-sol, grok-4.7 and
   composer-2.5; a subagent is put on it by `cursor:<model>` (spawn's
   `model`), as a reviewer on `cursor:sonnet-5.5`.
4. **Add devices.** On each computer Unii may work on, run `unii device
   https://your-server` once by hand: it prints a link and a code to
   confirm in your browser. Its work dir is `~/.unii/work`; its settings
   are in `~/.config/unii/device.json`. Then keep it up as a service,
   e.g. `~/.config/systemd/user/unii-device.service`:

       [Service]
       ExecStart=%h/.local/bin/unii device
       Restart=always
       [Install]
       WantedBy=default.target

   `systemctl --user enable --now unii-device` (and `loginctl
   enable-linger` to run it while you're logged out).

   A shell call has a time limit: `timeout` seconds, 600 by default, 3600
   at most. Past it, its process group gets SIGTERM, then SIGKILL 5 s
   later, and the call answers its output so far, ending `(timed out
   after N s: killed)`. A process that left the group (`setsid`) lives on
   till a stop or the device ends, but can't keep the call waiting.
   `view_video` is cut at 300 s; `read`, `write` and `edit` refuse a
   FIFO, device or socket, which would block the device. The server ends
   a job on its own 30 s past a shell's or view_video's limit (120 s for
   `read`, `write`, `edit`, `skill`) and tells the device to kill it: so
   a device running an older unii, which keeps no limit, is covered too,
   though its output so far is lost.

The server's settings are in `~/.unii/config.json` (most are on the
Settings page). Each may also be set as `UNII_<KEY>`, which wins. Besides
`vendors`, `models`, `pick`, `compactor`, `agents`, `profiles` and `site`:

- `mcp`: MCP servers, in Claude's `mcpServers` shape (or a file path).
  Add `"device": "<name>"` to run one on a device.
- `after`: a shell command run after each turn.
- `claude_sub`, `claude`, `chatgpt`: where the plans' sign-ins are kept.
- `cursor_sub` (its calls' dirs, `~/.unii/cursor-sub` by default),
  `cursor_login` (where its sign-in is kept, an XDG_CONFIG_HOME:
  `~/.unii/cursor-sub/xdg` by default, `~/.config` for this computer's
  own Cursor sign-in), `cursor` (the CLI's executable; by default
  `cursor-agent` or `agent`, on the PATH or in `~/.local/bin`),
  `cursor_sandbox` (`bwrap`, the default, or `off`: never on a server
  others' code may reach), `cursor_idle` (seconds a turn may go without
  a word, no tool running, before it's stopped and asked once to go on:
  600).
- `apple`, `apns`: the iOS app's (ios/) App ID and push key id.
- `task_stall`: hours a task of Unii's may stand still, with no
  `next_due`, before it's overdue (4 by default; read at the start).
- `owner_name`: your names as the chat calls you, comma-separated
  ("Guilherme"), so "depende da ordem do Guilherme" is a question to you
  (none by default; read at the start).
- `agents_depth`, `agents_front`, `agents_max`: how deep a tree of
  agents goes (2), how many may be at work under one agent of Unii's
  (4) and in all (12); `vigia_minutes`: how long an agent at work may
  show no sign of life (no output, no tool running, no usage limit)
  before the vigia resumes it (10). All read at the start.

The prompts: `~/.unii/prompt.md` (every turn; subagents get it too)
and `~/.unii/compact.md` (every summary, nothing else) replace the
built-in `prompt.txt` and `compact.txt`. Edit them on the Settings page.

Use
---

- **Web:** the server's address. ☰ has Settings, the memory tree, Import
  History and the MCP servers on or off.
- **Terminal:** `unii [url]` (default: `$UNII_URL`, else the last server,
  else the local one). `/help` lists its commands; `/import` brings in
  this computer's Claude and Codex sessions.
- `unii help` lists every command. Once a day the terminal asks GitHub
  for the newest release; `UNII_NO_UPDATE_CHECK=1` turns that off.

From source (Bun): `bun install`, `bun run web` (rebuilds web/app.js),
`bun Cli.ts <command>`, `bun run build` (one `unii` executable).
`bun test` runs every test on a fresh `/tmp/unii-test-*` data dir
(TestSetup.ts, preloaded by bunfig.toml), never on real data.

Q&A
---

**Can Unii use my screen?** Not by itself: add a computer-use MCP server,
such as [cua-driver](https://github.com/trycua/cua/tree/main/libs/cua-driver),
run on that device:

    "mcp": { "screen": { "command": "cua-driver", "args": ["mcp"], "device": "my-mac",
             "env": { "CUA_DRIVER_RS_TELEMETRY_ENABLED": "0" } } }

**Can others use my server?** No: a server has one owner. Anthropic and
OpenAI don't allow sharing a plan, either.

**Upgrading from arteeh.16 or older?** Stop the server first (`systemctl
--user stop unii-serve`), run the installer, then start it: it moves your
data to the new layout and won't while a server runs. Your user prompt is
then fixed in `prompt.md` (empty it on the Settings page to get later
built-in changes). The terminal is no device any more: set up `unii
device` (above) on each computer Unii should work on.

License
-------

Apache-2.0 (LICENSE). Copyright 2026 Higher Order Company.
