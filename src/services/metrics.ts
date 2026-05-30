export const metrics = {
  requestsTotal: 0,
  requestsActive: 0,
  bytesSentTotal: 0,
  rangeRequests: 0,
  fullRequests: 0,
  routingRequestsTotal: 0,
  routingCacheHitsTotal: 0,
  routingErrorsTotal: 0,
  routingDurationMsTotal: 0
};

export function toPrometheusText(): string {
  return [
    `pmtiles_requests_total ${metrics.requestsTotal}`,
    `pmtiles_requests_active ${metrics.requestsActive}`,
    `pmtiles_bytes_sent_total ${metrics.bytesSentTotal}`,
    `pmtiles_range_requests_total ${metrics.rangeRequests}`,
    `pmtiles_full_requests_total ${metrics.fullRequests}`,
    `pmtiles_routing_requests_total ${metrics.routingRequestsTotal}`,
    `pmtiles_routing_cache_hits_total ${metrics.routingCacheHitsTotal}`,
    `pmtiles_routing_errors_total ${metrics.routingErrorsTotal}`,
    `pmtiles_routing_duration_ms_total ${metrics.routingDurationMsTotal}`
  ].join("\n");
}
