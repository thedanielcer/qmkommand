import * as vscode from "vscode";
import { BindingStore } from "./bindings/bindingStore";
import { CommandExecutor } from "./commands/commandExecutor";
import { registerCommands } from "./commands/registerCommands";
import { HidService } from "./hid/hidService";

let service: HidService | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel("QMKommand", { log: true });
  const store = new BindingStore();
  const executor = new CommandExecutor(
    store,
    () => vscode.window.state.focused,
    (command, ...args) => vscode.commands.executeCommand(command, ...args),
    log,
  );

  const hid = new HidService(log, (key) => {
    void executor.dispatch(key);
  });

  service = hid;

  const reload = () => {
    const configuration = vscode.workspace.getConfiguration("qmkommand");
    // Application-scoped settings are user-only. Explicitly exclude workspace values too.
    const userSetting = (key: string) => {
      const inspected = configuration.inspect<unknown>(key);
      return inspected?.globalValue !== undefined
        ? inspected.globalValue
        : inspected?.defaultValue;
    };

    const result = store.reload(userSetting("bindings"), userSetting("device"));
    if (!result.ok) {
      const message = `Configuration rejected; retaining last valid settings (${store.size} bindings). ${result.error}`;
      log.error(message);
      void vscode.window.showErrorMessage(`QMKommand: ${message}`);
      return;
    }

    log.info(`Configuration loaded: ${store.size} active bindings.`);
    
    if (result.deviceChanged) {
      hid.configure(store.device!);
    }
  };
  context.subscriptions.push(
    log,
    hid,
    ...registerCommands(log, hid, executor),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("qmkommand")) {
        reload();
      }
    }),
  );
  reload();
}

export async function deactivate(): Promise<void> {
  await service?.dispose();
  service = undefined;
}
