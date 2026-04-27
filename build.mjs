/**
 * Cross-platform build script for the Echo360 Speed Control extension.
 *
 * Compiles TypeScript once into dist/_compiled, then assembles browser-specific
 * bundles in dist/chrome and dist/firefox. Each bundle contains the appropriate
 * manifest.json for its target browser.
 *
 * Usage:
 *   node build.mjs            # build both chrome and firefox
 *   node build.mjs chrome     # build chrome only
 *   node build.mjs firefox    # build firefox only
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
const COMPILED = path.join(DIST, "_compiled");
const ASSETS = path.join(ROOT, "assets");
const POPUP_HTML = path.join(ROOT, "src", "popup", "popup.html");
const POPUP_CSS = path.join(ROOT, "src", "popup", "popup.css");
const BASE_MANIFEST = path.join(ROOT, "manifest.json");

const TARGETS = ["chrome", "firefox"];

// File system helpers

function rimraf(target) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// TS compile

function compileTypeScript() {
  console.log("• Compiling TypeScript...");
  // Compile into a shared staging directory so we can copy the output into
  // each browser-specific dist folder without running tsc more than once.
  execSync(`npx tsc --outDir "${COMPILED}"`, { stdio: "inherit", cwd: ROOT });
}

// Manifest builder

function buildManifest(target) {
  const base = JSON.parse(fs.readFileSync(BASE_MANIFEST, "utf8"));

  if (target === "chrome") {
    // Chrome MV3 requires service_worker; nothing else to change.
    return base;
  }

  if (target === "firefox") {
    // Firefox MV3 supports background.service_worker only on 121+. To support
    // older Firefox releases (and to follow the Mozilla recommendation of
    // event pages over service workers), use background.scripts instead.
    delete base.background;
    base.background = {
      scripts: ["background/service-worker.js"],
    };

    // Required by AMO so the extension has a stable identifier.
    base.browser_specific_settings = {
      gecko: {
        id: "echo360-speed-control@weichongdevelops.github.io",
        strict_min_version: "109.0",
      },
    };

    return base;
  }

  throw new Error(`Unknown target: ${target}`);
}

// Per-target build

function buildTarget(target) {
  const out = path.join(DIST, target);
  console.log(`• Building ${target} -> ${path.relative(ROOT, out)}`);

  rimraf(out);
  fs.mkdirSync(out, { recursive: true });

  // 1. Copy compiled JS (everything tsc produced).
  copyDir(COMPILED, out);

  // 2. Copy static assets and popup files.
  copyDir(ASSETS, path.join(out, "assets"));
  copyFile(POPUP_HTML, path.join(out, "popup", "popup.html"));
  copyFile(POPUP_CSS, path.join(out, "popup", "popup.css"));

  // 3. Write the browser-specific manifest.
  const manifest = buildManifest(target);
  fs.writeFileSync(
    path.join(out, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

// Main

function main() {
  const requested = process.argv.slice(2);
  const targets = requested.length ? requested : TARGETS;

  for (const t of targets) {
    if (!TARGETS.includes(t)) {
      console.error(
        `Unknown target "${t}". Valid targets: ${TARGETS.join(", ")}`,
      );
      process.exit(1);
    }
  }

  rimraf(DIST);
  compileTypeScript();
  for (const t of targets) buildTarget(t);
  // Clean up shared staging directory once all targets are written.
  rimraf(COMPILED);

  console.log(`✓ Built: ${targets.join(", ")}`);
}

main();
