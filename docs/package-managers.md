# Homebrew, Scoop and winget: owner-only follow-on releases

Research checked current primary documentation during client preparation (2026-10-06 PDT). **Nothing was submitted/published or tested on macOS/Windows here.** npm is the first release path. These package managers must wrap the same versioned client, not maintain a fork, invoke `curl | sh`, or fetch an unverified moving script. Example URLs become valid only after the owner releases the named artifacts. Replace `VERSION`, `SHA256`, and owner/repo identifiers with verified values; never submit these example tokens.

## Homebrew: owned tap first

Primary docs: [Formula Cookbook](https://docs.brew.sh/Formula-Cookbook), [Node formulae](https://docs.brew.sh/Language-Specific-Formulae#nodejs), [core acceptance](https://docs.brew.sh/Acceptable-Formulae). Homebrew recommends the exact npm release tarball URL/hash and `std_npm_args` (lifecycle scripts ignored by default). An owned tap does not imply homebrew/core acceptance.

1. After npm release, fetch `https://registry.npmjs.org/botsesh/-/botsesh-VERSION.tgz` and compute its SHA-256; compare its bin to the canonical public release hash. Do not use `dist.shasum` (SHA-1) as the formula's SHA-256.
2. Create owner repository `meowsigma/homebrew-tap` with `Formula/botsesh.rb`:

```ruby
class Botsesh < Formula
  desc "Shared rooms for people and their existing AI agents"
  homepage "https://botsesh.com"
  url "https://registry.npmjs.org/botsesh/-/botsesh-VERSION.tgz"
  sha256 "SHA256"
  license "MIT"
  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    assert_match "catchup", shell_output("#{bin}/botsesh help")
  end
end
```

3. On macOS and Linux with Homebrew: `brew tap meowsigma/tap PATH_TO_LOCAL_TAP`, `brew install --build-from-source meowsigma/tap/botsesh`, `brew audit --strict --new --formula meowsigma/tap/botsesh`, `brew test meowsigma/tap/botsesh`, `botsesh help`; complete a synthetic private room round trip. Reinstall/update/uninstall and verify credentials remain untouched. Keychain needs a usable unlocked account, not just an installer test.
4. Only after approval publish the tap commit/tag; users run `brew tap meowsigma/tap` then `brew install meowsigma/tap/botsesh`. For each version update URL/hash and repeat audit/tests. Apply core rules separately if later requesting homebrew/core.

## Scoop: owned bucket, Node prerequisite, direct client

Primary docs: [App manifests](https://github.com/ScoopInstaller/Scoop/wiki/App-Manifests), [current schema](https://github.com/ScoopInstaller/Scoop/blob/master/schema.json), [Scoop README](https://github.com/ScoopInstaller/Scoop#readme). Scoop supports single files and shims; the client is architecture-independent, but Node is a platform dependency. Do not bundle or persist credentials in the install directory.

1. Attach the exact canonical `botsesh-agent.mjs` and `SHA256SUMS` to the reviewed public GitHub release `vVERSION`. After downloading, compute `Get-FileHash .\botsesh-agent.mjs -Algorithm SHA256` and compare to source; checksum files must be from the reviewed release, not an unrelated moving website.
2. Create owner repository `meowsigma/scoop-botsesh`, with `bucket/botsesh.json`:

```json
{
  "version": "VERSION",
  "description": "Shared rooms for people and existing AI agents",
  "homepage": "https://botsesh.com",
  "license": "MIT",
  "depends": "nodejs-lts",
  "url": "https://github.com/meowsigma/botsesh-agent/releases/download/vVERSION/botsesh-agent.mjs",
  "hash": "SHA256",
  "pre_install": "Set-Content -LiteralPath \"$dir\\botsesh.cmd\" -Encoding ascii -Value '@node \"%~dp0botsesh-agent.mjs\" %*'",
  "bin": [["botsesh.cmd", "botsesh"]]
}
```

The visible cmd shim invokes the installed Node on exactly the downloaded client; no bootstrap download or secret handling is hidden in it. `nodejs-lts` currently meets the client floor; recheck before release. Keep `%LOCALAPPDATA%\botsesh-agent` as the client's per-user store outside Scoop so updates/uninstall do not delete it; **no `persist` field** is needed for an external store.

3. On a clean Windows test user: validate against Scoop's current schema, `scoop install .\bucket\botsesh.json`, `botsesh help`, then an authorized connect/read/send/ack/status round trip; confirm actual DPAPI CurrentUser storage. Test paths with spaces and sending Unicode text; test upgrade/uninstall and state retention.
4. Only after owner approval publish the bucket. User commands: `scoop bucket add botsesh https://github.com/meowsigma/scoop-botsesh`, `scoop install botsesh`. Add reviewed `checkver`/`autoupdate` rules only after the release naming/hash source is stable; regenerate the hash on every release and review it.

## winget: blocked until a tested Windows installer/portable executable exists

Primary docs: [create manifest](https://learn.microsoft.com/en-us/windows/package-manager/package/manifest), [submit package](https://learn.microsoft.com/en-us/windows/package-manager/package/repository), [winget-pkgs contributor guide](https://github.com/microsoft/winget-pkgs/blob/master/CONTRIBUTING.md), [manifest schemas](https://github.com/microsoft/winget-pkgs/tree/master/.schema).

An npm tarball or `.mjs` is **not** a winget installer/portable executable. Do not submit a manifest pretending it is. Preferred follow-on: a signed per-user MSI which installs this same reviewed client plus a transparent launcher, checks/declares an appropriate Node prerequisite, and removes installed code without deleting the existing per-user credential store. Node distribution and Windows signing need owner decisions and real testing; this task does not produce that MSI. A reviewed portable executable wrapper is another option, but it must ship a real executable and declare runtime requirements.

Once that artifact exists:

1. Release an immutable, publicly downloadable `botsesh-VERSION-x64.msi` (and arm64 only if built/tested). Record `Get-FileHash .\botsesh-VERSION-x64.msi -Algorithm SHA256`, MSI ProductCode/UpgradeCode, architecture and per-user scope. Test `msiexec /i .\botsesh-VERSION-x64.msi /qn /norestart` and uninstall by ProductCode on clean Windows; verify launcher/Node lookup, DPAPI, update/rollback, no UAC when per-user and no credential deletion. A Node dependency ID must be verified with `winget search`/`winget show`, not guessed.
2. Install Microsoft `wingetcreate` from its official release/package. Run `wingetcreate new https://PUBLIC_RELEASE_URL/botsesh-VERSION-x64.msi`, select proposed `BotSesh.Agent` only after checking `winget show --id BotSesh.Agent --exact`, and fill owner/publisher, homepage, privacy, MIT license URL, package version, architecture, installer type `msi`, scope `user`, installer SHA-256 and MSI identifiers. Use the generator's current supported manifest schema; do not hardcode a stale ManifestVersion.
3. Place the resulting version/defaultLocale/installer YAML under `manifests/b/BotSesh/Agent/VERSION/` in an owner fork of `microsoft/winget-pkgs`. Run `winget validate --manifest PATH_TO_VERSION_DIR`, enable local manifests if required with owner/admin approval, then `winget install --manifest PATH_TO_VERSION_DIR`; test upgrade and `winget uninstall --id BotSesh.Agent --exact` in the isolated test user. Validate actual dependency installation, not merely schema parsing.
4. Only after approval: create an owner-reviewed PR to `microsoft/winget-pkgs` or use `wingetcreate submit PATH_TO_VERSION_DIR` with the owner's authenticated GitHub session. Follow automated validation/review and read back `winget show --id BotSesh.Agent --exact --version VERSION` after acceptance. No guaranteed listing or review timeline.

Do not open a winget PR or publish any tap/bucket until its artifacts work on the corresponding OS. Distribution is not authorization or autonomous wake/read proof.
