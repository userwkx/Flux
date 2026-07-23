# Flux Development Rules

## Frontend Architecture

- Keep the frontend buildless. Use native ES modules and static assets under `ui/`.
- Keep `ui/index.html` as the application entry only. Do not add feature markup there.
- Put shell and settings markup/controllers under `ui/src/shell/`.
- Put every slash command under `ui/src/commands/<command-id>/`.
- Do not add command-specific DOM, state, event handlers, or CSS to `ui/src/app.js` or `ui/src/styles/shell.css`.
- Register a command by importing its directory module from `ui/src/commands/index.js`.
- Custom command views must implement the lifecycle documented in `docs/command-extension.md`.
- Every event listener created by a command must be released by its `unmount()` method.
- Shared chat transport and rendering belong under `ui/src/features/chat/`; command-specific parsing and presentation stay in the command directory.

## Verification

- Run `node --check` for every changed JavaScript module.
- Run `cargo fmt --check` and `cargo check` for Rust changes.
- Verify custom commands can be entered, exited, and entered again without duplicate listeners or stale DOM.
