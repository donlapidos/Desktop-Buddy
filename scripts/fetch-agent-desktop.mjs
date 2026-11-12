// Fetches the agent-desktop CLI that Buddy drives, at the version and SHA-256 pinned in package.json
// ("agentDesktop"), from the upstream release, into bin/agent-desktop.exe. Buddy finds it there when run from source,
// and the installer bundles it (package.json build.extraResources). Nothing is run until its checksum matches.
//   npm run setup          fetch it if bin/ doesn't already hold the pinned version
//   npm run setup -- --force
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { agentDesktop } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const { version, sha256 } = agentDesktop ?? {};
if (!/^\d+\.\d+\.\d+$/.test(version ?? "") || !/^[0-9a-f]{64}$/.test(sha256 ?? "")) {
  console.error('package.json needs "agentDesktop": { "version": "x.y.z", "sha256": "<64 hex>" }');
  process.exit(2);
}

const binDir = path.join(root, "bin");
const exe = path.join(binDir, "agent-desktop.exe");
const marker = path.join(binDir, "agent-desktop.json");
const asset = `agent-desktop-v${version}-x86_64-pc-windows-msvc.tar.gz`;
const url = `https://github.com/vercel-labs/agent-desktop/releases/download/v${version}/${asset}`;

const have = (() => {
  try {
    return JSON.parse(fs.readFileSync(marker, "utf8"));
  } catch {
    return null;
  }
})();
if (!process.argv.includes("--force") && have?.version === version && have?.sha256 === sha256 && fs.existsSync(exe)) {
  console.log(`agent-desktop ${version} is already in bin/`);
  process.exit(0);
}

console.log(`Fetching agent-desktop ${version}…`);
const res = await fetch(url, { redirect: "follow" });
if (!res.ok) {
  console.error(`Couldn't download ${url}: HTTP ${res.status}`);
  process.exit(1);
}
const archive = Buffer.from(await res.arrayBuffer());
const got = crypto.createHash("sha256").update(archive).digest("hex");
if (got !== sha256) {
  console.error(`Checksum mismatch for ${asset}:\n  expected ${sha256}\n  got      ${got}\nNothing was installed.`);
  process.exit(1);
}

// Windows 10 and later ship tar (bsdtar), which reads .tar.gz. It's named by its full path: a Git Bash or MSYS tar
// earlier on PATH reads "C:\..." as a remote host.
const windowsTar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
const tarCommand = process.platform === "win32" && fs.existsSync(windowsTar) ? windowsTar : "tar";
const work = fs.mkdtempSync(path.join(os.tmpdir(), "agent-desktop-"));
try {
  const file = path.join(work, asset);
  fs.writeFileSync(file, archive);
  const tar = spawnSync(tarCommand, ["-xzf", file, "-C", work], { encoding: "utf8" });
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr || tar.error?.message}`);
  const unpacked = path.join(work, "agent-desktop.exe");
  if (!fs.existsSync(unpacked)) throw new Error("the archive has no agent-desktop.exe");
  fs.mkdirSync(binDir, { recursive: true });
  fs.copyFileSync(unpacked, exe);
  fs.writeFileSync(marker, `${JSON.stringify({ version, sha256 }, null, 2)}\n`);
  console.log(`agent-desktop ${version} is in bin/ (checksum verified)`);
} catch (err) {
  console.error(`Couldn't unpack agent-desktop: ${err.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
