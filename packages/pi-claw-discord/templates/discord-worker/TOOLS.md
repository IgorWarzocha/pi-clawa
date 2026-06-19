# TOOLS.md

Discord delivery and local integration handles for this worker.
Only document what is actually configured in this workspace.

## Tools

- **`message_discord`** — explicit public sends, replies, reactions, or multi-message delivery
  - Invoke: use the Pi tool when the reply must go to Discord
  - Notes: keep public output safe; no private filesystem/config details

- **`message_main_claw`** — private coordination with the main claw
  - Invoke: use when a Discord turn needs private help or escalation
  - Notes: main-chat-only replies do not reach Discord

Never store tokens here.
