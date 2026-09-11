# Provider embedding fallback probe

**Goal:** Determine whether the current relay supports a standard embeddings model other than the failed advanced candidate without overwriting canonical full-capability evidence.
**Root cause:** The current full-capability run explicitly pinned `text-embedding-3-large`. Explicit overrides intentionally disable standard fallback, so its `model-missing` result does not prove that the relay lacks embeddings entirely.
**Why planning is required:** The probe handles a user-authorized credential and sends bounded external requests.
**Acceptance:** Provider inputs remain process-local. A dedicated report and attempt under `.manual-qa` receive the result; canonical full-current, canonical current diagnostic, and preserved full attempt hashes remain unchanged. The run sends one minimal chat, then tries embeddings in the built-in `text-embedding-3-large` to `text-embedding-3-small` order and one moderation route probe. Image, audio, and realtime confirmations are absent. Both report validation and unconditional cleanup pass, and sensitive scans find no persisted inputs.

### Outcome 1: Input and artifact isolation
- Work: Use explicit dedicated report paths accepted by the smoke path policy and run `--validate-inputs-only` before network traffic.
- Stop conditions: Missing/ambiguous provider inputs, unsafe HTTPS shape, invalid model, report path rejection, or any canonical full/attempt hash change.

### Outcome 2: Bounded low-cost request
- Work: Set only chat and low-cost capability confirmations. Keep the embedding and moderation model overrides absent so the checked-in standard fallback list owns candidate order.
- Cost bound: One minimal chat, at most two embeddings requests, and one moderation request. No image, audio, or realtime traffic.
- Promotion rule: This is diagnostic evidence only. Even an embeddings pass cannot close the full-capability blocker while other requested capabilities fail.

### Outcome 3: Validation and cleanup
- Work: Validate the dedicated report, inspect only model attempt/status/failure fields, prove canonical report hashes are unchanged, remove every injected variable in `finally`, and rerun security/local-cleanup/sensitive scans.

## Result

- Input-only validation created no report and sent no request. The live probe then completed in 15.4 seconds with unconditional cleanup.
- Models and `gpt-5-6-pro` chat returned HTTP 200. `text-embedding-3-large` and `text-embedding-3-small` were attempted in order and both returned HTTP 404 `model-missing`.
- Moderation stopped after one `omni-moderation-latest` HTTP 404 `route-missing`; the second standard model was correctly not attempted for a missing route.
- Dedicated report and attempt validation passed. Both are 12,573 bytes / SHA-256 `34167490440E726D0D79F1279826149681F9440A505AC7386780ED929BF52B65` with the current Provider source fingerprint.
- Canonical full-current, preserved full attempt, and no-credential current diagnostic hashes remained unchanged.
