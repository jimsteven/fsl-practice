# FSL / Personal practice

A locally deployed personal Filipino Sign Language practice desk, **not a translator or signing assessment**. Project: `/Users/jim/projects/fsl-practice` on Jim’s Personal Mac. Original brief: `fsl-build-prompt.txt`.

## Open it

On the **Personal Mac**, visit **http://localhost:5173**, or double-click `start.command` in this folder. A macOS login service, `com.jim.fsl-practice`, serves the built app on loopback and starts at login. It does not expose the app to the internet or other devices. The camera requires localhost/HTTPS and an explicit permission grant.

The project-local Node **26.13.0** arm64 runtime is under `.tools/`; it was checked against Node’s published checksum. No global Node/Homebrew install, Firebase project, cloud deployment, commit or push was performed.

## What is usable

- **30 attributed local FSL-105 videos:** 10 greetings, 10 everyday communication signs, and numbers 1–10. Native play/pause and 0.5×/0.75× speed. Source orientation is not mirrored. These are published research examples, not a complete approved teaching curriculum.
- **Automatic camera/MediaPipe tracking in Practice**, with up to two hands and 21 points per hand. Chrome reuses its saved site permission; if permission is absent or expired, Chrome must ask again. No Start/Stop camera controls: leave Practice to release the camera. Preview mirroring and aligned landmarks are display options. No microphone, recording or frame uploads.
- **Guided practice.** Begin attempt runs a three-second countdown before the timed check. The camera caption gives framing cues (no hand, two hands for a number, hand outside the frame, too small, too close, good position); they describe framing only, never signing correctness. After a check, **Try again** repeats it and **Next sign** moves to the next reference in the same group (One→Five cycle for numbers). Unsaved summaries are discarded when moving on.
- **Webcam test (`#test`).** A guided four-minute check of the experimental model on your own webcam: numbers One–Five three times each, six non-number signs and two no-hand checks, in shuffled rounds with countdowns and automatic advance. Correct suggestions, wrong suggestions and refusals are counted separately, with a per-sign table. Each check's hand landmarks and model answer are saved through the local server to `.tools/webcam/<session>.jsonl` (no video), so failures can be analysed and the model re-scored or retrained without signing again. Pause, Redo last check and End test now are available.
- **Automatic experimental CNN matching for number focuses 1–5.** Select a supported number and the model loads automatically, then Begin attempt starts a four-second check after the countdown. Other signs use tracking only. Suggestions may be declined, or wrong; they are not correctness scores. Missing/incompatible/tampered model assets fall back to tracking with an explicit Retry recognition action.
- **Deliberately saved sessions survive reload.** IndexedDB stores aggregate observations, optional model suggestions and review notes—not video or landmark histories. (Only the Webcam test page saves landmarks, to the project folder.) The log keeps up to 200 attempts from the last 30 days, pruning when opened/updated. Sessions supports JSON export and confirmed deletion.
- **Review uses your actual saved attempts**, not fictional learners. Write personal notes or review together in the same browser. This is not authenticated or remote teacher access.

Use the same **localhost:5173 address and browser profile** each time. Another browser, incognito, 127.0.0.1 or clearing site data produces a separate/empty log. Export before changing browsers. Anyone with access to this browser profile can read its log; do not collect third-party/child learner records or sensitive notes.

Navigation, hiding the tab and teardown release camera tracks/workers. Returning to Practice or the visible tab starts the camera automatically; camera errors require Retry camera rather than repeated permission prompts. Chrome controls remembered permission, not app storage; choose a persistent Allow option in Chrome if offered, rather than a one-time grant. Changing focus keeps the camera stream running but discards the unsaved attempt/result and selects recognition automatically. Leaving Practice also discards unsaved attempts. Saved records are not automatically shared anywhere.

## Recognition evidence, not a headline accuracy claim

Trained locally on genuine **FSL-105 v2**, Isaiah Jassen Tupal (2023), **CC BY 4.0**. Full archive SHA-256 and all 160 selected source clips were checked. Attribution, source links, modifications and per-file hashes: `public/references/provenance.json`.

Current model **fsl105-numbers1-5-other-cnn-v2** (2026-11-02): six outputs (One–Five plus an "other" class that always abstains), trained with 688 more FSL-105 clips as unsupported examples and with augmentation; preprocessing **one-hand-main-segment-xyz-v3**. Details: `training/README.md`.

FSL-105 contains two byte-identical clip pairs filed under both Four and Seven (`clips/23/6`=`clips/26/7`, `clips/23/8`=`clips/26/9`). They are now dropped from every split, so the original test split has **19** supported clips. Before and after on that same deduplicated test split (before = the previous v1 model and preprocessing):

| Held-out FSL-105 test | Before (v1) | After (v2 model, v3 preprocessing) |
| --- | --- | --- |
| Numbers 1–5 correctly accepted | 10/19 | **11/19** |
| Wrong number accepted | 0 | **0** |
| Declined | 9 | 8 |
| Unsupported clips falsely matched | 1/405 | 1/405 (Seven `clips/26/8` → Four) |
| …of which unseen signs (never in training/calibration) | 0/191 | 0/191 |

