
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

---

*Framework developed through sustained human-AI collaboration research with Claude Opus 5 by Anthropic and GPT-5.6 Sol by OpenAI. Visualizations built with React. Analysis tools in JavaScript.*
