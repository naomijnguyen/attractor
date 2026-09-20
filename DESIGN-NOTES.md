---
Title        Attractor design notes
Purpose      Why the attractor works the way it does, in the words it was thought out in. Prose recovered verbatim from inside source files, plus later dated sections written against the shipped code and marked as such. Read for intent, not for current values.
Author       Jennifer Naomi Nguyen
Canonical    ~/Bootwitch/Projects/attractor/DESIGN-NOTES.md — authoritative for the recovered prose, which exists nowhere else since the source files it came from were rewritten. AMBIGUOUS for the repo as a whole: an older copy of this file exists at ~/Projects/Anthropic/attractor/DESIGN-NOTES.md and it has not been established which checkout is deployed. Flagged rather than asserted; see the note in ARCHITECTURE.md.
Updated      2026-09-20
Dependencies none. Current constants live in src/model.ts, not here.
---

# attractor / wikigen — design notes

Prose recovered from inside source files (it had been typed into the code).
Verbatim; wording unchanged.

---

## Conversation parsing & wiki tagging

_Recovered 2026-08-26 from `components/wikigen.py` line 78._

Conversations need to be individually retrieved from the database for analysis. To achieve this, we implemented a session hook at the end of each conversation. Whenever a conversation ends, this hook triggers the agent to automatically analyze that specific conversation. The model responsible for analyzing the conversation performs the vibe tag and wiki tags as part of the Claude Chat project web application, which is assisted by Claude Anthropic.

We built Basin, a tool that allows us to test various configurations. We used Haiku, Sonnet, and Opus as automated generation tools. These tools were optimized for distributed tasks, and a subagent feature was incorporated into the build. This feature offloaded tasks to each agent, enabling the API calls to reach additional subagents.

Later, this feature was extended to work with Claude3 code sessions. Therefore, not only did the tag generation analyze API conversations, but it also had the capability to do the same through the Claude Code Desktop app integration. This integration required multiple hooks, including those for Anthropic login requirements.

---

## Tag generation & de-duplication

_Recovered 2026-09-01 from `components/wikigen.py` line 116 (the `extract_concepts` signature)._

this is how hakiu from Anthropic is called through api to analylzes claude conversations to generate a tag representin the ideas over a conversationi. Wikis are then given a tag automated. Tags dictionary is managed in that initial list generated and then the model which analyses the conversation then searches that database so semantic dupliactes are not generated. So the a if the words webapp and webapplication showed up, within a conversation for the graph and nodes, you could still be able to generate the note without have two tags genrated

_From `load_jsonl_session` (line note, recovered 2026-09-01):_ load conversations but needs a list by role, content

_From `concepts_from_filename` (line note, recovered 2026-09-01):_ path : string so list string

---

## Graph construction

_Recovered 2026-09-01 from `components/wikigen.py` (bare line under the "Graph construction" header)._

