// Run: node --test --test-timeout=60000 tests/diagnostics.browser.test.mjs
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { runBrowserFixture } from './browserHarness.mjs';

test('diagnostic trends preserve missing data and stay unobtrusive across screen sizes', async t => {
  const result = await runBrowserFixture('tests/fixtures/diagnostics.tsx', {
    resultName: 'diagnosticsResult',
    configure: async cdp => {
      await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
    },
    inspect: async cdp => {
      const evaluate = async expression => {
        const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails));
        return response.result.value;
      };
      const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      const click = async testId => {
        const point = await evaluate(`(() => { const r = document.querySelector('[data-testid="${testId}"]').getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()`);
        await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
        await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
        await settle();
      };
      for (const [width, height, mobile, screenshot] of [
        [1440, 900, false, '/tmp/rd-diagnostics-desktop.png'],
        [390, 844, true, '/tmp/rd-diagnostics-mobile.png'],
        [844, 390, true, '/tmp/rd-diagnostics-landscape.png'],
      ]) {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
        await cdp('Emulation.setTouchEmulationEnabled', { enabled: mobile });
        await settle();
        for (const dark of [false, true]) {
          await evaluate(`window.diagnosticsFixture.setTheme(${dark})`);
          await settle();
          const layout = await evaluate(`(() => {
            const overlay = document.querySelector('[data-testid="diagnostic-overlay"]');
            const r = overlay.getBoundingClientRect();
            const chart = document.querySelector('[data-testid="diag-chart-fps"]').getBoundingClientRect();
            const close = document.querySelector('[data-testid="diag-close"]').getBoundingClientRect();
            return { x:r.x, width:r.width, height:r.height, scroll:document.documentElement.scrollWidth,
              charts:[...document.querySelectorAll('.diag-metric')].map(e => e.getBoundingClientRect().y),
              chartTarget:document.elementFromPoint(chart.x+chart.width/2, chart.y+chart.height/2)?.getAttribute('data-testid'),
              buttonTarget:document.elementFromPoint(close.x+close.width/2,close.y+close.height/2)?.closest('button')?.getAttribute('data-testid'),
              blur:getComputedStyle(overlay).backdropFilter, background:getComputedStyle(overlay).backgroundImage };
          })()`);
          assert.ok(layout.width >= width - 26 && layout.width < width, JSON.stringify(layout));
          assert.ok(layout.height <= (width < 640 ? 150 : 120), JSON.stringify(layout));
          assert.ok(layout.scroll <= width, JSON.stringify(layout));
          assert.equal(new Set(layout.charts).size, 1, 'Three charts should remain in one horizontal row');
          assert.equal(layout.chartTarget, 'fixture-desktop', 'The desktop must receive pointer input through charts');
          assert.equal(layout.buttonTarget, 'diag-close');
          assert.equal(layout.blur, 'none', 'The desktop should remain sharp beneath the overlay');
          assert.match(layout.background, /rgba\(/, 'The overlay should remain translucent');
          const image = await cdp('Page.captureScreenshot', { format: 'png' });
          await writeFile(dark ? screenshot.replace('.png', '-dark.png') : screenshot, Buffer.from(image.data, 'base64'));
        }
      }
      const before = await evaluate('window.diagnosticsFixture.pointerCount()');
      await click('diag-collapse');
      assert.equal(await evaluate('Boolean(document.querySelector(".diag-trend"))'), false);
      assert.equal(await evaluate('document.querySelector("[data-testid=diag-collapse]").getAttribute("aria-expanded")'), 'false');
      await click('diag-collapse');
      assert.equal(await evaluate('document.querySelectorAll(".diag-trend").length'), 3);
      await evaluate('document.querySelector("[data-testid=diag-close]").focus()');
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await settle();
      assert.equal(await evaluate('Boolean(document.querySelector("[data-testid=diagnostic-overlay]"))'), false);
      assert.equal(await evaluate('window.diagnosticsFixture.pointerCount()'), before, 'Buttons must not emit desktop pointer events');
      assert.equal(await evaluate('window.diagnosticsFixture.timerCount()'), 0, 'Closing must release its sampling timer');
      await evaluate('window.diagnosticsFixture.resetView(); window.diagnosticsFixture.setDirect(true)');
      assert.match(await evaluate('document.querySelector(".diag-metric-rtt").textContent'), /浏览器 → 电脑/);
      assert.deepEqual(await evaluate('window.diagnosticsResult.violations'), []);
    },
  });
  assert.deepEqual(result.violations, []);
  t.diagnostic(result.checks.join('; '));
  t.diagnostic('1440×900, 390×844 and 844×390; bright/dark screenshots; pointer passthrough and keyboard close');
});
