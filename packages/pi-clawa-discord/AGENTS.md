# Native Discord adapter

- One Pi session owns one home-local bot. Resolve config and history from that session's cwd, never the parent Clawa or inherited token variables.
- Keep the turn coordinator independent of Discord.js and Pi. The session owns preparation, routing and connection lifetime; do not restore worker polling, shared channel routing or a subprocess.
- Discord enters through a real Pi user kickoff so preparation hooks run. Only explicit output blocks or the send tool leave the tab.
- Acquire the token connection lease before opening Discord. Release only after network work drains. Its SQLite lock is OS-owned; never unlink a live lease file.
- Archive journals are retained history writes, not cache. Replay in order before reporting recovery.
- Preserve core recall and home identity. This package adds Discord tools, not a second personality or memory owner.
- Validate through the root strict gate. Keep ordinary tests offline and at owned boundaries; live bot checks require deliberate credentials and destinations.
