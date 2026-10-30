#!/usr/bin/env node
// Prints an AUTH_PASSWORD_HASH value. Prompts twice without echoing the password.
//   node hash-password.mjs
import { createInterface } from 'node:readline';
import { hashPassword } from './password.mjs';

const tty = Boolean(process.stdin.isTTY);
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
let prompt = '';
// Hide typed characters: only ever write the prompt itself.
rl._writeToOutput = (s) => { if (s.startsWith(prompt)) process.stdout.write(prompt); };
const lines = rl[Symbol.asyncIterator]();
async function ask(question) {
  prompt = question;
  process.stdout.write(question);
  const { value = '' } = await lines.next();
  process.stdout.write('\n');
  return value;
}

const a = await ask('Password: ');
if (a.length < 10) { console.error('Use at least 10 characters.'); process.exit(1); }
const b = await ask('Again: ');
rl.close();
if (a !== b) { console.error('Passwords did not match.'); process.exit(1); }
console.log(`\nAUTH_PASSWORD_HASH=${await hashPassword(a)}`);
