import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

// Emulator only. Never accepts a remote host or a real project ID.
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^127\.0\.0\.1:\d+$/.test(host || '')) throw new Error('Start the local Firestore emulator and set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080');
const base = `http://${host}/v1/projects/demo-personal-fsl/databases/(default)/documents`;
function token(uid) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: uid, user_id: uid, aud: 'demo-personal-fsl', iss: 'https://securetoken.google.com/demo-personal-fsl', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, firebase: { sign_in_provider: 'custom' } })}.`;
}
for (const [name, uid, path, method, fields] of [
  ['unauthenticated read', null, 'users/alice/sessions/test', 'GET', null],
  ['cross-user read', 'bob', 'users/alice/sessions/test', 'GET', null],
  ['owner collection remains blocked', 'alice', 'users/alice/sessions/test', 'PATCH', { ownerUid: { stringValue: 'alice' } }],
  ['ownership tampering', 'alice', 'users/alice/sessions/test', 'PATCH', { ownerUid: { stringValue: 'bob' } }],
  ['role escalation', 'alice', 'users/alice', 'PATCH', { role: { stringValue: 'admin' } }],
  ['teacher self-assignment', 'teacher', 'teacherAssignments/test', 'PATCH', { teacherUid: { stringValue: 'teacher' } }],
  ['unauthorized teacher read', 'teacher', 'users/alice/sessions/test', 'GET', null]
]) {
  test(`Stage 1 deny-all rejects ${name}`, async () => {
    const response = await fetch(`${base}/${path}`, { method, headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${token(uid)}` } : {}) }, ...(fields ? { body: JSON.stringify({ fields }) } : {}) });
    assert.equal(response.status, 403, await response.text());
  });
}
