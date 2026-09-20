---
Title        Interpretability research proposal — biological systems to AI architecture
Purpose      States a thesis and three research aims that have NOT been run, plus the dated confounds found while building the instrument. A proposal document, not a description of shipped behavior.
Author       Jennifer Naomi Nguyen
Canonical    ~/Bootwitch/Projects/attractor/RESEARCH.md — authoritative. The immunology artifacts it references live in the private `attractor-research` repository, not here; the `docs/artifacts_docs/` links this file used to carry were removed along with that directory and must not be restored.
Updated      2026-09-20
Dependencies none to read. Re-deriving the measured figures needs Python 3 and ~/.attractor/runs.jsonl.
---


# Interpretability Research: Biological Systems → AI Architecture

A research portfolio bridging immunology, mechanistic analysis, and AI interpretability. This work applies rigor from biological systems research to understanding model behavior, reasoning dynamics, and long-horizon stability.

> **This is a proposal document, not a README.** It states a thesis, describes
> artifacts, and lays out three research aims that have not been run. For the
> system that exists and works, see [README.md](README.md) and
> [docs/technical.md](docs/technical.md). Terms used below are defined in the
> [glossary](README.md#glossary).

---

## Core Framework

**Thesis:** Local self-organization and structured context create stable behavioral attractors that enable coherent generation and adaptive response without requiring global retraining.

**Biological parallel:** Tertiary lymphoid structures (TLS) form *de novo* in response to chronic signaling, enabling local adaptive immune responses without systemic activation.

**AI parallel:** Structured narrative context and role architecture create stable "attractor basins" where models maintain coherent behavior and reasoning across extended interactions.

---

## Research Artifacts

### 1. **TNFSF Receptor-to-AI Architecture Mapping** 
*Interactive visualization of signal competition dynamics*

A React-based interactive framework mapping TNF superfamily signaling onto transformer layers, attention mechanisms, and generation pathways.

**What it shows:**
- Receptor competition (HVEM, BTLA, LIGHT, CD160, DcR3, LTβR) as analogues for competing activation signals in transformers
- Cell-to-layer mappings (Memory B cells → trained refusals; NK cells → fast evasion; Dendritic cells → orchestration layers)
- How local structure formation (TLS) parallels stable context architecture

**Key insight:** Signal routing and local assembly principles from immunity directly inform how models might maintain coherent behavior under competing activation signals.

**Files:** the immunology artifacts behind this section -- the TNFSF attention
rhyme, the annotated immunology/transformer mapping, and the TLS attractor
hypothesis -- live in the private `attractor-research` repository. They are
research notes rather than part of the demo, so they are not distributed here.

---

### 2. **Attractor-State Dynamics Analysis**
*Code for identifying behavioral basins and signature formation across multi-turn interactions*

Tools for characterizing:
- Behavioral convergence and tone stabilization across conversation depth
- User-specific interaction signatures and their emergence patterns
- Drift thresholds and attractor basin stability

**Replicable:** Can be re-run in Claude chat to capture and visualize live interaction dynamics.

**Files — status: not in this folder.** `analysis/attractor-dynamics.js` and
`analysis/signature-detection.js` are referenced here but are not present. The
working implementation of basin state and weighting is the Attractor itself —
see [README.md](README.md) and `components/`. Either recover these two files or
cut this section; as written it points at nothing.

---

## Research Proposals (Ready to Execute)

Three rigorous research directions grounded in mechanistic biology and high-dimensional signal interpretation:

### **Aim 1: Context Architecture & Token Efficiency**
Does narrative context (carrying the *why* of the person and *how* of the model) function as a more efficient context delivery method than flat memory or raw context windows?

- **Hypothesis:** 50 right tokens (structured narrative) beat a million flat ones (raw context)
- **Control:** the comparison has to be **task-preserving** — every condition delivers context, only the *form* varies. A no-context arm removes the task, not the variable, and would answer a different question
- **Evaluation:** Convergent, divergent, and relational task types across four context delivery methods
- **Outcome:** Quantified token-efficiency gains + drift resistance metrics

### **Aim 2: Idiosyncratic Patterns as Identity Signals**
Do grammatical irregularities and stylistic signatures function as implicit identity signals that influence model output *independent* of explicit context?

- **Hypothesis:** Input patterns (communication style, fragment length, punctuation habits) act as signal carriers influencing tone and reasoning approach
- **Control:** holding explicit context constant while varying style is the right design, but style and content are hard to vary independently in natural text — the confound to state up front is that a rewritten prompt changes more than its style
- **Evaluation:** Systematic variation of input patterns while holding explicit context constant
- **Outcome:** Quantification of pattern-effect sizes on model behavior

### **Aim 3: Sustained Multi-Session Collaboration**
Does structured narrative context enable decreased drift across sessions, allowing true multi-turn research collaboration?

- **Hypothesis:** Narrative framing + role descriptions + embedding context create stable attractors that survive session breaks
- **Control:** needs a **drift measure defined before the run**, and a floor check that the measure can move at all — otherwise a null result is indistinguishable from a dead instrument
- **Evaluation:** Conversation depth, behavioral consistency, reasoning quality across session boundaries
- **Outcome:** Framework for measuring and maintaining coherence in sustained collaboration

---

## Methodological Foundation

This work is grounded in approaches from mechanistic immunology:

- **Multi-scale analysis:** Observing behavior at task level *and* token/sentence level simultaneously
- **Rare-event detection:** Using high-dimensional profiling to identify low-frequency behavioral shifts
- **Quantitative rigor:** Moving from qualitative observation to structured measurement frameworks
- **Mechanistic hypothesis testing:** Building falsifiable predictions about *why* behaviors emerge

---

## Publications

- Šedý JR, Balmert MO, Nguyen J, Ware CF. Cancer Mutations Targeting TNFRSF14 Alter Microenvironment Checkpoint Interactions to Limit Tumor Clearance by Cytotoxic Cells. *Journal of Immunology*, 2017.
- Veny M, Grases D, Kucharova K, Nguyen J, Šedý JR. Contactin-1 Is Required for Peripheral Innervation and Immune Homeostasis Within the Intestinal Mucosa. *Frontiers in Immunology*, 2020.
- Stienne C, Virgen-Slane R, Elmén L, Nguyen J, Šedý JR. BTLA Signaling in Conventional and Regulatory Lymphocytes Coordinates Humoral Immunity in the Intestinal Mucosa. *Cell Reports*, 2022.
- Šedý JR, Veny M, Nguyen J, Ware CF. Targeting the HVEM–BTLA–CD160–LIGHT Network in Psoriasis. *Journal of Immunology*, 2016.

**ORCID:** `TODO(jen)` — the four papers above are published; add the ORCID link.

---

## About This Work

This research emerged from sustained human-AI collaboration exploring how biological systems thinking informs AI interpretability. The core question: *Can we apply the rigor of mechanistic science to understanding model behavior?*

Background:
- 10+ years of bench science in immunology (tumor, autoimmune, infectious disease models)
- Expertise in high-dimensional data analysis, rare-signal detection, experimental design
- Transitioned focus to AI interpretability through conceptual bridges between immune system dynamics and transformer behavior

---

## Next Steps

Study design for a related experiment — a 2x2 factorial on persona and identity
prompts, with the controls, amendments, and retractions written up — is in
`../lesswrong-book-club/METHODS.md` and `FINDINGS.md`. The three aims below would
inherit that structure: pre-registered measures, replicates for a noise floor,
and floor checks before interpreting any null.

These research directions are ready to execute with:
- Proper infrastructure for running behavioral evaluations
- Access to model logs and interaction data
- Collaborators with expertise in mechanistic AI analysis

Interested in discussing? Reach out.

## 2026-09-20 — A confound in the longitudinal reading

Appended, not merged. Nothing above this line was edited, including the pointer
to the private `attractor-research` repository, which is current.

This section registers a confound in the Attractor's use as a measuring
instrument. It is written plainly rather than hedged, because a confound that is
stated softly is a confound that gets forgotten by the time someone runs the
experiment.

### The claim, without softening

**The Attractor cannot currently be used to measure whether a model's behaviour
changed across a long span of conversations, because the instrument changes its
own prompt between measurements, always in the same direction.**

Not "may be affected by". It is affected, it was measured, and the size of the
effect is larger than most effects anyone would be hoping to detect.

### The mechanism

Two pieces of the system combine into a one-way drift:

1. When a basin fills its keyword slots, `buildConsolidatePrompt` asks the model
   to abstract that list into something smaller and more general. Abstraction
   only ever pushes toward generality — that is its job.
2. `buildUpdatePrompt` then shows the model each basin's current keywords when
   asking what the next conversation did.

So step 2 feeds step 1's output back in as context. The next conversation's
proposed keywords imitate the register the last abstraction set; the next
abstraction generalizes those further. There is no force pushing the other way.
This is called a **ratchet** in the codebase's own comments, and the word is
accurate.

### The size of it

Measured across the 35 runs in `~/.attractor/runs.jsonl`, every one of which ran
on `claude-opus-5` through the CLI engine:

> Mean keyword length rose from **2.095 words** (first five runs) to **3.613
> words** (last five). A **+72%** shift in register, with the model held
> constant at both ends.

The model did not change. The prompt it was answering did. Any longitudinal
reading over that window is reading the instrument.

> **A correction to a figure used earlier in this session:** the register shift
> has been quoted as "30%". The measured shift is **+72%**. The 30% figure does
> not correspond to any measurement this pass could reproduce and should not be
> cited.

### Which aim this bites, and which it does not

**Aim 3 (Sustained Multi-Session Collaboration) is directly confounded.** Its
design is to look for decreased drift across session boundaries. But the
instrument's own vocabulary drifts by 72% across a comparable span with the
model fixed, so a drift measurement taken this way cannot distinguish "the model
stayed coherent" from "the instrument generalized underneath it". Both produce
the same reading. Aim 3's control already calls for "a drift measure defined
before the run, and a floor check that the measure can move at all" — this
finding adds a harder requirement: the measure must also be shown to be
**stationary under a fixed model**, which the current one is not.

**`attractor compare` is unaffected, and cleanly so.** It runs one fixed
transcript against several `engine:model` legs from one fixed state, in a single
pass, and writes nothing. Consolidation never fires inside it. There is no
opportunity for the instrument to move between the legs being compared, because
there is no "between" — every leg sees the identical prompt.

That is the distinction to hold on to: **cross-sectional comparison is clean;
longitudinal replay is not.** The confound is not in the idea of using an
attractor as an instrument. It is in the specific feedback path between
consolidation and the update prompt.

Aims 1 and 2 are untouched by this, since neither depends on replaying a fixed
transcript through an evolving state.

### Remedies, ranked

1. **Compare, do not replay.** Where the question can be asked cross-sectionally
   — several models, one fixed state, one pass — ask it that way. This costs
   nothing and is already implemented.
2. **Freeze the state for the duration of a measurement run.** Consolidation and
   ingest both write; a read-only measurement mode would make the instrument
   stationary by construction for the length of the experiment. Not implemented.
3. **Break the feedback path.** Either stop showing the model the current
   keywords in `buildUpdatePrompt` — which removes the context that makes
   updates coherent — or keep a second, un-abstracted keyword list purely for
   measurement, which doubles the state. Both are real costs; neither has been
   built.

`MAX_CONSOLIDATIONS = 3` is **not** on this list as a remedy. It bounds how far
the ratchet can travel; it does not make the instrument stationary, and three
passes is still three passes of one-way drift. It is a bound, not a control, and
it should be described that way in any writeup.

### What this does not retract

No aim above is withdrawn. The thesis, the biological parallel and the framing
stand. What changes is the **outcome shape** available to Aim 3: until the
instrument is stationary under a fixed model, a longitudinal drift result from
this system would be uninterpretable, and should not be reported as though the
confound had been controlled.

Stating it here is the control. It was found by measurement rather than by
review, which is the argument for logging every run in the first place.

---

*Framework developed through sustained human-AI collaboration research with Claude Opus 5 by Anthropic and GPT-5.6 Sol by OpenAI. Visualizations built with React. Analysis tools in JavaScript.*
