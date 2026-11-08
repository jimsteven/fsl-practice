# Local deployment verification / personal project

## Portable installation — 2026-11-08

The shell/PowerShell installers bootstrap Node 24.11.0, install npm dependencies and pinned tracking assets, verify the included reference videos, build, install Ollama 0.40.15, and download/load the selected local LLM. They require no Git, Python, FFmpeg, global Node or administrator access. The GitHub repository remains private, so download/extract its source ZIP while authenticated before running the one installation command.

**Executed on macOS ARM64:** fresh Node bootstrap and app installation; fresh Ollama archive/checksum/extraction/start and `gemma3:270m` download; real `/api/interpret` returned a nonempty sentence; repeated launch; existing Personal Mac Ollama reused with `gemma3:12b`. The tiny 270M model is an installation/inference smoke test, not a sentence-quality evaluation. Initial cold loading exceeded the app's request timeout; installers/launchers now preload the model with a five-minute deadline before announcing readiness. The default remains 12B. `--skip-llm` explicitly disables sentence generation while retaining local recognition.

**Regression checks:** lint, production build, 13 Node tests and all 31 existing browser tests passed. Node tests cover foreign/stale port refusal and LLM-disabled serving. The updated Interpret caption was checked at desktop/390 px with no horizontal overflow. Browser tests use synthetic media or attributed FSL-105 reference replays, not a secretly opened physical webcam.

**Other platforms:** `.github/workflows/install.yml` runs the actual installer, repeat launch, unit tests and real tiny-model inference on macOS, Ubuntu and Windows. No local Windows or Linux machine was used for this verification; refer to that workflow's results rather than assuming these platforms passed. GPU-driver installation, optional AMD/Jetson accelerators, Alpine/musl and 32-bit computers are outside the supported installer scope. No public Box redeployment was performed.

## Interpret demo and Check my signs — 2026-11-03 UTC

Local build on the Personal Mac adds `#interpret` with three modes: **Interpret** (signs lock in as gloss pills with a face-based expression tag, then the local LLM suggests an English sentence with added words underlined), **Check my signs** (one target sign with its reference; the camera shows **Good job!** when the model recognizes that sign, otherwise **Try again** with what it saw), and **Record my signs** (landmark samples for retraining). Vocabulary model **fsl105-vocab25-cnn-v1**; LLM **gemma3:12b** in Ollama on the Mac.

**Passed on the Personal Mac:** lint; 11 Node tests; production build; **31/31 browser tests** against localhost:5173, including: a looping HELLO clip gets *Try again* when the target is GOOD MORNING and *Good job!* when it is HELLO; a slower earlier LLM reply can't replace a newer one (this test failed on the previous build, which showed a stale sentence); recording saves through the local route. axe found no WCAG A/AA violations and no horizontal overflow in the Try again and Good job states at 1440 px and 390 px.

**Model evidence (FSL-105 test clips, scored once):** 25 signs 93/100 correct, 0 wrong, 7 abstained; other signs 36/158 falsely accepted (22/76 unseen). Replays of held-out clips through the real page: HELLO HOW ARE YOU I'M FINE → "Hello, how are you? I'm fine."; DEAF DON'T UNDERSTAND SLOW → "I'm deaf, I don't understand, slower please."; GOOD MORNING MOTHER COFFEE HOT NO SUGAR lost HOT in one run and COFFEE in another (the LLM then added "coffee" itself, shown underlined).

**LLM comparison** on 12 fixed chains through `/api/interpret`: gemma3:4b about 1.8 s per sentence but wrote expression tags into sentences ("Is the coffee skeptical today, no?") and joined words oddly; gemma3:12b about 5.9 s with no tag leaks, occasionally adding a fact ("Will Mom be there tomorrow?"). `FSL_LLM_MODEL=gemma3:4b` switches back.

**Tips for Check my signs** (`training/vocab-profiles.mjs`, profiles from train + calibration clips, thresholds set by hand before the test check): correct test clips with no tip 89/101; another sign's clip judged against a target gets at least one tip 2246/2424; deliberately changed correct clips get the matching tip: hand lowered 77/81, raised 101/101, fingers folded 101/101, movement frozen 80/80. Movement direction is not checked because net travel in FSL-105 is dominated by the hand entering and leaving.

