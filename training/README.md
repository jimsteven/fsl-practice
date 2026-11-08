# Local FSL experiment / personal project

## What actually ran

`scripts/setup-content.py` downloaded genuine **FSL-105 v2** source clips and CSVs, verified checksums, and re-encoded 30 source references to silent H.264/yuv420p. Re-encoding used the Work Mac’s existing ffmpeg; no ffmpeg or Python ML packages were installed on the Personal Mac. The full 379,081,783-byte original archive was subsequently SHA-256 checked on the Personal Mac, and all 160 selected source clips matched it.

Source: https://data.mendeley.com/datasets/48y2y99mb9/2 ; DOI `10.17632/48y2y99mb9.2`; Isaiah Jassen Tupal (2023), CC BY 4.0. Source/modification/rights links and hashes are in `public/references/provenance.json`. The authors describe expert-selected introductory vocabulary; SEACrowd describes expert-reviewed adult FSL signers. These claims do not validate this app or classifier. Per-clip signer IDs, separate consent releases and signer-disjoint partitions were not available.

Public pretrained alternatives were not incorporated: temporal candidates lacked clear reuse licenses, and the MIT alphabet candidate had model-output/label discrepancies. No pickle models or third-party training scripts were executed.

## Splits and capture contract

`samples.json` has 140 unique original clips:

- Supported original IDs 20–24, One–Five: per class, first 12 original training clips by numeric filename train and remaining 4 calibrate; all 4 original test clips remain test. Total 60 training / 20 positive calibration / 20 positive test.
- Unsupported IDs 25–29, Six–Ten: first 4 original training clips per class calibrate rejection, all 4 original test clips per class evaluate rejection. Total 20 negative calibration / 20 negative test.
- No clip overlap, frame-level splitting or random assignment of frames. This cannot substitute for signer-disjoint evaluation. Two training and one positive calibration clip lacked the required usable frames: effective train **58**, positive calibration **19**.

`extract.mjs` uses Chromium’s native, byte-range-capable video decoding and the same MediaPipe worker as live practice. Its initial full-file route interception broke MOV seeking; that extraction was discarded and all 140 clips regenerated using native Vite file serving. It does not open the webcam. Research source frames are sampled over four seconds at 24 grid points; original Windows paths are normalized.

`src/features.js` owns preprocessing **one-hand-main-segment-xyz-v3** (v2 until 2026-11-02):

1. Exactly one visible 21-point hand per usable grid point. Missing/multiple hands become zero/mask=0, never guessed landmarks.
2. Wrist-center XYZ; scale by XY wrist-to-middle-MCP distance; reject scale <0.01; clamp normalized coordinates to ±5. Preserve original orientation; preview mirroring never changes features.
3. Four-second, 24-point timestamp grid; nearest frame within 400 ms, otherwise zero. Each row is mask + 63 XYZ values.
4. Split visible rows into runs wherever more than three grid rows (~0.5 s) are empty, keep the run with the most visible rows, and resample it back to 24 rows. Short internal gaps stay as gaps. v2 cropped from the first to the last visible row, so a stray hand at the start of a live check (seen in moving-video replay after the countdown was added) stretched the window and turned real checks into "insufficient tracking". At least four visible rows in the main run and 50% window coverage are required. Live inference additionally requires at least 12 acquired frames and a 3.8-second duration.

These are explicit experimental engineering choices, **not an expert-approved capture/correctness rubric**. Hands alone do not capture full FSL expression or grammar.

## 2026-11-02: more negatives, an "other" class, augmentation, webcam data

- `python3 training/add-negatives.py` adds 688 more original FSL-105 clips from the verified local archive: the unused Six–Ten training clips plus 3 train / 2 calibrate per even-ID sign become an **"other" (unsupported) class**; the original test clips of every other sign are evaluated. Odd-ID signs never reach training or calibration, so their test clips measure rejection of **unseen** signs. `npm run extract:dataset -- extended` writes `.tools/fsl105/features-extended.json`, reusing existing rows.
- `train.mjs` now trains six outputs (One–Five + other; choosing other always abstains), with class weights and deterministic augmentation of training rows only (±15° rotation, mirroring, depth scale, jitter, ±2-row shift). The calibration-only score/novelty gates are unchanged in method.
- `training/data.mjs` also loads Webcam test sessions from `.tools/webcam/*.jsonl` (discards applied). The newest session is **held out for evaluation**; earlier sessions train, with every fourth check calibrating. `FSL_WEBCAM_HOLDOUT=<id,...>` chooses held-out sessions; `FSL_WEBCAM_HOLDOUT=none` trains on all.
- `evaluate.mjs [modelDir] [reportPath]` reports Six–Ten, seen-class and unseen-class negatives separately and re-scores held-out webcam checks with the same live capture rules as the browser. The pre-change model is archived in `.tools/models/v1` with `evaluation-extended.json` (scored with v2 preprocessing).
- `npm run report:webcam` prints what the browser showed for each session plus every failure's reason, score, novelty distance and tracking coverage.
- `node training/replay-webcam-test.mjs` runs the real Webcam test page with held-out FSL-105 clips at the camera boundary and writes to `.tools/webcam-replay` (never `.tools/webcam`). Read it with `FSL_WEBCAM_DIR=.tools/webcam-replay npm run report:webcam`. Do not set `FSL_WEBCAM_DIR` when training.

## 2026-11-03: Interpret vocabulary (25 signs + other)

