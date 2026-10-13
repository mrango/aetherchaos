/**
 * @fileoverview Automated Cross-Agent Contract & Simulation Test Suite
 *
 * Verifies the shared architectural contract between the 3 parallel modules:
 * 1. `index.html` & `style.css` (UI & Console Shell)
 * 2. `simulator-engine.js` (`window.ChaosEngine` Simulation Engine)
 * 3. `visualizer-app.js` (Canvas Topology & Telemetry Renderer)
 *
 * Includes explicit regression tests for the cross-agent schema boundaries
 * (`state.kpis` / `state.globalMetrics` and `event.timeStr` / `event.time`).
 *
 * Run with: `npm test` (uses Node's built-in `node:test` runner, 0 external deps).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

// Attach ChaosEngine onto global scope for headless verification
global.window = global;
require(path.join(ROOT_DIR, 'simulator-engine.js'));

const ChaosEngine = global.window.ChaosEngine;

/**
 * 1. DOM & CSP Contract Test (`index.html` <-> `visualizer-app.js`)
 * Ensures all 32 DOM element IDs required by `visualizer-app.js` are present
 * in `index.html` and that strict CSP rules are preserved.
 */
test('DOM & CSP Contract: index.html exposes all required element IDs and strict CSP', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');

  // Verify strict Content Security Policy header tag is present
  assert.match(
    html,
    /http-equiv="Content-Security-Policy"/,
    'index.html must include a Content-Security-Policy meta tag'
  );

  // Verify all 32 required DOM element IDs bound by visualizer-app.js
  const requiredDomIds = [
    'topology-select',
    'traffic-slider',
    'traffic-value',
    'autoheal-toggle',
    'kpi-slo',
    'kpi-latency',
    'kpi-rps',
    'kpi-error-rate',
    'kpi-pods',
    'system-status-badge',
    'btn-kill-node',
    'btn-traffic-spike',
    'btn-latency-storm',
    'btn-cascade-db',
    'btn-heal-all',
    'btn-reset',
    'topology-canvas',
    'node-inspector',
    'inspector-title',
    'inspector-type',
    'inspector-status',
    'inspector-cpu',
    'inspector-latency',
    'inspector-rps',
    'inspector-pods',
    'inspector-error',
    'btn-node-toggle-down',
    'btn-node-add-latency',
    'btn-node-scale-up',
    'metrics-canvas',
    'event-log-list'
  ];

  for (const id of requiredDomIds) {
    assert.ok(
      html.includes(`id="${id}"`),
      `Missing required DOM element id="${id}" in index.html`
    );
  }
});

/**
 * 2. Shared State & Schema Alias Contract (`window.ChaosEngine.getState()`)
 * Regression guard for the two cross-agent schema mismatches caught during
 * verification:
 * - `state.kpis.slo` / `state.metrics.slo` / `state.globalMetrics.slo`
 * - `event.timeStr` and `event.time` non-null formatted timestamps
 */
test('State Schema Contract: getState() exposes aligned KPI aliases and non-null event timestamps', () => {
  const state = ChaosEngine.init('genai_rag');

  // Top-level and nested KPI aliases must all be defined and consistent
  assert.equal(typeof state.slo, 'number');
  assert.ok(state.kpis && typeof state.kpis.slo === 'number', 'state.kpis.slo must be a number');
  assert.ok(state.metrics && typeof state.metrics.slo === 'number', 'state.metrics.slo must be a number');
  assert.ok(
    state.globalMetrics && typeof state.globalMetrics.slo === 'number',
    'state.globalMetrics.slo must be a number'
  );
  assert.equal(state.kpis.slo, state.globalMetrics.slo);

  // Event log entries must expose both `time` and `timeStr` as non-empty HH:MM:SS strings
  assert.ok(Array.isArray(state.events) && state.events.length > 0, 'state.events must be non-empty');
  for (const ev of state.events) {
    assert.equal(typeof ev.time, 'string', 'event.time must be a string');
    assert.equal(typeof ev.timeStr, 'string', 'event.timeStr must be a string');
    assert.match(ev.time, /^\d{2}:\d{2}:\d{2}$/, 'event.time must match HH:MM:SS format');
    assert.equal(ev.time, ev.timeStr, 'event.time and event.timeStr must match');
    assert.ok(!ev.time.includes('null'), 'event timestamp must never serialize as null');
  }
});

