# QMKommand

QMKommand is a desktop VS Code extension that receives custom QMK Raw HID reports and invokes your configured VS Code commands. It runs in the **local UI extension host**, including with WSL, SSH and other remote workspaces. Install it locally. It has no browser extension or webview and sends no HID reports or VIA configuration changes.

## Configure the keyboard and bindings

Run **QMKommand: Open Bindings** from the Command Palette to open Application Settings JSON at `qmkommand.bindings`. These are application-scoped settings shared across profiles; workspace/folder settings cannot replace bindings or select another keyboard. The command uses VS Code's built-in [application settings action and revealSetting option](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/preferences/browser/preferences.contribution.ts).

A complete example (JSON numbers must be decimal):

```jsonc
{
  "qmkommand.device": {
    "vendorId": 17475,                 // 0x4443
    "productId": 12337,                // 0x3031
    "productName": "thedanielceroefs", // Exact, case-sensitive product string
    "usagePage": 65376,                // 0xFF60
    "usage": 97,                       // 0x61
    "path": ""                         // Optional exact path to resolve ambiguity
  },
  "qmkommand.bindings": [
    { "key": "VSC_1", "command": "workbench.action.files.save" },
    { "key": "VSC_2", "command": "type", "args": { "text": "Hello World" } },
    { "key": "VSC_32", "command": "workbench.action.showCommands" }
  ]
}
```

The default VID, PID and product name come from the repository's original `src/keyboard.ts` implementation (now replaced by the HID service). Confirm them against your connected device. Bindings default to `[]`. Set either ID to `null` or `productName` to `""` to disable connection. Supply all six device fields when editing the object.

To find identifiers, run this from the repository after `npm ci`:

```sh
node -e "require('node-hid').devicesAsync().then(d => console.log(d)).catch(console.error)"
```

Inspect `vendorId`, `productId`, `product` (used as `productName`), `usagePage`, `usage` and `path`. Enumeration does not open the device. QMK's [official Raw HID documentation](https://docs.qmk.fm/features/rawhid) specifies defaults `0xFF60` / `0x61`; override both settings if your descriptor differs. The standard keyboard interface is not the Raw HID interface. Selection requires all identifiers and usage fields, opens **only by path**, and refuses multiple matches. If two keyboards/interfaces match, use a copied exact `path` (JSON-escape backslashes). Paths may change after moving USB ports or reconnecting.

Each binding supports only `key`, `command` and optional `args`. The key must be `VSC_1` through `VSC_32`; command must be a nonempty ID of an existing command, including commands supplied by other installed extensions. There is no command whitelist or per-press command enumeration. Duplicate keys use the **last entry**. There is **no `when` support**: the public extension API does not expose the complete internal context evaluator. `when` and all other unsupported fields are rejected at runtime as well as by the schema.

Settings load on activation and on configuration changes. The complete replacement is validated before a new in-memory Map and device settings become active. An invalid update produces an error notification and log entry and retains the previous valid configuration. Invalid initial settings leave no active bindings. Commands use only the in-memory Map when reports arrive.

Commands execute only while `vscode.window.state.focused` is true. Unbound keys do nothing. An absent `args` property calls `executeCommand(command)`; a supplied JSON value calls `executeCommand(command, args)`. Null, objects and arrays are each one argument; arrays are never spread. Each press starts independently, and synchronous/asynchronous failures are caught and logged. A long-running command does not block subsequent presses.

## Exact input protocol

Offsets refer directly to the payload delivered by node-hid's `data` event. The report is exactly **32 bytes**:

| Offset | Value | Meaning |
| --- | --- | --- |
| 0-5 | `51 4D 4B 56 53 43` | ASCII `QMKVSC`, no NUL terminator |
| 6 | `01` | Version 1 |
| 7 | `01` | Execute-action message |
| 8 | `00`-`1F` | Firmware action ID 0-31 |
| 9-31 | All `00` | Required zero reserved bytes |

Firmware computes `keycode - QK_KB_0`. The extension computes **`VSC_${actionId + 1}`**: wire ID 0 is `VSC_1`, ID 15 is `VSC_16`, ID 31 is `VSC_32`. `VSC_0` is never configurable, and wire values remain 0-31.

