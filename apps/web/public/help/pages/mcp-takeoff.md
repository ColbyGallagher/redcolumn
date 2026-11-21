# Takeoff proposals

The client can suggest which [assembly](#assemblies) fits each measurement, and how to group the takeoff. It never adds anything to the takeoff itself: you decide.

## list_assemblies

**Does:** lists the drawing's assemblies.

**Returns:** each assembly's items with their units and formulas, and its variables. `formulaNames` are the measured values a formula can use, such as `[Length]`, `[Area]` and `[Count]`.

**Limits:** it changes nothing. The client should run it before `propose_takeoff`.

**Model:** a cheaper model is fine.

## propose_takeoff

**Does:** proposes an assembly for each of some measurements, with its reasoning and, if it likes, the quantities it expects.

**Takes:** a list. Each item names a measurement (by id or number), an assembly (name or id) and a reason. It can also give the quantities the AI expects, its `confidence` (0 to 1) and its `sources`: where it read them, so you can check them. [Review AI takeoff](#ai-review) lists the least sure first.

**Where you see it:** the proposals wait in {{Tools > Takeoff > Review AI Takeoff…}}, a panel that opens by itself when they arrive. You **approve**, **edit** or **reject** each one. Nothing is added to the takeoff until you approve it.

**Limits:**

- 500 proposals a call.
- A new proposal for a measurement replaces its earlier pending one.
- Each item must say *why*, so you can check it.
- The markup must be a measurement.

**Model:** a strong model. It has to match the right assembly to each measurement, from the drawing and the assembly list, and the quantities it expects are a check on its own work.

## list_takeoff_proposals

**Does:** lists the proposals and where each stands: pending, approved (by whom, and whether they edited it) or rejected. It also lists the measurements the client drew (its drafts) and where each stands, and the drafts you rejected.

**Limits:** it changes nothing.

**Model:** a cheaper model is fine.

## propose_grouping_column

**Does:** proposes a custom column that groups markups, with a value for each markup and a reason for each.

**Takes:**

- `name`: the column name.
- `type`: `choice` (a drop-down) or `text`.
- `options`: the drop-down choices, if it is a drop-down.
- `reasoning`, and optionally `confidence`.
- `assignments`: each one a markup, its value and, optionally, a reason.

**Where you see it:** {{Tools > Takeoff > Review AI Takeoff…}}, on the Columns tab. Nothing is written until you accept it. See [Review AI takeoff](#ai-review).

**Limits:** never a number column. 5000 markups a call.

## list_grouping_columns

**Does:** lists the proposed grouping columns. For each one it gives the status, how many markups are in each group, how many you regrouped, and the tool that made it.

## propose_grouping_tool

**Does:** proposes a reusable grouping tool for the library on this computer. A tool is a rule: a `filter` (which markups) and an `action` (the value each one gets in its `column`). The action can:

- `set` a fixed value.
- `copy` the subject, label, layer, page, sheet or a column.
- name the `zone` the markup is in. Zones are page positions on one document, so a zone tool runs on that document only.
- map words in the `sheet` title to a value.

**Limits:** rules only, never code. It cannot run until you accept it.

## list_grouping_tools

**Does:** lists the library: each tool's rule in words, its status, whether it runs, and how often it was used.

## run_grouping_tool

**Does:** runs an accepted tool, that you have not turned off, on a drawing. It proposes a grouping column for you to review, recorded against the tool.

**Limits:** refused for a tool that is proposed, rejected or turned off. It never changes a markup or a quantity itself.

## get_review_packet

**Does:** gives a reviewer the takeoff to check, for the optional [AI review pass](#ai-review). It returns:

- every AI result that is not rejected, with its item id, page, geometry, measurement, assembly and sources.
- the sheets and their scales.
- the instructions.

It leaves out the first pass's reasoning and confidence on purpose.

**Limits:** it changes nothing. Run it in a fresh conversation or subagent, not the one that made the takeoff.

**Model:** a strong model. A different one from the first pass is better.

## report_review_findings

**Does:** reports what the reviewer found. A finding is about an item (`issue`, `check` or `ok`, with a kind such as `quantity` or `wrong-item`) or about something missed (with the page and area where it is). It can give the reviewer's own quantity and its sources.

**Where you see it:** in {{Tools > Takeoff > Review AI Takeoff…}}, labelled **AI review**, beside the item it is about. You accept or dismiss each finding. Nothing is applied.

**Limits:** 1000 findings a call. A missed item must say where it is.

Back to [Connect an AI client](#mcp).
