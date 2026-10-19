import { BindingLookup, resolveBinding } from '../bindings/bindingResolver';
import { KeyName, Logger, errorMessage } from '../types';

export type ExecuteCommand = (command: string, ...args: unknown[]) => PromiseLike<unknown>;
export class CommandExecutor {
  constructor(
    private readonly bindings: BindingLookup,
    private readonly isFocused: () => boolean,
    private readonly executeCommand: ExecuteCommand,
    private readonly log: Logger,
  ) {}

  /** Each call starts independently. This promise always contains command failures. */
  async dispatch(key: KeyName): Promise<void> {
    if (!this.isFocused()) { this.log.trace(`Ignored ${key}: window is not focused.`); return; }
    const binding = resolveBinding(this.bindings, key);
    if (!binding) { this.log.trace(`Unbound key: ${key}.`); return; }
    try {
      if (Object.hasOwn(binding, 'args')) {
        await this.executeCommand(binding.command, binding.args);
      } else {
        await this.executeCommand(binding.command);
      }
    } catch (error) {
      this.log.error(`Command ${binding.command} for ${key} failed: ${errorMessage(error)}`);
    }
  }
}
