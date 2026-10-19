import * as assert from 'node:assert/strict';
import { decodeReport, SIGNATURE } from '../hid/protocol';
import { BindingStore, validateBindings } from '../bindings/bindingStore';
import { CommandExecutor } from '../commands/commandExecutor';
import { DeviceSettings, JsonValue, Logger } from '../types';

export const device: DeviceSettings = { vendorId: 17475, productId: 12337, productName: 'thedanielceroefs', usagePage: 65376, usage: 97, path: '' };
export function report(action = 0): Buffer {
  const buffer = Buffer.alloc(32);
  buffer.set(SIGNATURE);
  buffer[6] = 1; buffer[7] = 1; buffer[8] = action;
  return buffer;
}
export function logger(): Logger & { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  return { errors, warnings, info() {}, debug() {}, trace() {}, warn: message => warnings.push(message), error: message => errors.push(message) };
}

suite('Protocol', () => {
  for (const [id, key] of [[0, 'VSC_1'], [15, 'VSC_16'], [31, 'VSC_32']] as const) {
    test(`action ${id} maps to ${key}`, () => assert.deepEqual(decodeReport(report(id)), { ok: true, event: { actionId: id, key } }));
  }
  test('every action maps correctly', () => {
    for (let id = 0; id < 32; id++) { assert.deepEqual(decodeReport(report(id)), { ok: true, event: { actionId: id, key: `VSC_${id + 1}` } }); }
  });
  test('rejects short, long and report-ID-prefixed input', () => {
    for (const payload of [report().subarray(0, 31), Buffer.concat([Buffer.from([0]), report()]), Buffer.alloc(0)]) {
      assert.deepEqual(decodeReport(payload), { ok: false, reason: 'length' });
    }
  });
  for (const [offset, byte, reason] of [[0, 0, 'signature'], [5, 0, 'signature'], [6, 2, 'version'], [7, 2, 'type'], [8, 32, 'actionId'], [8, 255, 'actionId'], [9, 1, 'reserved'], [31, 1, 'reserved']] as const) {
    test(`rejects ${reason} at byte ${offset} value ${byte}`, () => {
      const payload = report(); payload[offset] = byte;
      assert.deepEqual(decodeReport(payload), { ok: false, reason });
    });
  }
  test('identical reports remain independent valid events without mutation', () => {
    const payload = report(3), copy = Buffer.from(payload);
    assert.equal(decodeReport(payload).ok, true);
    assert.equal(decodeReport(payload).ok, true);
    assert.deepEqual(payload, copy);
  });
});

suite('Configuration', () => {
  for (const property of ['when', 'repeat', 'extra']) {
    test(`rejects unsupported ${property}`, () => assert.throws(() => validateBindings([{ key: 'VSC_1', command: 'save', [property]: true }]), /unsupported/));
  }
  test('rejects invalid keys, commands and args', () => {
    for (const entry of [null, {}, { key: 'VSC_0', command: 'save' }, { key: 'VSC_33', command: 'save' }, { key: 'VSC_1', command: ' ' }, { key: 'VSC_1', command: 3 }, { key: 'VSC_1', command: 'save', args: undefined }]) {
      assert.throws(() => validateBindings([entry]));
    }
    assert.throws(() => validateBindings({}));
  });
  test('last matching key wins and a replacement removes previous keys', () => {
    const store = new BindingStore();
    assert.equal(store.reload([{ key: 'VSC_1', command: 'first' }, { key: 'VSC_1', command: 'last' }], device).ok, true);
    assert.equal(store.get('VSC_1')?.command, 'last');
    store.reload([{ key: 'VSC_2', command: 'new' }], device);
    assert.equal(store.get('VSC_1'), undefined);
    assert.equal(store.get('VSC_2')?.command, 'new');
  });
  test('invalid reload preserves the entire previous valid configuration', () => {
    const store = new BindingStore();
    store.reload([{ key: 'VSC_1', command: 'old' }], device);
    assert.equal(store.reload([{ key: 'VSC_1', command: 'new' }, { key: 'VSC_2', when: 'bad' }], { ...device, productName: 'new' }).ok, false);
    assert.equal(store.get('VSC_1')?.command, 'old');
    assert.deepEqual(store.device, device);
    assert.equal(store.reload([], { ...device, usage: -1 }).ok, false);
    assert.equal(store.size, 1);
  });
  test('invalid initial configuration starts empty', () => {
    const store = new BindingStore();
    assert.equal(store.reload([{ key: 'VSC_0' }], device).ok, false);
    assert.equal(store.size, 0);
    assert.equal(store.device, undefined);
  });
});

suite('Command dispatch', () => {
  for (const [label, supplied, args] of [['absent', false, undefined], ['null', true, null], ['object', true, { text: 'Hello World' }], ['array', true, [1, 'two']]] as const) {
    test(`preserves ${label} args`, async () => {
      const bindings = validateBindings([{ key: 'VSC_1', command: 'type', ...(supplied ? { args } : {}) }]);
      const calls: unknown[][] = [];
      const executor = new CommandExecutor(bindings, () => true, async (...values) => { calls.push(values); }, logger());
      await executor.dispatch('VSC_1');
      assert.deepEqual(calls, [supplied ? ['type', args as JsonValue] : ['type']]);
    });
  }
  test('focus and unbound filtering', async () => {
    let focused = false, calls = 0;
    const executor = new CommandExecutor(validateBindings([{ key: 'VSC_1', command: 'x' }]), () => focused, async () => { calls++; }, logger());
    await executor.dispatch('VSC_1'); focused = true;
    await executor.dispatch('VSC_2');
    assert.equal(calls, 0);
    await executor.dispatch('VSC_1'); assert.equal(calls, 1);
  });
  test('contains asynchronous rejections and synchronous throws; future presses still work', async () => {
    let calls = 0;
    const log = logger();
    const executor = new CommandExecutor(validateBindings([{ key: 'VSC_1', command: 'x' }]), () => true, () => {
      calls++;
      if (calls === 1) { throw new Error('sync'); }
      if (calls === 2) { return Promise.reject(new Error('async')); }
      return Promise.resolve();
    }, log);
    await executor.dispatch('VSC_1'); await executor.dispatch('VSC_1'); await executor.dispatch('VSC_1');
    assert.equal(calls, 3); assert.equal(log.errors.length, 2);
  });
  test('initiates another command while a previous command is pending', async () => {
    let calls = 0;
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const executor = new CommandExecutor(validateBindings([{ key: 'VSC_1', command: 'x' }]), () => true, () => { calls++; return pending; }, logger());
    const first = executor.dispatch('VSC_1'), second = executor.dispatch('VSC_1');
    assert.equal(calls, 2); finish(); await Promise.all([first, second]);
  });
});
