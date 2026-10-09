# Sign with a Digital ID

1. [Make or import a Digital ID](#digital-ids) first.
2. Choose {{Tools > Sign & Certify > Sign with Digital ID…}}.

   ![The Sign window](img/digital-sign.png)
3. Choose the Digital ID and type its password.
4. Choose how to sign:
   - **Approve (sign)** — an ordinary signature.
   - **Certify: no changes allowed** — the author's signature; any later change breaks it.
   - **Certify: allow form filling and signing**.
   - **Certify: also allow markups**.
5. Choose **Where** the signature goes: **Draw the signature's box on the page**, or **Invisible** (listed in the Signatures panel only). If you started from an empty signature field, it goes there.
   Choose its **Appearance**: **Name and date only**, or one of your [saved signatures](#signatures).
6. Optional: tick **Add a trusted time stamp** so the signing time is vouched for by a time stamp server.
7. Click **Next: draw the box** (or **Sign**), and draw the box if asked. Then save the signed file.

## Check signatures on a PDF

Open the [Signatures panel](#signatures). Under **Digital Signatures**, each signature is listed with who signed, when, and whether the document has changed since. Click the check button to ask the certificate authority whether the certificate was revoked.

> **Warning:** After signing, don't change the document (markups, page changes, Reduce File Size) unless the signature allows it, or the signature will show as broken. To sign many files at once, use [Batch Sign & Seal](#batch-sign).
