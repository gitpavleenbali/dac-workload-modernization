import http from 'node:http';

/**
 * Create the Grid Telemetry HTTP API server (v2.0 Cloud-Native AKS + Service Bus batch support).
 */
export function createTelemetryServer(options = {}) {
  const maxBuffer = options.maxBuffer || 200;
  const ringBuffer = [];
  const seenReadings = new Set();
  const runtimeMode = process.env.KUBERNETES_SERVICE_HOST ? 'aks-kubernetes' : 'container-local';

  const sendJson = (res, statusCode, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
  };

  const ingestOne = (payload) => {
    if (!payload.substationId || typeof payload.frequencyHz !== 'number' || !payload.timestamp) {
      return { valid: false };
    }
    const dedupeKey = `${payload.substationId}:${payload.timestamp}`;
    if (seenReadings.has(dedupeKey)) {
      return { valid: true, deduplicated: true, key: dedupeKey };
    }
    seenReadings.add(dedupeKey);
    const record = {
      substationId: payload.substationId,
      frequencyHz: payload.frequencyHz,
      voltageKv: payload.voltageKv ?? 380,
      timestamp: payload.timestamp,
      ingestedAt: new Date().toISOString()
    };
    ringBuffer.push(record);
    if (ringBuffer.length > maxBuffer) ringBuffer.shift();
    return { valid: true, deduplicated: false, record };
  };

  return http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/healthz') {
      return sendJson(res, 200, {
        status: 'healthy',
        version: '2.0.0',
        service: 'grid-telemetry-service',
        runtimeMode,
        bufferedReadings: ringBuffer.length
      });
    }

    if (req.method === 'GET' && url.pathname === '/v1/grid/status') {
      const latest = ringBuffer.at(-1) || null;
      return sendJson(res, 200, {
        gridZone: process.env.GRID_ZONE || 'eu-central-1',
        nominalFrequencyHz: 50.0,
        activeAlerts: ringBuffer.filter((r) => r.frequencyHz < 49.8 || r.frequencyHz > 50.2).length,
        latestReading: latest
      });
    }

    if (req.method === 'GET' && url.pathname === '/v1/telemetry/recent') {
      return sendJson(res, 200, {
        count: ringBuffer.length,
        items: ringBuffer.slice(-25)
      });
    }

    if (req.method === 'POST' && url.pathname === '/v1/telemetry') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        try {
          const out = ingestOne(JSON.parse(raw || '{}'));
          if (!out.valid) {
            return sendJson(res, 400, { error: 'Required fields: substationId, frequencyHz (number), timestamp' });
          }
          return sendJson(res, out.deduplicated ? 200 : 202, { accepted: true, ...out });
        } catch {
          return sendJson(res, 400, { error: 'Invalid JSON request body' });
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/telemetry/batch') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        try {
          const payload = JSON.parse(raw || '{}');
          if (!Array.isArray(payload.readings) || payload.readings.length === 0) {
            return sendJson(res, 400, { error: 'Expected non-empty readings[] array' });
          }
          let acceptedCount = 0;
          let deduplicatedCount = 0;
          for (const item of payload.readings) {
            const out = ingestOne(item);
            if (!out.valid) return sendJson(res, 400, { error: 'Invalid reading in batch' });
            if (out.deduplicated) deduplicatedCount++;
            else acceptedCount++;
          }
          return sendJson(res, 202, {
            queuedToServiceBus: 'sb-grid-telemetry/telemetry-events',
            acceptedCount,
            deduplicatedCount
          });
        } catch {
          return sendJson(res, 400, { error: 'Invalid JSON request body' });
        }
      });
      return;
    }

    return sendJson(res, 404, { error: 'Not Found' });
  });
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const port = Number(process.env.PORT || 8080);
  const srv = createTelemetryServer();
  srv.listen(port, () => {
    console.log(`grid-telemetry-service v2.0 listening on port ${port}`);
  });
}
