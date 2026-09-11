# Claudian

<p>
  <img src="https://img.shields.io/github/v/release/vrevolverrr/claudian" alt="GitHub release" vspace="10">
  <img src="https://img.shields.io/github/license/vrevolverrr/claudian" alt="License" vspace="10">
</p>

An Obsidian plugin that embeds AI coding agents (Claude Code, Antigravity, Codex, Grok, Opencode, and Pi) in your vault. Your vault becomes the agent's working directory — file read/write, search, bash, and multi-step workflows all work out of the box.

![Preview](assets/Preview.png)

This is a fork of [Claudian](https://github.com/YishenTu/claudian) by Yishen Tu (see [claudian.md](https://claudian.md/) for the original). It adds Google's Antigravity CLI (`agy`) as a provider and removes Collab mode. It uses its own plugin id (`claudian-agy`), so it installs alongside the original rather than replacing it — both appear as "Claudian" in the plugin list, told apart by their descriptions.

## Features & Usage

Open the chat sidebar from the ribbon icon or command palette. Select text and use the hotkey for inline edit. Everything works like your familiar coding agent, Claude Code, Antigravity, Codex, Grok, Opencode, and Pi — talk to the agent, and it reads, writes, edits, and searches files in your vault.

**Inline Edit** — Select text or start at the cursor position + hotkey to edit directly in notes with word-level diff preview.

**Slash Commands & Skills** — Type `/` or `$` for reusable prompt templates or Skills from user- and vault-level scopes.

**`@mention`** - Type `@` to mention anything you want the agent to work with, including vault files, subagents, and files in external directories.

**Plan Mode** — Toggle via `Shift+Tab`. The agent explores and designs before implementing, then presents a plan for approval.

**Instruction Mode (`/instruction`)** — Refined custom instructions added from the chat input.

**MCP Servers** — Connect external tools through each coding agent's native CLI-managed MCP configuration.

**Tabs & Session Management** — Use multiple tabs in single-panel mode or a persistent session manager beside the chat in dual-pane mode.


## Requirements

- At least one of the following harnesses:
  - [Claude Code CLI](https://code.claude.com/docs/en/overview)
  - [Antigravity CLI](https://antigravity.google/) (`agy`)
  - [Codex CLI](https://github.com/openai/codex)
  - [Grok Build](https://github.com/xai-org/grok-build)
  - [OpenCode](https://github.com/anomalyco/opencode)
  - [Pi](https://github.com/earendil-works/pi)
- A compatible subscription or API provider, such as [OpenRouter](https://openrouter.ai/docs/guides/guides/claude-code-integration), [Kimi](https://platform.kimi.ai/docs/guide/claude-code-kimi), [GLM](https://docs.z.ai/devpack/tool/claude), or [DeepSeek](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code) etc.
- Obsidian v1.13.0+
- Desktop only (macOS, Linux, Windows)
- Node 24.x, to build the plugin

## Installation

This fork is not in the Obsidian community plugin catalogue and will not be submitted to it — searching "Claudian" there installs the original. Build it from source instead. There is no tagged release yet, so there are no prebuilt files to download.

1. Clone the repository anywhere on disk. It does not need to live inside your vault:
   ```bash
   git clone https://github.com/vrevolverrr/claudian.git claudian-agy
   cd claudian-agy
   ```

2. Point the build at your vault:
   ```bash
   echo 'OBSIDIAN_VAULT=/path/to/vault' > .env.local
   ```
   `OBSIDIAN_VAULT` also works as an ordinary environment variable if you prefer not to write the file.

3. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```
   The build creates `<vault>/.obsidian/plugins/claudian-agy/` and copies `main.js`, `manifest.json`, and `styles.css` into it. The folder is named after the `id` in `manifest.json`, so it never overwrites an existing Claudian install.

4. In Obsidian, open Settings → Community plugins, reload the installed plugin list, and enable "Claudian". Both this fork and the original show up under that name; the description tells them apart.

If you skip step 2, `npm run build` still writes `main.js`, `manifest.json`, and `styles.css` to the repository root. Copy those three files into `<vault>/.obsidian/plugins/claudian-agy/` yourself, creating the folder first, then reload Obsidian.

### Development

```bash
# Watch mode
npm run dev

# Production build
npm run build
```

With `OBSIDIAN_VAULT` set, watch mode reinstalls into the vault on every rebuild; use Obsidian's "Reload app without saving" command to pick up the change.

## Privacy & Data Use

- **Sent to API**: Your input, attached files, images, and tool call outputs. Depending on the selected provider, data is sent to Anthropic (Claude), Google (Antigravity), OpenAI (Codex), xAI (Grok), or the providers configured in OpenCode or Pi. The destination can be configured through provider settings and environment variables.
- **No telemetry or unsolicited background activity**: Claudian does not run telemetry beacons. UI polling timers read local Obsidian/editor selection state only. Network activity is limited to explicit provider runtime work, configured MCP endpoints, provider SDK/CLI calls needed to answer your requests.

## Troubleshooting

The following sections use Claude Code as an example.

### Provider CLI not found

If Claudian cannot auto-detect a provider CLI, verify that the CLI is installed and available to GUI applications through PATH. Typical errors include `spawn claude ENOENT` and `Claude CLI not found`. This issue is common with Node version managers (nvm, fnm, volta).

Leave the CLI path setting empty first so Claudian can auto-detect the CLI. If auto-detection fails, find the executable path and set it in Settings → Advanced → Claude CLI path.

| Platform | Command | Example Path |
|----------|---------|--------------|
| macOS/Linux | `which claude` | `/Users/you/.volta/bin/claude` |
| Windows (native) | `where.exe claude` | `C:\Users\you\AppData\Local\Claude\claude.exe` |
| Windows (npm) | `npm root -g` | `{root}\@anthropic-ai\claude-code\cli-wrapper.cjs` |

> **Note**: On Windows, avoid `.cmd` and `.ps1` wrappers. Use `claude.exe` for native installs, or `cli-wrapper.cjs` for package-manager installs. `cli.js` is only a legacy fallback for older Claude Code npm packages.

**Alternative**: Add your Node.js bin directory to PATH in Settings → Environment → Custom variables.

### npm CLI and Node.js not in the same directory

When using an npm-installed provider CLI, make sure its executable and Node.js are available from the same environment. Check their paths:

```bash
dirname $(which claude)
dirname $(which node)
```

If the paths differ, GUI apps like Obsidian may not find Node.js.

Either:

1. Install the native binary (recommended).
2. Add the Node.js path in Settings → Environment: `PATH=/path/to/node/bin`.

### More help

For provider-specific installation and configuration guidance, refer to the provider documentation linked in the [Requirements](#requirements) section. If you have a feature request or run into a bug, please [submit a GitHub issue](https://github.com/vrevolverrr/claudian/issues) on this fork.

## Architecture

```
src/
├── main.ts                      # Plugin entry point
├── app/                         # Application services and storage
├── core/                        # Provider-neutral runtime, registry, and type contracts
│   ├── runtime/                 # ChatRuntime interface and approval types
│   ├── providers/               # Provider registry and workspace services
│   ├── auxiliary/               # Shared provider auxiliary services
│   ├── bootstrap/               # Plugin bootstrap wiring
│   ├── security/                # Approval utilities
│   └── ...                      # commands, prompt, storage, tools, types
├── providers/
│   ├── claude/                  # Claude SDK adaptor, prompt encoding, storage, MCP, plugins
│   ├── agy/                     # Antigravity CLI adaptor, NDJSON stream mode, model discovery
│   ├── codex/                   # Codex app-server adaptor, JSON-RPC transport, JSONL history
│   ├── grok/                    # Grok Build ACP adaptor, native history, models, and tools
│   ├── opencode/                # Opencode adaptor
│   ├── pi/                      # Pi RPC adaptor, model discovery, JSONL history
│   └── acp/                     # Agent Client Protocol shared transport
├── features/
│   ├── chat/                    # Sidebar chat: tabs, controllers, renderers
│   ├── inline-edit/             # Inline edit modal and provider-backed edit services
│   └── settings/                # Settings shell with provider tabs
├── shared/                      # Reusable UI components and modals
├── i18n/                        # Internationalization (10 locales)
├── types/                       # Shared ambient types
├── utils/                       # Cross-cutting utilities
└── style/                       # Modular CSS
```

## Contributing

Issues and focused pull requests are welcome. Issues are the preferred starting point: describe the problem, reproduction steps, and environment clearly so it can be investigated.

Pull requests must explain the problem, the proposed solution, why the approach is appropriate, and how the change was validated.

## License

Licensed under the [MIT License](LICENSE).