Graph based on the tags from wikis and attractor basin scoring which then are (though notyet implemented as an sql or datablase. As  the conersations build the graph is rendered and the nodes are shown as a node differin in sizes with more frequent wiki tags generally being represeented as a larger node.

---

## Graph drawing — sizing, responsiveness, and the temporal view

_Recovered 2026-09-01 from `components/wikigen.py`, the block under the "Drawing" header.
Verbatim; wording unchanged._

graph should be claculated by calculating area of a circle for the node , normalizing each node down to a size that fits and the value for calculating comes from the number of times that the word appears.
The graph it self would be dependent on the size of each screen no? So if looking at a smaller laptop screen vs a desktop the draw graph is a bit dynamic so you ocould do a small graph, scale it so that the fixed corners then stretch with the size of the screen?

sort of like eaach piece snaps to the sides of the others like a button?I can graph in graphpad prism but it's definitely not as nice, so it'

It's just x and y axis but no border on the graph I think looks nicerplsu it's not really a grouped xy so much as a flat temporal view with nondes sitting on the graph on a planar view rather than vertically. The aplike to see the way a conversation is traveled as well. Wyich requires the  db to have dates in it  The temporal repressentation as how I can retrace the way I ideas and which ideas lead to what, rather than placemarker for what was first. As the temporal feature itself helped to show which added features were a hint at where I could first debug if something like, a two subagent calls placed too close together could possiblt push the streaming websocket and that falls back to the 30 second nechanism that the was what could keep db and worker online, agentic loop which allows the worker to stay "oersistent" wich could be a considered when debuggin.
worker > server went down >worker > db write > read db> 30 sec to relay again > db1 write> db read> ..,
  and b write coul how he pieces were made as I thought about them, rather thab the a the perfect structure of how professional developeers general plan.  which is sort of how we ended up with node modules.
  The first page was pretty empty. no features were there aside from just a chat window. Which. So individual pieces were added  kind of qui8kly in the sense that no one thing was too big. Until the complied file.

---

## 2026-09-20 — Why the decay model was replaced

> **This section is not recovered prose.** Everything above it was lifted
> verbatim out of source files and left unedited, typos and all, because its
> value is that it is a record of how the thing was actually thought about at
> the time. This section was written on 2026-09-20 against the shipped code. It
> is kept in the same file because it answers a design question the recovered
> notes raise, but it is marked so nobody later mistakes it for something
> Jennifer typed into `wikigen.py`.

The recovered notes above describe nodes sized by how often a tag appears, and a
graph that "breathes". The first implementation took that literally: a basin
gained weight when a conversation mentioned it, and basins nobody mentioned
drifted slowly back toward a resting value of `0.3`.

That is a reasonable-looking rule and it failed, for a reason that is only
obvious once you see the numbers.

**Every conversation is about something.** So the model, asked what a
conversation did to the attractor, almost always answers "raised something" —
across 35 logged runs it proposed 126 weight deltas and 125 of them were
positive. The gain applied to whatever was in front of it. The loss applied only
to what it ignored. Those two are not symmetric, and the gap does not close: the
weights climbed until four of six basins sat at the ceiling, at which point
weight stopped carrying any information at all. The graph had stopped breathing
and nobody could tell, because it still looked full.

### Why a bigger decay rate is the wrong fix

This is the first thing anyone suggests, including the people who wrote it, and
it is worth writing down why it does not work — otherwise it gets suggested
again in six months.

A larger decay rate makes the system **forget faster**. It does not make it
**discriminate**. The imbalance is between a per-conversation gain applied to
what was mentioned and a per-conversation loss applied only to what was not, and
no rate closes that gap without also erasing the signal. A decay strong enough
to hold the line against `+0.057` per mention would flatten a basin to the floor
during any ordinary week it simply was not the subject of — which is the
*opposite* of "a basin goes dormant and can reactivate".

Clamping harder fails for the same reason. Deltas were already clamped at `0.3`
and saturation happened anyway, because the problem is the **sign** of the
deltas, not their size.

### What replaced it

Two forces instead of one, doing two different jobs.

**A conversation now redistributes attention rather than adding it.** The mean
proposed delta is subtracted from every basin, and — this is the whole trick —
basins nobody mentioned count as zero when that mean is taken. That is what
gives a single-topic conversation something to take weight *from*. Saturation
stops being a tuning problem and becomes structurally impossible: reaching the
ceiling now requires being dominant relative to everything else, not merely
being mentioned a lot.

**And everything is pulled gently toward the live mean.** Redistribution alone
has a mirror failure that is just as bad: a basin that is present in most
conversations but the subject of none sinks to the floor and stays there.
Pulling the spread together fixes both tails with one force, and it adds no
weight to the system, so it does not undo the first fix.

The important difference from the decay it replaced is *what it aims at*. Decay
pulled toward a fixed `0.3` — a number someone chose. Reversion pulls toward
whatever the mean currently is. It therefore never argues with the distribution
the conversations actually produced; it only limits how far the tails can run
away from it.

### The thing that was given up, on purpose

Weight used to mean "how active is this basin". It now means "what share of
attention does it hold". Those are genuinely different, and the second one has a
cost that shows up immediately: **a period where all your work intensifies
together reads as flat.** Nothing is rising, because everything is.

That was accepted rather than worked around. The absolute story did not
disappear — `conversationCount` and `phase` still carry it — and the question
the graph is for ("what is pulling on me right now, relative to everything
else?") is the relative one. But it means a screenshot of the graph is not a
picture of how busy someone was, and reading it that way will mislead.

### The keyword ratchet, which was a surprise

The weights were the expected problem. This one was not.

When a basin fills its ten keyword slots, a separate model call abstracts the
list into something smaller and more general rather than evicting the oldest
entries — because eviction by recency leaves a basin described by its last few
conversations instead of by what it *is*.

But the prompt that asks the model what a conversation did shows it each basin's
current keywords. So after an abstraction pass, the next conversation's keywords
imitate the register the abstraction just set. Then the next abstraction
abstracts *that*. It only ever turns one way, toward the general, and it is
measurable: mean keyword length went from 2.1 words to 3.6 across the log with
the model held constant the whole time. The instrument was slowly rewriting its
own vocabulary.

The fix is a cap — three abstraction passes per basin, ever — and it is honestly
a bound rather than a solution. Past the cap a basin falls back to exactly the
recency eviction that abstraction existed to avoid. That trade was made
knowingly: a slow loss of history is at least legible in the keywords
themselves, whereas a slow loss of specificity is invisible until the basins
have all started to sound alike.

Worth knowing: the hosted Worker never consolidated at all. So the cap does not
invent a third behaviour — it moves the CLI back toward what the hosted version
was already doing.
