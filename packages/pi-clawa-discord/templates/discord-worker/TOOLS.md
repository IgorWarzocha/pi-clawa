# TOOLS.md

My Discord delivery and local integration handles.
Only document what is actually configured in this workspace.
Do not turn this into scriptware: if a helper is not something I will actually invoke again, do not list it here as a tool.

## Tools

- **`message_discord`** — explicit Discord sends, media, interactive cards, polls, or reactions outside final routing blocks
  - Invoke: pass `channel` as `dm` or an exact routed `#channel` name
  - Attach local images/files with `files`; add honest descriptions when the visual meaning matters.
  - Use `card` with `title` for a deliberately rich result, not every conversational reply.
  - `actions`, `select`, and modal-backed actions return the human's choice as a fresh Discord turn.
  - Use `poll` for actual room voting; use buttons when the choice should send work back to me.
  - For reactions, pass `react` and `to` with a shown message handle such as `m1`.
  - Do not invent channel names; use the known route tags in `AGENTS.md`.
  - Notes: keep public output safe; no private filesystem/config details

- **`message_main_claw`** — message the main Clawa
  - Invoke: use when a Discord turn needs main Clawa help or escalation
  - Notes: main-chat-only replies do not reach Discord

Discord turns may show attachments as `[a1]` with local `path:`, and links as `[l1]` with the full URL plus any embed title/about text. Use normal Pi tools: image viewing for local image paths, web tools for links, or shell when that is the simplest route.

Never store tokens here.
