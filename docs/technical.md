# The Attractor Model

> A dynamic system for tracking how conversational interests and themes evolve over time.

> The technical reference. For what the Attractor is and why, start at
> [README.md](../README.md); terms used here are defined in its
> [glossary](../README.md#glossary).

---

## Why I Built This

The question that started it all: *why don't AI models have memory?* It seemed so simple at first. Over a year and a half of digging into transformers, context windows, and RLHF, I realized the answer was more nuanced — and that the real opportunity was in how we structure and optimize context.

The Attractor Model is my answer to that puzzle. Instead of trying to remember everything, it tracks what *matters* — the gravitational pull of recurring themes, interests, and patterns across conversations. It's a map of attention that evolves over time.

The Attractor was an idea about whether personalization was something that I could "drop" an LLM into via a custom user prompt. A sort of memory, for a user liked to interact, what topics they talked about, and different keywords that could be used in a semantic search to help guide responses. Naturally, I wanted this to be updated in almost real time, to allow the attractor and basins to be calculated with each conversation end, with "weights" of a basin calculated by automated analysis with an API call done in app and sent to the conversation model as context for response generation. 

This idea spanned two projects, one was to see if personalization through this method was possible. Could I get any sort of a sense of continuity when coming back conversations and projects, where the tone, working state, project state, would continue rather than a cold start?

The other, was how different settings (like temp, k, token length and constraints), as well as model (for this, I made API calls to Anthropic's Claude Opus, Sonnet, and Haiku) with varying changes and constraints on how the model analyzed the conversation (the calculations stayed static). Which was interesting in the differences in what attractor was generated, based on which model was used.

This prototype expands on this, with special implementations which could allow users to input their own AIP keys, and input/seed or import a conversation for analysis to see the graph generated. For Interpretability researchers, features to analyze the response differences across a family of models, as well temp, perplexity, token limits, etc change the way a model analyzes a conversation to select key token values real-time. The end product, the attractor values could essentially be ephemeral or externally stored weighted parameters that are dynamically generated and used as context for a response rather than a conversation transcript. 

 The idea about attractors representing a space in the topology of how LLMs sorted parameters and grouped them during training was something that arose from very informal learning. I wanted to know the way that an LLM developed different understandings of math, or coding or history, personas (like helpful assistant) and what that was represented as, which I wasn't able to find an answer for. Over time, I thought of attractors as personas, which contained neighborhoods of different homes and shops which could helpe to orient a model into a specific response style by associating different ideas with certain words. And I wondered if this could be a faster way to go from a cold start to a personalized reponse, every time. 

Since I wasn't able to experiment with context windows or architecture, and I was really interested in automations for memory features, and autonomous writes, as well as not wanting to copy and paste code from a conversation over to a text document, then making it plain text, saving it as .sh and then ch mod and moving the files to the right directory. 
 
 These Projects show the evolution of of this over time. I wanted to customize the response (tone, working style, project state) have a repo that could be referred to for projects, documents, see what an LLM would write, AND I wanted the model to be able to write to repo, something that claude.ai wasn't able to do at the time. And this is that story along with some side detours on random ideas (like a journal club that became a router model)
 

---

## Overview

The Attractor Model represents areas of interest as weighted "basins" — think of them as gravity wells that conversations naturally fall into. As sessions are ingested, basin weights shift, connections form, and the overall shape of the attractor evolves. Entropy measures how focused or diffuse the system is at any moment (0 = highly focused, 1 = uniformly spread). Phase tracks structural transitions over time.

The result is a living map of attention: what's dominant right now, what's fading, what's emerging.

---

## Architecture

### API Layer (`attractor.ts`)
Cloudflare Workers-style REST API backed by KV storage. Handles seeding the attractor with initial basins, ingesting conversations (raw transcripts are summarized via Claude Haiku before being fed in, and retrieving state and history.

### CLI (`attractor`)
Bash tool that fetches the current attractor state and renders it in the terminal as a weighted bar chart with trend arrows, entropy, trajectory direction, top keywords, and emerging patterns. Run `attractor history` for a timestamped evolution table.

Requires a bearer token at `~/.claude/attractor-token`.

### Frontend (`AttractorView` / attractor.tsx)
React canvas component with a force-directed graph. Basins are nodes sized and colored by weight (blue → teal → amber → coral → violet as weight increases). Physics simulation handles repulsion between nodes, attraction along edges, and center gravity.

Clicking a node opens a detail panel with description, weight bar, trajectory sparkline, keywords, and connected basins. The history sidebar shows all basins ranked by weight with mini sparklines and a snapshot timeline.

---

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/attractor` | Current attractor state |
| POST | `/api/attractor/seed` | Initialize with basins |
| POST | `/api/attractor/basins` | Add a basin |
| DELETE | `/api/attractor/basins/:id` | Remove a basin |
| GET | `/api/attractor/history` | Evolution snapshots |
| POST | `/api/attractor/ingest-transcript` | Raw messages → summarize → update |
| POST | `/api/attractor/ingest` | Pre-summarized text → update |

---

## CLI Usage

```bash
attractor           # current state: weights, entropy, trajectory, keywords
attractor history   # timestamped evolution table
```

Requires `~/.claude/attractor-token`.

---

## Tech Stack

- **Runtime:** Cloudflare Workers + KV storage
- **Summarization:** Claude Haiku (Anthropic API)
- **Frontend:** React + HTML Canvas
- **CLI:** Bash + Python

---




*May 3, 2026*
