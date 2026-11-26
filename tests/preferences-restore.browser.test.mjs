import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { runBrowserFixture } from './browserHarness.mjs';

test('mobile preferences retain saved choices and touch mode survives real page reloads', async () => {
  const device = (cdp, mobile) => Promise.all([
    cdp('Emulation.setDeviceMetricsOverride', { width: mobile ? 390 : 1200, height: 800, deviceScaleFactor: 1, mobile }),
    cdp('Emulation.setTouchEmulationEnabled', { enabled: mobile }),
  ]);
  await runBrowserFixture('tests/fixtures/preferencesRestore.tsx', {
    resultName: 'preferencesResult', configure: cdp => device(cdp, false),
    inspect: async cdp => {
      const evaluate = async expression => {
        const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails));
        return response.result.value;
      };
      const waitFor = async expression => {
        for (let i = 0; i < 150; i++) {
          if (await evaluate(expression)) return;
          await delay(20);
        }
        assert.fail(`Timed out: ${expression}`);
      };
      const reload = async () => {
        await evaluate('window.preferencesResult.status = "running"');
        await cdp('Page.reload');
        await waitFor('window.preferencesResult?.status === "passed"');
      };
      const snapshot = () => evaluate('window.preferencesFixture.snapshot()');
      const toggleTouch = async expected => {
        await evaluate('document.querySelector("[data-testid=settings-toggle-touch-mode]").click()');
        await waitFor(`JSON.parse(localStorage.getItem('rd_web_prefs')).touchMode === ${expected}`);
      };
      assert.equal((await snapshot()).touchMode, false);
      assert.equal((await snapshot()).display.autoKeyboard, false);
      await toggleTouch(true);
      await reload();
      assert.equal((await snapshot()).touchMode, true, 'Explicit desktop touch input must persist');

      const choices = { autoKeyboard: false, showRemoteCursor: false, enlargeCursor: true, followRemoteCursor: true };
      await evaluate(`window.preferencesFixture.updateDisplay(${JSON.stringify(choices)})`);
      await waitFor("JSON.parse(localStorage.getItem('rd_web_display_prefs')).enlargeCursor === true");
      await device(cdp, true);
      await reload();
      for (const [key, value] of Object.entries(choices)) assert.equal((await snapshot()).display[key], value, key);
      await toggleTouch(false);
      await reload();
      assert.equal((await snapshot()).touchMode, false, 'Explicit mobile mouse input must persist');
      assert.equal(await evaluate('document.querySelector("[data-testid=settings-scroll]")'), null);

      await evaluate(`localStorage.setItem('rd_web_prefs', JSON.stringify({ peerId:'123456789' }));
        localStorage.setItem('rd_web_display_prefs', JSON.stringify({ qualityPreset:'best', scrollStyle:'scrollbar' }));`);
      await reload();
      const legacy = await snapshot();
      assert.equal(legacy.touchMode, true, 'Old records lacking touchMode must use the device default');
      assert.equal(legacy.display.autoKeyboard, true, 'Missing display fields must use mobile defaults');
      assert.equal(legacy.display.targetFps, 60, 'Existing quality migration must still apply');
      await evaluate('window.preferencesFixture.updateDisplay({ autoKeyboard:false })');
      await waitFor("JSON.parse(localStorage.getItem('rd_web_display_prefs')).autoKeyboard === false");
      assert.equal(await evaluate("JSON.parse(localStorage.getItem('rd_web_display_prefs')).scrollStyle"), 'scrollbar');
      await reload();
      assert.equal((await snapshot()).display.autoKeyboard, false, 'Explicit false must survive on mobile');

      await evaluate(`localStorage.setItem('rd_web_display_prefs', '{');
        localStorage.setItem('rd_web_prefs', JSON.stringify({touchMode:'false'}));`);
      await reload();
      assert.equal((await snapshot()).display.autoKeyboard, true);
      assert.equal((await snapshot()).touchMode, true, 'Invalid preference types must not masquerade as explicit choices');
      assert.deepEqual(await evaluate('window.preferencesResult.violations'), []);
    },
  });
});
