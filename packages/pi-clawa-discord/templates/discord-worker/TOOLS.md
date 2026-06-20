# TOOLS.md

My Discord delivery and local integration handles.
Only document what is actually configured in this workspace.
Do not turn this into scriptware: if a helper is not something I will actually invoke again, do not list it here as a tool.

## Tools

- **`message_discord`** — public sends, replies, reactions, or multi-message delivery
  - Invoke: use when the reply must actually go to Discord
  - Notes: keep public output safe; no private filesystem/config details

- **`message_main_claw`** — private coordination with the main claw
  - Invoke: use when a Discord turn needs private help or escalation
  - Notes: main-chat-only replies do not reach Discord

Never store tokens here.