The Interpret page (`#interpret`) uses a separate model in `public/models/vocab`. It is an experimental demo, not a translator.

- `python3 training/vocab-samples.py` selects 834 FSL-105 clips into `.tools/fsl105/vocab-samples.json`: 25 vocabulary signs (300 train / 110 calibration / 101 test) and other signs for an "other" class (123 / 41 / 82 seen-class test), plus 77 test clips of signs never used in training ("unseen"). The duplicate `clips/23/8.MOV` is dropped.
- `npm run extract:vocab` runs hand **and face** tracking on every clip and writes 24 rows × 133 features (face flag + two hand slots of 66, hands relative to the nose and scaled by eye distance) to `.tools/fsl105/vocab-features.json`.
- `npm run train:vocab` trains a per-frame dense layer + two Conv1D layers (26 outputs) with training-only augmentation (trim, mirror, shift/scale, jitter). Per-sign minimum scores come from calibration rows only. About 22 s per epoch on tfjs CPU; the first run stopped early at epoch 34 (best 26). Recordings from Interpret → Record my signs (`.tools/webcam/*.jsonl`, `vocab-record-v1`) are added automatically; the newest session is held out unless `FSL_WEBCAM_HOLDOUT` says otherwise.
- `node training/replay-interpret.mjs "GOOD MORNING,MOTHER,COFFEE" [baseURL] [screenshot.png]` plays held-out test clips back to back at the camera of the running page and prints the recognised chain and the real local-LLM sentence.

First results (FSL-105 test, scored once): 25 signs **93/100 accepted correctly, 0 wrong, 7 abstained** (HOT is weakest at 1/4). Other signs: **36/158 falsely accepted as a vocabulary sign** (22/76 for unseen signs), mostly as TOMORROW, GOOD MORNING, HELLO and YESTERDAY, whose calibration thresholds are low because calibration has only 41 "other" rows. These are isolated clips from the dataset signers, not continuous signing or Jim's webcam.

## Re-run on the prepared Personal Mac

```sh
export PATH="$PWD/.tools/node-v26.13.0-darwin-arm64/bin:$PATH"
export FSL_CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
npm run extract:dataset
python3 training/add-negatives.py
npm run extract:dataset -- extended
npm run train:experimental
npm run evaluate:experimental
npm run build
npm run start:local
```

Keep existing source clips, CSVs, `samples.json` and `.tools/fsl105` cache for reproduction. For a fresh acquisition run `npm run setup:content` on a machine with reviewed ffmpeg; its download URLs/checksums and ZIP handling are explicit in the script. That step requires internet. Do not run extraction alongside another development server on its dedicated loopback port 5174.

Training uses **TensorFlow.js 4.22 CPU**, two Conv1D layers, global average pooling and a five-class softmax. Fixed initializer seeds 42/43/44, deterministic hashed clip ordering, no shuffled batches, at most 120 epochs, best positive-calibration loss retained. This model reached epoch 120. Training history and actual paths are saved in `.tools/fsl105/training-history.json`.

Rejection calibrates per-class minimum softmax and maximum nearest-training mean-shape distance on **calibration clips only**, requiring zero false accepts there and maximizing correct accepts. It can disable a class entirely if that is the only safe calibration choice. Softmax is a model score, not a correctness percentage. Parameters were frozen before the original test evaluation and were not loosened after replay failures.

## Actual held-out results (v1, 2026-10-28; superseded)

Current before/after numbers on the deduplicated test split are in the project README. The text below describes the first model.

`public/models/numbers/evaluation.json` is the full generated report tied to model/weight hashes. Raw top-1 confusion is diagonal: 4/4 for each number, 20/20 total. With rejection, **11 correct accepts, 9 abstentions, 0 wrong accepts** among 20 supported clips. Unsupported Six–Ten: **18/20 rejected, 2 false matches**. Report counts, not a claim of 100% useful recognition. Node classifier-only timings exclude MediaPipe, camera acquisition, capture time and display latency.

Live moving-video replay sometimes abstains despite high Five softmax because the mean-shape novelty gate rejects it. A diagnostic observed distances 0.0658/0.0738 against a 0.0448 maximum; a held genuine Five frame produced 0.0212/0.0216 and was accepted. Thus tests retain a controlled still-frame positive and a separate moving-video acceptance-or-abstention check. This does not prove dynamic FSL or real-webcam robustness.

## Still blocked for validated recognition

The general validated-recognition gate stays disabled. Independent expert review, diverse consented signer-disjoint data, actual new-signer/device evaluation, full vocabulary/motion requirements and a correction rubric remain missing. The experimental manifest/opt-in is a separate contract, not a back door to certified signing assessment.

The original requested **Python/OpenCV → TensorFlow/Keras → TensorFlow.js conversion** route has not been implemented or run; this bounded experiment directly trains TF.js with shared browser preprocessing to avoid train/live drift and unsupported conversion claims. Before that larger pipeline, pin compatible packages, audit rights/consent/signer metadata, match preprocessing, and verify export parity on fixed inputs.

The existing Python metadata audit remains useful for a future dataset: `python3 training/audit_dataset.py metadata.json`. It requires clip_id, signer_id, split, sign_id, consent/rights/expert-review references and source SHA-256; it rejects obvious clip/hash/signer leakage but does not verify the truth of supplied metadata. Its three tests use synthetic metadata; FSL-105 cannot pass a signer-disjoint audit without missing signer evidence. Do not invent it.
