'use strict';

const fs = require('fs');

function isContainerRuntime() {
  return (
    process.env.DOCKER === 'true' ||
    Boolean(process.env.RAILWAY_ENVIRONMENT) ||
    Boolean(process.env.RAILWAY_PROJECT_ID) ||
    (process.platform === 'linux' && fs.existsSync('/.dockerenv'))
  );
}

function resolvePuppeteerExecutablePath() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }

  try {
    const puppeteer = require('puppeteer');
    const bundled = puppeteer.executablePath();
    if (bundled && fs.existsSync(bundled)) {
      return bundled;
    }
  } catch (e) {
    console.warn('⚠️ puppeteer.executablePath():', e.message);
  }

  for (const candidate of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function resolveProtocolTimeoutMs() {
  const configured = parseInt(process.env.PROTOCOL_TIMEOUT_MS, 10);
  // Короче = зависший evaluate отпускает CDP быстрее (дефолт 2 мин, не 5).
  return Number.isFinite(configured) && configured >= 30000 ? configured : 120000;
}

function isPuppeteerProtocolTimeout(error) {
  const message = String(error?.message || error || '');
  return (
    /protocoltimeout/i.test(String(error?.name || '')) ||
    /Runtime\.callFunctionOn timed out/i.test(message) ||
    /protocolTimeout.*timed out/i.test(message) ||
    /waiting for .* protocol/i.test(message)
  );
}

function getPuppeteerLaunchOptions() {
  const executablePath = resolvePuppeteerExecutablePath();
  const container = isContainerRuntime();
  const singleProcess = process.env.PUPPETEER_SINGLE_PROCESS === '1';

  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-sync',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-default-browser-check',
    '--renderer-process-limit=2',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
  ];

  if (container) {
    args.push('--disable-software-rasterizer');
    // НЕ используем --single-process по умолчанию: ломает E2E-расшифровку WhatsApp (type=ciphertext).
    if (singleProcess) {
      args.push('--no-zygote', '--single-process');
    }
  }

  return {
    headless: true,
    executablePath,
    protocolTimeout: resolveProtocolTimeoutMs(),
    args,
  };
}

function logPuppeteerDiagnostics() {
  const opts = getPuppeteerLaunchOptions();
  const singleProcess = process.env.PUPPETEER_SINGLE_PROCESS === '1';
  console.log(`🌐 Chromium: ${opts.executablePath || 'не найден (puppeteer скачает при npm ci)'}`);
  console.log(`⏱️ Puppeteer protocol timeout: ${Math.round(opts.protocolTimeout / 1000)} с`);
  if (isContainerRuntime()) {
    console.log(
      singleProcess
        ? '🐳 Режим контейнера: single-process (может ломать расшифровку WA — только если Chrome не стартует)'
        : '🐳 Режим контейнера: multi-process + no-sandbox (нужно для расшифровки ciphertext)'
    );
  }
  if (!opts.executablePath) {
    console.error(
      '❌ Исполняемый файл Chrome/Chromium не найден. Пересоберите образ без PUPPETEER_SKIP_CHROMIUM_DOWNLOAD.'
    );
  }
}

module.exports = {
  isContainerRuntime,
  resolvePuppeteerExecutablePath,
  resolveProtocolTimeoutMs,
  isPuppeteerProtocolTimeout,
  getPuppeteerLaunchOptions,
  logPuppeteerDiagnostics,
};
