import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/integration/**/*.test.js',
});