Still not tested: Jim's own webcam and signing, continuous natural signing, signer-independent data, expert review. "Good job" means the model recognized the target sign, not that a teacher would accept it.

## Guided practice, Webcam test and recognition update — 2026-11-02 UTC

Deployed build **29c640ada6bacd60** adds the guided countdown, framing cues, Try again / Next sign, the Webcam test page (`#test`) with its local `POST /api/webcam-trials` route, and model **fsl105-numbers1-5-other-cnn-v2** with preprocessing **one-hand-main-segment-xyz-v3**. Practice internals were split into `src/live.js` hooks shared with the Webcam test page.

**Passed on the Personal Mac:** lint; 8 Node tests (new: framing cues, protocol/outcome counting, "other" class abstention, main-segment cropping, server write route incl. foreign Origin 403, wrong type 415, bad session 400, oversize 413); production build; Storybook build; **27/27 browser tests in 1.5 min** against localhost:5173. New browser tests: countdown → capture → Five → Next sign → reset cancels the countdown; Webcam test records/redo/discard/end with the server route intercepted so test runs never write to `.tools/webcam`. Six rendered states (Practice countdown, result with Next sign, Webcam test intro, capturing, summary, 390 px intro) had zero axe AA violations and no horizontal overflow; captures in `.amp/in/artifacts/guided-webcam/`.

The first browser run failed the moving-video test: with a countdown, a hand visible in the first frames (from the looping clip) stretched the v2 first-to-last-visible window, so real attempts came back "insufficient tracking". The test now aligns the clip with the capture window, and preprocessing v3 keeps the main visible run. The model was retrained for v3; no thresholds were tuned on test data.

**Recognition evidence** (deduplicated FSL-105 test split; before = v1 model + v2 preprocessing): numbers 1–5 correctly accepted 10/19 → **11/19**, wrong accepts 0 → 0, unsupported false matches 1/405 → 1/405 (0/191 unseen signs in both). Webcam-page replay with held-out clips: 10/15 → **12/15** correct, 0 wrong, 8/8 refusals in both; offline re-scoring of the replay captures reproduced the browser's 23 outcomes exactly. Two byte-identical Four/Seven clip pairs in FSL-105 were found and removed from all splits; one had produced a "false match" that was really a duplicate of a Four training clip.

Still not tested: Jim's physical webcam and signing (needs Jim), signer-independent data, expert review.

## Automatic Practice update — 2026-10-28 UTC

Deployed build **02c453714643e464** supersedes the manual camera/recognition controls described in the initial proof below. Practice now starts the camera automatically, reuses Chrome’s site permission, and enables experimental number recognition when the focus is One–Five. Other focuses use tracking only. Start/Stop camera and recognition-mode toggle buttons are removed; Retry actions appear only for errors. Begin attempt still starts each exercise explicitly.

The Personal Mac’s active Chrome Default profile already has an **Allow** camera entry for `http://localhost:5173`; it was read, not changed. Permission remains browser-controlled, not an invented app-side grant. No physical webcam or user camera footage was acquired by this verification.

**Passed:** lint, production build, 5 Node tests, Storybook build, and **25 browser tests in 41.0 seconds**, with no skips, unexpected failures or flaky results. Browser tests cover automatic startup/reload under granted permission, hidden-tab stop/visible-tab resume, camera release on navigation/teardown, late permission disposal, persistent denial without automatic retries, focus-driven model selection, camera continuity across focus changes, discarding an old unsaved attempt, and recovery from missing/tampered/incompatible model assets. Real MediaPipe/CNN positive and abstention controls, storage, playback, keyboard/axe, 200% text and five widths remain covered.

Six additional rendered states have zero reported axe AA violations or horizontal overflow: default automatic camera, Five recognition, 390px recognition, Hello tracking-only, permission-denied/Retry camera and updated Settings. Captures and `checks.json` are retained in `.amp/in/artifacts/automatic-practice/`. The recognition capture uses a held licensed source frame, not a live learner. The first capture harness incorrectly used Playwright’s `browser.newPage()` convenience API with axe; it was corrected to an explicit browser context and rerun successfully. No product code or checks were weakened for that harness error.

The classifier, thresholds, dataset evaluation and remaining linguistic/webcam limitations are unchanged. The login service is healthy on localhost:5173. No commit, push or public deployment.

