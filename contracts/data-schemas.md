# Personal project data contracts / v1

**PROJECT REQUIREMENT:** keep reference provenance, tracking observations, model suggestions and pedagogical correctness distinct. No ordinary-practice video, screenshots, audio or continuous landmark histories are persisted/uploaded.

## Active local adapter

IndexedDB `fsl-personal-practice`, version 1, `sessions` key `id`. This is **one local browser profile, not account authorization**. The production server serves dist only and never reads this database.

`src/storage.js` writes an explicit allowlist: schemaVersion, id, kind, mode, draftContentId, startedAt, durationMs, sampledFrames, framesWithHands, trackingLatencyMeanMs, recognition, detailedCorrection='unavailable', reviewNote. Only an explicit Save summary commits an attempt. Notes are trimmed, limited to 2,000 characters and saved on request. No fictional learner data is inserted.

Modes: tracking-only or experimental-recognition. Recognition is either not-configured, suggestion with a supported signId/label, unknown, insufficient-tracking, cancelled or error, with the model version when applicable. classifierMs is classifier/preprocessing call time, not camera-to-display latency or signing quality. No confidence/correctness/mastery percentages are persisted.

Read/write transactions prune entries outside the last 30 days and beyond the newest 200 attempts. Pruning occurs when the app opens/updates the log, not while the browser is closed. IndexedDB errors are surfaced; the UI does not confirm a save before transaction completion. Deletion removes summaries and their notes in the same store after confirmation. Export creates user-requested local JSON; it does not upload anything.

Anyone using the same browser profile can read its log. Another origin/profile is separate; clearing browser site data deletes it. No cloud sync, remote teacher accounts or shared class records. Do not collect others’ or children’s personal data here.

## Reference / model files

`src/content.js` distinguishes attributed FSL-105 research references from pending alphabet/zero planning labels. `public/references/provenance.json` records source/license/modifications and hashes. Published expert-review descriptions do not establish a complete approved curriculum.

`public/models/numbers/manifest.json` describes only the experimental five-number CNN: exact ordered labels/sign IDs, shared preprocessing version, 24×64 shape, four-second capture, coverage requirements, calibration/rejection policy, prototypes, provenance and artifact hashes. `evaluation.json` must match both model and weight hashes before initialization succeeds. Validation/correctness claims remain disabled separately in `src/model-contract.js`.

## Eventual cloud boundary — not implemented

| Path | Intended minimum contract / authorization |
| --- | --- |
| `signs/{signId}` | schema/lexicon/language/category/label/variants/capture requirements, expert approval, rights/consent/attributed media. Trusted administration only. |
| `users/{uid}/sessions/{sessionId}` | Immutable owner, bounded allowlisted aggregate fields, mode/result versions, timestamps/expiry; verified owner only. No client role grants. |
| Derived progress | Real owner-session counts/time, not invented mastery or demo rows. Delete with source records. |
| `teacherAssignments/{id}` | learner/teacher/scope/consent/expiry, established by a trusted authority—not client-created assignment or hidden-button authorization. |

Firebase SDK/auth/Firestore/Hosting are not active. Existing rules remain **deny-all** and emulator rejection tests are supplied but not run on the Personal Mac. Before cloud/school use: agree identity/teacher authority/retention/consent, implement both positive owner paths and rejection paths, run emulator tests, and independently review Admin/server authorization. Local deployment does not authorize that work or any public publication.
