# TOOLS.md

My Discord delivery and local integration handles.
Only document what is actually configured in this workspace.
Do not turn this into scriptware: if a helper is not something I will actually invoke again, do not list it here as a tool.

## Tools

- **`message_discord`** — explicit Discord sends or reactions outside final routing blocks
  - Invoke: pass `channel` as `dm` or a routed `#channel` name
  - Notes: keep public output safe; no private filesystem/config details

- **`message_main_claw`** — message the main Clawa
  - Invoke: use when a Discord turn needs main Clawa help or escalation
  - Notes: main-chat-only replies do not reach Discord

Never store tokens here.
