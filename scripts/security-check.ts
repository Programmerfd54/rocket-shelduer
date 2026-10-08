#!/usr/bin/env npx tsx
/**
 * Комплексная проверка безопасности (SECURITY_TESTING_SCOPE).
 * Запуск: npm run security:check
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

let hasErrors = false;
let hasWarnings = false;

function log(msg: string, type: 'ok' | 'warn' | 'err' = 'ok') {
  const prefix = type === 'ok' ? `${GREEN}✓` : type === 'warn' ? `${YELLOW}⚠` : `${RED}✗`;
  console.log(`${prefix} ${msg}${RESET}`);
  if (type === 'err') hasErrors = true;
  if (type === 'warn') hasWarnings = true;
}

function section(title: string) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(` ${title}`);
  console.log('='.repeat(50));
}

// 1. npm audit
function runNpmAudit() {
  section('1. Анализ зависимостей (npm audit)');
  try {
    const out = execSync('npm audit --json 2>/dev/null || true', {
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    });
    const data = JSON.parse(out || '{}');
    const vuln = data.metadata?.vulnerabilities || {};
    const total = (vuln.critical || 0) + (vuln.high || 0) + (vuln.moderate || 0) + (vuln.low || 0);
    if (total === 0) {
      log('Уязвимостей не найдено');
    } else {
      const hasCritical = (vuln.critical || 0) > 0;
      const hasHigh = (vuln.high || 0) > 0;
      log(`Найдено: ${vuln.critical || 0} critical, ${vuln.high || 0} high, ${vuln.moderate || 0} moderate, ${vuln.low || 0} low`, hasCritical ? 'err' : hasHigh ? 'warn' : 'warn');
      log('Выполните: npm audit fix (или npm audit fix --force с осторожностью)');
    }
  } catch {
    log('npm audit не выполнен (возможно, нет доступа к реестру)', 'warn');
  }
}

// 2. Проверка .env.example
function checkEnvExample() {
  section('2. Конфигурация (.env.example)');
  const envPath = path.join(process.cwd(), '.env.example');
  if (!fs.existsSync(envPath)) {
    log('.env.example не найден', 'warn');
    return;
  }
  const content = fs.readFileSync(envPath, 'utf-8');
  const required = ['DATABASE_URL', 'JWT_SECRET'];
  const recommended = ['ENCRYPTION_KEY', 'CRON_SECRET', 'HEALTH_CHECK_SECRET'];
  for (const r of required) {
    if (content.includes(r)) log(`${r} — описан`);
    else log(`${r} — отсутствует в .env.example`, 'warn');
  }
  for (const r of recommended) {
    if (content.includes(r)) log(`${r} — описан (рекомендуется)`);
    else log(`${r} — не описан`, 'warn');
  }
  if (content.includes('your-secret-key') || content.includes('default-secret')) {
    log('Обнаружены дефолтные секреты в примере — убедитесь, что в production используются свои', 'warn');
  }
}

// 3. Проверка middleware (security headers)
function checkMiddleware() {
  section('3. Заголовки безопасности (middleware)');
  const mwPath = path.join(process.cwd(), 'middleware.ts');
  if (!fs.existsSync(mwPath)) {
    log('middleware.ts не найден', 'err');
    return;
  }
  const content = fs.readFileSync(mwPath, 'utf-8');
  const headers = ['X-Frame-Options', 'X-Content-Type-Options', 'Content-Security-Policy', 'Strict-Transport-Security'];
  for (const h of headers) {
    if (content.includes(h)) log(`${h} — установлен`);
    else log(`${h} — отсутствует`, 'warn');
  }
  if (/script-src[^;]*unsafe-eval/.test(content)) log('CSP script-src содержит unsafe-eval — снижает защиту от XSS', 'warn');
}

// 4. Проверка опасных паттернов (упрощённый SAST)
function runSast() {
  section('4. Статический анализ (опасные паттерны)');
  const excludeFiles = ['app/api/health/route.ts', 'app/api/admin/health/route.ts', 'lib/sanitize.ts'];
  const patterns: { pattern: RegExp; msg: string; severity: 'err' | 'warn' }[] = [
    { pattern: /eval\s*\(/g, msg: 'eval() — опасно', severity: 'err' },
    { pattern: /new Function\s*\(/g, msg: 'new Function() — опасно', severity: 'err' },
    { pattern: /\.innerHTML\s*=/g, msg: 'innerHTML = — риск XSS', severity: 'warn' },
    { pattern: /dangerouslySetInnerHTML/g, msg: 'dangerouslySetInnerHTML — проверить санитизацию', severity: 'warn' },
    { pattern: /\$queryRaw\s*`[^`]*\$\{/g, msg: 'Raw SQL с интерполяцией — риск SQLi', severity: 'err' },
    { pattern: /password\s*:\s*['"][^'"]{1,20}['"]/gi, msg: 'Возможный хардкод пароля', severity: 'warn' },
  ];

  const srcDir = path.join(process.cwd(), 'app');
  const libDir = path.join(process.cwd(), 'lib');
  const compDir = path.join(process.cwd(), 'components');
  const dirs = [srcDir, libDir, compDir].filter((d) => fs.existsSync(d));

  for (const dir of dirs) {
    const files = walkSync(dir, ['.ts', '.tsx', '.js', '.jsx']);
    for (const file of files) {
      const rel = path.relative(process.cwd(), file);
      if (excludeFiles.some((e) => rel.includes(e))) continue;
      const content = fs.readFileSync(file, 'utf-8');
      for (const { pattern, msg, severity } of patterns) {
        if (pattern.test(content)) {
          log(`${rel}: ${msg}`, severity);
        }
      }
    }
  }
  if (!hasErrors && !hasWarnings) log('Опасных паттернов не обнаружено');
}

function walkSync(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const f of list) {
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (!['node_modules', '.next', '.git'].includes(f)) {
        results.push(...walkSync(full, exts));
      }
    } else if (exts.some((e) => f.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

// 5. Запуск unit-тестов безопасности
function runSecurityTests() {
  section('5. Unit-тесты безопасности');
  try {
    execSync('npx vitest run lib/__tests__/security lib/__tests__/ssrf lib/__tests__/permissions --reporter=verbose 2>&1', {
      encoding: 'utf-8',
      stdio: 'inherit',
    });
    log('Тесты безопасности пройдены');
  } catch {
    log('Часть тестов не пройдена', 'err');
  }
}

// Main
console.log('\n🔒 Security Check (SECURITY_TESTING_SCOPE)\n');
runNpmAudit();
checkEnvExample();
checkMiddleware();
runSast();
runSecurityTests();

console.log('\n' + '='.repeat(50));
if (hasErrors) {
  console.log(`${RED}Есть критические замечания (critical) — исправьте перед деплоем${RESET}`);
  process.exit(1);
}
if (hasWarnings) {
  console.log(`${YELLOW}Есть предупреждения (high/moderate/low) — рекомендуется исправить${RESET}`);
}
console.log(`${GREEN}Проверка завершена${RESET}\n`);
