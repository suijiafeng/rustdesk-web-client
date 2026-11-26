// Run: node --test --test-timeout=60000 tests/keyboard-release.browser.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { runBrowserFixture } from './browserHarness.mjs';

test('physical keys are released on blur, hidden tabs and loss of remote input without orphan releases', async () => {
  await runBrowserFixture('tests/fixtures/keyboardRelease.tsx', {
    resultName: 'keyboardResult', configure: cdp => cdp('Emulation.setFocusEmulationEnabled', { enabled: true }),
    inspect: async cdp => {
      const evaluate = async expression => {
        const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails));
        return response.result.value;
      };
      const act = expression => evaluate(`window.keyboardFixture.${expression}`);
      const messages = () => act('messages');
      const keys = async () => (await messages()).filter(message => message.type === 'key')
        .map(message => `${message.action}:${message.control ?? message.chr}`);
      const reset = async () => {
        await act('blur()');
        await act('hidden(false)');
        await act('setState({ menu:false, dialog:false, viewOnly:false, phase:"live" })');
        await evaluate('document.querySelector("input").focus()');
        await act('clear()');
      };
      const key = (type, code, key, modifiers = 0, autoRepeat = false) => cdp('Input.dispatchKeyEvent', {
        type, code, key, modifiers, autoRepeat,
      });
      const down = (code, value, modifiers, repeat) => key('keyDown', code, value, modifiers, repeat);
      const up = (code, value, modifiers) => key('keyUp', code, value, modifiers);

      await reset();
      await down('ShiftLeft', 'Shift', 8);
      await down('KeyA', 'A', 8);
      await up('ShiftLeft', 'Shift');
      await up('KeyA', 'a');
      assert.deepEqual(await keys(), ['down:Shift', 'down:A', 'up:Shift', 'up:A']);

      await reset();
      await down('ControlLeft', 'Control', 2);
      await down('ControlRight', 'Control', 2);
      await up('ControlLeft', 'Control', 2);
      assert.deepEqual(await keys(), ['down:Control', 'down:Control'], 'One physical side must keep the shared remote control held');
      await up('ControlRight', 'Control');
      assert.deepEqual(await keys(), ['down:Control', 'down:Control', 'up:Control']);

      await reset();
      await down('ShiftLeft', 'Shift', 8);
      await down('KeyA', 'A', 8);
      await up('ShiftLeft', 'Shift');
      await down('KeyA', 'a', 0, true);
      await down('KeyA', 'a', 0, true);
      await act('blur()');
      const repeated = await keys();
      assert.deepEqual(repeated, ['down:Shift', 'down:A', 'up:Shift', 'up:A', 'down:a', 'down:a', 'up:a']);
      await up('KeyA', 'a');
      assert.deepEqual(await keys(), repeated, 'A delayed keyup after blur must not release a second time');

      await reset();
      await down('KeyA', 'a');
      await down('ShiftRight', 'Shift', 8);
      await act('blur()');
      assert.deepEqual(await keys(), ['down:a', 'down:Shift', 'up:a', 'up:Shift'], 'Cleanup releases characters first even when modifiers were pressed later');

      await reset();
      await down('KeyA', 'a', 2);
      await act('blur()');
      assert.deepEqual(await messages(), [
        { type: 'key', action: 'down', chr: 'a', modifiers: ['Control'] },
        { type: 'key', action: 'up', chr: 'a' },
      ], 'Implicit per-event modifiers must not invent held modifier keys');

      for (const cleanup of ['blur()', 'hidden(true)']) {
        await reset();
        await down('ControlLeft', 'Control', 2);
        await down('ControlRight', 'Control', 2);
        await down('KeyC', 'c', 2);
        await down('ArrowUp', 'ArrowUp', 2);
        await act(cleanup);
        const released = await keys();
        assert.deepEqual(released.slice(-3), ['up:ArrowUp', 'up:c', 'up:Control']);
        await up('ArrowUp', 'ArrowUp', 2);
        await up('KeyC', 'c', 2);
        await up('ControlLeft', 'Control', 2);
        await up('ControlRight', 'Control');
        assert.deepEqual(await keys(), released);
      }
      await act('hidden(false)');

      for (const patch of [{ menu: true }, { dialog: true }, { viewOnly: true }, { phase: 'error' }]) {
        await reset();
        await down('AltLeft', 'Alt', 1);
        await down('KeyX', 'x', 1);
        await act(`setState(${JSON.stringify(patch)})`);
        // Allow React to flush the eligibility effect before a late native keyup.
        await evaluate('new Promise(resolve => setTimeout(resolve, 0))');
        assert.deepEqual((await keys()).slice(-2), ['up:x', 'up:Alt'], JSON.stringify(patch));
        const released = await keys();
        await up('KeyX', 'x', 1);
        await up('AltLeft', 'Alt');
        assert.deepEqual(await keys(), released);
      }

      await reset();
      await down('MetaLeft', 'Meta', 4);
      await down('KeyC', 'c', 4);
      await evaluate('document.querySelector("button").focus()');
      assert.deepEqual((await keys()).slice(-2), ['up:c', 'up:Meta'], 'Local chrome focus must release remote keys');
      const localFocus = await keys();
      await up('KeyC', 'c', 4);
      await up('MetaLeft', 'Meta');
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      assert.equal(await act('localClicks()'), 1);
      assert.deepEqual(await keys(), localFocus, 'Activating local controls must not leak keys to the host');

      await reset();
      await down('ShiftRight', 'Shift', 8);
      await act('ime("compositionstart")');
      await act('key("keydown", { code:"KeyN", key:"Process", keyCode:229, isComposing:true })');
      await up('ShiftRight', 'Shift');
      await act('ime("compositionend", "你好")');
      await act('key("keyup", { code:"KeyN", key:"n" })');
      assert.deepEqual(await keys(), ['down:Shift', 'up:Shift']);
      assert.deepEqual((await messages()).filter(message => message.type === 'text'), [{ type: 'text', text: '你好' }]);

      await reset();
      await act('key("keydown", { code:"", key:"Backspace" })');
      await act('key("keyup", { code:"", key:"Backspace" })');
      assert.deepEqual(await keys(), ['down:Backspace', 'up:Backspace']);
      await act('clear()');
      await down('ControlLeft', 'Control', 2);
      await down('KeyZ', 'z', 2);
      await act('unmount()');
      assert.deepEqual((await keys()).slice(-2), ['up:z', 'up:Control']);
      const unmounted = await keys();
      await up('KeyZ', 'z', 2);
      await up('ControlLeft', 'Control');
      assert.deepEqual(await keys(), unmounted);
      assert.deepEqual(await evaluate('window.keyboardResult.violations'), []);
    },
  });
});