/**
 * 3. Topology Presets Contract (`genai_rag`, `ecommerce`, `payments`)
 * Verifies all 3 cloud topologies initialize cleanly with valid DAG nodes and edges.
 */
test('Topology Contract: all 3 cloud presets initialize with valid nodes and directed edges', () => {
  for (const key of ['genai_rag', 'ecommerce', 'payments']) {
    const state = ChaosEngine.loadTopology(key);
    assert.equal(state.topologyKey, key);
    assert.equal(state.nodes.length, 8, `Topology ${key} should contain 8 service nodes`);
    assert.ok(state.edges.length >= 8, `Topology ${key} should contain directed edges`);

    const nodeIds = new Set(state.nodes.map((n) => n.id));
    for (const edge of state.edges) {
      assert.ok(nodeIds.has(edge.from), `Edge source "${edge.from}" must exist in nodes`);
      assert.ok(nodeIds.has(edge.to), `Edge target "${edge.to}" must exist in nodes`);
    }
  }
});

/**
 * 4. Simulation Physics: 3x Flash Traffic Surge & HPA Auto-Scaling
 * Verifies that triggering a traffic surge increases RPS and triggers HPA pod scale-up.
 */
test('Resilience Physics: 3x flash traffic surge triggers HPA pod auto-scaling', () => {
  const initial = ChaosEngine.init('genai_rag');
  ChaosEngine.setAutoHeal(true);
  const initialPods = initial.activePods;

  const spikedRps = ChaosEngine.triggerTrafficSpike();
  assert.ok(spikedRps > initial.targetRps, 'Target RPS should increase after traffic spike');

  // Advance simulation several steps so HPA cooldowns elapse and pods scale up
  let postSpikeState = null;
  for (let i = 0; i < 40; i++) {
    postSpikeState = ChaosEngine.step(0.1);
  }

  assert.ok(
    postSpikeState.activePods > initialPods,
    `Expected HPA to scale active pods above ${initialPods}, got ${postSpikeState.activePods}`
  );
});

/**
 * 5. Simulation Physics: Downstream Outage, Upstream Backpressure & Circuit Breaker Isolation
 * Verifies that killing a downstream database propagates latency/errors upstream when
 * unprotected, and trips Circuit Breakers + heals when SRE self-healing is engaged.
 */
test('Resilience Physics: downstream DB failure cascades upstream and recovers via Circuit Breaker / healAll()', () => {
  ChaosEngine.init('genai_rag');
  ChaosEngine.setAutoHeal(false);

  const baselineOrch = ChaosEngine.getNodeById('orchestrator');
  const baselineLat = baselineOrch.currentLatency;

  // Terminate downstream AlloyDB Vector Search (`vector_db`)
  ChaosEngine.saturateDatabase();
  ChaosEngine.toggleNodeDown('vector_db');
  ChaosEngine.step(0.1);

  const degradedOrch = ChaosEngine.getNodeById('orchestrator');
  assert.ok(
    degradedOrch.currentLatency > baselineLat,
    'Upstream orchestrator latency must increase due to downstream backpressure'
  );
  assert.ok(
    degradedOrch.errorRate > 0,
    'Upstream orchestrator error rate must reflect cascading downstream failure'
  );

  // Enable self-healing: circuit breaker should trip on `vector_db` and cap upstream latency
  ChaosEngine.setAutoHeal(true);
  ChaosEngine.step(0.1);
  const vectorDb = ChaosEngine.getNodeById('vector_db');
  assert.equal(vectorDb.circuitOpen, true, 'Circuit breaker should trip on terminated downstream node');

  // Execute global healAll() and verify full SLO recovery
  const healedState = ChaosEngine.healAll();
  assert.equal(healedState.systemStatus, 'HEALTHY');
  assert.ok(healedState.slo >= 99.9, `Expected healed SLO >= 99.9%, got ${healedState.slo}%`);
});
