# Walkthrough

A Herdr mod that turns a repository's diff into a guided reading, shown beside or over a coding agent.

## Language

**Placement**:
Where a walkthrough is shown: a Dialog, a Pane or a Tab. A walkthrough has exactly one Placement at a time; changing it moves the walkthrough, it doesn't copy it.
_Avoid_: mode, view, layout

**Dialog**:
The Placement floating over the agent's tab, closed with Esc.
_Avoid_: floating window, overlay, modal, popup

**Pane**:
The Placement beside the agent, inside the agent's tab.
_Avoid_: panel, split

**Tab**:
The Placement in a tab of its own, in the same space as the agent's tab.
_Avoid_: window, page

**Auto**:
The setting that writes a finished turn's walkthrough without a click; off unless the person turns it on.
_Avoid_: autogenerate, auto mode

**Origin tab**:
The agent's tab a walkthrough was first opened over; whatever its Placement, it watches that tab's agents, sends comments and questions to them by default, and returns to it as a Dialog.
_Avoid_: source tab, parent tab
