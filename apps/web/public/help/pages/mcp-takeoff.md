# Takeoff proposals

The client can suggest which [assembly](#assemblies) fits each measurement. It never adds anything to the takeoff itself: you decide.

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

Back to [Connect an AI client](#mcp).
