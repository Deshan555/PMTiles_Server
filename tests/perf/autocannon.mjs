import autocannon from "autocannon";

const baseUrl = process.env.PERF_BASE_URL || "http://localhost:8080";
const duration = Number(process.env.PERF_DURATION || 20);
const connections = Number(process.env.PERF_CONNECTIONS || 200);
const pipelining = Number(process.env.PERF_PIPELINING || 1);

const target = `${baseUrl}/tiles/map.pmtiles`;

console.log("[autocannon] starting", { target, duration, connections, pipelining });

const instance = autocannon({
  url: target,
  duration,
  connections,
  pipelining,
  headers: {
    Range: "bytes=0-65535"
  }
});

autocannon.track(instance, { renderProgressBar: true, renderResultsTable: true });

instance.on("done", (result) => {
  console.log("[autocannon] done");
  console.log(
    JSON.stringify(
      {
        requestsAverage: result.requests.average,
        latencyAverage: result.latency.average,
        throughputAverageBytes: result.throughput.average,
        errors: result.errors,
        timeouts: result.timeouts,
        non2xx: result.non2xx
      },
      null,
      2
    )
  );

  if (result.errors > 0 || result.timeouts > 0 || result.non2xx > 0) {
    process.exitCode = 1;
  }
});
