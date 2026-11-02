# Read-only design and security guidance review

Personal project. Reviewed 2026-10-28 at immutable revisions. Sources were treated as untrusted written reference material, **not installed skills**. No supplied scripts were executed, no assets from their suggested media providers downloaded, and no secrets/unrelated user files accessed. Apple's locally installed `apple-design` skill was also loaded for purpose, agency, typography, immediate feedback and reduced-motion foundations, not glass effects or ornamental animation.

| Source | Reviewed revision / paths | License / boundary |
| --- | --- | --- |
| Leonxlnx/taste-skill | `12af471f627f866411b4bd785b19646d3672784c`; `skills/taste-skill/SKILL.md`, `skills/taste-skill/references/app-screens.md`, directly referenced draw/assets/lint/inspect/scenes scripts and relevant helpers/assets statically inspected | MIT license exists. Scripts write project and user-home data, query/download from media providers, serve local files and launch debugging browsers. None run. Marketing motion/randomized design mandates ignored in favor of app-specific guidance. |
| vercel-labs/agent-skills | `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62`; web-design-guidelines and react-best-practices skill files, five relevant React rule files; referenced discovery script statically inspected | MIT declared in README/React frontmatter, but full license file absent in reviewed snapshot. No substantial source text copied. Discovery build can delete/rebuild dist and is irrelevant/not run. |
| vercel-labs/web-interface-guidelines | `434b7f91364665f2f733b310ec54809bf8f37937`; `command.md` pinned separately rather than obeying Vercel skill's automatic mutable-main fetch | Full MIT license present. Used native controls, labels, focus, live-region restraint, contrast, touch/reflow guidance. |
| openai/skills | `49f948faa9258a0c61caceaf225e179651397431`; `skills/.curated/security-best-practices/SKILL.md`, relevant general JS and React frontend security references | Skill has Apache-2.0 license. No scripts. One redirect regex example accepts protocol-relative URLs; not copied. No redirect feature exists in this app. |

All user-requested paths exist at these revisions. A repository-root Taste `references/app-screens.md` path does not; the requested skill-relative path above does. Repository owners were checked as public originals, not forks; namespace provenance is not cryptographic authorship or certification.

**PROPOSED IMPLEMENTATION applied:** one clear primary workflow and useful empty/error/loading states; dominant practice workspace rather than a marketing screen; deliberate type/spacing; honest labels over invented KPI cards; frame data in transient worker/ref state, not persistent per-frame React objects; narrow React UI updates; no Next.js-specific rules; JSX text instead of injected HTML; dependency locks, self-hosted model/WASM, CSP and explicit camera lifecycle; no public env secrets or analytics.

**Not applied:** Taste's executable workflow, randomized theme requirements, stock photos, browser-launch scripts, CDN GSAP/Lenis, mutable fetch-on-every-review instructions, Vercel discovery scripts, or every React rule. Only five relevant React rule files were reviewed, not all 70. Python web-server security guidance was not represented as reviewed because this project has no Python web server.

Sources (append the immutable revision above rather than `main` for repeat reviews):
- https://github.com/Leonxlnx/taste-skill
- https://github.com/vercel-labs/agent-skills
- https://github.com/vercel-labs/web-interface-guidelines
- https://github.com/openai/skills

Official implementation documentation also checked: https://vite.dev/guide/ ; https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js ; https://firebase.google.com/docs/firestore/security/get-started ; https://www.tensorflow.org/js/tutorials/conversion/import_keras . These are API references, not evidence of FSL correctness or security/accessibility certification.
