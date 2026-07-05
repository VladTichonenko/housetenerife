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

function getPuppeteerLaunchOptions() {
  const executablePath = resolvePuppeteerExecutablePath();
  const container = isContainerRuntime();

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
  ];

  if (container) {
    args.push(
      '--no-zygote',
      '--single-process',
      '--disable-software-rasterizer',
      '--disable-features=TranslateUI,VizDisplayCompositor'
    );
  }

  return {
    headless: true,
    executablePath,
    protocolTimeout: parseInt(process.env.PROTOCOL_TIMEOUT_MS, 10) || 180000,
    args,
  };
}

function logPuppeteerDiagnostics() {
  const opts = getPuppeteerLaunchOptions();
  console.log(`🌐 Chromium: ${opts.executablePath || 'не найден (puppeteer скачает при npm ci)'}`);
  if (isContainerRuntime()) {
    console.log('🐳 Режим контейнера: single-process + no-sandbox');
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
  getPuppeteerLaunchOptions,
  logPuppeteerDiagnostics,
};