## Initial deployment proof — historical camera controls

Executed **2026-10-28 UTC** (2026-10-29 on the Personal Mac), `/Users/jim/projects/fsl-practice`. macOS 26.6 (25G72), arm64; Chrome 156.0.8078.48 headless, Playwright 1.64.1, project-local Node 26.13.0, Python 3.9.6, MediaPipe tasks-vision 1.2.0, TensorFlow.js 4.22 CPU. This record supersedes the earlier Stage 1-only handoff.

## Delivered state

The built app is served at **http://localhost:5173 on the Personal Mac only**, not this reader’s other device. LaunchAgent `com.jim.fsl-practice` is installed in Jim’s user domain with RunAtLoad/KeepAlive; its active process serves only dist from loopback. `/health.json` identifies the tested build as **3631d21fe4e189f6**. It replaced the earlier Vite preview. No public/cloud deployment, Firebase provisioning, commit or push.

The service was actually stopped/restarted during verification; the browser process was closed/reopened with an isolated persistent test profile. The same saved Five attempt, genuine model suggestion and review note survived both. A JSON export was parsed and checked for the note/suggestion and absence of frame/landmark/video/confidence/correctness fields. Confirmed deletion remained empty after reload. The disposable test profile was removed; no user browser profile was used. Actual logout/reboot was not performed; login startup is configured rather than claimed as reboot-tested.

## Passed checks

| Check | Actual result |
| --- | --- |
| Lint / production build | Passed. Main JS 257.33 kB / 80.36 kB gzip, separately loaded TF.js recognition worker about 1.62 MB uncompressed; model weights about 11 kB. Sizes are not performance guarantees. |
| Node tests | **5 passed**: aggregate contracts, unavailable validated recognition, projection/error wording, normalization/gaps/idle-edge preprocessing, production server media ranges and rejection boundaries. |
| Browser suite against deployed localhost:5173 | **24 passed, 35.9 s**. Saved summaries/notes/reload/delete/export; actual attributed video playback; real CNN + actual tracker on licensed pixels; no-hand abstention; missing/tampered/incompatible assets; separate moving-video checks; camera failures/start-stop-restart/late permission/navigation/pagehide; keyboard/axe; 200% text; five widths. |
| Additional persistent-profile deployment proof | Session/suggestion/note survived browser closure plus service stop/start; actual exported contents checked; deletion confirmed. Nine rendered states scanned with axe AA tags and checked for overflow: zero reported violations. |
| Observed runtime network | Additional signed-input/review flow had **15 same-origin GET requests, no request bodies**. Browser suite independently checks tracking and recognition flows for external/upload requests. Not universal security proof. |
| Python metadata audit | **3 passed**, synthetic metadata only. Not a claim that FSL-105 supplies signer/consent metadata. |
| Storybook build | Passed; camera-off/pending/source-video/empty/synthetic-layout stories. Nonfatal tooling module.register deprecation/large preview chunk warnings were not suppressed. |
| Dependency audit | **Zero known vulnerabilities reported**, all resolved production/development dependencies. Not security certification. |
| Licensed data integrity | Full archive SHA-256 `c048c0820be1621101dfedeabb76a9fbfca76ed2868eebe23b4cb90d5c748463`; all **160** range-fetched original clips matched it. Thirty silent H.264 references have recorded output hashes and attribution. |

## Model evidence and its limits

Numbers One–Five only, genuine CC BY FSL-105 v2. Sixty intended training clips, **58 usable**; 40 calibration clips (19 usable positive, 20 usable negative); original **20 positive + 20 unsupported test clips**. Clip-disjoint only; signer IDs were not supplied. The independent source research is summarized in `training/README.md`; candidates without clear reuse licenses or matching model/label contracts were rejected.

The CNN trained for 120 epochs with fixed initializer seeds, deterministic clip order and calibration-only selection. Test thresholds were frozen before evaluation. Raw top-1 was 20/20, but rejection gives the relevant result:

| Number | Correctly accepted / 4 | Declined / 4 |
| --- | --- | --- |
| One | 2 | 2 |
| Two | 2 | 2 |
| Three | 4 | 0 |
| Four | 2 | 2 |
| Five | 1 | 3 |

