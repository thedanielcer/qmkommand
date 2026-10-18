import * as hid from "node-hid";
import { Result } from "./result";

const vendorId = 0x4443;
const productId = 0x3031;
const productName = "thedanielceroefs";

const reportLength = 32;

async function getKeyboard(): Promise<Result<hid.Device, string>> {
  const AllDevices = await hid.devicesAsync();

  const thedanielceroefs = AllDevices.filter((device) => {
    return (
      device.vendorId === vendorId &&
      device.productId === productId &&
      device.product === productName
    );
  });

  if (thedanielceroefs.length === 0) {
    return {
      ok: false,
      error: "No matching keyboard found",
    };
  }

  return {
    ok: true,
    value: thedanielceroefs[0],
  };
}

async function openKeyboard(
  device: hid.Device,
): Promise<Result<hid.HIDAsync, string>> {
  try {
    if (device.path) {
      const keyboard = await hid.HIDAsync.open(device.path);
      return {
        ok: true,
        value: keyboard,
      };
    }

    const keyboard = await hid.HIDAsync.open(device.vendorId, device.productId);
    return {
      ok: true,
      value: keyboard,
    };
  } catch (error) {
    return {
      ok: false,
      error: "Failed to open keyboard",
    };
  }
}
