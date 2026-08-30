#!/usr/bin/env node
'use strict';

/**
 * Refuses to let a credential reach the repository or the browser bundle.
 *
 * Three checks, in the order things actually go wrong:
 *   1. Is a .env file tracked by git, or staged for commit?
 *   2. Does any tracked file contain something shaped like a live credential?
 *   3. Does any VITE_-prefixed variable look like a secret? Vite inlines those
 *      into the client bundle, so such a value is served to every visitor.
 *
 * Run standalone, from `npm run check:secrets`, in CI, or as a pre-commit hook:
 *   ln -s ../../scripts/check-secrets.js .git/hooks/pre-commit
 *
 * Exits non-zero on a finding so it can gate a commit or a pipeline.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const useColour = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColour ? `[${code}m${s}[0m` : String(s));
const bold = paint('1');
const red = paint('31');
const green = paint('32');
const yellow = paint('33');

const repoRoot = path.resolve(__dirname, '..');

function git(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/**
 * Patterns for values that are credentials by shape, not by name — so a leak is
 * caught even when the variable is called something harmless.
 */
const SECRET_PATTERNS = [
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Stripe secret key', re: /\bsk_live_[A-Za-z0-9]{16,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  {
    name: 'database URL with inline password',
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s:@/]+@/,
  },
  {
    name: 'assigned credential literal',
    // KEY = "…" with a long opaque value. Placeholders are excluded below.
    re: /\b(?:api[_-]?key|apikey|secret|password|passwd|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*["'][A-Za-z0-9_\-./+]{16,}["']/i,
  },
];

/** Obvious non-secrets: templates, docs and test fixtures. */
const PLACEHOLDER = /your[_-]?key|example|placeholder|changeme|xxx+|<[^>]+>|\.\.\.|dummy|test[_-]?key|fake|sample|user:password/i;

const SKIP_FILES = new Set(['package-lock.json', 'scripts/check-secrets.js']);
const SKIP_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.woff', '.woff2']);

const findings = [];
const notes = [];

// ---------------------------------------------------------------------------
// 1. Env files that should never be committed
// ---------------------------------------------------------------------------
const tracked = git(['ls-files']).split('\n').filter(Boolean);
const staged = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);

const isProtectedEnvFile = (file) => {
  const base = path.basename(file);
  return base.startsWith('.env') && base !== '.env.example';
};

for (const file of tracked) {
  if (isProtectedEnvFile(file)) {
    findings.push({ file, reason: 'env file is tracked by git — it must be gitignored' });
  }
}

for (const file of staged) {
  if (isProtectedEnvFile(file) && !tracked.includes(file)) {
    findings.push({ file, reason: 'env file is staged for commit — unstage it' });
  }
}

// .env.example must stay a template, never a filled-in copy.
const examplePath = path.join(repoRoot, '.env.example');
if (fs.existsSync(examplePath)) {
  for (const [index, line] of fs.readFileSync(examplePath, 'utf8').split('\n').entries()) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (!match) continue;
    const [, name, rawValue] = match;
    const value = rawValue.trim().replace(/^["']|["']$/g, '');
    if (!value || PLACEHOLDER.test(value)) continue;

    if (/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|CREDENTIAL/i.test(name)) {
      findings.push({
        file: '.env.example',
        line: index + 1,
        reason: `${name} has a real-looking value; the template must ship empty or placeholder`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Credential-shaped strings in tracked files
// ---------------------------------------------------------------------------
for (const file of tracked) {
  if (SKIP_FILES.has(file)) continue;
  if (SKIP_EXTENSIONS.has(path.extname(file))) continue;

  const absolute = path.join(repoRoot, file);
  let content;
  try {
    const stat = fs.statSync(absolute);
    if (!stat.isFile() || stat.size > 2_000_000) continue;
    content = fs.readFileSync(absolute, 'utf8');
  } catch {
    continue;
  }

  content.split('\n').forEach((line, index) => {
    if (PLACEHOLDER.test(line)) return;

    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(line)) {
        findings.push({
          file,
          line: index + 1,
          reason: `looks like a ${name}`,
          excerpt: line.trim().slice(0, 100),
        });
        break;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// 3. Secrets exposed to the browser through a VITE_ prefix
// ---------------------------------------------------------------------------
for (const name of Object.keys(process.env)) {
  if (!name.startsWith('VITE_')) continue;
  if (/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|CREDENTIAL/i.test(name)) {
    findings.push({
      file: '(environment)',
      reason: `${name} is inlined into the client bundle by its VITE_ prefix and served to every visitor`,
    });
  }
}

const envFiles = fs.readdirSync(repoRoot).filter((f) => f.startsWith('.env') && f !== '.env.example');
for (const file of envFiles) {
  const content = fs.readFileSync(path.join(repoRoot, file), 'utf8');
  for (const [index, line] of content.split('\n').entries()) {
    const match = /^\s*(VITE_[A-Z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (!match) continue;
    if (/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|CREDENTIAL/i.test(match[1])) {
      findings.push({
        file,
        line: index + 1,
        reason: `${match[1]} would be inlined into the client bundle — drop the VITE_ prefix`,
      });
    }
  }
  notes.push(`${file} present locally and correctly untracked`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log(bold('\nSecret scan'));
console.log(`  scanned ${tracked.length} tracked file(s)\n`);

for (const note of notes) console.log(`  ${green('ok')}  ${note}`);

if (findings.length === 0) {
  console.log(`  ${green('ok')}  no env file is tracked or staged`);
  console.log(`  ${green('ok')}  no credential-shaped strings in tracked files`);
  console.log(`  ${green('ok')}  no secret exposed through a VITE_ prefix`);
  console.log(green('\nClean — nothing to block.\n'));
  process.exit(0);
}

console.log(red(`\n${findings.length} finding(s):\n`));
for (const finding of findings) {
  const where = finding.line ? `${finding.file}:${finding.line}` : finding.file;
  console.log(`  ${red('!')} ${bold(where)}`);
  console.log(`    ${finding.reason}`);
  if (finding.excerpt) console.log(`    ${yellow(finding.excerpt)}`);
}

console.log(
  red('\nBlocked.') +
    ' Remove the value, rotate the credential if it was ever pushed, and keep\n' +
    'secrets in .env (gitignored) or your platform\'s secret store.\n',
);
process.exit(1);
