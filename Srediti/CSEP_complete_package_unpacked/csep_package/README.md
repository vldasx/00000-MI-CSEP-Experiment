# CSEP — Conceptual Space Expansion Prompting

## Process documentation & reproducibility package

This package contains the complete experimental record of the CSEP investigation: documentation, tools, and data produced during a single extended working session.

---

## Final results at a glance

On 4 altered-classic puzzles where baseline Haiku 4.5 reliably recites the classical answer:

| Method | Result | % | Source |
|--------|--------|---|--------|
| Baseline | 0/4 | 0% | direct prompt |
| Self-Consistency (5 samples) | 0/4 | 0% | Wang et al. 2022 |
| Standard CoT | 1/4 | 25% | Wei et al. 2022 |
| CSEP v1 (hypothesis-first) | 1/4 | 25% | this work |
| Tree of Thoughts (real) | 2/4 | 50% | Yao et al. 2023 |
| Advanced CoT (hybrid) | 2/4 | 50% | this work |
| **CSEP v2 (prompt-first)** | **4/4** | **100%** | this work |

**Key finding:** Self-Consistency — widely cited as SOTA for reasoning — scores *worse* than Standard CoT on recitation problems. Temperature-based diversity sampling cannot escape a recitation failure mode that is systematic rather than stochastic.

---

## What's inside

```
csep_package/
├── README.md                              ← this file
├── documentation/
│   └── CSEP_Process_Documentation.pdf     ← full process documentation (15 sections)
├── tools/                                 ← 13 JSX tools
│   ├── csep_v2_test.jsx                   ← THE WINNING PIPELINE (4/4)
│   ├── three_cot_baselines.jsx            ← Standard + Self-Consistency + real ToT
│   ├── advanced_cot_test.jsx              ← hybrid ToT + adversarial CoT (2/4)
│   ├── cot_test.jsx                       ← standard step-by-step CoT
│   ├── csep_vs_baseline.jsx               ← CSEP v1 (1/4)
│   ├── haiku_hard_test.jsx                ← baseline on 20 altered classics
│   ├── haiku_curated_test.jsx             ← 30 hand-curated questions
│   ├── question_filter_v2.jsx             ← two-step question generator
│   ├── question_filter.jsx                ← one-step generator (deprecated)
│   ├── csep_batch_evaluated.jsx           ← early batch with judging
│   ├── csep_batch_test.jsx                ← early batch without judging
│   ├── csep_pipeline_test.jsx             ← first CSEP v1 single-question test
│   └── haiku_baseline_100.jsx             ← early 100-question baseline
└── data/                                  ← 11 JSON files
    ├── hard_questions.json                ← 20 altered classics (CORE DATASET)
    ├── haiku_hard_failures.json           ← 4 Haiku baseline failures (core test set)
    ├── three_cot_baselines.json           ← Standard + SC + ToT results
    ├── advanced_cot_results.json          ← advanced hybrid CoT results (2/4)
    ├── csep_v2_results.json               ← CSEP v2 results (4/4)
    ├── csep_vs_baseline_4.json            ← CSEP v1 results (1/4)
    ├── curated_questions.json             ← 30 hand-curated questions
    ├── questions.json                     ← earlier 100-question generated set
    ├── all_questions_60.json              ← mode-collapsed 60-question run
    ├── csep_test_questions.json           ← 5 failures from generator iteration 2
    └── csep_test_questions2_.json         ← 3 failures from generator iteration 3
```

---

## How to read this package

**Start with the PDF.** `documentation/CSEP_Process_Documentation.pdf` is the full narrative across 15 sections: motivation from the bachelor thesis, dataset iterations, CSEP v1 design, the negative result, CSEP v2 redesign, three-baseline SOTA comparison, final interpretation, and reproducibility guide.

**Then inspect the tools.** Every tool is a single JSX file that runs as a Claude Artifact. Each has its questions embedded, its own localStorage key, and download buttons.

