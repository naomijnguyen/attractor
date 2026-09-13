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