A replay of the real Webcam test page with held-out clips at the camera boundary (`training/replay-webcam-test.mjs`, 15 number checks and 8 should-refuse checks) gave **12/15 correct, 0 wrong, 3 refused, 8/8 refusals** after, versus **10/15 correct, 0 wrong, 5 refused (1 for tracking), 8/8 refusals** when the same captured landmarks are scored by the previous model and preprocessing. Replay uses the same signers and clips as the dataset test.

This is a small **clip-disjoint, not signer-independent** dataset test. It does not establish webcam accuracy or pedagogical correctness. A steady genuine source frame is the positive browser-integration control; full video may yield Five or abstention. Thresholds are selected on calibration rows only and were not relaxed after test results.

`public/models/numbers/evaluation.json` contains per-clip results/confusion and classifier-only timing; `manifest.json` contains the preprocessing/version, label order, provenance, artifact hashes and per-class rejection policies. The app displays the matching report when the model loads. Softmax values are never shown as signing quality.

## Maintain / test

Run in this project on the Personal Mac:

```sh
export PATH="$PWD/.tools/node-v26.13.0-darwin-arm64/bin:$PATH"
npm run lint
npm test
npm run build
npm run start:local       # install/restart login service after a build
FSL_CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:browser
python3 -m unittest discover -s training -p 'test_*.py'
STORYBOOK_DISABLE_TELEMETRY=1 npm run build-storybook
npm audit
```

`npm run stop:local` stops this login’s service; it starts again at the next login. `npm run preview` runs the built server in a terminal instead. Use only one server on port 5173. For source development, stop the service and run `npm run dev`; restart the service afterward. Logs: `.tools/local-server.log`. Health/build identifier: `/health.json`. No source, training cache or browser records are served by the production server.

On another build machine: Node 22.12+, `npm ci --ignore-scripts`, `npm run setup:tracking`, then prepare the licensed references/model as described in `training/README.md`, and build. Tracking assets, models and videos are self-hosted; ordinary practice needs no third-party runtime requests. This is not a PWA/offline-support guarantee.

Browser tests use synthetic no-hand input and genuine licensed reference pixels at the camera boundary, **not a secretly opened physical camera**. Tests cover storage/review/deletion, playback, real tracking/CNN, abstention, model integrity/fallback, camera failures/cleanup, keyboard/axe and responsive layouts. Actual evidence and limitations: `docs/VERIFICATION.md`.

## Architecture / decision register

| Classification | Implementation or remaining boundary |
| --- | --- |
| PROJECT REQUIREMENT | Personal FSL practice; no ASL substitution, sentence translation, invented instructions or correctness percentages. |
| PROPOSED IMPLEMENTATION | Restrained paper/ink/forest React/Vite workspace. Commit-pinned written Taste/Vercel/OpenAI guidance selectively applied; no external skills installed/scripts executed. See `docs/GUIDANCE-REVIEW.md`. |
| PROPOSED IMPLEMENTATION | `src/tracking.js` owns camera lifecycle and one in-flight frame; worker runs MediaPipe. The 12-submissions/sec cap is a scheduling bound, not measured FPS. |
| PROPOSED IMPLEMENTATION | `src/features.js`, `training/`, `src/recognition.worker.js`: shared 24×64 preprocessing, temporal CNN, local weights/integrity checks and explicit abstention. This experiment trains in TensorFlow.js rather than claiming an unrun Keras conversion. |
| PROPOSED IMPLEMENTATION | `src/storage.js` allowlists aggregate explicit saves; local profile, 30-day/200-attempt pruning, export/deletion. `src/sessions.js` derives counts/time, not mastery. |
| PROPOSED IMPLEMENTATION | `scripts/serve-local.mjs` serves only dist on loopback with security headers, media ranges, foreign-Host/traversal/symlink rejection. Its one write route, `POST /api/webcam-trials`, accepts same-origin JSON webcam-test records up to 2 MB and appends them to `.tools/webcam/<session>.jsonl`; all other uploads get 405. `scripts/local-service.mjs` manages the macOS login service. |
| UNRESOLVED INPUT | Authoritative alphabet, zero, regional variants, emergency/directional vocabulary, full expert-approved curriculum and detailed correction rubric. Missing references stay pending. |
| UNRESOLVED INPUT | Signer-disjoint/consented diverse evaluation, independent expert validation of this classifier, physical webcam/real-device testing and educational usefulness. Public data provides no per-clip signer IDs or separate consent releases. |
| PROJECT REQUIREMENT / NOT IMPLEMENTED | Full Python/OpenCV + Keras pipeline, Firebase Authentication/Firestore/Hosting, authenticated teacher assignments. The personal local adapter is functional; cloud auth is not simulated. Deny-all rules remain in `firebase/`. Java/Firebase emulator checks have not run. |
| UNRESOLVED INPUT | Accounts, teacher authority, school/child safeguards, real device/browser support targets and performance budgets. No collection of others’ data, PWA, or Raspberry Pi deliverable. |

**Next real-world check:** on the Personal Mac open **http://localhost:5173/#test** and run the Webcam test (about four minutes). Results are counted on screen and saved to `.tools/webcam/`; `npm run report:webcam` summarises them and `npm run train:experimental` + `npm run evaluate:experimental` retrain and re-score with them (the newest session stays held out). Prefer formal FSL instruction/expert review for learning and corrections. No accessibility, security, ISO or educational-outcome certification is claimed.
