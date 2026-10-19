# GitHub Actions releases

The workflow is in [.github/workflows/release.yml](.github/workflows/release.yml).
It reuses the existing packaging and verification scripts. The downloadable
extension supports **Windows x64**; the other machine needs desktop VS Code
1.140.0 or later.

## First release

1. Merge the release workflow pull request into `main`. Its build check should
   pass before merging.
2. In your local checkout, switch to `main` and pull the merged changes:

   ```sh
   git switch main
   git pull --ff-only origin main
   ```

3. Confirm `package.json` has version `0.0.1`, your working tree is clean, and
   your intended extension changes are committed. Create and push the tag:

   ```sh
   git tag -a v0.0.1 -m "QMKommand v0.0.1"
   git push origin v0.0.1
   ```

4. Open the repository's **Actions** tab and select **Build and release VSIX**.
   Expand the jobs and steps to watch the commands and read their output.
5. When both jobs succeed, open **Releases**, select **QMKommand v0.0.1**,
   and download `qmkommand-0.0.1-win32-x64.vsix` under **Assets**.
6. On the other Windows x64 machine, use VS Code's **Extensions: Install from
   VSIX...** command, or:

   ```sh
   code --install-extension qmkommand-0.0.1-win32-x64.vsix
   ```

The tag marks the exact source commit used for the build. The workflow requires
the tag to equal `v` followed by the version in `package.json`; a mismatch fails
before dependency installation. Push the tag only after the workflow is merged.
The tag push creates and publishes a release automatically.

Do not create the same release manually first. If a release already exists,
the create step fails rather than overwriting its assets. For a failed run,
inspect the failed step and fix its cause; retry transient failures using
**Re-run failed jobs**. For source or workflow fixes after tagging, commit the
fix and use a new package version and tag.

## Try Actions without publishing

After merging, open **Actions → Build and release VSIX → Run workflow**, select
`main`, and run it. This runs the Windows build only. On its completed run page,
download the **qmkommand-win32-x64** artifact and unzip it to get the VSIX.
These Actions artifacts expire after 14 days; the file attached to a GitHub
release remains available independently of that artifact retention period.

Pull requests changing the workflow or packaging configuration also run the
build job, without publishing a release.

## What each part means

| YAML | Purpose |
| --- | --- |
| `on.push.tags` | Starts the workflow when a tag beginning with `v` is pushed. |
| `workflow_dispatch` | Enables the manual **Run workflow** button. |
| `jobs` | Defines the build and release jobs, each on its own temporary machine. |
| `runs-on: windows-latest` | Builds on Windows because the packaging script requires Windows x64 and loads a Windows native binary. |
| `uses` | Runs a reusable action, such as checking out the repository or setting up Node.js. |
| `run` | Executes a command on the runner. Windows uses PowerShell here; the Linux release step uses Bash. |
| `needs: build` | Allows the release job to run only after the build job succeeds. |
| `if` | Limits release publication to tag pushes; manual and pull request runs only build. |
| `permissions` | Gives the build read access and the release job permission to create a release. |

The build uses Node.js 24 x64 and `npm ci`, which installs the versions recorded
in `package-lock.json`. It runs the existing unit tests, then
`npm run package:vsix` (including type checking, linting and the production
build), then `npm run verify:vsix`. Verification extracts the VSIX and tests its
packaged native dependency in isolation. It does not test a physical keyboard
or the VS Code/Electron host.

An Actions artifact carries the verified VSIX between jobs. The release job
downloads that artifact and runs GitHub CLI's `gh release create` to publish it.
GitHub supplies the temporary `GITHUB_TOKEN` automatically; no personal access
token or Marketplace account is needed. The token is exposed as `GH_TOKEN`
only to the release command.

## Later versions

If you make changes, commit them and update the version, for example:

```sh
npm version patch --no-git-tag-version
git add package.json package-lock.json
git commit -m "Bump version to 0.0.2"
git push origin main
git tag -a v0.0.2 -m "QMKommand v0.0.2"
git push origin v0.0.2
```

This example assumes you are on `main`, the previous version was `0.0.1`, and
the intended source changes are already committed. Each new version gets its
own release and downloadable VSIX.
