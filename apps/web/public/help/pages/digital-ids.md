# Digital IDs

A **Digital ID** is an electronic identity (a certificate and a private key) used to sign PDFs so anyone can check who signed and that the file hasn't changed.

## Open your Digital IDs

Choose {{Tools > Sign & Certify > Digital IDs…}}.

## Make a Digital ID

1. In the Digital IDs window, choose to make a new one.

   ![Making a Digital ID](img/digital-ids.png)
2. Type your **Name**, **Email** and **Organisation**.
3. Choose a **Password** and type it **Again**. You need it each time you sign.
4. Click **Create**.

This makes a *self-signed* ID. It proves the document hasn't changed since you signed it. People who check it can choose to trust your certificate: click **Export certificate** beside your ID and send them the file.

## Use an ID from your company or a certificate authority

If you have been given a `.p12` or `.pfx` file, click **Import .p12 / .pfx…** in the Digital IDs window, pick the file, type its password and click **Import**.

## Remove an ID

Click **Delete** beside it. Documents already signed with it stay signed.

> **Warning:** Your Digital ID is kept only in this browser on this device. If you clear the browser's data, it is gone. Keep a backup of any `.p12`/`.pfx` file you import.