Total **11 correct accepts, 9 abstentions, 0 wrong accepts** among supported clips. Unsupported Six–Ten: **18 rejected, 2 falsely matched**. `public/models/numbers/evaluation.json` contains each row, raw confusion and artifact hashes. Do not describe this as 100% useful recognition or new-signer accuracy. Two positive test clips and one unsupported clip failed the usable-frame gate, included as abstentions rather than removed from totals.

Classifier-only Node calls over these 40 clips: median **0.307 ms**, maximum **4.347 ms**. This excludes video decode, MediaPipe, four-second acquisition and display. It is not camera-to-display latency, a throughput benchmark, or a performance budget. A reviewed integration capture processed 42 frames with hands over roughly four seconds; its tracking-call mean is scenario-specific. The 12-submissions/sec scheduling cap is not measured FPS.

The positive browser control is a **held genuine frame from a licensed training reference**, decoded normally and streamed at the physical-camera boundary. MediaPipe and CNN run unchanged, producing Five; no fake landmarks or classifier responses. It proves integration, not held-out accuracy, full-motion recognition or signing correctness. Moving-video replay is a separate three-attempt case: it may suggest Five or explicitly abstain, never another number in this fixture. No physical webcam was acquired/recorded by the successful tests.

## Failures investigated, not hidden

- Initial Stage 1 did not retain summaries after reload and had no reference videos. The added local adapter and licensed media now exercise those paths; the initial feature test failures were observed before implementation.
- Full-file interception of MOV byte-range requests produced invalid feature extraction. A raw clip probe confirmed native Vite serving restored varying hand detections; all 140 research clips were re-extracted before training. Bad extraction was discarded.
- Original clips include idle time. Shared preprocessing now crops idle edges while preserving internal gaps before resampling; this was chosen using training/calibration observations before held-out evaluation.
- A full-video integration run passed, then a repeat abstained. Diagnosis found Five softmax >0.999 but novelty distance 0.0658/0.0738 exceeded the calibration maximum 0.0448; a controlled held frame gave 0.0212/0.0216 and was accepted. **No weights/thresholds were changed after test evaluation.** The original expectation of guaranteed acceptance was invalid for this conservative model. The kept tests explicitly separate a controlled positive from permitted full-video abstention; no test is skipped or fitted to a fabricated prediction.
- The deletion test initially reloaded before its asynchronous commit. It now waits for the visible committed empty state, then reloads and checks again; deletion has busy/error feedback.
- Additional proof-script setup mistakes (relative API URL and an initializer added before a hash-only navigation rather than a document reload) were corrected. The latter produced permission denied, not acquired camera frames. The successful proof uses a forced document reload and fake-device launch flags in addition to the licensed fixture. These were harness errors, not app fixes.
- Full-page captures taken while scrolled misplaced sticky navigation in the image. Final captures explicitly start at scroll top; this was capture setup, not a product layout change.

## Rendered review / remaining gaps

Actual captures retained under `.amp/in/artifacts/local-final/`: default desktop; Five reference desktop/390px phone; library; Hello detail; genuine held-input Five recognition/overlay; saved session; Review desktop/phone. Camera-off/errors, 320px/phone/tablet/laptop/landscape and 200% text also have browser-suite captures. Images were inspected for clipping, readable controls, genuine media, attribution, honest result wording and state. Automated scans reported no AA violations; this is not full WCAG conformance.

**Not proven:** Jim’s own webcam/new signer, physical occlusion/lighting, real two-handed signing, real iPhone Safari/Android Chrome/Edge/Safari, screen readers/full accessibility audit, signer-independent accuracy, pedagogical correctness, broader/dynamic vocabulary, educational usefulness or end-to-end latency. Complete alphabet/zero/emergency curriculum and detailed corrections remain unavailable. Firebase auth/teacher authorization is not implemented, and deny-all emulator rules were not run because Java/Firebase CLI are absent. No Python/OpenCV/Keras conversion, PWA/offline guarantee, school/child collection or Raspberry Pi deployment is claimed.

Run/test/setup commands and explicit requirement/proposal/unresolved classifications are in `README.md`, `training/README.md` and the contracts. Local use is ready for personal reference/tracking/logging; the recognizer remains a small opt-in research experiment, not validated FSL assessment.
