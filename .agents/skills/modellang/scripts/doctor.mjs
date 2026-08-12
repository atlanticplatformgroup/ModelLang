#!/usr/bin/env node
/* global console, process */

import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const cwd = process.cwd();
const require = createRequire(join(cwd, "package.json"));
const major = Number.parseInt(process.versions.node.split(".")[0], 10);
const packageJsonPath = join(cwd, "package.json");

console.log(`ModelLang doctor: ${cwd}`);
console.log(`Node: ${process.version} (${major >= 20 ? "ok" : "requires Node >=20"})`);

const lockfiles = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];
const detected = lockfiles.find(([file]) => existsSync(join(cwd, file)));
console.log(`Package manager: ${detected?.[1] ?? "not detected"}`);

let projectPackage;
if (existsSync(packageJsonPath)) {
  try {
    projectPackage = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    console.log(`Project: ${projectPackage.name ?? basename(cwd)}`);
  } catch (error) {
    console.log(`Project package.json: invalid (${error.message})`);
  }
} else {
  console.log("Project package.json: not found");
}

const sourceCheckout =
  projectPackage?.name === "@atlanticplatformgroup/modellang" &&
  existsSync(join(cwd, "src", "cli.ts")) &&
  existsSync(join(cwd, "tsconfig.json"));

if (sourceCheckout) {
  const builtCli = join(cwd, "dist", "src", "cli.js");
  console.log("Environment: ModelLang source checkout");
  console.log(`Compiler build: ${existsSync(builtCli) ? builtCli : "missing; run npm run build"}`);
} else {
  try {
    const installedPackage = require.resolve("@atlanticplatformgroup/modellang/package.json");
    const installed = JSON.parse(readFileSync(installedPackage, "utf8"));
    console.log(`ModelLang package: ${installed.version} (${installedPackage})`);
  } catch {
    console.log("ModelLang package: not installed in this project");
  }
}

const binName = process.platform === "win32" ? "modelc.cmd" : "modelc";
const localBin = resolve(cwd, "node_modules", ".bin", binName);
console.log(`Local modelc: ${existsSync(localBin) ? localBin : "not found"}`);

if (process.argv.includes("--registry")) {
  const result = spawnSync("npm", ["view", "@atlanticplatformgroup/modellang", "version"], {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status === 0) {
    console.log(`npm registry: @atlanticplatformgroup/modellang@${result.stdout.trim()} available`);
  } else {
    const detail = (result.stderr || result.stdout).trim().split("\n").slice(-4).join("\n");
    console.log("npm registry: @atlanticplatformgroup/modellang unavailable or inaccessible");
    if (detail) console.log(detail);
  }
}

if (major < 20) process.exitCode = 1;