For ID 0: `51 4D 4B 56 53 43 01 01 00`, then 23 zero bytes. All fields and the exact length are validated by a pure decoder before dispatch. Malformed packets and unrelated VIA traffic are ignored with trace diagnostics. There is no release, repeat or sequence field. Two identical valid reports are two presses: no debounce or deduplication.

### Input framing verification

[node-hid's input API](https://github.com/node-hid/node-hid#reading-from-a-device) delivers input via `data`. Its output/feature APIs' leading report-ID rule does not define input framing. The installed node-hid 3.4.0 wrapper forwards native read buffers. Its bundled HIDAPI Windows source (`hidapi/windows/hid.c`, `hid_read_timeout`) removes Windows' leading zero placeholder for unnumbered input reports; numbered input retains its actual report ID. See the [upstream HIDAPI Windows implementation](https://github.com/libusb/hidapi/blob/master/windows/hid.c).

QMKommand neither prepends nor strips a byte. An unexpected 33-byte packet is rejected, including a zero-prefixed packet. No additional platform framing defect was discovered by source inspection; physical input framing remains a hardware validation item. Firmware/report descriptors that introduce numbered reports would not match this exact protocol.

## Commands and connection behavior

- **QMKommand: Open Bindings** opens Settings JSON and reveals `qmkommand.bindings` using VS Code's built-in settings command.
- **QMKommand: Reconnect Keyboard** cancels pending retry timing, closes the current handle and retries selection. Device-setting changes also reconnect automatically.
- **QMKommand: Show Logs** shows the shared `QMKommand` LogOutputChannel.
- **QMKommand: Test Key** selects one of the 32 names and invokes the same resolver/executor without hardware. Focus filtering and normal argument/error handling still apply. Editor-dependent commands act on the editor focused after the picker closes.

Startup with or without the keyboard is supported. Failed discovery/open/native loading is contained; retry delays are 1, 2, 4, 8, then at most 10 seconds. A device error closes the handle and restarts discovery. Repeated identical connection failures move to debug after the first warning. Valid connection and configuration state is logged at ordinary levels; malformed packet details are trace-only. Use **Developer: Set Log Level** to select Debug/Trace for QMKommand when diagnosing input.

Connection attempts are serialized. Configuration generations invalidate pending discovery/open results; stale handles are closed, and disposal cancels timers and prevents stale results from reconnecting. Device handles and listeners are cleaned up.

**One active extension window is supported.** Multiple VS Code windows and applications such as VIA may compete for ownership of the same HID interface. Close competing windows/applications, then reconnect. Open failures are logged and retried gracefully. Focus filtering prevents unfocused dispatch; it does not coordinate device ownership. There is no broker service.

## Development, packaging and installation

Use desktop VS Code **1.140.0 or later** (the repository's existing engine requirement), npm, and preferably Node.js **24 LTS** for development. Some existing ESLint dependencies require Node >=22.13 on the Node 22 line. Checks also ran successfully on the available Node 22.11 host. The packaging command enables require-of-ESM support for the current vsce dependency on that older host; this flag does not affect the extension runtime.

```sh
npm ci
npm run check-types
npm run lint
npm test
npm run compile
```

Open this repository folder in VS Code, select **Run Extension** in Run and Debug, and press **F5**. The **QMKommand: Build** task runs `npm run compile`, finishes, and then launches a separate Extension Development Host window. F5 does not require the optional esbuild problem-matcher extension or background watch tasks. For continuous rebuilding, run `npm run watch` separately, then reload the development window after changes. In the Extension Development Host, set User/Application settings, open a scratch file, and run **QMKommand: Test Key**. `npm run test:integration` runs the separate VS Code host smoke test (requires a downloadable/local VS Code and a GUI); unit tests run in Node with Mocha and injected HID fakes. The host smoke test is not part of `npm test`.

```sh
npm run package:vsix
npm run verify:vsix
code --install-extension artifacts/qmkommand-0.0.1-win32-x64.vsix
```

Alternatively use **Extensions: Install from VSIX...**, choose the artifact, then reload VS Code. Packaging runs the production type/lint/esbuild checks. The VSIX targets **Windows x64**. `qmkommand-local` is a local packaging publisher identifier, not a Marketplace registration; nothing is published by these commands. The original project had no license/repository metadata, so packaging skips those optional checks without assigning a new license.

`node-hid` is a runtime native dependency and is external to esbuild. The VSIX includes its runtime JavaScript, `binding-options.js`, Windows x64 Node-API v4 binary, `pkg-prebuilds` loader and required helper JavaScript, dependency metadata and licenses. Compile-only `node-addon-api` headers and other platforms' binaries are excluded. No npm installation should be needed on the end user's machine. Packaging explicitly forces native loading first. `npm run verify:vsix` extracts the archive, asserts the Windows x64 target and settings schema, and loads the packaged native dependency in a child process that refuses dependency resolution outside the extracted extension. It writes `artifacts/verification.json`. See [VS Code platform-specific extension packaging](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platformspecific-extensions) and [node-hid's Node-API notes](https://github.com/node-hid/node-hid#platform-support).

The packaging profile deliberately supports the available Windows x64 host only. For Windows ARM64, macOS or Linux, supply/build the appropriate node-hid binary, change the allowlist in `.vscodeignore` and the target guard in `scripts/package-vsix.cjs`, then validate on that host. Cross-platform packaging and VS Code/Electron native loading have not been verified here. Keep the local UI host placement for remote workspaces.

### OS access requirements

On Windows, use the vendor Raw HID interface with the normal HID driver; OS-owned standard keyboard/mouse interfaces are unavailable to node-hid. The extension does not install drivers or request elevated privileges. On macOS, node-hid documents OS access restrictions and a permission prompt for its nonexclusive keyboard mode; QMKommand uses the separate Raw HID interface and the default opening mode, so that option is not enabled. Verify access on the actual device rather than granting blanket keyboard access. See [node-hid platform/access notes](https://github.com/node-hid/node-hid#devices-node-hid-cannot-read).

On Linux, node-hid defaults to `hidraw`. Your user needs permission to access the device, commonly through a device-specific udev rule. Follow [node-hid's udev guidance](https://github.com/node-hid/node-hid#udev-device-permissions); use your actual lowercase hexadecimal IDs, limit access to an appropriate local group or seat, reload rules and replug. For the repository device, a group-limited example (create/use the group according to your distribution) is:

```udev
KERNEL=="hidraw*", ATTRS{idVendor}=="4443", ATTRS{idProduct}=="3031", MODE="0660", GROUP="plugdev"
```

Place an appropriate rule under `/etc/udev/rules.d/`, run `sudo udevadm control --reload-rules`, then unplug/replug. Group membership and rules are administrator-managed; do not run VS Code as root. Linux/macOS access has not been tested by this Windows build.

## Hardware and VS Code validation checklist

Automated tests use fake handles; they do not establish physical USB behavior or integration success. On your machine:

- Install the Windows x64 VSIX; confirm no native-load error in **QMKommand: Show Logs**. Verify the identifiers and exactly one selected Raw HID interface.
- Start VS Code with the keyboard connected, then start without it and connect later; check connection logs.
- Configure save/type bindings; test `VSC_1`, an intermediate key and `VSC_32`. Confirm each label matches the firmware action ID + 1 and each press executes once.
- Press the same key twice deliberately. Both presses must execute. Releasing a key must add no action.
- With Trace logging, verify direct 32-byte input, zero padding, and no artificial report-ID adjustment. Exercise unrelated VIA traffic; it must execute nothing.
- Unplug/replug repeatedly, use **Reconnect Keyboard**, and change device settings during a pending reconnect. Confirm one connection resumes, without duplicate execution.
- Change a binding while connected. Introduce `when` or another invalid field; confirm an error and that the previous valid binding still works. Remove the invalid field and verify reload.
- Test absent args, `null`, object and array arguments with suitable commands. Try an invalid command ID; verify a logged error and that future keys still work.
- Run **Test Key** without hardware. Verify **Open Bindings** focuses the correct application setting and **Show Logs** opens QMKommand logs.
- Focus another application; physical presses must do nothing. Restore focus and retry. With multiple VS Code windows, close competing windows and verify graceful ownership failures/recovery.
- In a remote WSL/SSH workspace, confirm installation/running on the local UI host and local keyboard access. Reload/close the extension host during retries and confirm handles/timers are released.
