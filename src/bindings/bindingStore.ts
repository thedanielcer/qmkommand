import {
  Binding,
  DeviceSettings,
  JsonValue,
  KEY_NAMES,
  KeyName,
  errorMessage,
} from "../types";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJson(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJson);
  }
  return isObject(value) && Object.values(value).every(isJson);
}

export function validateBindings(value: unknown): Map<KeyName, Binding> {
  if (!Array.isArray(value)) {
    throw new Error("qmkommand.bindings must be an array.");
  }
  const next = new Map<KeyName, Binding>();
  value.forEach((entry: unknown, index) => {
    const label = `qmkommand.bindings[${index}]`;
    if (!isObject(entry)) {
      throw new Error(`${label} must be an object.`);
    }
    const unsupported = Object.keys(entry).filter(
      (key) => !["key", "command", "args"].includes(key),
    );
    if (unsupported.length) {
      throw new Error(
        `${label}: unsupported properties: ${unsupported.join(", ")}. Only key, command and args are supported; when is unavailable.`,
      );
    }
    if (!KEY_NAMES.includes(entry.key as KeyName)) {
      throw new Error(`${label}.key must be VSC_1 through VSC_32.`);
    }
    if (typeof entry.command !== "string" || !entry.command.trim()) {
      throw new Error(`${label}.command must be a nonempty command ID.`);
    }
    const binding: Binding = {
      key: entry.key as KeyName,
      command: entry.command,
    };
    if (Object.hasOwn(entry, "args")) {
      if (!isJson(entry.args)) {
        throw new Error(`${label}.args must be a JSON value.`);
      }
      next.set(binding.key, { ...binding, args: structuredClone(entry.args) });
    } else {
      next.set(binding.key, binding);
    }
  });
  return next;
}

export function validateDevice(value: unknown): DeviceSettings {
  if (!isObject(value)) {
    throw new Error("qmkommand.device must be an object.");
  }
  const fields = [
    "vendorId",
    "productId",
    "productName",
    "usagePage",
    "usage",
    "path",
  ];
  if (Object.keys(value).some((key) => !fields.includes(key))) {
    throw new Error("qmkommand.device contains unsupported properties.");
  }
  for (const field of ["vendorId", "productId", "usagePage", "usage"]) {
    const number = value[field];
    if ((field === "vendorId" || field === "productId") && number === null) {
      continue;
    }
    if (
      typeof number !== "number" ||
      !Number.isInteger(number) ||
      number < 0 ||
      number > 65535
    ) {
      throw new Error(
        `qmkommand.device.${field} must be an integer from 0 to 65535${field.endsWith("Id") ? " or null" : ""}.`,
      );
    }
  }
  if (typeof value.productName !== "string" || typeof value.path !== "string") {
    throw new Error("qmkommand.device.productName and path must be strings.");
  }
  return { ...value } as unknown as DeviceSettings;
}

/** Validate both settings completely before making either visible to report dispatch. */
export class BindingStore {
  private bindings = new Map<KeyName, Binding>();
  private currentDevice: DeviceSettings | undefined;

  get(key: KeyName): Binding | undefined {
    return this.bindings.get(key);
  }

  get size(): number {
    return this.bindings.size;
  }

  get device(): DeviceSettings | undefined {
    return this.currentDevice;
  }

  reload(
    bindings: unknown,
    device: unknown,
  ): { ok: true; deviceChanged: boolean } | { ok: false; error: string } {
    try {
      const nextBindings = validateBindings(bindings);
      const nextDevice = validateDevice(device);

      const deviceChanged =
        JSON.stringify(this.currentDevice) !== JSON.stringify(nextDevice);

      this.bindings = nextBindings;
      this.currentDevice = nextDevice;

      return {
        ok: true,
        deviceChanged,
      };
    } catch (error) {
      return {
        ok: false,
        error: errorMessage(error),
      };
    }
  }
}
