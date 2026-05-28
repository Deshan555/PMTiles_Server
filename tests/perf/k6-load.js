import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = __ENV.PERF_BASE_URL || "http://localhost:8080";

export const options = {
  scenarios: {
    ramping_load: {
      executor: "ramping-vus",
      startVUs: 10,
      stages: [
        { duration: "30s", target: 100 },
        { duration: "1m", target: 300 },
        { duration: "30s", target: 0 }
      ],
      gracefulRampDown: "10s"
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"]
  }
};

export default function () {
  const res = http.get(`${baseUrl}/tiles/map.pmtiles`, {
    headers: { Range: "bytes=0-65535" }
  });

  check(res, {
    "status is 206": (r) => r.status === 206,
    "has content-range": (r) => !!r.headers["Content-Range"]
  });

  sleep(0.1);
}
