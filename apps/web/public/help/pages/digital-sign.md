# Sign with a Digital ID

1. [Make or import a Digital ID](#digital-ids) first.
2. Choose {{Tools > Sign & Certify > Sign with Digital ID…}} (or press [[X]]).

   ![The Sign window](img/digital-sign.png)
3. Choose the Digital ID and type its password (or, for an ID on a [smart card or USB token](#digital-ids), its PIN).
4. Choose how to sign:
   - **Approve (sign)** — an ordinary signature.
   - **Certify: no changes allowed** — the author's signature; any later change breaks it.
   - **Certify: allow form filling and signing**.
   - **Certify: also allow markups**.
5. Choose **Where** the signature goes: **Draw the signature's box on the page**, or **Invisible** (listed in the Signatures panel only). If you started from an empty signature field, it goes there.
   Choose its **Appearance**: **Name and date only**, or one of your [saved signatures](#signatures).
6. Optional: tick **Trusted time stamp from** so the signing time is vouched for by a time stamp server. Time stamps need the desktop app: browsers cannot reach time stamp servers, so in the browser the option is greyed out. The desktop app reaches public servers only: a time stamp or revocation server on your company's own network, or one reachable only through a proxy, cannot be used yet.
7. Optional (desktop app only, with a trusted time stamp): tick **Add long-term validation (LTV)** to keep the certificate chain and the certificate authority's "not revoked" answer in the PDF. The signature can then be checked years later, after the certificate expires or the authority's servers are gone. It is added after the signature, which stays valid. The authority's answer must be issued after the time stamp, so it shows the certificate was not revoked when the document was signed. If such an answer cannot be had (offline, a certificate authority with no revocation service, or one that only gives out older answers), the file is signed without it and you are told why.
8. Click **Next: draw the box** (or **Sign**), and draw the box if asked. Then save the signed file.

## Check signatures on a PDF

Open the [Signatures panel](#signatures). Under **Digital Signatures**, each signature is listed with who signed, when, and whether the document has changed since. Click the check button to ask the certificate authority whether the certificate was revoked. **LTV enabled** means the PDF holds what is needed to check the signature without going online; **Add LTV** adds it to a signature that lacks it (desktop app only).

> **Warning:** If a PDF contains active content (JavaScript, or actions that open a file or program), the Sign dialog and the Signatures panel say so. A script can change what the document shows without changing the signed bytes, so what you see may not be what was signed. Sign or rely on such a file only if you trust where it came from. Bulk Sign & Seal signs it anyway and notes it in the results.

> **Warning:** After signing, don't change the document (markups, page changes, Reduce File Size) unless the signature allows it, or the signature will show as broken. To sign many files at once, use [Bulk Sign & Seal](#batch-sign).
