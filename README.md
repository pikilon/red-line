# Modern Conquest: Red Line

An open-source, browser-based 2.5D real-time strategy game set in modern
real-world conflicts — drones, electronic warfare, artillery and asymmetric
armies. Inspired by Red Alert 2 and C&C Generals.

> Status: Phase 0 — project bootstrap. Nothing playable yet.

## Highlights (planned)

* Runs in the browser, works offline (PWA), LAN multiplayer without internet.
* Deterministic Rust simulation compiled to WebAssembly; Three.js 2.5D renderer.
* Real factions: Ukraine and Russia first, then USA, Europe, China, Israel and
  the Axis/insurgency block.
* Data-driven units, balance and computer AI.

## Development

This project is built by AI agents under Spec-Driven Development.

* Agent rules: [`AGENTS.md`](AGENTS.md) and [`.agents/skills/`](.agents/skills/).
* Decisions: [`docs/decisions.md`](docs/decisions.md).
* Roadmap: [`docs/roadmap.md`](docs/roadmap.md).
* Check your toolchain: `scripts/doctor.sh`.

### Harness notes

* **Claude Code** >= 2.1.277 reads `AGENTS.md` natively. Do not add a
  `CLAUDE.md`: it would take precedence and hide `AGENTS.md`.
* **OpenCode** and **Antigravity** read `AGENTS.md` natively.

## License

Code under [AGPL-3.0-or-later](LICENSE), assets under
[CC BY-SA 4.0](LICENSE-ASSETS). Attribution is required: see
[`NOTICE.md`](NOTICE.md).

Not affiliated with Electronic Arts.
