# Modern Conquest: Red Line

An open-source, browser-based 2.5D real-time strategy game set in modern
real-world conflicts — drones, electronic warfare, artillery and asymmetric
armies. Inspired by Red Alert 2 and C&C Generals.

> Status: Phase 2 core RTS loop done. Phase 3 (computer AI and balance) next.

## Highlights (planned)

* Runs in the browser, works offline (PWA), LAN multiplayer without internet.
* Deterministic Rust simulation compiled to WebAssembly; Three.js 2.5D renderer.
* Real factions: Ukraine and Russia first, then USA, Europe, China, Israel and
  the Axis/insurgency block.
* Data-driven units, balance and computer AI.

## Development

This project is built by AI agents.

* Decisions: [`docs/decisions.md`](docs/decisions.md).
* Roadmap: [`docs/roadmap.md`](docs/roadmap.md).
* Check your toolchain: `scripts/doctor.sh`.

### Agent instructions

[`AGENTS.md`](AGENTS.md) is the only agent instruction file. Claude Code,
Antigravity, DeepSeek Harness (`dsh`) and OpenCode read it natively. Do not add
`CLAUDE.md`, `.cursor/` rules or similar: a tool that looks for its own file
must be configured to read `AGENTS.md` instead.

## License

Code under [AGPL-3.0-or-later](LICENSE), assets under
[CC BY-SA 4.0](LICENSE-ASSETS). Attribution is required: see
[`NOTICE.md`](NOTICE.md).

Not affiliated with Electronic Arts.
