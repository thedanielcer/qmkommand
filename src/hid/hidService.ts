import type { Device } from "node-hid";
import { DeviceSettings, KeyName, Logger, errorMessage } from "../types";
import { decodeReport } from "./protocol";

export interface HidHandle {
  on(event: "data", listener: (data: Buffer) => void): unknown;
  on(event: "error", listener: (error: unknown) => void): unknown;
  removeListener(event: "data", listener: (data: Buffer) => void): unknown;
  removeListener(event: "error", listener: (error: unknown) => void): unknown;
  close(): Promise<void>;
}

export interface HidBackend {
  devicesAsync(vid: number, pid: number): Promise<Device[]>;
  open(path: string): Promise<HidHandle>;
}

export interface Scheduler {
  set(callback: () => void, delay: number): unknown;
  clear(timer: unknown): void;
}

const scheduler: Scheduler = {
  set: (callback, delay) => setTimeout(callback, delay),
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export async function loadNodeHid(): Promise<HidBackend> {
  // Kept outside the bundle and loaded inside the service's error boundary.
  const hid = await import("node-hid");
  return {
    devicesAsync: hid.devicesAsync,
    open: (path) => hid.HIDAsync.open(path),
  };
}

export function selectDevice(
  devices: Device[],
  settings: DeviceSettings,
): Device | undefined {
  const matches = devices.filter(
    (device) =>
      device.vendorId === settings.vendorId &&
      device.productId === settings.productId &&
      device.product === settings.productName &&
      device.usagePage === settings.usagePage &&
      device.usage === settings.usage &&
      (!settings.path || device.path === settings.path),
  );
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} matching HID interfaces; set qmkommand.device.path to select one explicitly.`,
    );
  }
  if (matches[0] && !matches[0].path) {
    throw new Error(
      "Matching interface has no device path; cannot open safely.",
    );
  }
  return matches[0];
}

export class HidService {
  private settings: DeviceSettings | undefined;
  private generation = 0;
  private disposed = false;
  private pending = false;
  private worker: Promise<void> | undefined;
  private timer: unknown;
  private delay = 1000;
  private connection:
    | {
        handle: HidHandle;
        data: (data: Buffer) => void;
        error: (error: unknown) => void;
      }
    | undefined;
  private lastFailure: string | undefined;

  constructor(
    private readonly log: Logger,
    private readonly onKey: (key: KeyName) => void,
    private readonly load: () => Promise<HidBackend> = loadNodeHid,
    private readonly clock: Scheduler = scheduler,
  ) {}
  configure(settings: DeviceSettings): void {
    if (this.disposed) {
      return;
    }
    this.settings = { ...settings };
    this.reconnect();
  }
  reconnect(): void {
    if (this.disposed) {
      return;
    }
    this.generation++;
    this.delay = 1000;
    this.lastFailure = undefined;
    this.clearTimer();
    this.request();
  }
  private clearTimer(): void {
    if (this.timer !== undefined) {
      this.clock.clear(this.timer);
      this.timer = undefined;
    }
  }
  private current(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }
  private request(): void {
    if (this.disposed) {
      return;
    }
    this.pending = true;
    if (!this.worker) {
      this.worker = this.run()
        .catch((error) => {
          this.log.error(`HID service failure: ${errorMessage(error)}`);
        })
        .finally(() => {
          this.worker = undefined;
          if (this.pending && !this.disposed) {
            this.request();
          }
        });
    }
  }
  private async close(handle: HidHandle): Promise<void> {
    try {
      await handle.close();
    } catch (error) {
      this.log.debug(`HID close failed: ${errorMessage(error)}`);
    }
  }
  private async disconnect(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    if (!connection) {
      return;
    }
    // Keep guarded listeners through close so in-flight errors remain harmless.
    await this.close(connection.handle);
    connection.handle.removeListener("data", connection.data);
    connection.handle.removeListener("error", connection.error);
    this.log.info("Keyboard disconnected.");
  }
  private retry(generation: number, message: string): void {
    if (!this.current(generation)) {
      return;
    }
    if (message !== this.lastFailure) {
      this.log.warn(message);
      this.lastFailure = message;
    } else {
      this.log.debug(message);
    }
    const delay = this.delay;
    this.delay = Math.min(delay * 2, 10000);
    this.log.debug(`Retrying HID connection in ${delay} ms.`);
    this.timer = this.clock.set(() => {
      this.timer = undefined;
      if (this.current(generation)) {
        this.request();
      }
    }, delay);
  }
  private async run(): Promise<void> {
    while (this.pending && !this.disposed) {
      this.pending = false;
      const generation = this.generation;
      await this.disconnect();
      if (!this.current(generation)) {
        continue;
      }
      const settings = this.settings;
      if (
        !settings ||
        settings.vendorId === null ||
        settings.productId === null ||
        !settings.productName.trim()
      ) {
        this.log.info(
          "Keyboard unconfigured. Set qmkommand.device vendorId, productId and productName.",
        );
        continue;
      }
      try {
        const backend = await this.load();
        if (!this.current(generation)) {
          continue;
        }
        const devices = await backend.devicesAsync(
          settings.vendorId,
          settings.productId,
        );
        if (!this.current(generation)) {
          continue;
        }
        const device = selectDevice(devices, settings);
        if (!device) {
          this.retry(
            generation,
            "Keyboard not found. Waiting for a matching Raw HID interface.",
          );
          continue;
        }
        const handle = await backend.open(device.path!);
        if (!this.current(generation)) {
          await this.close(handle);
          continue;
        }
        const data = (payload: Buffer) => {
          if (!this.current(generation) || this.connection?.handle !== handle) {
            return;
          }
          const decoded = decodeReport(payload);
          if (decoded.ok) {
            this.onKey(decoded.event.key);
          } else {
            this.log.trace(
              `Ignored HID input: ${decoded.reason} (length ${payload.length}).`,
            );
          }
        };
        const error = (failure: unknown) => {
          if (!this.current(generation) || this.connection?.handle !== handle) {
            return;
          }
          this.log.warn(`Keyboard error: ${errorMessage(failure)}`);
          this.generation++;
          // The single worker closes the old handle before discovering/opening again.
          this.request();
        };
        this.connection = { handle, data, error };
        handle.on("error", error);
        handle.on("data", data);
        this.delay = 1000;
        this.lastFailure = undefined;
        this.log.info(
          `Keyboard connected: ${device.product} (usage page ${settings.usagePage}, usage ${settings.usage}).`,
        );
      } catch (error) {
        this.retry(
          generation,
          `Cannot connect to keyboard: ${errorMessage(error)}. Check device ownership, permissions and native dependency installation.`,
        );
      }
    }
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    this.generation++;
    this.pending = false;
    this.clearTimer();
    await this.worker;
    await this.disconnect();
  }
}
