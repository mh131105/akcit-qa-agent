import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { createSpecialistSession } from '../dist/runtime/pi.js';

// Teste de infraestrutura com página controlada; não chama provedores de LLM.
const root = await mkdtemp(join(tmpdir(), 'akcit-smoke-'));
const started = Date.now();
let browser;
let recorder;
let recordingFinished;
const fixture = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<!doctype html><html><title>AKCIT runtime check</title><body style="margin:0"><button style="position:absolute;left:40px;top:200px;width:400px;height:200px;font-size:24px" onclick="this.textContent=\'Cursor confirmado\';document.title=\'clicked\'">Clique de teste</button></body></html>');
});
try {
  execFileSync('pi', ['--version'], { stdio: 'pipe', timeout: 15000 });
  execFileSync('pdftotext', ['-v'], { stdio: 'pipe', timeout: 5000 });
  execFileSync('xdotool', ['getdisplaygeometry'], { timeout: 5000 });
  const { session } = await createSpecialistSession('test-executor', root);
  assert.equal(session.agent.state.tools.length, 0, 'Sessão inicial não deve ter tools liberadas');
  session.dispose();

  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
    headless: false,
    args: ['--no-sandbox', '--window-position=0,0', '--window-size=1366,768', '--force-device-scale-factor=1'],
  });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${fixture.address().port}`);
  const video = join(root, 'cursor.mp4');
  recorder = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-video_size', '1366x768', '-framerate', '10', '-draw_mouse', '1', '-i', process.env.DISPLAY ?? ':99', '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', video], { stdio: ['ignore', 'ignore', 'pipe'] });
  let recordingError = '';
  recorder.stderr.on('data', chunk => { recordingError += chunk.toString(); });
  recordingFinished = once(recorder, 'exit');
  execFileSync('xdotool', ['mousemove', '--sync', '200', '350', 'click', '1'], { timeout: 10000 });
  await page.waitForFunction(() => document.title === 'clicked', null, { timeout: 10000 });
  const screenshot = join(root, 'cursor.png');
  await page.screenshot({ path: screenshot });
  assert.ok((await stat(screenshot)).size > 1000);
  const [exitCode] = await recordingFinished;
  assert.equal(exitCode, 0, recordingError);
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', video], { encoding: 'utf8' }));
  assert.ok(Number(info.format.duration) >= 1);
  const result = { status: 'passed', checked: ['pi-cli', 'pi-sdk-isolated-session', 'pdf-reader', 'headed-chromium', 'real-mouse-click', 'screenshot', 'screen-video'], durationMs: Date.now() - started };
  if (process.env.SMOKE_RESULT_FILE) await writeFile(process.env.SMOKE_RESULT_FILE, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  if (recorder && recorder.exitCode === null) {
    recorder.kill('SIGTERM');
    await recordingFinished;
  }
  await browser?.close();
  if (fixture.listening) await new Promise(resolve => fixture.close(resolve));
  await rm(root, { recursive: true, force: true });
}
