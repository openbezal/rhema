# Rhema — Project Rules

## Fork Management

This project is a fork of `openbezal/rhema`. The remotes are:
- `origin` — `https://github.com/edgdmedia/rhema` (our fork, push here)
- `upstream` — `https://github.com/openbezal/rhema` (source project, pull updates from here)

### Pulling upstream updates
```bash
git fetch upstream
git merge upstream/main
```

### Minimizing merge conflicts
- Keep customizations **modular and isolated** — add new files rather than rewriting core files
- Example: add `src-tauri/crates/stt/src/whisper.rs` for a new STT provider rather than editing `deepgram.rs`
- Commit changes with clear messages so it's easy to identify what is ours vs upstream
- Pull from upstream **regularly** — don't let the fork drift months apart
- When a customization is polished, **open a PR to upstream** so we no longer need to maintain that divergence

### Contributing back
- Bug fixes, UX improvements, new STT providers, additional Bible translations, and better ARM64/Apple Silicon support are all good PR candidates
- Keeping contributions upstream reduces our long-term maintenance burden
