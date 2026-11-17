# Community library

The community library is a shared collection of **trade packs**: everything one trade needs to start a takeoff, made by other estimators. A pack can hold [assemblies](#assemblies), the [items](#estimating-items) and [product lists](#product-lists) they price from, [takeoff templates](#takeoff-templates), [tool sets](#tool-sets) and [drawing standards](#drawing-standards).

## Add a pack

1. Choose {{Tools > Takeoff > Browse Library…}}, or click **Library** on the **Takeoff** tab.
2. Pick a trade, or search by name, trade or tag.
3. Click **Add** beside the pack.

What the pack holds goes into your own library:

- assemblies into **My Assemblies**, and items, product lists and templates into the estimating library, so every document can use them;
- tool sets into the [Tool Library](#tool-library) of the active profile;
- drawing standards into the active profile's [drawing standards](#drawing-standards).

Adding a pack again updates it: its assemblies and estimating records are matched by id, its tool sets replace the ones it added before, and its standards replace the ones with the same id. Your own records are not changed.

> **Note:** Quantities, waste factors and rates in a pack are starting points from whoever shared it. Check them against the job's spec before you price from them.

## Add a pack file

A pack is one `.rctrade` file. To add one someone sent you, choose **Add from File…** in the library and pick the file. It is checked the same way as a pack from the library: anything redcolumn does not recognise stops it being added.

## Share a pack

The library lives in the public `redcolumn-library` repository on GitHub. Click **Share a Pack…** in the library to open it; its README explains the pack format and how to send one in. Packs must not contain client drawings, client names or anything you are not free to share.

## Privacy

redcolumn asks GitHub for the library's list only when you open **Browse Library**, and for a pack only when you add it. The requests carry no cookies, sign-in or referrer, and nothing from your documents or settings. Each pack is checked against the fingerprint in the list before it is added. See the privacy policy for more.
