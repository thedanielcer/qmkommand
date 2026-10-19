import * as vscode from "vscode";
import { KEY_NAMES, errorMessage } from "../types";
import { CommandExecutor } from "./commandExecutor";
import { HidService } from "../hid/hidService";

export function registerCommands(
  log: vscode.LogOutputChannel,
  hid: HidService,
  executor: CommandExecutor,
): vscode.Disposable[] {
  const register = (id: string, action: () => unknown) =>
    vscode.commands.registerCommand(id, async () => {
      try {
        await action();
      } catch (error) {
        log.error(`${id} failed: ${errorMessage(error)}`);
      }
    });

  return [
    register("qmkommand.openBindings", () =>
      vscode.commands.executeCommand(
        "workbench.action.openApplicationSettingsJson",
        {
          revealSetting: { key: "qmkommand.bindings", edit: true },
        },
      ),
    ),
    register("qmkommand.reconnect", () => hid.reconnect()),
    register("qmkommand.showLogs", () => log.show()),
    register("qmkommand.testKey", async () => {
      const selected = await vscode.window.showQuickPick(
        KEY_NAMES.map((key) => ({
          label: key,
          key,
        })),
        { placeHolder: "Select a QMKommand key to test" },
      );
      if (selected) {
        await executor.dispatch(selected.key);
      }
    }),
  ];
}
