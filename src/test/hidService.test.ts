import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Device } from 'node-hid';
import { HidService, Scheduler, selectDevice } from '../hid/hidService';
import { device, logger, report } from './core.test';

const descriptor: Device = { ...device, vendorId: device.vendorId!, productId: device.productId!, product: device.productName, path: 'raw-path', release: 1, interface: 1 };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
class Handle extends EventEmitter {
  closed = 0;
  async close(): Promise<void> { this.closed++; }
}
class Clock implements Scheduler {
  jobs = new Map<number, () => void>();
  delays: number[] = [];
  next = 0;
  set(callback: () => void, delay: number): number { this.delays.push(delay); this.jobs.set(++this.next, callback); return this.next; }
  clear(timer: unknown): void { this.jobs.delete(timer as number); }
  fire(): void { const job = this.jobs.entries().next().value; assert.ok(job); this.jobs.delete(job[0]); job[1](); }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

suite('HID selection and lifecycle', () => {
  test('selects by all identifiers, usage and optional path; refuses ambiguity and missing path', () => {
    assert.equal(selectDevice([{ ...descriptor, usage: 1 }, descriptor], device), descriptor);
    for (const mismatch of [{ vendorId: 1 }, { productId: 1 }, { product: 'other' }, { usagePage: 1 }]) {
      assert.equal(selectDevice([{ ...descriptor, ...mismatch }], device), undefined);
    }
    assert.throws(() => selectDevice([descriptor, { ...descriptor, path: 'other' }], device), /matching HID interfaces/);
    assert.equal(selectDevice([descriptor, { ...descriptor, path: 'other' }], { ...device, path: 'raw-path' }), descriptor);
    assert.throws(() => selectDevice([{ ...descriptor, path: undefined }], device), /no device path/);
  });
  test('opens the exact path and receives repeated reports while ignoring malformed input', async () => {
    const handle = new Handle(), keys: string[] = [], paths: string[] = [];
    const service = new HidService(logger(), key => keys.push(key), async () => ({ devicesAsync: async () => [descriptor], open: async path => { paths.push(path); return handle; } }));
    service.configure(device); await tick();
    handle.emit('data', report(31)); handle.emit('data', Buffer.alloc(32)); handle.emit('data', report(31));
    assert.deepEqual(paths, ['raw-path']); assert.deepEqual(keys, ['VSC_32', 'VSC_32']);
    await service.dispose();
    assert.equal(handle.closed, 1); assert.equal(handle.listenerCount('data'), 0); assert.equal(handle.listenerCount('error'), 0);
    handle.emit('data', report()); assert.equal(keys.length, 2);
  });
  test('absent keyboard retries with bounded backoff, then connects', async () => {
    const clock = new Clock(), handle = new Handle(); let present = false;
    const service = new HidService(logger(), () => {}, async () => ({ devicesAsync: async () => present ? [descriptor] : [], open: async () => handle }), clock);
    service.configure(device); await tick();
    for (let i = 0; i < 6; i++) { clock.fire(); await tick(); }
    assert.deepEqual(clock.delays, [1000, 2000, 4000, 8000, 10000, 10000, 10000]);
    present = true; clock.fire(); await tick(); assert.equal(clock.jobs.size, 0);
    await service.dispose(); assert.equal(handle.closed, 1);
  });
  test('contains native load failure and clears timers on disposal', async () => {
    const log = logger(), clock = new Clock(); let loads = 0;
    const service = new HidService(log, () => {}, async () => { loads++; throw new Error('native module missing'); }, clock);
    service.configure(device); await tick(); assert.match(log.warnings[0], /native module missing/);
    const queued = [...clock.jobs.values()][0];
    await service.dispose(); queued(); service.reconnect(); await tick();
    assert.equal(clock.jobs.size, 0); assert.equal(loads, 1);
  });
  test('disposal during discovery prevents opening', async () => {
    const discovery = deferred<Device[]>(); let opens = 0;
    const service = new HidService(logger(), () => {}, async () => ({ devicesAsync: () => discovery.promise, open: async () => { opens++; return new Handle(); } }));
    service.configure(device); await tick(); const disposal = service.dispose();
    discovery.resolve([descriptor]); await disposal; assert.equal(opens, 0);
  });
  test('disposal during open closes the stale handle without attaching listeners', async () => {
    const opening = deferred<Handle>(), handle = new Handle();
    const service = new HidService(logger(), () => assert.fail('stale dispatch'), async () => ({ devicesAsync: async () => [descriptor], open: () => opening.promise }));
    service.configure(device); await tick(); const disposal = service.dispose();
    opening.resolve(handle); await disposal;
    assert.equal(handle.closed, 1); assert.equal(handle.listenerCount('data'), 0);
  });
  test('configuration change and manual reconnect never overlap opens; stale handle closes first', async () => {
    const opening = deferred<Handle>(), old = new Handle(), current = new Handle(); let opens = 0;
    const service = new HidService(logger(), () => {}, async () => ({ devicesAsync: async () => [descriptor], open: async () => {
      opens++; if (opens === 1) { return opening.promise; }
      assert.equal(old.closed, 1); return current;
    } }));
    service.configure(device); await tick();
    service.configure({ ...device, path: 'raw-path' }); service.reconnect(); await tick(); assert.equal(opens, 1);
    opening.resolve(old); await tick(); assert.equal(opens, 2); assert.equal(old.listenerCount('data'), 0);
    await service.dispose(); assert.equal(current.closed, 1);
  });
  test('device error closes and reconnects; ownership errors are contained', async () => {
    const clock = new Clock(), first = new Handle(), next = new Handle(); let opens = 0;
    const service = new HidService(logger(), () => {}, async () => ({ devicesAsync: async () => [descriptor], open: async () => {
      opens++; if (opens === 2) { throw new Error('device busy'); } return opens === 1 ? first : next;
    } }), clock);
    service.configure(device); await tick(); first.emit('error', new Error('unplugged')); await tick();
    assert.equal(first.closed, 1); assert.equal(clock.jobs.size, 1);
    clock.fire(); await tick(); await service.dispose(); assert.equal(next.closed, 1);
  });
  test('unconfigured devices never load native code or schedule a retry', async () => {
    const clock = new Clock();
    const service = new HidService(logger(), () => {}, async () => { throw new Error('must not load'); }, clock);
    service.configure({ ...device, vendorId: null }); await tick(); assert.equal(clock.jobs.size, 0); await service.dispose();
  });
});
