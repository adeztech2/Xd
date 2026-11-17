# Changes in this fixed build

Security
- Removed the hardcoded Supabase DATABASE_URL and password from pg.js and render.yaml.
  render.yaml now uses sync: false, so DATABASE_URL is set in the host dashboard.
  If that password was ever live, rotate it in Supabase.
- Restored the earlier pg.js, which reads DATABASE_URL from the environment only.
- The .ai command no longer sends prompts to a free third-party service by default.
  Set AI_FREE_FALLBACK=1 to enable it.

Restored from the earlier version (regressions in the newer upload)
- session-import.js: bundled pre-keys and encryption sessions are imported again.
- STORE_KEY per linked number in db.js, so shared databases don't collide.
- index.js: per-number instance lock.
- guard.js: exact hostname matching for anti-link, and a kick error guard.
- group-events.js: edit notices come only from anti-edit.js.
- plain-commands.js: rate limiting restored.
- package.json and package-lock.json: link-preview-js and the lockfile restored.
- lib/netsafe.js and commands/keithdl.js restored.

Defaults restored to the safer earlier values in config.js
- antiEdit: false (enable with .toggle antiedit on)
- antiLink action: delete (was kick)
- antiBadword words from the BADWORDS variable (was a hardcoded ['spam'])

Kept from the newer upload
- Level system (plugins/level.js, commands/level.js). Set LEVEL_SYSTEM=false to disable.
- autoReact runtime toggle.
- README repository links.

Not reviewed in depth
- commands/download.js changed in the newer upload (TikTok helpers were removed).
  It passes a syntax check, but test the download commands before relying on them.