**Then inspect the data.** The most important files are:
- `hard_questions.json` — the 20-question test set
- `csep_v2_results.json` — phase-3 self-diagnosis quotes, directly citable in the paper
- `three_cot_baselines.json` — full SOTA comparison data with all 5 Self-Consistency samples per question

---

## The core finding in one sentence

**Recitation-over-reasoning is not a failure of reasoning effort; it is a failure of processing order, and can be fixed by requiring the model to parse the prompt before any attempt to generate an answer.**

Every established technique (Standard CoT, Self-Consistency, Tree of Thoughts, hybrid adversarial CoT, hypothesis-first CSEP v1) catches at most half the traps. CSEP v2 — which parses concepts, analyzes the question, and checks for pattern-match risk before generating any tentative answer — succeeds 4/4.

---

## The smoking gun evidence

These specific quotes from the data files are the strongest evidence for the paper:

**CSEP v1 Q#7 phase 3** (the model invents a constraint):
> "1.1 Transport Mechanism — The man wades through a shallow river, carrying **one item at a time**. This replaces the boat in the classic puzzle but leaves the single-item-per-trip constraint **entirely intact**."
> (The "one item at a time" constraint does not appear in the prompt.)

**Self-Consistency Q#5** (all 5 samples identical at temperature 0.7):
> Sample 1: "The ball costs $0.05 (5 cents)."
> Sample 2: "The ball costs $0.05 (5 cents)."
> Sample 3: "The ball costs $0.05 (5 cents)."
> Sample 4: "The ball costs $0.05 (5 cents)."
> Sample 5: "The ball costs $0.05 (5 cents)."
> Vote count: {"$0.05": 5}

**Self-Consistency Q#7** (actively degraded a single-run success):
> 4 samples: classic multi-trip sequence (wrong)
> 1 sample: wade across with all three (correct)
> Majority vote: classic sequence — wrong

**Tree of Thoughts Q#1 evaluator** (the evaluator itself recites):
> "Branch B most cleanly identifies and dismantles the single hidden assumption driving the paradox — that 'surgeon' implies male — and delivers the classic intended answer (the surgeon is the boy's mother)."

**Advanced CoT Q#20** (model writes down the flaw and uses the answer anyway):
> Adversarial check: "Against Answer B (hanging/ice block): If he hanged himself, there would be a rope or ligature still present... The problem doesn't mention a rope."
> Final answer: "He died by hanging (asphyxiation): he stood on a block of ice, put a noose around his neck..."

**CSEP v2 Q#5 phase 3** (the model diagnoses recitation and escapes):
> "The irony is that $0.10 — the answer everyone mocks as the 'dumb intuitive trap' in the canonical puzzle — is actually the correct answer to this version. The problem has been quietly modified so that the famous 'wrong' answer is now right."

---

## Reproduction

1. Load any JSX tool from `tools/` into a Claude Artifacts session.
2. The tool has its questions embedded; click "Run" to execute.
3. Results save to browser localStorage automatically.
4. Click "Download" to export results as JSON.
5. Compare against the corresponding file in `data/` for reference.

Models: `claude-haiku-4-5-20251001` (target), `claude-opus-4-5-20250929` (judge).

---

## Key literature

- **RoR-Bench** (Yan et al., 2025) — documents "recitation over reasoning"
- **Easy Problems That LLMs Get Wrong** (Williams & Huckle, 2024)
- **Altered Riddles Dataset** (marcodsn, 2025, HuggingFace)
- **BrainBench** (Tang, 2025)
- **Chain-of-Thought** (Wei et al., 2022)
- **Self-Consistency** (Wang et al., 2022)
- **Tree of Thoughts** (Yao et al., 2023)
- **Bachelor thesis** (Miletin, 2025, IU)

---

## Next steps

- Scale all 7 methods to full 20-question set
- Control set of normal questions (check for over-correction)
- Ablation of v2's three features (prompt-first, meta-analysis, pattern-check)
- Cross-model generalization (Sonnet, Opus, GPT-4, Gemini)
- Implement parked ideas as follow-up papers
