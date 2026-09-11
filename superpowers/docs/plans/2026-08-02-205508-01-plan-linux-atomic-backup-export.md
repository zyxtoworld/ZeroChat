# Linux atomic encrypted-backup export

**Goal:** Preserve an existing encrypted backup when a replacement export fails before publication.
**Root cause:** The GTK save callback writes directly to the selected destination with `fs::write`, which opens and truncates an existing backup before disk-full, short-write, or other I/O failures are known.
**Why planning is required:** This is a user-data-loss path. Correctness depends on file ownership, permissions, durability ordering, and an explicit atomic publication point rather than a successful happy-path write.
**Acceptance:** Export bytes are written to a unique `create_new` file in the destination directory with Unix mode `0600`, completed with `write_all`, flushed with `sync_all`, closed, atomically renamed over the destination on Linux, and followed by parent-directory sync. Every pre-publication failure removes the temporary file and leaves existing destination bytes unchanged. No fixed recovery temp is shared with snapshot storage, no partial file is exposed at the selected path, and the GTK error path remains localized. A deterministic injected partial-write failure proves the old destination is byte-for-byte unchanged.

### Outcome 1: Failing executable regression
- Work: Add a pure-standard-library atomic-file module test that writes partial bytes and then injects an error before publication. It must assert the existing destination remains unchanged and no export temp remains.
- Red condition: Standalone `rustc --test` compilation fails because the atomic writer does not yet exist.
- Verify: Compile `apps/linux/src/atomic_file.rs` as a standalone test crate into the OS temporary directory and run the resulting test binary.

### Outcome 2: Atomic private-file publication
- Work: Implement unique same-directory temp creation with collision-safe `create_new`, private Unix permissions, complete write and file sync before rename, parent-directory sync after rename, and best-effort temp cleanup on all pre-publication failures. Route encrypted-backup export through this helper and remove direct final-path `fs::write`.
- Boundary: Snapshot storage keeps its fixed recoverable `.tmp` candidate because its crash-recovery semantics differ from ephemeral export ownership.
- Verify: The standalone Rust tests pass, `cargo fmt --check` passes, and a Linux backup source contract proves the GTK path calls the helper after the existing size bound.

### Outcome 3: Guarded evidence
- Work: Add the backup contract to the standard Linux contract command and preserve requirements/audit markers. Record that Windows-host pure Rust evidence does not replace GTK/libadwaita target runtime export QA.
- Verify: Run `check:linux-contracts`, repository health, completion audit, docs, security, and local cleanup. On a Linux target, run the crate tests and an actual overwrite/export visual workflow including an injected storage failure.
