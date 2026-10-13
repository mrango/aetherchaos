/**
 * @fileoverview Cloud Chaos & Architecture Simulator — Core Physics & Resilience Engine
 *
 * Implements a real-time distributed systems queueing, cascading failure propagation,
 * circuit-breaking, and Horizontal Pod Autoscaler (HPA) simulation engine for cloud-native
 * GCP and Vertex AI Gemini 4 Argon architectures.
 *
 * Security & Quality Compliance:
 * - Zero direct HTML string injection or unsafe DOM properties.
 * - Zero dynamic code execution or runtime string compilation.
 * - Zero browser web storage usage or blocking native modal dialogs.
 * - Strict allow-list validation and numeric clamping on all external inputs.
 */

(function initChaosEngineModule(globalScope) {
  'use strict';

  // ============================================================================
  // 1. SIMULATION CONSTANTS & NUMERIC BOUNDS
  // ============================================================================

  /**
   * Allowed topology identifier keys for strict input validation.
   * @type {ReadonlyArray<string>}
   */
  const ALLOWED_TOPOLOGIES = Object.freeze(['genai_rag', 'ecommerce', 'payments']);

  /**
   * Numeric boundaries used to clamp all user and chaos inputs safely.
   */
  const BOUNDS = Object.freeze({
    MIN_TARGET_RPS: 50,
    MAX_TARGET_RPS: 5000,
    DEFAULT_TARGET_RPS: 1250,
    MIN_DT_SECONDS: 0.001,
    MAX_DT_SECONDS: 0.25,
    MIN_INJECTED_LATENCY_MS: 0,
    MAX_INJECTED_LATENCY_MS: 3500,
    MIN_PODS_FLOOR: 1,
    MAX_PODS_CEILING: 64,
    MAX_HISTORY_POINTS: 60,
    MAX_EVENT_LOG_ENTRIES: 80,
    MAX_ACTIVE_PACKETS: 220,
    HISTORY_SAMPLE_INTERVAL_SEC: 0.5
  });

  /**
   * Enumerated node operational statuses.
   */
  const NODE_STATUS = Object.freeze({
    HEALTHY: 'HEALTHY',
    DEGRADED: 'DEGRADED',
    CRITICAL: 'CRITICAL',
    DOWN: 'DOWN',
    CIRCUIT_OPEN: 'CIRCUIT_OPEN'
  });

  // ============================================================================
  // 2. PRESET ARCHITECTURE TOPOLOGIES
  // ============================================================================

  /**
   * Complete definitions for the 3 cloud architecture topologies:
   * - `genai_rag`: Gemini 4 Argon RAG & Vertex Pipeline
   * - `ecommerce`: GCP E-Commerce Cloud Native
   * - `payments`: Global FinTech Payment Mesh
   */
  const TOPOLOGY_PRESETS = Object.freeze({
    genai_rag: {
      key: 'genai_rag',
      name: 'Gemini 4 Argon RAG & Vertex Pipeline',
      description: 'Low-latency enterprise retrieval-augmented generation pipeline with semantic caching, AlloyDB vector search, and Vertex AI Gemini 4 Argon.',
      defaultRps: 1250,
      nodes: [
        {
          id: 'ingress',
          name: 'Cloud Armor Edge LB',
          category: 'Ingress',
          x: 0.10,
          y: 0.50,
          baseLatency: 6,
          pods: 6,
          minPods: 3,
          maxPods: 20,
          capacityPerPod: 420
        },
        {
          id: 'apigee',
          name: 'Apigee API Gateway',
          category: 'Gateway',
          x: 0.28,
          y: 0.30,
          baseLatency: 11,
          pods: 5,
          minPods: 2,
          maxPods: 16,
          capacityPerPod: 260
        },
        {
          id: 'auth',
          name: 'IAM & Token Guard',
          category: 'Security',
          x: 0.28,
          y: 0.70,
          baseLatency: 9,
          pods: 4,
          minPods: 2,
          maxPods: 14,
          capacityPerPod: 280
        },
        {
          id: 'orchestrator',
          name: 'RAG Query Orchestrator',
          category: 'Compute',
          x: 0.50,
          y: 0.50,
          baseLatency: 18,
          pods: 6,
          minPods: 3,
          maxPods: 24,
          capacityPerPod: 310
        },
        {
          id: 'gemini4',
          name: 'Vertex AI Gemini 4 Argon',
          category: 'AI Model',
          x: 0.72,
          y: 0.22,
          baseLatency: 68,
          pods: 6,
          minPods: 2,
          maxPods: 22,
          capacityPerPod: 165
        },
        {
          id: 'vector_db',
          name: 'AlloyDB Vector Search',
          category: 'Database',
          x: 0.72,
          y: 0.50,
          baseLatency: 16,
          pods: 5,
          minPods: 2,
          maxPods: 16,
          capacityPerPod: 240
        },
        {
          id: 'redis',
          name: 'Memorystore Semantic Cache',
          category: 'Cache',
          x: 0.72,
          y: 0.78,
          baseLatency: 4,
          pods: 4,
          minPods: 2,
          maxPods: 12,
          capacityPerPod: 380
        },
        {
          id: 'bq_sink',
          name: 'BigQuery Telemetry Sink',
          category: 'Analytics',
          x: 0.90,
          y: 0.50,
          baseLatency: 14,
          pods: 5,
          minPods: 2,
          maxPods: 18,
          capacityPerPod: 340
        }
      ],
      edges: [
        { id: 'e_ing_apigee', from: 'ingress', to: 'apigee', weight: 0.65 },
        { id: 'e_ing_auth', from: 'ingress', to: 'auth', weight: 0.55 },
        { id: 'e_api_orch', from: 'apigee', to: 'orchestrator', weight: 0.62 },
        { id: 'e_auth_orch', from: 'auth', to: 'orchestrator', weight: 0.52 },
        { id: 'e_orch_gemini', from: 'orchestrator', to: 'gemini4', weight: 0.56 },
        { id: 'e_orch_vec', from: 'orchestrator', to: 'vector_db', weight: 0.66 },
        { id: 'e_orch_redis', from: 'orchestrator', to: 'redis', weight: 0.78 },
        { id: 'e_gem_bq', from: 'gemini4', to: 'bq_sink', weight: 0.48 },
        { id: 'e_vec_bq', from: 'vector_db', to: 'bq_sink', weight: 0.36 },
        { id: 'e_red_bq', from: 'redis', to: 'bq_sink', weight: 0.28 }
      ]
    },

    ecommerce: {
      key: 'ecommerce',
      name: 'GCP E-Commerce Cloud Native',
      description: 'High-throughput global retail storefront backed by Cloud CDN, GKE microservices, Memorystore Redis, and Cloud Spanner.',
      defaultRps: 1450,
      nodes: [
        {
          id: 'ingress',
          name: 'Cloud CDN & Global LB',
          category: 'Ingress',
          x: 0.10,
          y: 0.50,
          baseLatency: 5,
          pods: 6,
          minPods: 3,
          maxPods: 22,
          capacityPerPod: 450
        },
        {
          id: 'api_gw',
          name: 'API Gateway Mesh',
          category: 'Gateway',
          x: 0.28,
          y: 0.30,
          baseLatency: 10,
          pods: 5,
          minPods: 2,
          maxPods: 18,
          capacityPerPod: 310
        },
        {
          id: 'auth_svc',
          name: 'Auth & Session Service',
          category: 'Security',
          x: 0.28,
          y: 0.70,
          baseLatency: 8,
          pods: 4,
          minPods: 2,
          maxPods: 14,
          capacityPerPod: 300
        },
        {
          id: 'catalog_svc',
          name: 'Catalog Service',
          category: 'Compute',
          x: 0.50,
          y: 0.30,
          baseLatency: 14,
          pods: 5,
          minPods: 2,
          maxPods: 20,
          capacityPerPod: 290
        },
        {
          id: 'checkout_gke',
          name: 'Checkout GKE Service',
          category: 'Compute',
          x: 0.50,
          y: 0.70,
          baseLatency: 21,
          pods: 5,
          minPods: 2,
          maxPods: 20,
          capacityPerPod: 240
        },
        {
          id: 'redis_cache',
          name: 'Memorystore Redis',
          category: 'Cache',
          x: 0.72,
          y: 0.26,
          baseLatency: 3,
          pods: 4,
          minPods: 2,
          maxPods: 14,
          capacityPerPod: 420
        },
        {
          id: 'spanner_primary',
          name: 'Cloud Spanner Primary',
          category: 'Database',
          x: 0.72,
          y: 0.68,
          baseLatency: 15,
          pods: 6,
          minPods: 2,
          maxPods: 18,
          capacityPerPod: 250
        },
        {
          id: 'pubsub_fulfill',
          name: 'Pub/Sub Fulfillment',
          category: 'Analytics',
          x: 0.90,
          y: 0.50,
          baseLatency: 12,
          pods: 5,
          minPods: 2,
          maxPods: 18,
          capacityPerPod: 350
        }
      ],
      edges: [
        { id: 'e_ec_ing_api', from: 'ingress', to: 'api_gw', weight: 0.68 },
        { id: 'e_ec_ing_auth', from: 'ingress', to: 'auth_svc', weight: 0.50 },
        { id: 'e_ec_api_cat', from: 'api_gw', to: 'catalog_svc', weight: 0.66 },
        { id: 'e_ec_api_chk', from: 'api_gw', to: 'checkout_gke', weight: 0.42 },
        { id: 'e_ec_auth_chk', from: 'auth_svc', to: 'checkout_gke', weight: 0.52 },
        { id: 'e_ec_cat_red', from: 'catalog_svc', to: 'redis_cache', weight: 0.75 },
        { id: 'e_ec_cat_spn', from: 'catalog_svc', to: 'spanner_primary', weight: 0.38 },
        { id: 'e_ec_chk_spn', from: 'checkout_gke', to: 'spanner_primary', weight: 0.70 },
        { id: 'e_ec_red_pub', from: 'redis_cache', to: 'pubsub_fulfill', weight: 0.30 },
        { id: 'e_ec_spn_pub', from: 'spanner_primary', to: 'pubsub_fulfill', weight: 0.62 }
      ]
    },

    payments: {
      key: 'payments',
      name: 'Global FinTech Payment Mesh',
      description: 'Mission-critical zero-trust payment settlement architecture with AI fraud scoring, Cloud HSM vault, and multi-region Spanner ledger.',
      defaultRps: 1100,
      nodes: [
        {
          id: 'ingress',
          name: 'Global Front Door',
          category: 'Ingress',
          x: 0.10,
          y: 0.50,
          baseLatency: 7,
          pods: 6,
          minPods: 3,
          maxPods: 20,
          capacityPerPod: 380
        },
        {
          id: 'fraud_ai',
          name: 'Fraud Detection AI',
          category: 'AI Model',
          x: 0.28,
          y: 0.28,
          baseLatency: 28,
          pods: 5,
          minPods: 2,
          maxPods: 18,
          capacityPerPod: 220
        },
        {
          id: 'hsm_vault',
          name: 'HSM Crypto Vault',
          category: 'Security',
          x: 0.28,
          y: 0.72,
          baseLatency: 12,
          pods: 4,
          minPods: 2,
          maxPods: 14,
          capacityPerPod: 260
        },
        {
          id: 'payment_router',
          name: 'Payment Router',
          category: 'Gateway',
          x: 0.50,
          y: 0.32,
          baseLatency: 11,
          pods: 5,
          minPods: 2,
          maxPods: 18,
          capacityPerPod: 280
        },
        {
          id: 'ledger_core',
          name: 'Ledger Core',
          category: 'Compute',
          x: 0.50,
          y: 0.68,
          baseLatency: 19,
          pods: 6,
          minPods: 3,
          maxPods: 22,
          capacityPerPod: 230
        },
        {
          id: 'spanner_multi',
          name: 'Cloud Spanner Multi-Region',
          category: 'Database',
          x: 0.72,
          y: 0.32,
          baseLatency: 22,
          pods: 6,
          minPods: 2,
          maxPods: 20,
          capacityPerPod: 220
        },
        {
          id: 'audit_log',
          name: 'Kafka/PubSub Audit Log',
          category: 'Cache',
          x: 0.72,
          y: 0.72,
          baseLatency: 8,
          pods: 5,
          minPods: 2,
          maxPods: 16,
          capacityPerPod: 320
        },
        {
          id: 'settlement_worker',
          name: 'Settlement Worker',
          category: 'Analytics',
          x: 0.90,
          y: 0.50,
          baseLatency: 17,
          pods: 5,
          minPods: 2,
          maxPods: 18,
          capacityPerPod: 290
        }
      ],
      edges: [
        { id: 'e_pay_ing_frd', from: 'ingress', to: 'fraud_ai', weight: 0.68 },
        { id: 'e_pay_ing_hsm', from: 'ingress', to: 'hsm_vault', weight: 0.56 },
        { id: 'e_pay_frd_rtr', from: 'fraud_ai', to: 'payment_router', weight: 0.66 },
        { id: 'e_pay_hsm_rtr', from: 'hsm_vault', to: 'payment_router', weight: 0.38 },
        { id: 'e_pay_hsm_ldg', from: 'hsm_vault', to: 'ledger_core', weight: 0.52 },
        { id: 'e_pay_rtr_ldg', from: 'payment_router', to: 'ledger_core', weight: 0.64 },
        { id: 'e_pay_rtr_spn', from: 'payment_router', to: 'spanner_multi', weight: 0.48 },
        { id: 'e_pay_ldg_spn', from: 'ledger_core', to: 'spanner_multi', weight: 0.68 },
        { id: 'e_pay_ldg_aud', from: 'ledger_core', to: 'audit_log', weight: 0.72 },
        { id: 'e_pay_spn_stl', from: 'spanner_multi', to: 'settlement_worker', weight: 0.56 },
        { id: 'e_pay_aud_stl', from: 'audit_log', to: 'settlement_worker', weight: 0.46 }
      ]
    }
  });

  // ============================================================================
  // 3. UTILITY & MATHEMATICAL HELPER FUNCTIONS
  // ============================================================================

  /**
   * Clamps a numeric value safely within [min, max].
   * Falls back to `fallback` if the input is not a finite number.
   *
   * @param {number} value - Raw numeric input.
   * @param {number} min - Minimum allowed value.
   * @param {number} max - Maximum allowed value.
   * @param {number} [fallback=min] - Fallback value if NaN/infinite.
   * @returns {number} Clamped finite number.
   */
  function clampNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return fallback !== undefined ? fallback : min;
    }
    return Math.min(max, Math.max(min, num));
  }

  /**
   * Rounds a floating-point number to a fixed number of decimal places.
   *
   * @param {number} value - Input value.
   * @param {number} [decimals=1] - Number of decimal digits.
   * @returns {number} Rounded number.
   */
  function roundTo(value, decimals) {
    const places = decimals === undefined ? 1 : decimals;
    const factor = Math.pow(10, places);
    return Math.round(value * factor) / factor;
  }

  /**
   * Formats the current simulation clock or system time as HH:MM:SS.mmm for SRE logs.
   *
   * @returns {string} Formatted timestamp string.
   */
  function formatTimestamp() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return hh + ':' + mm + ':' + ss;
  }

  // ============================================================================
  // 4. CHAOS ENGINE CLASS IMPLEMENTATION
  // ============================================================================

  /**
   * Core simulation engine managing topology graph state, M/M/1 queueing physics,
   * backward cascading failure propagation, HPA auto-scaling, and animated traffic packets.
   */
  class ChaosSimulatorEngine {
    constructor() {
      /** @type {string} Active topology preset identifier */
      this.topologyKey = 'genai_rag';

      /** @type {string} Human-readable name of active topology */
      this.topologyName = TOPOLOGY_PRESETS.genai_rag.name;

      /** @type {string} Subtitle description of active topology */
      this.topologyDescription = TOPOLOGY_PRESETS.genai_rag.description;

      /** @type {number} Target incoming requests per second at the Ingress node */
      this.targetRps = BOUNDS.DEFAULT_TARGET_RPS;

      /** @type {boolean} Whether SRE Self-Healing (HPA + Circuit Breakers) is enabled */
      this.autoHeal = true;

      /** @type {Array<Object>} Active service nodes in the topology */
      this.nodes = [];

      /** @type {Array<Object>} Directed dependency edges connecting nodes */
      this.edges = [];

      /** @type {Array<Object>} Animated request packets traversing edges */
      this.packets = [];

      /** @type {Array<Object>} Rolling time-series history (max 60 points) */
      this.metricsHistory = [];

      /** @type {Array<Object>} Structured SRE & Chaos event feed */
      this.events = [];

      /** @type {Array<function>} Optional subscriber callbacks for SRE events */
      this.eventListeners = [];

      /** @type {number} Total elapsed simulation time in seconds */
      this.simTime = 0;

      /** @type {number} Accumulator for sampling metricsHistory every 0.5s */
      this.historyAccumulator = 0;

      /** @type {number} Monotonically increasing packet identifier counter */
      this.packetSeq = 1;

      /** @type {number} Monotonically increasing event identifier counter */
      this.eventSeq = 1;

      /**
       * Global system-wide KPI summary metrics.
       */
      this.kpis = {
        slo: 99.99,
        p99Latency: 42,
        totalRps: BOUNDS.DEFAULT_TARGET_RPS,
        errorRate: 0,
        activePods: 0,
        maxPods: 0,
        systemStatus: NODE_STATUS.HEALTHY
      };

      // Initialize default topology on instantiation
      this.init('genai_rag');
    }

    /**
     * Validates a topology key against `ALLOWED_TOPOLOGIES`.
     *
     * @param {string} key - Candidate topology key.
     * @returns {string} Validated topology key (falls back to 'genai_rag').
     */
    validateTopologyKey(key) {
      if (typeof key === 'string' && ALLOWED_TOPOLOGIES.indexOf(key) !== -1) {
        return key;
      }
      return 'genai_rag';
    }

    /**
     * Appends an SRE / Chaos operational event to the internal log and notifies listeners.
     *
     * @param {string} level - Severity level ('info' | 'warn' | 'error' | 'success' | 'chaos').
     * @param {string} message - Human-readable operational log message.
     * @param {string} [nodeId='system'] - Related node identifier if applicable.
     * @returns {Object} Newly created event entry.
     */
    recordEvent(level, message, nodeId) {
      const safeLevel = ['info', 'warn', 'error', 'success', 'chaos'].indexOf(level) !== -1
        ? level
        : 'info';
      const safeMessage = String(message || '').slice(0, 280);
      const tsStr = formatTimestamp();
      const entry = {
        id: 'evt_' + (this.eventSeq++),
        timestamp: Date.now(),
        time: tsStr,
        timeStr: tsStr,
        level: safeLevel,
        type: safeLevel,
        nodeId: typeof nodeId === 'string' ? nodeId : 'system',
        message: safeMessage
      };

      this.events.unshift(entry);
      if (this.events.length > BOUNDS.MAX_EVENT_LOG_ENTRIES) {
        this.events.length = BOUNDS.MAX_EVENT_LOG_ENTRIES;
      }

      for (let i = 0; i < this.eventListeners.length; i++) {
        try {
          this.eventListeners[i](entry);
        } catch (_err) {
          // Fail safely without interrupting simulation physics
        }
      }
      return entry;
    }

    /**
     * Registers a listener function invoked whenever a new SRE or Chaos event is logged.
     *
     * @param {function} callback - Listener receiving `(eventEntry)`.
     */
    onEvent(callback) {
      if (typeof callback === 'function') {
        this.eventListeners.push(callback);
      }
    }

    /**
     * Initializes the simulator with the specified topology key.
     *
     * @param {string} [topologyKey='genai_rag'] - Preset topology identifier.
     * @returns {Object} Current full engine state snapshot.
     */
    init(topologyKey) {
      const validKey = this.validateTopologyKey(topologyKey || 'genai_rag');
      return this.loadTopology(validKey);
    }

    /**
     * Loads a preset topology cleanly, resetting node states, packets, and metrics history.
     *
     * @param {string} topologyKey - Preset key ('genai_rag' | 'ecommerce' | 'payments').
     * @returns {Object} Current full engine state snapshot.
     */
    loadTopology(topologyKey) {
      const validKey = this.validateTopologyKey(topologyKey);
      const preset = TOPOLOGY_PRESETS[validKey];

      this.topologyKey = validKey;
      this.topologyName = preset.name;
      this.topologyDescription = preset.description;
      this.targetRps = preset.defaultRps;
      this.simTime = 0;
      this.historyAccumulator = 0;
      this.packets = [];
      this.metricsHistory = [];

      // Instantiate fresh Node State objects conforming to the Node State Schema
      this.nodes = preset.nodes.map(function createNodeState(def) {
        return {
          id: def.id,
          name: def.name,
          category: def.category,
          x: def.x,
          y: def.y,
          baseLatency: def.baseLatency,
          currentLatency: def.baseLatency,
          cpuLoad: 32,
          rps: 0,
          errorRate: 0,
          status: NODE_STATUS.HEALTHY,
          pods: def.pods,
          minPods: def.minPods,
          maxPods: def.maxPods,
          capacityPerPod: def.capacityPerPod,
          injectedLatency: 0,
          isKilled: false,
          circuitOpen: false,
          scaleCooldown: 0,
          initialPods: def.pods
        };
      });

      // Instantiate directed edges with both from/to and source/target aliases
      this.edges = preset.edges.map(function createEdgeState(edgeDef) {
        return {
          id: edgeDef.id,
          from: edgeDef.from,
          to: edgeDef.to,
          source: edgeDef.from,
          target: edgeDef.to,
          weight: edgeDef.weight,
          trafficRps: 0,
          status: 'ok'
        };
      });

      // Run an initial physics step to populate realistic baseline metrics & history
      this.step(0.05);
      this.seedInitialHistory();

      this.recordEvent(
        'info',
        'Loaded topology "' + preset.name + '" at ' + this.targetRps + ' RPS baseline.',
        'ingress'
      );

      return this.getState();
    }

    /**
     * Pre-populates 20 baseline points in `metricsHistory` so telemetry charts
     * render a rich continuous line immediately upon topology load.
     */
    seedInitialHistory() {
      this.metricsHistory = [];
      for (let i = 19; i >= 0; i--) {
        const jitterRps = Math.round(this.kpis.totalRps * (0.985 + (i % 3) * 0.008));
        const jitterLat = Math.round(this.kpis.p99Latency * (0.97 + (i % 4) * 0.012));
        this.metricsHistory.push({
          timestamp: Date.now() - i * 500,
          simTime: roundTo(Math.max(0, this.simTime - i * 0.5), 1),
          slo: this.kpis.slo,
          p99Latency: jitterLat,
          totalRps: jitterRps,
          targetRps: this.targetRps,
          errorRate: this.kpis.errorRate,
          activePods: this.kpis.activePods,
          systemStatus: this.kpis.systemStatus
        });
      }
    }

    /**
     * Finds and returns a node object by its validated ID, or null if not found.
     *
     * @param {string} nodeId - Node identifier string.
     * @returns {Object|null} Matching node state object or null.
     */
    getNodeById(nodeId) {
      if (typeof nodeId !== 'string' || !nodeId) {
        return null;
      }
      for (let i = 0; i < this.nodes.length; i++) {
        if (this.nodes[i].id === nodeId) {
          return this.nodes[i];
        }
      }
      return null;
    }

    /**
     * Sets the target incoming requests per second (RPS) at the Ingress layer.
     *
     * @param {number} rps - Desired target RPS (clamped to [50, 5000]).
     * @returns {number} Newly applied clamped target RPS.
     */
    setTargetRps(rps) {
      this.targetRps = Math.round(
        clampNumber(rps, BOUNDS.MIN_TARGET_RPS, BOUNDS.MAX_TARGET_RPS, this.targetRps)
      );
      return this.targetRps;
    }

    /**
     * Enables or disables autonomous SRE self-healing (HPA scaling & Circuit Breakers).
     *
     * @param {boolean} enabled - True to enable self-healing, false to disable.
     * @returns {boolean} Updated autoHeal flag.
     */
    setAutoHeal(enabled) {
      const nextState = Boolean(enabled);
      if (this.autoHeal !== nextState) {
        this.autoHeal = nextState;
        this.recordEvent(
          nextState ? 'success' : 'warn',
          'SRE Self-Healing & HPA Auto-Scaling ' + (nextState ? 'ENABLED' : 'DISABLED') + '.',
          'system'
        );
      }
      return this.autoHeal;
    }

    // ==========================================================================
    // 5. SIMULATION PHYSICS & CASCADING FAILURE ENGINE (`step(dtSeconds)`)
    // ==========================================================================

    /**
     * Advances the distributed systems simulation by `dtSeconds`.
     *
     * Physics pipeline:
     * 1. Forward Pass: Propagate RPS from Ingress along directed edges.
     * 2. Local Resource Pass: Calculate each node's `cpuLoad` (%) from `rps / (pods * capacityPerPod)`
     *    and compute M/M/1 non-linear queueing latency when `cpuLoad > 70%`.
     * 3. Reverse Topological Pass (Cascading Failure Propagation):
     *    Propagate downstream latency amplification, thread-pool queue saturation,
     *    and partial error rates back to upstream callers—unless `circuitOpen` is active,
     *    which caps latency amplification and fast-fails degraded downstream paths.
     * 4. Self-Healing & HPA Pass (`autoHeal === true`):
     *    - Automatically scales pods up when `cpuLoad > 78%` and `pods < maxPods`.
     *    - Trips circuit breakers (`circuitOpen = true`) when downstream is killed or `errorRate > 65%`.
     *    - Gradually decays `injectedLatency` and recovers circuit breakers once downstream heals.
     * 5. Packet Animation Pass: Spawns and advances visual packets along edges.
     * 6. Global KPI & Telemetry Snapshot Pass: Computes `slo`, `p99Latency`, `totalRps`,
     *    `errorRate`, `activePods`, `maxPods`, and `systemStatus`.
     *
     * @param {number} [dtSeconds=0.05] - Elapsed frame delta in seconds.
     * @returns {Object} Current full engine state snapshot.
     */
    step(dtSeconds) {
      const dt = clampNumber(
        dtSeconds,
        BOUNDS.MIN_DT_SECONDS,
        BOUNDS.MAX_DT_SECONDS,
        0.05
      );
      this.simTime += dt;

      // Build fast lookup map by node ID
      const nodeMap = Object.create(null);
      for (let i = 0; i < this.nodes.length; i++) {
        const node = this.nodes[i];
        nodeMap[node.id] = node;
        // Decrement HPA scaling cooldown timer
        if (node.scaleCooldown > 0) {
          node.scaleCooldown = Math.max(0, node.scaleCooldown - dt);
        }
        // Natural gradual decay of transient latency storms (faster when autoHeal is active)
        if (node.injectedLatency > 0) {
          const decayRate = this.autoHeal ? 28 : 6;
          node.injectedLatency = Math.max(0, node.injectedLatency - decayRate * dt);
        }
      }

      // ------------------------------------------------------------------------
      // PASS 1: Forward Traffic Propagation (Ingress -> Downstream DAG)
      // ------------------------------------------------------------------------
      for (let i = 0; i < this.nodes.length; i++) {
        this.nodes[i].rps = 0;
      }

      // Subtle organic micro-jitter (+/- 1.5%) for realistic live telemetry feel
      const waveJitter = 1 + Math.sin(this.simTime * 2.7) * 0.012;
      const ingressNode = this.nodes[0];
      if (ingressNode) {
        ingressNode.rps = Math.round(this.targetRps * waveJitter);
      }

      // Propagate RPS across directed edges in topological order
      for (let i = 0; i < this.edges.length; i++) {
        const edge = this.edges[i];
        const sourceNode = nodeMap[edge.from];
        const targetNode = nodeMap[edge.to];
        if (!sourceNode || !targetNode) {
          continue;
        }

        // If source node is completely DOWN, it forwards 0 traffic
        if (sourceNode.isKilled) {
          edge.trafficRps = 0;
          edge.status = 'error';
          continue;
        }

        // Calculate fraction of source requests surviving to downstream edge
        const sourceSuccessRatio = Math.max(0.15, 1 - (sourceNode.errorRate || 0) / 140);
        // If target has an open circuit breaker, only a 12% health-probe canary trickle is sent
        const circuitThrottle = targetNode.circuitOpen ? 0.12 : 1.0;

        const edgeFlow = Math.round(
          sourceNode.rps * edge.weight * sourceSuccessRatio * circuitThrottle
        );
        edge.trafficRps = edgeFlow;
        targetNode.rps += edgeFlow;
      }

      // ------------------------------------------------------------------------
      // PASS 2: Local CPU Load, M/M/1 Queueing Latency, and Local Error Rate
      // ------------------------------------------------------------------------
      for (let i = 0; i < this.nodes.length; i++) {
        const node = this.nodes[i];

        if (node.isKilled) {
          node.cpuLoad = 0;
          node.currentLatency = 0;
          node.errorRate = 100;
          node.status = NODE_STATUS.DOWN;
          continue;
        }

        // Total processing capacity across active pods
        const totalCapacity = Math.max(1, node.pods * node.capacityPerPod);

        // Raw CPU utilization percentage = (rps / capacity) * 100
        const rawCpuPct = (node.rps / totalCapacity) * 100;

        // Injected latency also increases thread hold times, adding virtual CPU pressure
        const latencyHoldPenalty = (node.injectedLatency / 100) * 6.5;
        node.cpuLoad = roundTo(clampNumber(rawCpuPct + latencyHoldPenalty, 4, 100, 10), 1);

        // Non-linear M/M/1-inspired queueing latency curve when cpuLoad > 70%
        let queueingDelayMs = 0;
        if (node.cpuLoad > 70) {
          // Normalized overload ratio in [0, 1.5]
          const overloadFactor = (rawCpuPct - 70) / 30;
          // Exponential/rational M/M/1 congestion growth
          queueingDelayMs =
            node.baseLatency * (1.8 * Math.pow(Math.max(0, overloadFactor), 2.15)) +
            Math.max(0, rawCpuPct - 85) * 9.5;
        } else {
          // Mild linear scaling below 70% utilization
          queueingDelayMs = node.baseLatency * (node.cpuLoad / 100) * 0.35;
        }

        node.currentLatency = Math.round(
          clampNumber(
            node.baseLatency + queueingDelayMs + node.injectedLatency,
            node.baseLatency,
            4800,
            node.baseLatency
          )
        );

        // Local overload and timeout-induced error rate
        let localErrorPct = 0;
        if (rawCpuPct > 92) {
          // Shedding requests when capacity is exceeded
          localErrorPct += (rawCpuPct - 92) * 1.65;
        }
        if (node.currentLatency > 420) {
          // Request deadline exceeded errors
          localErrorPct += (node.currentLatency - 420) * 0.065;
        }
        node.errorRate = roundTo(clampNumber(localErrorPct, 0, 100, 0), 1);
      }

      // ------------------------------------------------------------------------
      // PASS 3: Reverse Dependency Pass (Cascading Failure Propagation)
      // ------------------------------------------------------------------------
      // Traverse edges in reverse order so downstream failures cascade upstream
      // through multi-hop call chains (e.g., AlloyDB -> Orchestrator -> Apigee -> Ingress).
      for (let i = this.edges.length - 1; i >= 0; i--) {
        const edge = this.edges[i];
        const upstream = nodeMap[edge.from];
        const downstream = nodeMap[edge.to];
        if (!upstream || !downstream || upstream.isKilled) {
          continue;
        }

        const coupling = edge.weight;

        if (downstream.isKilled) {
          if (downstream.circuitOpen) {
            // Circuit Breaker OPEN: Fail-fast / fallback protects caller from thread exhaustion!
            // Caller only pays a tiny 12ms fast-fail check and mild degraded fallback error rate.
            upstream.currentLatency = Math.round(upstream.currentLatency + 12 * coupling);
            upstream.errorRate = roundTo(
              clampNumber(upstream.errorRate + 14 * coupling, 0, 100, 0),
              1
            );
            edge.status = 'slow';
          } else {
            // Unprotected Downstream DOWN: Connection timeouts exhaust upstream worker pools!
            upstream.currentLatency = Math.round(upstream.currentLatency + 420 * coupling);
            upstream.cpuLoad = roundTo(
              clampNumber(upstream.cpuLoad + 28 * coupling, 0, 100, 0),
              1
            );
            upstream.errorRate = roundTo(
              clampNumber(upstream.errorRate + 58 * coupling, 0, 100, 0),
              1
            );
            edge.status = 'error';
          }
        } else {
          // Downstream is alive, check if it is experiencing high latency or errors
          const downstreamExcessLatency = Math.max(
            0,
            downstream.currentLatency - downstream.baseLatency * 1.6
          );

          if (downstream.circuitOpen) {
            // Circuit breaker caps upstream latency amplification to a safe ceiling
            const cappedPenalty = Math.min(35, downstreamExcessLatency * 0.15) * coupling;
            upstream.currentLatency = Math.round(upstream.currentLatency + cappedPenalty);
            upstream.errorRate = roundTo(
              clampNumber(upstream.errorRate + downstream.errorRate * 0.18 * coupling, 0, 100, 0),
              1
            );
            edge.status = 'slow';
          } else {
            // Propagate downstream latency and queue backpressure into upstream caller
            if (downstreamExcessLatency > 25) {
              upstream.currentLatency = Math.round(
                upstream.currentLatency + downstreamExcessLatency * 0.58 * coupling
              );
              // Blocked upstream threads waiting on slow downstream I/O increase CPU/thread pressure
              const backpressureLoad = Math.min(26, (downstreamExcessLatency / 18) * coupling);
              upstream.cpuLoad = roundTo(
                clampNumber(upstream.cpuLoad + backpressureLoad, 0, 100, 0),
                1
              );
            }

            if (downstream.errorRate > 2) {
              upstream.errorRate = roundTo(
                clampNumber(upstream.errorRate + downstream.errorRate * 0.52 * coupling, 0, 100, 0),
                1
              );
            }

            if (downstream.errorRate > 35 || downstream.currentLatency > 320) {
              edge.status = 'error';
            } else if (downstream.currentLatency > 140 || downstream.cpuLoad > 78) {
              edge.status = 'slow';
            } else {
              edge.status = 'ok';
            }
          }
        }
      }

      // ------------------------------------------------------------------------
      // PASS 4: SRE Self-Healing, HPA Auto-Scaling & Circuit Breaker State Machine
      // ------------------------------------------------------------------------
      for (let i = 0; i < this.nodes.length; i++) {
        const node = this.nodes[i];

        if (this.autoHeal) {
          // 4a. Trip Circuit Breaker when node is killed or suffering severe error rate (> 65%)
          if ((node.isKilled || node.errorRate > 65) && !node.circuitOpen) {
            node.circuitOpen = true;
            this.recordEvent(
              'warn',
              'Circuit Breaker TRIPPED on ' + node.name + ' (isolating upstream callers from cascading timeouts).',
              node.id
            );
          }

          // 4b. Auto-close Circuit Breaker when node is healthy again
          if (node.circuitOpen && !node.isKilled && node.errorRate < 22 && node.currentLatency < 220) {
            node.circuitOpen = false;
            this.recordEvent(
              'success',
              'Circuit Breaker CLOSED on ' + node.name + ' after health probes succeeded.',
              node.id
            );
          }

          // 4c. Horizontal Pod Autoscaler (HPA): Scale UP when cpuLoad > 78% and pods < maxPods
          if (
            !node.isKilled &&
            node.cpuLoad > 78 &&
            node.pods < node.maxPods &&
            node.scaleCooldown <= 0
          ) {
            const stepPods = node.cpuLoad > 92 ? 2 : 1;
            node.pods = Math.min(node.maxPods, node.pods + stepPods);
            node.scaleCooldown = 1.6; // 1.6s cooldown between HPA scale-up actions
            this.recordEvent(
              'success',
              'HPA scaled ' + node.name + ' to ' + node.pods + ' pods (CPU ' + Math.round(node.cpuLoad) + '%).',
              node.id
            );
          }
        }

        // 4d. Determine final discrete Node Status for rendering
        if (node.isKilled) {
          node.status = node.circuitOpen ? NODE_STATUS.CIRCUIT_OPEN : NODE_STATUS.DOWN;
        } else if (node.circuitOpen) {
          node.status = NODE_STATUS.CIRCUIT_OPEN;
        } else if (node.errorRate >= 35 || node.cpuLoad >= 92 || node.currentLatency >= 420) {
          node.status = NODE_STATUS.CRITICAL;
        } else if (node.errorRate >= 8 || node.cpuLoad >= 75 || node.currentLatency >= 180) {
          node.status = NODE_STATUS.DEGRADED;
        } else {
          node.status = NODE_STATUS.HEALTHY;
        }
      }

      // ------------------------------------------------------------------------
      // PASS 5: Animated Network Packets (`packets`)
      // ------------------------------------------------------------------------
      this.updatePackets(dt, nodeMap);

      // ------------------------------------------------------------------------
      // PASS 6: Global KPIs & Rolling History Snapshot
      // ------------------------------------------------------------------------
      this.computeGlobalKpis();

      this.historyAccumulator += dt;
      if (this.historyAccumulator >= BOUNDS.HISTORY_SAMPLE_INTERVAL_SEC) {
        this.historyAccumulator = 0;
        this.metricsHistory.push({
          timestamp: Date.now(),
          simTime: roundTo(this.simTime, 1),
          slo: this.kpis.slo,
          p99Latency: this.kpis.p99Latency,
          totalRps: this.kpis.totalRps,
          targetRps: this.targetRps,
          errorRate: this.kpis.errorRate,
          activePods: this.kpis.activePods,
          systemStatus: this.kpis.systemStatus
        });
        if (this.metricsHistory.length > BOUNDS.MAX_HISTORY_POINTS) {
          this.metricsHistory.shift();
        }
      }

      return this.getState();
    }

    /**
     * Spawns and advances visual request packets along directed edges proportional
     * to each edge's live traffic and health status.
     *
     * @param {number} dt - Elapsed simulation step in seconds.
     * @param {Object} nodeMap - Dictionary mapping node ID to node state.
     */
    updatePackets(dt, nodeMap) {
      // Advance existing packets and keep those with progress < 1.0
      const survivingPackets = [];
      for (let i = 0; i < this.packets.length; i++) {
        const pkt = this.packets[i];
        pkt.progress += pkt.speed * dt;
        if (pkt.progress < 1.0) {
          survivingPackets.push(pkt);
        }
      }
      this.packets = survivingPackets;

      // Spawn new packets across active edges proportional to edge traffic
      for (let i = 0; i < this.edges.length; i++) {
        if (this.packets.length >= BOUNDS.MAX_ACTIVE_PACKETS) {
          break;
        }
        const edge = this.edges[i];
        const sourceNode = nodeMap[edge.from];
        const targetNode = nodeMap[edge.to];
        if (!sourceNode || !targetNode || sourceNode.isKilled) {
          continue;
        }

        // Spawn probability scales with trafficRps
        const normalizedTraffic = clampNumber(edge.trafficRps / 950, 0.08, 2.2, 0.25);
        const spawnProb = normalizedTraffic * dt * 5.2;

        if (Math.random() < spawnProb) {
          let pktStatus = 'ok';
          let speed = 0.72 + Math.random() * 0.22;

          if (targetNode.isKilled || edge.status === 'error' || targetNode.errorRate > 35) {
            pktStatus = 'error';
            speed = 0.42 + Math.random() * 0.15;
          } else if (
            targetNode.circuitOpen ||
            edge.status === 'slow' ||
            targetNode.currentLatency > 160 ||
            targetNode.cpuLoad > 78
          ) {
            pktStatus = 'slow';
            speed = 0.48 + Math.random() * 0.16;
          }

          this.packets.push({
            id: 'pkt_' + (this.packetSeq++),
            edgeId: edge.id,
            from: edge.from,
            to: edge.to,
            source: edge.from,
            target: edge.to,
            progress: Math.random() * 0.08,
            speed: speed,
            status: pktStatus
          });
        }
      }
    }

    /**
     * Aggregates node telemetry into global system KPIs (`slo`, `p99Latency`,
     * `totalRps`, `errorRate`, `activePods`, `maxPods`, `systemStatus`).
     */
    computeGlobalKpis() {
      let totalActivePods = 0;
      let totalMaxPods = 0;
      let weightedLatencySum = 0;
      let maxNodeLatency = 0;
      let weightedErrorSum = 0;
      let totalWeight = 0;
      let criticalCount = 0;
      let degradedCount = 0;

      for (let i = 0; i < this.nodes.length; i++) {
        const node = this.nodes[i];
        if (!node.isKilled) {
          totalActivePods += node.pods;
        }
        totalMaxPods += node.maxPods;

        const nodeWeight = Math.max(1, node.rps);
        totalWeight += nodeWeight;

        const effectiveNodeLatency = node.isKilled
          ? (node.circuitOpen ? 85 : 650)
          : node.currentLatency;
        weightedLatencySum += effectiveNodeLatency * nodeWeight;
        if (effectiveNodeLatency > maxNodeLatency) {
          maxNodeLatency = effectiveNodeLatency;
        }

        weightedErrorSum += node.errorRate * nodeWeight;

        if (node.status === NODE_STATUS.DOWN || node.status === NODE_STATUS.CRITICAL) {
          criticalCount++;
        } else if (
          node.status === NODE_STATUS.DEGRADED ||
          node.status === NODE_STATUS.CIRCUIT_OPEN
        ) {
          degradedCount++;
        }
      }

      const ingressNode = this.nodes[0];
      const avgLatency = totalWeight > 0 ? weightedLatencySum / totalWeight : 40;
      // End-to-end P99 tail latency combines pipeline stage average with tail hotspot
      const p99Latency = Math.round(
        clampNumber(avgLatency * 1.45 + maxNodeLatency * 0.52, 18, 4999, 45)
      );

      // System error rate blends ingress caller-perceived errors and weighted service errors
      const weightedError = totalWeight > 0 ? weightedErrorSum / totalWeight : 0;
      const ingressError = ingressNode ? ingressNode.errorRate : 0;
      const systemErrorRate = roundTo(
        clampNumber(ingressError * 0.55 + weightedError * 0.45, 0, 100, 0),
        2
      );

      // SLO burn calculation: 99.99% at zero error & normal latency, dropping down to 60.00%
      const latencySloPenalty = Math.max(0, (p99Latency - 180) * 0.0045);
      const errorSloPenalty = systemErrorRate * 0.42;
      const computedSlo = roundTo(
        clampNumber(99.99 - errorSloPenalty - latencySloPenalty, 60.0, 99.99, 99.99),
        2
      );

      let systemStatus = NODE_STATUS.HEALTHY;
      if (criticalCount > 0 || systemErrorRate >= 15 || computedSlo < 95.0) {
        systemStatus = NODE_STATUS.CRITICAL;
      } else if (degradedCount > 0 || systemErrorRate >= 2 || p99Latency > 220) {
        systemStatus = NODE_STATUS.DEGRADED;
      }

      const effectiveIngressRps = ingressNode && !ingressNode.isKilled ? ingressNode.rps : 0;

      this.kpis = {
        slo: computedSlo,
        p99Latency: p99Latency,
        totalRps: effectiveIngressRps,
        errorRate: systemErrorRate,
        activePods: totalActivePods,
        maxPods: totalMaxPods,
        systemStatus: systemStatus
      };
    }

    // ==========================================================================
    // 6. CHAOS ACTION & INTERACTIVE CONTROL METHODS
    // ==========================================================================

    /**
     * Randomly terminates a non-Ingress healthy service pod cluster to demonstrate
     * fault isolation, cascading impact, and circuit breaker protection.
     *
     * @returns {Object|null} The killed node state object, or null if all nodes are already down.
     */
    killRandomNode() {
      // Prefer non-ingress alive nodes so traffic can still enter the graph
      const candidates = this.nodes.filter(function filterAliveNonIngress(n, idx) {
        return idx > 0 && !n.isKilled;
      });
      const pool = candidates.length > 0
        ? candidates
        : this.nodes.filter(function filterAnyAlive(n) { return !n.isKilled; });

      if (pool.length === 0) {
        this.recordEvent('warn', 'All service nodes are already terminated.', 'system');
        return null;
      }

      const victim = pool[Math.floor(Math.random() * pool.length)];
      victim.isKilled = true;
      victim.circuitOpen = false;
      victim.cpuLoad = 0;
      victim.errorRate = 100;
      victim.status = NODE_STATUS.DOWN;

      this.recordEvent(
        'chaos',
        'CHAOS ACTION: Terminated node "' + victim.name + '" (SIGKILL pod outage).',
        victim.id
      );

      this.step(0.05);
      return victim;
    }

    /**
     * Multiplies `targetRps` by 2.8x (clamped up to 5000 RPS) to simulate a DDoS
     * or viral flash-crowd traffic surge.
     *
     * @returns {number} Newly applied `targetRps`.
     */
    triggerTrafficSpike() {
      const previousRps = this.targetRps;
      const spikedRps = Math.min(
        BOUNDS.MAX_TARGET_RPS,
        Math.round(this.targetRps * 2.8)
      );
      this.targetRps = Math.max(BOUNDS.MIN_TARGET_RPS, spikedRps);

      this.recordEvent(
        'chaos',
        'CHAOS ACTION: Flash Traffic Spike triggered (' + previousRps + ' -> ' + this.targetRps + ' RPS).',
        'ingress'
      );

      this.step(0.05);
      return this.targetRps;
    }

    /**
     * Injects +280ms to +450ms of synthetic network/compute jitter across multiple
     * core nodes to simulate noisy-neighbor contention or regional packet loss.
     *
     * @returns {Array<string>} List of affected node names.
     */
    triggerLatencyStorm() {
      const affectedNames = [];
      for (let i = 1; i < this.nodes.length; i++) {
        const node = this.nodes[i];
        if (!node.isKilled && (i % 2 === 1 || node.category === 'AI Model' || node.category === 'Compute')) {
          const jitterMs = Math.round(280 + Math.random() * 170);
          node.injectedLatency = clampNumber(
            node.injectedLatency + jitterMs,
            BOUNDS.MIN_INJECTED_LATENCY_MS,
            BOUNDS.MAX_INJECTED_LATENCY_MS,
            jitterMs
          );
          affectedNames.push(node.name);
        }
      }

      this.recordEvent(
        'chaos',
        'CHAOS ACTION: Regional Latency Storm (+280ms to +450ms) injected across ' + affectedNames.join(', ') + '.',
        'system'
      );

      this.step(0.05);
      return affectedNames;
    }

    /**
     * Injects heavy I/O lock contention (+480ms latency) and drops active pods to `minPods`
     * on Database and Cache/Storage nodes to demonstrate upstream cascading queue buildup.
     *
     * @returns {Array<string>} List of saturated storage/database node names.
     */
    saturateDatabase() {
      const saturatedNodes = [];
      for (let i = 0; i < this.nodes.length; i++) {
        const node = this.nodes[i];
        if (
          node.category === 'Database' ||
          node.category === 'Cache' ||
          node.category === 'Analytics'
        ) {
          node.isKilled = false;
          node.pods = node.minPods;
          node.injectedLatency = clampNumber(
            node.injectedLatency + 480,
            BOUNDS.MIN_INJECTED_LATENCY_MS,
            BOUNDS.MAX_INJECTED_LATENCY_MS,
            480
          );
          node.scaleCooldown = 2.5;
          saturatedNodes.push(node.name);
        }
      }

      this.recordEvent(
        'chaos',
        'CHAOS ACTION: Database I/O Saturation & Connection Pool Exhaustion on ' + saturatedNodes.join(', ') + '.',
        'system'
      );

      this.step(0.05);
      return saturatedNodes;
    }

    /**
     * Revives all killed nodes, clears all injected latency, closes circuit breakers,
     * and restores healthy pod counts across the entire architecture.
     *
     * @returns {Object} Current full engine state snapshot.
     */
    healAll() {
      const preset = TOPOLOGY_PRESETS[this.topologyKey] || TOPOLOGY_PRESETS.genai_rag;
      for (let i = 0; i < this.nodes.length; i++) {
        const node = this.nodes[i];
        node.isKilled = false;
        node.injectedLatency = 0;
        node.circuitOpen = false;
        node.errorRate = 0;
        node.scaleCooldown = 0;

        // Ensure pods are at least initial baseline or scaled appropriately for current RPS
        const requiredPodsForLoad = Math.ceil(
          (this.targetRps * 0.65) / Math.max(1, node.capacityPerPod * 0.68)
        );
        node.pods = clampNumber(
          Math.max(node.initialPods || preset.nodes[i].pods, requiredPodsForLoad),
          node.minPods,
          node.maxPods,
          node.initialPods || 4
        );
        node.status = NODE_STATUS.HEALTHY;
      }

      this.recordEvent(
        'success',
        'SRE ACTION: Executed global healAll() — revived all nodes, flushed latency queues, and reset circuit breakers.',
        'system'
      );

      return this.step(0.05);
    }

    /**
     * Resets the current topology cleanly back to its initial baseline state.
     *
     * @returns {Object} Current full engine state snapshot.
     */
    reset() {
      return this.loadTopology(this.topologyKey);
    }

    /**
     * Toggles a specific node between `DOWN` (`isKilled = true`) and `HEALTHY` (`isKilled = false`).
     *
     * @param {string} nodeId - Target node identifier.
     * @returns {Object|null} Updated node state object or null if invalid ID.
     */
    toggleNodeDown(nodeId) {
      const node = this.getNodeById(nodeId);
      if (!node) {
        return null;
      }

      node.isKilled = !node.isKilled;
      if (node.isKilled) {
        node.circuitOpen = false;
        node.cpuLoad = 0;
        node.errorRate = 100;
        node.status = NODE_STATUS.DOWN;
        this.recordEvent(
          'chaos',
          'Node "' + node.name + '" manually terminated (DOWN).',
          node.id
        );
      } else {
        node.circuitOpen = false;
        node.errorRate = 0;
        node.status = NODE_STATUS.HEALTHY;
        this.recordEvent(
          'success',
          'Node "' + node.name + '" revived and rejoined cluster mesh.',
          node.id
        );
      }

      this.step(0.05);
      return node;
    }

    /**
     * Injects (or removes if negative) synthetic latency in milliseconds on a specific node.
     *
     * @param {string} nodeId - Target node identifier.
     * @param {number} [deltaMs=250] - Latency delta in milliseconds.
     * @returns {Object|null} Updated node state object or null if invalid ID.
     */
    injectNodeLatency(nodeId, deltaMs) {
      const node = this.getNodeById(nodeId);
      if (!node) {
        return null;
      }

      const delta = clampNumber(deltaMs !== undefined ? deltaMs : 250, -3500, 3500, 250);
      node.injectedLatency = Math.round(
        clampNumber(
          node.injectedLatency + delta,
          BOUNDS.MIN_INJECTED_LATENCY_MS,
          BOUNDS.MAX_INJECTED_LATENCY_MS,
          0
        )
      );

      this.recordEvent(
        delta >= 0 ? 'warn' : 'info',
        'Adjusted injected latency on "' + node.name + '" by ' + (delta >= 0 ? '+' : '') + delta + 'ms (now +' + node.injectedLatency + 'ms).',
        node.id
      );

      this.step(0.05);
      return node;
    }

    /**
     * Manually scales a specific node's active replica pods by `deltaPods`,
     * clamped safely within `[node.minPods, node.maxPods]`.
     *
     * @param {string} nodeId - Target node identifier.
     * @param {number} [deltaPods=2] - Positive or negative pod adjustment.
     * @returns {Object|null} Updated node state object or null if invalid ID.
     */
    scaleNodePods(nodeId, deltaPods) {
      const node = this.getNodeById(nodeId);
      if (!node) {
        return null;
      }

      const delta = Math.round(clampNumber(deltaPods !== undefined ? deltaPods : 2, -32, 32, 2));
      const prevPods = node.pods;
      node.pods = clampNumber(
        node.pods + delta,
        node.minPods,
        node.maxPods,
        node.pods
      );

      this.recordEvent(
        'info',
        'Scaled "' + node.name + '" replicas from ' + prevPods + ' to ' + node.pods + ' pods (range ' + node.minPods + '-' + node.maxPods + ').',
        node.id
      );

      this.step(0.05);
      return node;
    }

    /**
     * Returns a complete, serializable snapshot of the simulator state including
     * topology metadata, nodes, edges, animated packets, global KPIs, rolling history,
     * and SRE event logs.
     *
     * @returns {Object} Complete simulation state object.
     */
    getState() {
      return {
        topologyKey: this.topologyKey,
        topologyName: this.topologyName,
        topologyDescription: this.topologyDescription,
        targetRps: this.targetRps,
        autoHeal: this.autoHeal,
        simTime: roundTo(this.simTime, 2),
        nodes: this.nodes,
        edges: this.edges,
        packets: this.packets,
        // Top-level KPI fields for direct access
        slo: this.kpis.slo,
        p99Latency: this.kpis.p99Latency,
        totalRps: this.kpis.totalRps,
        errorRate: this.kpis.errorRate,
        activePods: this.kpis.activePods,
        maxPods: this.kpis.maxPods,
        systemStatus: this.kpis.systemStatus,
        // Grouped KPI object aliases for flexible UI consumption
        kpis: this.kpis,
        metrics: this.kpis,
        globalMetrics: this.kpis,
        metricsHistory: this.metricsHistory,
        events: this.events,
        topologies: TOPOLOGY_PRESETS
      };
    }
  }

  // Instantiate singleton and expose on `window.ChaosEngine`
  const engineInstance = new ChaosSimulatorEngine();

  if (globalScope && typeof globalScope === 'object') {
    globalScope.ChaosEngine = engineInstance;
    globalScope.ChaosSimulatorEngine = ChaosSimulatorEngine;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = engineInstance;
  }
})(typeof window !== 'undefined' ? window : globalThis);
