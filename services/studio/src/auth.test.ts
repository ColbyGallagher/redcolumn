import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bearer, googleVerifier, socketToken } from './auth.ts';

test('tokens are trusted only for our client, with a verified email', async () => {
  const answers: Record<string, object> = {
    good: { aud: 'ours.apps.googleusercontent.com', email: 'Sam@Firm.com', email_verified: 'true', expires_in: '3000' },
    otherApp: { aud: 'theirs.apps.googleusercontent.com', email: 'sam@firm.com', email_verified: 'true', expires_in: '3000' },
    unverified: { aud: 'ours.apps.googleusercontent.com', email: 'sam@firm.com', email_verified: 'false', expires_in: '3000' },
  };
  let calls = 0;
  const fake = (async (url: string) => {
    calls++;
    const t = new URL(url).searchParams.get('access_token')!;
    return answers[t] ? new Response(JSON.stringify(answers[t])) : new Response('{}', { status: 400 });
  }) as typeof fetch;
  const verify = googleVerifier(['ours.apps.googleusercontent.com'], fake);
  assert.deepEqual(await verify('good'), { email: 'sam@firm.com' });
  assert.deepEqual(await verify('good'), { email: 'sam@firm.com' });
  assert.equal(calls, 1, 'answers are cached');
  assert.equal(await verify('otherApp'), null);
  assert.equal(await verify('unverified'), null);
  assert.equal(await verify('junk'), null);
});

test('tokens come from the Authorization header or a WebSocket subprotocol', () => {
  assert.equal(bearer('Bearer ya29.abc'), 'ya29.abc');
  assert.equal(bearer('Basic x'), null);
  assert.equal(socketToken('nb-studio, nb-auth.ya29.a-b_c'), 'ya29.a-b_c');
  assert.equal(socketToken(undefined), null);
});
