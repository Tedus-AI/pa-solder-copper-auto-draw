const { chromium } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { unzipSync, strFromU8 } = require('fflate');

(async () => {
  const output = process.env.TEST_OUTPUT || '/tmp/pa-cad-web-test'; fs.mkdirSync(output, { recursive: true });
  let server, browser;
  const url = process.env.BASE_URL || 'http://127.0.0.1:4173/pa-solder-copper-auto-draw/';
  try {
    if (!process.env.BASE_URL) server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: 'pipe' });
    let available = false;
    for (let i = 0; i < 60; i++) { try { const r = await fetch(url); if (r.ok) { available = true; break; } } catch {} await new Promise(r => setTimeout(r, 1000)); }
    assert.ok(available, `Website did not become available: ${url}`);
    const executable = process.env.CHROMIUM_PATH || (process.env.CI ? undefined : ['/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => fs.existsSync(p)));
    browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1120 }, locale: 'zh-TW', acceptDownloads: true });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') console.error('Browser console:', m.text()); });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForFunction(() => !document.getElementById('download-zip').disabled || !document.getElementById('error').hidden, null, { timeout: 120000 });
    assert.equal(await page.locator('#error').isVisible(), false, await page.locator('#error').textContent());
    assert.equal(await page.locator('#metric-z').textContent(), '0.374779');
    assert.equal(await page.locator('#metric-cuh').textContent(), '0.4800');
    assert.equal(await page.locator('#viewer').getAttribute('data-ready'), 'true');
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    const downloaded = page.waitForEvent('download'); await page.locator('#download-zip').click();
    const download = await downloaded; const file = path.join(output, 'pa_780_m1p.zip'); await download.saveAs(file);
    const files = unzipSync(fs.readFileSync(file));
    for (const name of ['copper.step', 'preform.step', 'copper.dxf', 'preform.dxf', 'report.json', 'creo_job.json', 'creo_runner.py', 'WINDOWS_CREO7.md']) assert.ok(files[name], `Missing ${name}`);
    for (const name of ['copper.step', 'preform.step']) assert.ok(strFromU8(files[name]).includes('ISO-10303-21;'));
    const report = JSON.parse(strFromU8(files['report.json']));
    assert.equal(report.verification, 'volume_and_step_roundtrip_passed'); assert.equal(report.native_prt.status, 'not_generated');
    assert.ok(Math.abs(report.cad_volumes_mm3.preform - 66.9958033717615) < .001);
    const hashes = JSON.parse(strFromU8(files['sha256.json']));
    for (const [name, digest] of Object.entries(hashes)) assert.equal(crypto.createHash('sha256').update(files[name]).digest('hex'), digest);
    const job = JSON.parse(strFromU8(files['creo_job.json'])); assert.equal(job.step_import_acceptable, false); assert.equal(job.target.version, '7.0.10.0');
    await page.locator('#tab-preform').click();
    const stepDownload = page.waitForEvent('download'); await page.locator('#download-step').click();
    assert.match((await stepDownload).suggestedFilename(), /preform\.step$/);
    await page.getByText('錫片設計', { exact: true }).click();
    await page.locator('#preform-thickness_override').fill('0.37');
    assert.equal(await page.locator('#download-zip').isDisabled(), true);
    await page.locator('#generate').click();
    await page.waitForFunction(() => !document.getElementById('download-zip').disabled || !document.getElementById('error').hidden, null, { timeout: 120000 });
    assert.equal(await page.locator('#error').isVisible(), false, await page.locator('#error').textContent());
    assert.equal(await page.locator('#metric-model').textContent(), '0.370000');
    await page.locator('#preform-chamfer').fill('1'); await page.locator('#generate').click();
    await page.locator('#error').waitFor(); assert.match(await page.locator('#error').textContent(), /削角/);
    assert.equal(await page.locator('#download-zip').isDisabled(), true);
    await page.locator('#reset').click();
    await page.waitForFunction(() => !document.getElementById('download-zip').disabled || !document.getElementById('error').hidden, null, { timeout: 120000 });
    assert.equal(await page.locator('#error').isVisible(), false, await page.locator('#error').textContent());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#viewer').scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(`PASS: ${url} — browser CAD, STEP roundtrip, ZIP integrity, Creo job, parameter changes, validation and mobile layout.`);
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { if (browser) await browser.close(); if (server) server.kill('SIGTERM'); }
})();
