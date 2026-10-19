import { Binding, KeyName } from "../types";

export interface BindingLookup {
  get(key: KeyName): Binding | undefined;
}

/** Duplicate priority is settled at map construction: the last entry wins. */
export function resolveBinding(
  bindings: BindingLookup,
  key: KeyName,
): Binding | undefined {
  return bindings.get(key);
}
