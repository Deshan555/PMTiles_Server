import { spawn } from "node:child_process";

const mode = process.argv[2] || "all";
const allowed = new Set(["all", "quick", "load"]);

if (!allowed.has(mode)) {
  console.error(`Invalid mode: ${mode}. Use one of: all, quick, load`);
  process.exit(1);
}

function run(command, args, name, env = process.env) {
  return new Promise((resolve, reject) => {
    console.log(`\n[perf-suite] starting ${name}: ${command} ${args.join(" ")}`);

    const child = spawn(command, args, {
      stdio: "inherit",
      env,
      shell: false
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        console.log(`[perf-suite] ${name} completed`);
        resolve();
        return;
      }
      reject(new Error(`${name} failed with exit code ${code}`));
    });
  });
}

(async () => {
  try {
    if (mode === "quick" || mode === "all") {
      await run("node", ["tests/perf/autocannon.mjs"], "autocannon quick benchmark");
    }

    if (mode === "load" || mode === "all") {
      await run("k6", ["run", "tests/perf/k6-load.js"], "k6 real load test");
    }

    console.log("\n[perf-suite] finished successfully");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n[perf-suite] failed: ${message}`);
    if (String(message).includes("ENOENT") || String(message).includes("k6")) {
      console.error("[perf-suite] hint: install k6 and ensure it is available in PATH");
    }
    process.exit(1);
  }
})();
