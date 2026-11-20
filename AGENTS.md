# Project instructions

Read README.md and AI_PLAYER_PROMPT.txt before live gameplay. Use this project's unique host and a single persistent client; no second injection session or input controller against a running target.

Keep exact executable/hash verification, pre-resume save isolation, exclusive host/controller ownership, player-stop lock, unknown-action non-replay, and verified native-selection/input release. The host retains its native resources until the isolated child exits. Do not hot-replace running code; offline edits alone do not justify stopping a healthy runner. Deploy only after verified release and normal game exit.

Use focused checks for changed boundaries. Native business claims need actual game evidence; no full test/build of the other projects. Package only the public-source allowlist. Never include game/, .venv/, runtime/, evidence/, research/, generated/, local saves or credentials in a release.
