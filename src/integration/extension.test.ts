import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

suite('VS Code host smoke tests', () => {
  test('activates with public utility commands and application-scoped schema', async () => {
    const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'qmkommand');
    assert.ok(extension);
    await extension.activate();
    // Enumeration belongs only to this smoke test, never to per-report dispatch.
    const commands = await vscode.commands.getCommands();
    for (const name of ['openBindings', 'reconnect', 'showLogs', 'testKey']) {
      assert.ok(commands.includes(`qmkommand.${name}`));
    }
    const properties = extension.packageJSON.contributes.configuration.properties;
    assert.equal(properties['qmkommand.bindings'].scope, 'application');
    assert.equal(properties['qmkommand.device'].scope, 'application');
    assert.deepEqual(extension.packageJSON.extensionKind, ['ui']);
  });
});
