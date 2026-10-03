/**
 * Invitation emails. The redcolumn server sends them through whichever provider is set up:
 * - STUDIO_RESEND_API_KEY (and STUDIO_MAIL_FROM): the Resend API;
 * - STUDIO_MAIL_WEBHOOK: a POST of { to, subject, text } to your own mail service.
 * With neither, invitations are not sent by the server (the app offers the user's own mail app).
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export type Mailer = (mail: Mail) => Promise<void>;

export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): Mailer | null {
  const resend = env.STUDIO_RESEND_API_KEY;
  if (resend) {
    const from = env.STUDIO_MAIL_FROM ?? 'redcolumn <studio@localhost>';
    return async (mail) => {
      const res = await fetcher('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${resend}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text }),
      });
      if (!res.ok) throw new Error(`The mail service answered ${res.status}`);
    };
  }
  const hook = env.STUDIO_MAIL_WEBHOOK;
  if (hook)
    return async (mail) => {
      const res = await fetcher(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(mail) });
      if (!res.ok) throw new Error(`The mail service answered ${res.status}`);
    };
  return null;
}

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

/** Up to `max` distinct, plausible email addresses. */
export function cleanEmails(raw: unknown, max = 20): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const e of raw) {
    const v = typeof e === 'string' ? e.trim().toLowerCase() : '';
    if (!EMAIL.test(v) || v.length > 200) return null;
    if (!out.includes(v)) out.push(v);
  }
  return out.length && out.length <= max ? out : null;
}

/** Invitations per session or Project per day, so the server cannot be used to send spam. */
export class InviteLimit {
  private sent = new Map<string, { day: number; count: number }>();
  private perDay: number;
  constructor(perDay = 100) {
    this.perDay = perDay;
  }
  take(key: string, n: number): boolean {
    const day = Math.floor(Date.now() / 86_400_000);
    const cur = this.sent.get(key);
    const count = cur && cur.day === day ? cur.count : 0;
    if (count + n > this.perDay) return false;
    this.sent.set(key, { day, count: count + n });
    return true;
  }
}

/** The plain-text invitation: who invites, to what, the ID, a link, and their note. */
export function invitationText(o: { from: string; what: string; name: string; id: string; link: string | null; note: string }): Mail['text'] {
  return [
    `${o.from} invited you to the ${o.what === 'Session' ? 'Live Session' : 'Team Project'} “${o.name}”.`,
    '',
    o.link ? `Open it: ${o.link}` : null,
    `${o.what === 'Session' ? 'Session' : 'Project'} ID: ${o.id}`,
    o.note ? `\n${o.from} wrote:\n${o.note}` : null,
    '',
    'Sent by redcolumn.',
  ]
    .filter((l) => l !== null)
    .join('\n');
}
