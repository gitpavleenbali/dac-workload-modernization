import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelemetryServer } from '../src/server.mjs';

test('Grid telemetry API healthz, idempotent ingestion, and grid status endpoints', async () => {
  const server = createTelemetryServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const healthResp = await fetch(`${base}/healthz`);
    assert.equal(healthResp.status, 200);
    const health = await healthResp.json();
    assert.equal(health.status, 'healthy');

    const reading = {
      substationId: 'sub-de-west-04',
      frequencyHz: 49.98,
      voltageKv: 380.4,
      timestamp: '2026-11-21T01:00:00Z'
    };

    const post1 = await fetch(`${base}/v1/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reading)
    });
    assert.equal(post1.status, 202);
    const body1 = await post1.json();
    assert.equal(body1.deduplicated, false);

    // Retry same reading -> idempotent deduplication
    const post2 = await fetch(`${base}/v1/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reading)
    });
    assert.equal(post2.status, 200);
    const body2 = await post2.json();
    assert.equal(body2.deduplicated, true);

    const statusResp = await fetch(`${base}/v1/grid/status`);
    const gridStatus = await statusResp.json();
    assert.equal(gridStatus.latestReading.substationId, 'sub-de-west-04');

    // Verify v2.0 async Service Bus batch endpoint
    const batchResp = await fetch(`${base}/v1/telemetry/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        readings: [
          reading,
          { substationId: 'sub-de-north-09', frequencyHz: 50.03, timestamp: '2026-11-21T01:00:05Z' }
        ]
      })
    });
    assert.equal(batchResp.status, 202);
    const batchBody = await batchResp.json();
    assert.equal(batchBody.acceptedCount, 1);
    assert.equal(batchBody.deduplicatedCount, 1);
    assert.equal(batchBody.queuedToServiceBus, 'sb-grid-telemetry/telemetry-events');

    // Verify v2.2 automated dispatch curtailment endpoint
    const curtailResp = await fetch(`${base}/v1/dispatch/curtailment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ substationId: 'sub-de-west-04', targetReductionMw: 45 })
    });
    assert.equal(curtailResp.status, 202);
    const curtailBody = await curtailResp.json();
    assert.equal(curtailBody.dispatched, true);
    assert.equal(curtailBody.targetReductionMw, 45);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
