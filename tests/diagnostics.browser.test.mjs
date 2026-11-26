// Run: node --test --test-timeout=60000 tests/diagnostics.browser.test.mjs
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { runBrowserFixture } from './browserHarness.mjs';

test('text connection details stay compact, accurate and transparent to remote input', async t => {
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
      const enter = async () => {
        await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: String.fromCharCode(13) });
        await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await settle();
      };
      await evaluate('window.diagnosticsFixture.setDirect(true); window.diagnosticsFixture.step({fps:47,bitrate:2100000,rtt:26})');
      assert.match(await evaluate('document.querySelector("[data-testid=diag-rtt]").textContent'), /远端往返 26 ms/);
      const sizes = [];
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
            const value = document.querySelector('[data-testid="diag-value-fps"]').getBoundingClientRect();
            const close = document.querySelector('[data-testid="diag-close"]').getBoundingClientRect();
            const signal = document.querySelector('[data-testid="diag-picture-state"]').getBoundingClientRect();
            return { x:r.x, width:r.width, height:r.height, scroll:document.documentElement.scrollWidth,
              rows:[...document.querySelectorAll('.diag-text > span')].map(e => e.getBoundingClientRect().y),
              textTarget:document.elementFromPoint(value.x+value.width/2,value.y+value.height/2)?.getAttribute('data-testid'),
              buttonTarget:document.elementFromPoint(close.x+close.width/2,close.y+close.height/2)?.closest('button')?.getAttribute('data-testid'),
              signalTarget:document.elementFromPoint(signal.x+signal.width/2,signal.y+signal.height/2)?.closest('[data-testid]')?.getAttribute('data-testid'),
              blur:getComputedStyle(overlay).backdropFilter, background:getComputedStyle(overlay).backgroundImage,
              unexpectedSections:overlay.querySelectorAll('.diag-trend, details, [data-testid="diag-collapse"]').length };
          })()`);
          assert.ok(layout.width >= width - 26 && layout.width < width, JSON.stringify(layout));
          assert.ok(layout.height <= (width < 640 ? 85 : 52), JSON.stringify(layout));
          assert.ok(layout.scroll <= width, JSON.stringify(layout));
          assert.ok(new Set(layout.rows.map(y => Math.round(y))).size <= (width < 640 ? 4 : 2), JSON.stringify(layout));
          assert.equal(layout.textTarget, 'fixture-desktop', 'Text must pass pointer input to the desktop');
          assert.equal(layout.buttonTarget, 'diag-close');
          assert.equal(layout.signalTarget, 'diag-picture-state', 'The signal icon must accept hover for its status tooltip');
          assert.equal(layout.unexpectedSections, 0);
          assert.equal(layout.blur, 'none', 'The desktop remains sharp beneath the text bar');
          assert.match(layout.background, /rgba\(/, 'The background remains translucent');
          if (!dark) sizes.push(`${width}×${height}: ${layout.height}px`);
          const image = await cdp('Page.captureScreenshot', { format: 'png' });
          await writeFile(dark ? screenshot.replace('.png', '-dark.png') : screenshot, Buffer.from(image.data, 'base64'));
        }
      }
      t.diagnostic(sizes.join('; '));
      const activeColor = await evaluate('getComputedStyle(document.querySelector("[data-testid=diag-picture-state]")).color');
      await evaluate('window.diagnosticsFixture.step({fps:0,bitrate:0,idle:true,inFlightFrames:5,oldestFrameAgeMs:450})');
      const status = await evaluate(`(() => { const e=document.querySelector('[data-testid="diag-picture-state"]'); return {
        state:e.dataset.state,label:e.getAttribute('aria-label'),title:e.title,text:e.textContent,
        animation:getComputedStyle(e).animationName,color:getComputedStyle(e).color }; })()`);
      assert.equal(status.state, 'recovering');
      assert.equal(status.label, '画面恢复中');
      assert.equal(status.title, status.label);
      assert.equal(status.text, '');
      assert.notEqual(status.color, activeColor);
      assert.equal(status.animation, 'diag-recovering');
      await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      assert.equal(await evaluate('getComputedStyle(document.querySelector("[data-testid=diag-picture-state]")).animationName'), 'none');
      await cdp('Emulation.setEmulatedMedia', { features: [] });
      const beforeSignal = await evaluate('({pointer:window.diagnosticsFixture.pointerCount(),keys:window.diagnosticsFixture.keyCount()})');
      await click('diag-picture-state');
      await evaluate('document.querySelector("[data-testid=diag-picture-state]").focus()');
      await enter();
      assert.deepEqual(await evaluate('({pointer:window.diagnosticsFixture.pointerCount(),keys:window.diagnosticsFixture.keyCount()})'), beforeSignal,
        'Inspecting the accessible signal icon must not send pointer or keyboard input to the remote desktop');

      const pointersBeforeText = await evaluate('window.diagnosticsFixture.pointerCount()');
      await click('diag-value-fps');
      assert.equal(await evaluate('window.diagnosticsFixture.pointerCount()'), pointersBeforeText + 2);
      await evaluate('document.querySelector("[data-testid=fixture-desktop]").focus()');
      const keysBeforeCanvas = await evaluate('window.diagnosticsFixture.keyCount()');
      await enter();
      assert.equal(await evaluate('window.diagnosticsFixture.keyCount()'), keysBeforeCanvas + 2,
        'The real remote keyboard hook still forwards keys focused on the desktop');

      const beforeClose = await evaluate('({pointer:window.diagnosticsFixture.pointerCount(),keys:window.diagnosticsFixture.keyCount()})');
      await click('diag-close');
      assert.equal(await evaluate('Boolean(document.querySelector("[data-testid=diagnostic-overlay]"))'), false);
      await evaluate('window.diagnosticsFixture.resetView()');
      assert.equal(await evaluate('document.querySelector("[data-testid=diag-value-rtt]").textContent'), '—');
      await evaluate('document.querySelector("[data-testid=diag-close]").focus()');
      await enter();
      assert.equal(await evaluate('Boolean(document.querySelector("[data-testid=diagnostic-overlay]"))'), false);
      assert.deepEqual(await evaluate('({pointer:window.diagnosticsFixture.pointerCount(),keys:window.diagnosticsFixture.keyCount()})'), beforeClose,
        'Mouse and keyboard close actions must not reach the remote desktop');
      assert.equal(await evaluate('window.diagnosticsFixture.timerCount()'), 0, 'No extra sampling interval may remain after closing');
      assert.deepEqual(await evaluate('window.diagnosticsResult.violations'), []);
    },
  });
  assert.deepEqual(result.violations, []);
  t.diagnostic(result.checks.join('; '));
});
