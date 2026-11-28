# Quarantined end-to-end tests

Tests that are known to fail and are skipped until fixed. This file is the only list: each entry
names the test, the reason, and the issue or PR that will fix it. A quarantined test is skipped in
its spec with `test.fixme(...)` and a comment pointing here.

Do not add a test here to get a PR green. Quarantine is for failures that are understood and not
caused by the change under review, and the maintainer agrees to each entry.

| Test | Projects | Reason | Since |
|---|---|---|---|
| `view.spec.ts` › split with one file open shows independent panes and a tab in the right pane, with no file picker | web (desktop not checked) | **App bug.** With a markup selected, right-clicking the right pane's tab activates that pane, which drops the selection; the Markup Format ribbon row closes and the tab strip moves up about 32 px before `contextmenu` fires, so the event lands on the page canvas and the page's menu opens instead of the tab's. Fails every time with several workers, passes alone. Browsers that fire `contextmenu` after mouseup (Windows) can hit it by hand. Fix: keep the layout still on that press (or open the tab menu on pointerdown), then remove the `test.fixme`. | 2026-11-28 |
