/**
 * ============================================================================
 * AetherChaos — Cloud Chaos & Architecture Simulator
 * File: visualizer-app.js
 * Role: 60FPS HTML5 Canvas Topology Renderer, Real-Time Sparkline Telemetry
 *       Chart, and Strict-CSP Safe DOM Controller.
 *
 * Security & Code Quality Architecture:
 * - Strictly uses document.createElement(), textContent, classList, and
 *   element.replaceChildren() for all DOM updates.
 * - Zero unsafe HTML string sinks, dynamic code compilation, browser web
 *   storage, or blocking native dialog calls.
 * - Zero inline style mutations so strict Content-Security-Policy
 *   (style-src 'self'; script-src 'self') is never violated.
 * - All user inputs (topology keys, traffic slider values, node identifiers)
 *   are validated against strict allow-lists and numeric bounds.
 * ============================================================================
 */

(function () {
  'use strict';

  /* ==========================================================================
     1. CONSTANTS, ALLOW-LISTS & COLOR PALETTE CONFIGURATION
     Defines strict input validation constants, visual dimensions, and the
     SRE Mission Control color palette for nodes, edges, and packets.
     ========================================================================== */

  /** Allow-list of valid topology identifiers accepted by the selector */
  const ALLOWED_TOPOLOGIES = new Set(['genai_rag', 'ecommerce', 'payments']);

  /** Numeric bounds for the ingress traffic slider (requests per second) */
  const MIN_TRAFFIC_RPS = 200;
  const MAX_TRAFFIC_RPS = 5000;

  /** Maximum number of incident events rendered in the live SRE log list */
  const MAX_VISIBLE_EVENTS = 25;

  /** Interval in milliseconds between DOM text/KPI updates (~8.3 Hz) */
  const DOM_UPDATE_INTERVAL_MS = 120;

  /** Visual geometry constants for microservice node cards on the canvas */
  const NODE_CARD_WIDTH = 148;
  const NODE_CARD_HEIGHT = 76;
  const NODE_CORNER_RADIUS = 10;

  /** Color palette mapping for microservice node health states */
  const STATUS_PALETTE = {
    HEALTHY: {
      stroke: '#10b981',
      glow: 'rgba(16, 185, 129, 0.32)',
      badgeBg: 'rgba(16, 185, 129, 0.16)',
      text: '#34d399',
      label: 'HEALTHY',
      cssClass: 'status-healthy'
    },
    DEGRADED: {
      stroke: '#f59e0b',
      glow: 'rgba(245, 158, 11, 0.38)',
      badgeBg: 'rgba(245, 158, 11, 0.18)',
      text: '#fbbf24',
      label: 'DEGRADED',
      cssClass: 'status-degraded'
    },
    CRITICAL: {
      stroke: '#ef4444',
      glow: 'rgba(239, 68, 68, 0.45)',
      badgeBg: 'rgba(239, 68, 68, 0.22)',
      text: '#f87171',
      label: 'CRITICAL',
      cssClass: 'status-critical'
    },
    DOWN: {
      stroke: '#dc2626',
      glow: 'rgba(220, 38, 38, 0.52)',
      badgeBg: 'rgba(220, 38, 38, 0.28)',
      text: '#fca5a5',
      label: 'DOWN',
      cssClass: 'status-down'
    },
    CIRCUIT_OPEN: {
      stroke: '#a855f7',
      glow: 'rgba(168, 85, 247, 0.42)',
      badgeBg: 'rgba(168, 85, 247, 0.22)',
      text: '#c084fc',
      label: 'CIRCUIT OPEN',
      cssClass: 'status-circuit-open'
    }
  };

  /** Architectural tier column headers drawn across the topology canvas */
  const TIER_COLUMNS = [
    { label: 'INGRESS / EDGE', xRatio: 0.10 },
    { label: 'GATEWAY & AUTH', xRatio: 0.29 },
    { label: 'CORE / AI COMPUTE', xRatio: 0.56 },
    { label: 'DATA & TELEMETRY', xRatio: 0.84 }
  ];

  /* ==========================================================================
     2. VISUALIZER APPLICATION STATE
     Tracks the currently selected node, hover/drag state, animation clocks,
     visual shockwaves, and cached DOM element references.
     ========================================================================== */

  const appState = {
    /** Currently selected microservice node ID for the Node Inspector */
    selectedNodeId: null,
    /** Node ID currently under the user's mouse cursor */
    hoveredNodeId: null,
    /** Node ID currently being dragged by the user, or null */
    draggedNodeId: null,
    /** Flag indicating whether pointer movement exceeded click threshold */
    didDragMove: false,
    /** High-resolution timestamp of the previous animation frame */
    lastFrameTimeMs: performance.now(),
    /** High-resolution timestamp of the last throttled DOM update */
    lastDomUpdateTimeMs: 0,
    /** Continuous animation phase in seconds for pulsing rings and dashes */
    animTimeSec: 0,
    /** Signature string of the last rendered event log to avoid redundant DOM rebuilds */
    lastEventLogSignature: '',
    /** Active visual shockwave rings triggered by clicks or fault injections */
    ripples: [],
    /** Cached logical CSS dimensions for the topology canvas */
    topoLogicalWidth: 1100,
    topoLogicalHeight: 620,
    topoLastDpr: 1,
    /** Cached logical CSS dimensions for the sparkline metrics canvas */
    metricsLogicalWidth: 360,
    metricsLogicalHeight: 140,
    metricsLastDpr: 1
  };

  /** Dictionary of cached DOM elements populated on initialization */
  const dom = {};

  /* ==========================================================================
     3. SAFE DATA NORMALIZATION HELPERS
     Normalizes properties from window.ChaosEngine state so the visualizer
     operates reliably across all topology presets and engine structures.
     ========================================================================== */

  /**
   * Clamps a numeric value between a minimum and maximum bound.
   * @param {number} val - Input number to clamp.
   * @param {number} min - Lower bound.
   * @param {number} max - Upper bound.
   * @returns {number} Clamped numeric value.
   */
  function clamp(val, min, max) {
    const num = Number(val);
    if (!Number.isFinite(num)) {
      return min;
    }
    return Math.min(max, Math.max(min, num));
  }

  /**
   * Formats an integer or floating-point number with thousands separators.
   * @param {number} value - Number to format.
   * @returns {string} Locale-formatted integer string.
   */
  function formatInt(value) {
    const clean = Math.round(Number(value) || 0);
    return clean.toLocaleString('en-US');
  }

  /**
   * Retrieves the current engine state snapshot safely from window.ChaosEngine.
   * @returns {Object|null} Engine state object or null if engine is unavailable.
   */
  function getEngineState() {
    if (!window.ChaosEngine || typeof window.ChaosEngine.getState !== 'function') {
      return null;
    }
    return window.ChaosEngine.getState();
  }

  /**
   * Extracts normalized global KPI metrics from the simulation state.
   * Supports both flat state properties and nested `state.metrics` structures.
   * @param {Object} state - Raw state snapshot from window.ChaosEngine.
   * @returns {Object} Normalized KPI telemetry values.
   */
  function extractGlobalKpis(state) {
    const m = (state && state.metrics) ? state.metrics : (state || {});
    const slo = clamp(
      m.slo !== undefined ? m.slo : (state.slo !== undefined ? state.slo : 99.99),
      0,
      100
    );
    const p99Latency = Math.max(
      0,
      Math.round(
        m.p99Latency !== undefined
          ? m.p99Latency
          : (state.p99Latency !== undefined ? state.p99Latency : 42)
      )
    );
    const totalRps = Math.max(
      0,
      Math.round(
        m.totalRps !== undefined
          ? m.totalRps
          : (state.totalRps !== undefined
            ? state.totalRps
            : (state.targetRps !== undefined ? state.targetRps : 1400))
      )
    );
    const errorRate = clamp(
      m.errorRate !== undefined
        ? m.errorRate
        : (state.errorRate !== undefined ? state.errorRate : 0),
      0,
      100
    );
    const activePods = Math.max(
      0,
      Math.round(
        m.activePods !== undefined
          ? m.activePods
          : (state.activePods !== undefined ? state.activePods : 0)
      )
    );
    const maxPods = Math.max(
      activePods,
      Math.round(
        m.maxPods !== undefined
          ? m.maxPods
          : (state.maxPods !== undefined ? state.maxPods : 0)
      )
    );
    const systemStatus = String(
      m.systemStatus || state.systemStatus || 'HEALTHY'
    ).toUpperCase();

    return {
      slo,
      p99Latency,
      totalRps,
      errorRate,
      activePods,
      maxPods,
      systemStatus
    };
  }

  /**
   * Resolves the source and target node objects for a given directed edge.
   * Supports `{ from, to }` or `{ source, target }` edge schemas.
   * @param {Object} edge - Directed edge object from state.edges.
   * @param {Map<string, Object>} nodeMap - Lookup map of nodes by ID.
   * @returns {{ sourceNode: Object|null, targetNode: Object|null }} Resolved nodes.
   */
  function resolveEdgeNodes(edge, nodeMap) {
    if (!edge) {
      return { sourceNode: null, targetNode: null };
    }
    const fromId = edge.from || edge.source;
    const toId = edge.to || edge.target;
    return {
      sourceNode: nodeMap.get(fromId) || null,
      targetNode: nodeMap.get(toId) || null
    };
  }

  /* ==========================================================================
     4. HIGH-DPI (RETINA) CANVAS SCALING & GEOMETRY HELPERS
     Ensures razor-sharp rendering on macOS Retina screens without modifying
     inline style attributes (respecting strict CSP `style-src 'self'`).
     ========================================================================== */

  /**
   * Synchronizes a canvas element's internal backing store dimensions with its
   * CSS layout size multiplied by `window.devicePixelRatio`.
   * @param {HTMLCanvasElement} canvas - Target canvas element.
   * @param {CanvasRenderingContext2D} ctx - 2D rendering context.
   * @param {string} kind - Identifier ('topo' or 'metrics') for caching dimensions.
   * @returns {{ width: number, height: number }} Logical CSS pixel dimensions.
   */
  function syncCanvasDpi(canvas, ctx, kind) {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    const rect = canvas.getBoundingClientRect();

    // Determine logical CSS width & height from layout box, with safe fallbacks
    const fallbackWidth = kind === 'topo' ? 1100 : 360;
    const fallbackHeight = kind === 'topo' ? 620 : 140;
    const cssWidth = rect.width > 40 ? Math.round(rect.width) : fallbackWidth;
    const cssHeight = rect.height > 40 ? Math.round(rect.height) : fallbackHeight;

    const targetBufferWidth = Math.round(cssWidth * dpr);
    const targetBufferHeight = Math.round(cssHeight * dpr);

    // Resize internal canvas buffer only when layout dimensions or DPI change
    if (canvas.width !== targetBufferWidth || canvas.height !== targetBufferHeight) {
      canvas.width = targetBufferWidth;
      canvas.height = targetBufferHeight;
    }

    // Apply scale transform so all drawing operations use logical CSS coordinates
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (kind === 'topo') {
      appState.topoLogicalWidth = cssWidth;
      appState.topoLogicalHeight = cssHeight;
      appState.topoLastDpr = dpr;
    } else {
      appState.metricsLogicalWidth = cssWidth;
      appState.metricsLogicalHeight = cssHeight;
      appState.metricsLastDpr = dpr;
    }

    return { width: cssWidth, height: cssHeight };
  }

  /**
   * Converts a node's normalized `[0..1]` coordinates into logical canvas pixels.
   * @param {Object} node - Microservice node with `x` and `y` in `[0..1]`.
   * @param {number} width - Logical canvas width.
   * @param {number} height - Logical canvas height.
   * @returns {{ cx: number, cy: number }} Pixel center coordinates.
   */
  function getNodeCanvasCenter(node, width, height) {
    const horizontalPadding = 88;
    const verticalPadding = 58;
    const usableW = Math.max(200, width - horizontalPadding * 2);
    const usableH = Math.max(160, height - verticalPadding * 2);

    const normX = clamp(node.x !== undefined ? node.x : 0.5, 0.02, 0.98);
    const normY = clamp(node.y !== undefined ? node.y : 0.5, 0.05, 0.95);

    return {
      cx: horizontalPadding + ((normX - 0.10) / 0.80) * usableW,
      cy: verticalPadding + ((normY - 0.15) / 0.70) * usableH
    };
  }

  /**
   * Converts logical canvas pixel coordinates back into normalized `[0..1]`
   * node coordinates when the user drags a node on the stage.
   * @param {number} px - Canvas X coordinate in logical pixels.
   * @param {number} py - Canvas Y coordinate in logical pixels.
   * @param {number} width - Logical canvas width.
   * @param {number} height - Logical canvas height.
   * @returns {{ x: number, y: number }} Normalized node coordinates.
   */
  function canvasPixelsToNormalized(px, py, width, height) {
    const horizontalPadding = 88;
    const verticalPadding = 58;
    const usableW = Math.max(200, width - horizontalPadding * 2);
    const usableH = Math.max(160, height - verticalPadding * 2);

    const rawX = 0.10 + ((px - horizontalPadding) / usableW) * 0.80;
    const rawY = 0.15 + ((py - verticalPadding) / usableH) * 0.70;

    return {
      x: clamp(rawX, 0.06, 0.94),
      y: clamp(rawY, 0.10, 0.90)
    };
  }

  /**
   * Computes cubic Bezier control points between two node centers.
   * @param {number} x1 - Start X coordinate.
   * @param {number} y1 - Start Y coordinate.
   * @param {number} x2 - End X coordinate.
   * @param {number} y2 - End Y coordinate.
   * @returns {{ p0x: number, p0y: number, cp1x: number, cp1y: number, cp2x: number, cp2y: number, p3x: number, p3y: number }}
   */
  function computeEdgeBezier(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const isMostlyVertical = Math.abs(dx) < NODE_CARD_WIDTH * 0.75;

    if (isMostlyVertical) {
      // Connect top/bottom edges of vertically aligned nodes
      const signY = dy >= 0 ? 1 : -1;
      const p0x = x1;
      const p0y = y1 + signY * (NODE_CARD_HEIGHT * 0.48);
      const p3x = x2;
      const p3y = y2 - signY * (NODE_CARD_HEIGHT * 0.48);
      const midY = (p0y + p3y) * 0.5;
      return {
        p0x,
        p0y,
        cp1x: p0x + 28,
        cp1y: midY,
        cp2x: p3x + 28,
        cp2y: midY,
        p3x,
        p3y
      };
    }

    // Connect right side of upstream node to left side of downstream node
    const signX = dx >= 0 ? 1 : -1;
    const p0x = x1 + signX * (NODE_CARD_WIDTH * 0.48);
    const p0y = y1;
    const p3x = x2 - signX * (NODE_CARD_WIDTH * 0.48);
    const p3y = y2;
    const spanX = p3x - p0x;

    return {
      p0x,
      p0y,
      cp1x: p0x + spanX * 0.46,
      cp1y: p0y,
      cp2x: p0x + spanX * 0.54,
      cp2y: p3y,
      p3x,
      p3y
    };
  }

  /**
   * Evaluates a point `(x, y)` and tangent angle on a cubic Bezier curve at `t` in `[0, 1]`.
   * @param {Object} bz - Bezier control points from computeEdgeBezier.
   * @param {number} t - Normalized parameter along the curve `[0, 1]`.
   * @returns {{ x: number, y: number, angle: number }} Point and tangent angle in radians.
   */
  function evaluateCubicBezier(bz, t) {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;

    const x =
      uuu * bz.p0x +
      3 * uu * t * bz.cp1x +
      3 * u * tt * bz.cp2x +
      ttt * bz.p3x;
    const y =
      uuu * bz.p0y +
      3 * uu * t * bz.cp1y +
      3 * u * tt * bz.cp2y +
      ttt * bz.p3y;

    // First derivative for tangent orientation
    const dxdt =
      3 * uu * (bz.cp1x - bz.p0x) +
      6 * u * t * (bz.cp2x - bz.cp1x) +
      3 * tt * (bz.p3x - bz.cp2x);
    const dydt =
      3 * uu * (bz.cp1y - bz.p0y) +
      6 * u * t * (bz.cp2y - bz.cp1y) +
      3 * tt * (bz.p3y - bz.cp2y);

    return {
      x,
      y,
      angle: Math.atan2(dydt, dxdt)
    };
  }

  /**
   * Draws a rounded rectangle path on a 2D canvas context.
   * @param {CanvasRenderingContext2D} ctx - 2D canvas context.
   * @param {number} x - Top-left X coordinate.
   * @param {number} y - Top-left Y coordinate.
   * @param {number} w - Rectangle width.
   * @param {number} h - Rectangle height.
   * @param {number} r - Corner radius.
   */
  function traceRoundedRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  /**
   * Spawns an expanding shockwave ripple at a node's position for visual feedback.
   * @param {number} x - Center X coordinate in logical canvas pixels.
   * @param {number} y - Center Y coordinate in logical canvas pixels.
   * @param {string} color - CSS color string for the ripple ring.
   */
  function spawnRipple(x, y, color) {
    appState.ripples.push({
      x,
      y,
      radius: 28,
      maxRadius: 115,
      alpha: 0.85,
      color: color || '#00f5d4'
    });
  }

  /* ==========================================================================
     5. 60FPS TOPOLOGY CANVAS RENDERING PIPELINE (`#topology-canvas`)
     Renders the engineering grid, architectural tier lanes, directed cubic
     Bezier conduits, animated request packets, shockwaves, and telemetry cards.
     ========================================================================== */

  /**
   * Renders the dark engineering grid background, ambient radial glow,
   * architectural tier column headers, and coordinate markers.
   * @param {CanvasRenderingContext2D} ctx - 2D rendering context.
   * @param {number} width - Logical canvas width.
   * @param {number} height - Logical canvas height.
   * @param {Object} kpis - Normalized global KPIs for ambient posture tinting.
   */
  function renderEngineeringGrid(ctx, width, height, kpis) {
    // 1. Deep obsidian space backdrop
    ctx.fillStyle = '#060a12';
    ctx.fillRect(0, 0, width, height);

    // 2. Subtle ambient radial illumination reflecting global posture
    const radialGrad = ctx.createRadialGradient(
      width * 0.52,
      height * 0.50,
      30,
      width * 0.52,
      height * 0.50,
      Math.max(width, height) * 0.62
    );
    if (kpis.systemStatus === 'CRITICAL') {
      radialGrad.addColorStop(0, 'rgba(239, 68, 68, 0.08)');
      radialGrad.addColorStop(1, 'rgba(6, 10, 18, 0)');
    } else if (kpis.systemStatus === 'DEGRADED') {
      radialGrad.addColorStop(0, 'rgba(245, 158, 11, 0.07)');
      radialGrad.addColorStop(1, 'rgba(6, 10, 18, 0)');
    } else {
      radialGrad.addColorStop(0, 'rgba(0, 245, 212, 0.055)');
      radialGrad.addColorStop(1, 'rgba(6, 10, 18, 0)');
    }
    ctx.fillStyle = radialGrad;
    ctx.fillRect(0, 0, width, height);

    // 3. Engineering grid lines (40px pitch)
    const gridPitch = 40;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.045)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = gridPitch; x < width; x += gridPitch) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = gridPitch; y < height; y += gridPitch) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    // 4. Precision crosshair markers every 120px
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
    ctx.beginPath();
    for (let x = gridPitch * 3; x < width; x += gridPitch * 3) {
      for (let y = gridPitch * 3; y < height; y += gridPitch * 3) {
        ctx.moveTo(x - 3, y);
        ctx.lineTo(x + 3, y);
        ctx.moveTo(x, y - 3);
        ctx.lineTo(x, y + 3);
      }
    }
    ctx.stroke();

    // 5. Architectural tier column dividers and labels along the top
    ctx.save();
    ctx.font = '600 10px "JetBrains Mono", "Fira Code", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const dividerRatios = [0.20, 0.40, 0.65];
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.07)';
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    for (let i = 0; i < dividerRatios.length; i++) {
      const dx = Math.round(width * dividerRatios[i]);
      ctx.moveTo(dx, 14);
      ctx.lineTo(dx, height - 18);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    for (let i = 0; i < TIER_COLUMNS.length; i++) {
      const col = TIER_COLUMNS[i];
      const cx = width * col.xRatio;

      // Subtle pill header background
      const pillW = 132;
      const pillH = 18;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      traceRoundedRect(ctx, cx - pillW * 0.5, 10, pillW, pillH, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
      ctx.fillText(col.label, cx, 14);
    }

    // 6. Faint telemetry coordinate watermark in bottom-left corner
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.38)';
    ctx.font = '500 9.5px "JetBrains Mono", "Fira Code", monospace';
    ctx.fillText(
      'MESH: GKE-AUTOPILOT-MULTI-REGION // VECTOR ENGINE: 60FPS',
      14,
      height - 10
    );
    ctx.restore();
  }

  /**
   * Renders all directed cubic Bezier edges between microservice nodes,
   * dynamically reflecting downstream service health, circuit breaker gates,
   * and directional arrowheads.
   * @param {CanvasRenderingContext2D} ctx - 2D rendering context.
   * @param {Array<Object>} edges - Directed edges from engine state.
   * @param {Map<string, Object>} nodeMap - Map of node ID to node state.
   * @param {Map<string, {cx: number, cy: number}>} centerMap - Map of node ID to canvas coordinates.
   */
  function renderEdges(ctx, edges, nodeMap, centerMap) {
    if (!Array.isArray(edges)) {
      return;
    }

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const { sourceNode, targetNode } = resolveEdgeNodes(edge, nodeMap);
      if (!sourceNode || !targetNode) {
        continue;
      }

      const startPos = centerMap.get(sourceNode.id);
      const endPos = centerMap.get(targetNode.id);
      if (!startPos || !endPos) {
        continue;
      }

      const bz = computeEdgeBezier(startPos.cx, startPos.cy, endPos.cx, endPos.cy);
      const targetStatus = String(targetNode.status || 'HEALTHY').toUpperCase();
      const isCircuitOpen =
        Boolean(edge.circuitOpen) ||
        Boolean(targetNode.circuitOpen) ||
        targetStatus === 'CIRCUIT_OPEN';
      const isFailing =
        Boolean(targetNode.isKilled) ||
        targetStatus === 'DOWN' ||
        targetStatus === 'CRITICAL';
      const isDegraded = targetStatus === 'DEGRADED';

      ctx.save();

      // 1. Base structural conduit under-stroke
      ctx.beginPath();
      ctx.moveTo(bz.p0x, bz.p0y);
      ctx.bezierCurveTo(bz.cp1x, bz.cp1y, bz.cp2x, bz.cp2y, bz.p3x, bz.p3y);
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.85)';
      ctx.lineWidth = 3.5;
      ctx.stroke();

      // 2. Active health-colored inner Bezier curve
      ctx.beginPath();
      ctx.moveTo(bz.p0x, bz.p0y);
      ctx.bezierCurveTo(bz.cp1x, bz.cp1y, bz.cp2x, bz.cp2y, bz.p3x, bz.p3y);

      if (isCircuitOpen) {
        // Purple animated dashed line for active Circuit Breaker protection
        ctx.strokeStyle = 'rgba(168, 85, 247, 0.85)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = -appState.animTimeSec * 24;
      } else if (isFailing) {
        // Pulsing crimson line when downstream is DOWN or CRITICAL
        const pulse = 0.55 + 0.35 * Math.sin(appState.animTimeSec * 7);
        ctx.strokeStyle = 'rgba(239, 68, 68, ' + pulse.toFixed(2) + ')';
        ctx.lineWidth = 2.4;
        ctx.setLineDash([8, 5]);
        ctx.lineDashOffset = -appState.animTimeSec * 32;
      } else if (isDegraded) {
        // Amber dashed line when downstream experiences elevated latency
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.78)';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 4]);
        ctx.lineDashOffset = -appState.animTimeSec * 20;
      } else {
        // Healthy neon cyan/blue conduit
        ctx.strokeStyle = 'rgba(0, 245, 212, 0.38)';
        ctx.lineWidth = 1.8;
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // 3. Directional arrowhead near downstream node entry point
      const tipPoint = evaluateCubicBezier(bz, 0.96);
      const arrowLen = 7;
      ctx.save();
      ctx.translate(tipPoint.x, tipPoint.y);
      ctx.rotate(tipPoint.angle);
      ctx.beginPath();
      ctx.moveTo(2, 0);
      ctx.lineTo(-arrowLen, -arrowLen * 0.55);
      ctx.lineTo(-arrowLen, arrowLen * 0.55);
      ctx.closePath();
      if (isCircuitOpen) {
        ctx.fillStyle = '#a855f7';
      } else if (isFailing) {
        ctx.fillStyle = '#ef4444';
      } else if (isDegraded) {
        ctx.fillStyle = '#f59e0b';
      } else {
        ctx.fillStyle = '#00f5d4';
      }
      ctx.fill();
      ctx.restore();

      // 4. Midpoint badge when Circuit Breaker is tripped open on this route
      if (isCircuitOpen) {
        const mid = evaluateCubicBezier(bz, 0.5);
        const tagW = 54;
        const tagH = 15;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
        traceRoundedRect(ctx, mid.x - tagW * 0.5, mid.y - tagH * 0.5, tagW, tagH, 4);
        ctx.fill();
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#d8b4fe';
        ctx.font = '700 8.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('CB OPEN', mid.x, mid.y + 0.5);
      }

      ctx.restore();
    }
  }

  /**
   * Renders animated glowing telemetry packets traveling along the cubic Bezier
   * curves (`t = packet.progress`).
   * - `'ok'`: neon cyan `#00f5d4`
   * - `'slow'`: amber `#fbbf24`
   * - `'error'`: crimson `#f43f5e` with halo
   * @param {CanvasRenderingContext2D} ctx - 2D rendering context.
   * @param {Array<Object>} packets - Active packet objects from state.packets.
   * @param {Array<Object>} edges - Directed edges array from state.edges.
   * @param {Map<string, Object>} nodeMap - Map of node ID to node object.
   * @param {Map<string, {cx: number, cy: number}>} centerMap - Map of node ID to pixel center.
   */
  function renderPackets(ctx, packets, edges, nodeMap, centerMap) {
    if (!Array.isArray(packets) || packets.length === 0) {
      return;
    }

    ctx.save();
    for (let i = 0; i < packets.length; i++) {
      const pkt = packets[i];
      if (!pkt) {
        continue;
      }

      // Resolve source and target nodes either directly from packet or via edge index
      let fromId = pkt.from || pkt.sourceId || pkt.source;
      let toId = pkt.to || pkt.targetId || pkt.target;

      if ((!fromId || !toId) && pkt.edgeIndex !== undefined && edges[pkt.edgeIndex]) {
        const edge = edges[pkt.edgeIndex];
        fromId = edge.from || edge.source;
        toId = edge.to || edge.target;
      }

      const startPos = centerMap.get(fromId);
      const endPos = centerMap.get(toId);
      if (!startPos || !endPos) {
        continue;
      }

      const t = clamp(pkt.progress !== undefined ? pkt.progress : 0, 0, 1);
      const bz = computeEdgeBezier(startPos.cx, startPos.cy, endPos.cx, endPos.cy);
      const pos = evaluateCubicBezier(bz, t);
      const tailPos = evaluateCubicBezier(bz, Math.max(0, t - 0.045));

      const pktStatus = String(pkt.status || 'ok').toLowerCase();
      let coreColor = '#00f5d4';
      let haloColor = 'rgba(0, 245, 212, 0.28)';
      let radius = 3.2;

      if (pktStatus === 'error' || pktStatus === 'drop' || pktStatus === 'fail') {
        coreColor = '#f43f5e';
        haloColor = 'rgba(244, 63, 94, 0.38)';
        radius = 4.0;
      } else if (pktStatus === 'slow' || pktStatus === 'warn' || pktStatus === 'degraded') {
        coreColor = '#fbbf24';
        haloColor = 'rgba(251, 191, 36, 0.32)';
        radius = 3.5;
      }

      // 1. Comet motion trail segment
      ctx.beginPath();
      ctx.moveTo(tailPos.x, tailPos.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = haloColor;
      ctx.lineWidth = radius * 1.6;
      ctx.lineCap = 'round';
      ctx.stroke();

      // 2. Outer luminescent halo
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius * 2.2, 0, Math.PI * 2);
      ctx.fillStyle = haloColor;
      ctx.fill();

      // 3. Crisp bright packet core
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = coreColor;
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Advances and renders expanding shockwave ripples triggered by user clicks
   * or fault injections.
   * @param {CanvasRenderingContext2D} ctx - 2D rendering context.
   * @param {number} dtSec - Elapsed frame delta time in seconds.
   */
  function renderRipples(ctx, dtSec) {
    if (appState.ripples.length === 0) {
      return;
    }

    ctx.save();
    for (let i = appState.ripples.length - 1; i >= 0; i--) {
      const r = appState.ripples[i];
      r.radius += dtSec * 140;
      r.alpha -= dtSec * 1.15;

      if (r.alpha <= 0 || r.radius >= r.maxRadius) {
        appState.ripples.splice(i, 1);
        continue;
      }

      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = clamp(r.alpha, 0, 1);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Renders each microservice node as a futuristic SRE telemetry module with:
   * - Pulsing outer ring when selected or when HPA auto-scaling is active
   * - Status color border & glow (`HEALTHY`, `DEGRADED`, `CRITICAL`, `DOWN`, `CIRCUIT_OPEN`)
   * - Circular CPU utilization gauge arc around the service hub
   * - Crisp labels: Node Name, Category pill, Live Latency (`42ms` or `OFFLINE`),
   *   CPU (`68%`), and Pod Replicas badge (`4/12 pods`).
   * @param {CanvasRenderingContext2D} ctx - 2D rendering context.
   * @param {Array<Object>} nodes - Array of node objects from engine state.
   * @param {Map<string, {cx: number, cy: number}>} centerMap - Node pixel centers.
   */
  function renderNodes(ctx, nodes, centerMap) {
    if (!Array.isArray(nodes)) {
      return;
    }

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const pos = centerMap.get(node.id);
      if (!pos) {
        continue;
      }

      const cx = pos.cx;
      const cy = pos.cy;
      const x = cx - NODE_CARD_WIDTH * 0.5;
      const y = cy - NODE_CARD_HEIGHT * 0.5;

      const rawStatus = String(node.status || 'HEALTHY').toUpperCase();
      const palette = STATUS_PALETTE[rawStatus] || STATUS_PALETTE.HEALTHY;
      const isSelected = node.id === appState.selectedNodeId;
      const isHovered = node.id === appState.hoveredNodeId;
      const isScaling =
        (Number(node.scaleCooldown) > 0 || Number(node.cpuLoad) > 78) &&
        !node.isKilled &&
        rawStatus !== 'DOWN';

      ctx.save();

      // 1. Outer pulsing HPA Auto-Scaling halo when scaling is active
      if (isScaling) {
        const scalePulse = 4 + 4 * Math.sin(appState.animTimeSec * 6);
        traceRoundedRect(
          ctx,
          x - scalePulse,
          y - scalePulse,
          NODE_CARD_WIDTH + scalePulse * 2,
          NODE_CARD_HEIGHT + scalePulse * 2,
          NODE_CORNER_RADIUS + 4
        );
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 2. Outer pulsing selection ring when inspected
      if (isSelected) {
        const selPad = 5 + 1.5 * Math.sin(appState.animTimeSec * 4.5);
        traceRoundedRect(
          ctx,
          x - selPad,
          y - selPad,
          NODE_CARD_WIDTH + selPad * 2,
          NODE_CARD_HEIGHT + selPad * 2,
          NODE_CORNER_RADIUS + 4
        );
        ctx.strokeStyle = '#00f5d4';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // 3. Card base fill with subtle vertical dark gradient and status shadow
      ctx.shadowColor = isSelected ? 'rgba(0, 245, 212, 0.45)' : palette.glow;
      ctx.shadowBlur = isSelected || isHovered ? 18 : 11;

      const cardGrad = ctx.createLinearGradient(x, y, x, y + NODE_CARD_HEIGHT);
      if (rawStatus === 'DOWN' || node.isKilled) {
        cardGrad.addColorStop(0, 'rgba(38, 12, 18, 0.95)');
        cardGrad.addColorStop(1, 'rgba(20, 8, 12, 0.96)');
      } else {
        cardGrad.addColorStop(0, 'rgba(15, 23, 42, 0.94)');
        cardGrad.addColorStop(1, 'rgba(9, 14, 26, 0.96)');
      }

      traceRoundedRect(ctx, x, y, NODE_CARD_WIDTH, NODE_CARD_HEIGHT, NODE_CORNER_RADIUS);
      ctx.fillStyle = cardGrad;
      ctx.fill();

      // Reset shadow before crisp inner strokes and text
      ctx.shadowBlur = 0;
      ctx.lineWidth = isSelected || isHovered ? 2 : 1.4;
      ctx.strokeStyle = isSelected ? '#00f5d4' : palette.stroke;
      ctx.stroke();

      // 4. Top header bar inside node card: Category Pill + Status Indicator Dot
      const categoryText = String(node.category || node.type || 'SERVICE').toUpperCase();
      ctx.fillStyle = palette.badgeBg;
      traceRoundedRect(ctx, x + 8, y + 7, 68, 14, 4);
      ctx.fill();

      ctx.fillStyle = palette.text;
      ctx.font = '700 8.5px "JetBrains Mono", "Fira Code", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(categoryText.slice(0, 10), x + 12, y + 14.5);

      // Pod Replicas badge in top-right corner (`6/16 pods`)
      const pods = Math.round(Number(node.pods) || 0);
      const maxPods = Math.round(Number(node.maxPods) || pods);
      const podBadgeText = pods + '/' + maxPods + ' pods';
      ctx.fillStyle = isScaling ? 'rgba(56, 189, 248, 0.22)' : 'rgba(30, 41, 59, 0.85)';
      traceRoundedRect(ctx, x + NODE_CARD_WIDTH - 60, y + 7, 52, 14, 4);
      ctx.fill();

      ctx.fillStyle = isScaling ? '#38bdf8' : '#cbd5e1';
      ctx.font = '600 8.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(podBadgeText, x + NODE_CARD_WIDTH - 12, y + 14.5);

      // 5. Circular CPU Load Gauge Arc on the left side of the card body
      const gaugeCx = x + 24;
      const gaugeCy = y + 46;
      const gaugeRadius = 14;
      const cpuVal = rawStatus === 'DOWN' || node.isKilled
        ? 0
        : clamp(Math.round(Number(node.cpuLoad) || 0), 0, 100);

      // Gauge track circle
      ctx.beginPath();
      ctx.arc(gaugeCx, gaugeCy, gaugeRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.65)';
      ctx.lineWidth = 3.2;
      ctx.stroke();

      // Active CPU load arc
      if (cpuVal > 0) {
        const startAngle = -Math.PI * 0.5;
        const endAngle = startAngle + (cpuVal / 100) * (Math.PI * 2);
        ctx.beginPath();
        ctx.arc(gaugeCx, gaugeCy, gaugeRadius, startAngle, endAngle);
        ctx.strokeStyle =
          cpuVal > 85 ? '#ef4444' : cpuVal > 70 ? '#f59e0b' : '#00f5d4';
        ctx.lineWidth = 3.2;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // CPU percentage label inside circular gauge
      ctx.fillStyle = rawStatus === 'DOWN' ? '#f87171' : '#e2e8f0';
      ctx.font = '700 8.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        rawStatus === 'DOWN' || node.isKilled ? 'ERR' : cpuVal + '%',
        gaugeCx,
        gaugeCy + 0.5
      );

      // 6. Service Name & Live Telemetry Readout on the right of the CPU gauge
      const textLeftX = x + 45;
      ctx.fillStyle = '#f8fafc';
      ctx.font = '600 11px "Inter", -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      // Truncate long node names cleanly to fit card width
      const rawName = String(node.name || node.id || 'Service');
      const displayName = rawName.length > 17 ? rawName.slice(0, 16) + '…' : rawName;
      ctx.fillText(displayName, textLeftX, y + 29);

      // Bottom telemetry line: Latency (`42ms` or `OFFLINE`) + RPS
      const isDown = rawStatus === 'DOWN' || Boolean(node.isKilled);
      const latencyMs = Math.round(
        Number(node.currentLatency !== undefined ? node.currentLatency : node.baseLatency) || 0
      );
      const latencyLabel = isDown ? 'OFFLINE' : latencyMs + 'ms';
      const nodeRps = Math.round(Number(node.rps) || 0);

      ctx.font = '600 9.5px "JetBrains Mono", monospace';
      ctx.fillStyle = isDown
        ? '#f87171'
        : latencyMs > 220
          ? '#fbbf24'
          : '#34d399';
      ctx.fillText(latencyLabel, textLeftX, y + 47);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 9px "JetBrains Mono", monospace';
      ctx.fillText(formatInt(nodeRps) + ' r/s', textLeftX + 46, y + 47.5);

      // 7. Status indicator dot in bottom-right corner
      ctx.beginPath();
      ctx.arc(x + NODE_CARD_WIDTH - 10, y + NODE_CARD_HEIGHT - 10, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = palette.stroke;
      ctx.fill();

      ctx.restore();
    }
  }

  /**
   * Master rendering entry point for `#topology-canvas`.
   * @param {Object} state - Current engine state snapshot.
   * @param {number} dtSec - Elapsed frame time in seconds.
   */
  function renderTopologyCanvas(state, dtSec) {
    if (!dom.topoCanvas || !dom.topoCtx || !state) {
      return;
    }

    const { width, height } = syncCanvasDpi(dom.topoCanvas, dom.topoCtx, 'topo');
    const ctx = dom.topoCtx;
    const kpis = extractGlobalKpis(state);
    const nodes = Array.isArray(state.nodes) ? state.nodes : [];
    const edges = Array.isArray(state.edges) ? state.edges : [];
    const packets = Array.isArray(state.packets) ? state.packets : [];

    // Build lookup maps for O(1) node & coordinate resolution
    const nodeMap = new Map();
    const centerMap = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      nodeMap.set(n.id, n);
      centerMap.set(n.id, getNodeCanvasCenter(n, width, height));
    }

    renderEngineeringGrid(ctx, width, height, kpis);
    renderEdges(ctx, edges, nodeMap, centerMap);
    renderPackets(ctx, packets, edges, nodeMap, centerMap);
    renderRipples(ctx, dtSec);
    renderNodes(ctx, nodes, centerMap);
  }

  /* ==========================================================================
     6. REAL-TIME TELEMETRY SPARKLINE CHART (`#metrics-canvas`)
     Renders a multi-series area/line chart from `state.metricsHistory` showing:
     - SLO Availability (%, neon cyan/emerald curve)
     - P99 Latency (ms, purple/amber curve)
     - 5xx Error Rate (%, crimson curve)
     ========================================================================== */

  /**
   * Renders the real-time Golden Signals sparkline chart on `#metrics-canvas`.
   * @param {Object} state - Current simulation state snapshot.
   */
  function renderMetricsChart(state) {
    if (!dom.metricsCanvas || !dom.metricsCtx || !state) {
      return;
    }

    const { width, height } = syncCanvasDpi(
      dom.metricsCanvas,
      dom.metricsCtx,
      'metrics'
    );
    const ctx = dom.metricsCtx;
    const history = Array.isArray(state.metricsHistory) ? state.metricsHistory : [];

    // 1. Clear background
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, width, height);

    // Chart plot margins
    const padLeft = 10;
    const padRight = 10;
    const padTop = 22;
    const padBottom = 16;
    const plotW = Math.max(60, width - padLeft - padRight);
    const plotH = Math.max(40, height - padTop - padBottom);

    // 2. Subtle horizontal reference grid lines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 3; i++) {
      const gy = Math.round(padTop + (plotH / 3) * i) + 0.5;
      ctx.moveTo(padLeft, gy);
      ctx.lineTo(width - padRight, gy);
    }
    ctx.stroke();

    if (history.length < 2) {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
      ctx.font = '500 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Collecting real-time telemetry…', width * 0.5, height * 0.5);
      return;
    }

    const count = history.length;
    const stepX = plotW / Math.max(1, count - 1);

    // Determine dynamic maximum latency for smooth scaling (minimum 300ms ceiling)
    let maxLatencyScale = 300;
    for (let i = 0; i < count; i++) {
      const pt = history[i];
      const lat = Number(pt.p99Latency !== undefined ? pt.p99Latency : pt.latency) || 0;
      if (lat > maxLatencyScale) {
        maxLatencyScale = lat * 1.15;
      }
    }

    // Helper to compute X coordinate for history index
    const getX = function (idx) {
      return padLeft + idx * stepX;
    };

    // 3. Draw P99 Latency Shaded Area & Line (Purple `#a855f7`)
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const pt = history[i];
      const lat = clamp(
        Number(pt.p99Latency !== undefined ? pt.p99Latency : pt.latency) || 0,
        0,
        maxLatencyScale
      );
      const px = getX(i);
      const py = padTop + plotH * (1 - lat / maxLatencyScale);
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Fill area under P99 Latency curve
    ctx.lineTo(getX(count - 1), padTop + plotH);
    ctx.lineTo(getX(0), padTop + plotH);
    ctx.closePath();
    const latGrad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
    latGrad.addColorStop(0, 'rgba(168, 85, 247, 0.25)');
    latGrad.addColorStop(1, 'rgba(168, 85, 247, 0.01)');
    ctx.fillStyle = latGrad;
    ctx.fill();
    ctx.restore();

    // 4. Draw SLO Availability Curve (Neon Cyan `#00f5d4`, scaled 65%..100%)
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const pt = history[i];
      const slo = clamp(Number(pt.slo !== undefined ? pt.slo : 100), 65, 100);
      const normSlo = (slo - 65) / 35;
      const px = getX(i);
      const py = padTop + plotH * (1 - normSlo);
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.strokeStyle = '#00f5d4';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.lineTo(getX(count - 1), padTop + plotH);
    ctx.lineTo(getX(0), padTop + plotH);
    ctx.closePath();
    const sloGrad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
    sloGrad.addColorStop(0, 'rgba(0, 245, 212, 0.18)');
    sloGrad.addColorStop(1, 'rgba(0, 245, 212, 0.0)');
    ctx.fillStyle = sloGrad;
    ctx.fill();
    ctx.restore();

    // 5. Draw 5xx Error Rate Curve (Crimson `#f43f5e`, scaled 0%..100%)
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const pt = history[i];
      const err = clamp(Number(pt.errorRate) || 0, 0, 100);
      const px = getX(i);
      const py = padTop + plotH * (1 - err / 100);
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // 6. Top summary readout strip inside sparkline canvas
    const latest = history[count - 1];
    const latestSlo = Number(latest.slo !== undefined ? latest.slo : 99.99).toFixed(2);
    const latestLat = Math.round(
      Number(latest.p99Latency !== undefined ? latest.p99Latency : latest.latency) || 0
    );
    const latestErr = Number(latest.errorRate || 0).toFixed(1);

    ctx.save();
    ctx.font = '600 9.5px "JetBrains Mono", monospace';
    ctx.textBaseline = 'top';

    ctx.fillStyle = '#00f5d4';
    ctx.textAlign = 'left';
    ctx.fillText('SLO ' + latestSlo + '%', padLeft, 5);

    ctx.fillStyle = '#c084fc';
    ctx.textAlign = 'center';
    ctx.fillText('P99 ' + latestLat + 'ms', width * 0.5, 5);

    ctx.fillStyle = '#f43f5e';
    ctx.textAlign = 'right';
    ctx.fillText('5xx ' + latestErr + '%', width - padRight, 5);
    ctx.restore();
  }

  /* ==========================================================================
     7. SAFE DOM CONTROLLER (KPIs, NODE INSPECTOR & SRE EVENT LOG)
     Updates all DOM text nodes and status badges at ~8 Hz using strictly
     `textContent`, `createElement`, `classList`, and `replaceChildren`.
     ========================================================================== */

  /**
   * Updates the status badge classList on an element (`#system-status-badge`
   * or `#inspector-status`) without overwriting its structural base class.
   * @param {HTMLElement} badgeEl - Target badge DOM element.
   * @param {string} baseClass - Base class name to preserve.
   * @param {string} statusKey - Status string ('HEALTHY', 'DEGRADED', 'CRITICAL', 'DOWN', 'CIRCUIT_OPEN').
   */
  function applyStatusBadgeStyle(badgeEl, baseClass, statusKey) {
    if (!badgeEl) {
      return;
    }
    const cleanKey = String(statusKey || 'HEALTHY').toUpperCase();
    const info = STATUS_PALETTE[cleanKey] || STATUS_PALETTE.HEALTHY;

    badgeEl.textContent = info.label;
    badgeEl.className = baseClass + ' ' + info.cssClass;
  }

  /**
   * Updates the 5 Golden Signal KPI cards and the global posture badge.
   * @param {Object} state - Current simulation state snapshot.
   */
  function updateTopKpiDom(state) {
    const kpis = extractGlobalKpis(state);

    if (dom.kpiSlo) {
      dom.kpiSlo.textContent = kpis.slo.toFixed(2) + '%';
    }
    if (dom.kpiLatency) {
      dom.kpiLatency.textContent = formatInt(kpis.p99Latency) + ' ms';
    }
    if (dom.kpiRps) {
      dom.kpiRps.textContent = formatInt(kpis.totalRps) + ' req/s';
    }
    if (dom.kpiErrorRate) {
      dom.kpiErrorRate.textContent = kpis.errorRate.toFixed(2) + '%';
    }
    if (dom.kpiPods) {
      dom.kpiPods.textContent =
        kpis.maxPods > 0
          ? kpis.activePods + ' / ' + kpis.maxPods
          : String(kpis.activePods);
    }
    if (dom.systemStatusBadge) {
      applyStatusBadgeStyle(
        dom.systemStatusBadge,
        'system-status-badge',
        kpis.systemStatus
      );
    }
  }

  /**
   * Ensures a valid node is selected (defaulting to an interesting core node
   * like `orchestrator` or `gemini4` or the first node in the topology) and
   * updates `#node-inspector` fields.
   * @param {Object} state - Current simulation state snapshot.
   */
  function updateNodeInspectorDom(state) {
    const nodes = Array.isArray(state.nodes) ? state.nodes : [];
    if (nodes.length === 0) {
      return;
    }

    // Locate currently selected node or pick an interesting default service
    let selected = null;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === appState.selectedNodeId) {
        selected = nodes[i];
        break;
      }
    }

    if (!selected) {
      const preferredIds = ['gemini4', 'orchestrator', 'checkout', 'payment_router'];
      for (let p = 0; p < preferredIds.length && !selected; p++) {
        for (let i = 0; i < nodes.length; i++) {
          if (nodes[i].id === preferredIds[p]) {
            selected = nodes[i];
            break;
          }
        }
      }
      if (!selected) {
        selected = nodes[0];
      }
      appState.selectedNodeId = selected.id;
    }

    const rawStatus = String(selected.status || 'HEALTHY').toUpperCase();
    const isDown = rawStatus === 'DOWN' || Boolean(selected.isKilled);
    const cpuPercent = isDown ? 0 : Math.round(Number(selected.cpuLoad) || 0);
    const latencyMs = Math.round(
      Number(
        selected.currentLatency !== undefined
          ? selected.currentLatency
          : selected.baseLatency
      ) || 0
    );
    const nodeRps = Math.round(Number(selected.rps) || 0);
    const pods = Math.round(Number(selected.pods) || 0);
    const maxPods = Math.round(Number(selected.maxPods) || pods);
    const errRate = clamp(Number(selected.errorRate) || 0, 0, 100);

    if (dom.inspectorTitle) {
      dom.inspectorTitle.textContent = String(selected.name || selected.id);
    }
    if (dom.inspectorType) {
      const cat = String(selected.category || selected.type || 'Cloud Service');
      const cbStatus = selected.circuitOpen ? ' • Circuit Breaker Engaged' : ' • Regional GKE Mesh';
      dom.inspectorType.textContent = cat + cbStatus;
    }
    if (dom.inspectorStatus) {
      applyStatusBadgeStyle(
        dom.inspectorStatus,
        'inspector-status-badge',
        rawStatus
      );
    }
    if (dom.inspectorCpu) {
      dom.inspectorCpu.textContent = isDown ? '0% (OFFLINE)' : cpuPercent + '%';
    }
    if (dom.inspectorLatency) {
      dom.inspectorLatency.textContent = isDown ? 'OFFLINE' : formatInt(latencyMs) + ' ms';
    }
    if (dom.inspectorRps) {
      dom.inspectorRps.textContent = formatInt(nodeRps) + ' req/s';
    }
    if (dom.inspectorPods) {
      dom.inspectorPods.textContent = pods + ' / ' + maxPods;
    }
    if (dom.inspectorError) {
      dom.inspectorError.textContent = errRate.toFixed(2) + '%';
    }
    if (dom.btnNodeToggleDown) {
      dom.btnNodeToggleDown.textContent = isDown
        ? 'Restore Service'
        : 'Terminate Service';
    }
  }

  /**
   * Synchronizes `#event-log-list` using strictly `document.createElement('li')`,
   * `document.createElement('span')`, `textContent`, and `replaceChildren()`.
   * Capped at `MAX_VISIBLE_EVENTS` (25 items).
   * @param {Object} state - Current simulation state snapshot.
   */
  function updateEventLogDom(state) {
    if (!dom.eventLogList || !state) {
      return;
    }

    const rawEvents = Array.isArray(state.events)
      ? state.events
      : Array.isArray(state.eventLog)
        ? state.eventLog
        : [];

    if (rawEvents.length === 0) {
      return;
    }

    const visibleSlice = rawEvents.slice(0, MAX_VISIBLE_EVENTS);
    const firstEvt = visibleSlice[0];
    const signature =
      rawEvents.length +
      ':' +
      String(firstEvt.id || firstEvt.time || '') +
      ':' +
      String(firstEvt.message || firstEvt.msg || '');

    if (signature === appState.lastEventLogSignature) {
      return;
    }
    appState.lastEventLogSignature = signature;

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < visibleSlice.length; i++) {
      const evt = visibleSlice[i];
      const li = document.createElement('li');

      // Normalize severity level to match CSS rules (`event-info`, `event-warning`, `event-danger`, `event-chaos`, `event-success`)
      const rawLevel = String(evt.level || evt.type || 'info').toLowerCase();
      let levelClass = 'event-info';
      if (rawLevel === 'chaos') {
        levelClass = 'event-chaos';
      } else if (rawLevel === 'error' || rawLevel === 'danger' || rawLevel === 'critical') {
        levelClass = 'event-danger';
      } else if (rawLevel === 'warn' || rawLevel === 'warning') {
        levelClass = 'event-warning';
      } else if (rawLevel === 'success' || rawLevel === 'heal' || rawLevel === 'ok') {
        levelClass = 'event-success';
      }

      li.classList.add('event-item', levelClass);

      const timeSpan = document.createElement('span');
      timeSpan.classList.add('event-time');
      timeSpan.textContent = String(evt.timeStr || evt.time || 'LIVE');

      const msgSpan = document.createElement('span');
      msgSpan.classList.add('event-msg');
      msgSpan.textContent = String(evt.message || evt.msg || evt.text || '');

      li.appendChild(timeSpan);
      li.appendChild(msgSpan);
      fragment.appendChild(li);
    }

    dom.eventLogList.replaceChildren(fragment);
  }

  /* ==========================================================================
     8. INTERACTIVE CANVAS & CONTROL EVENT HANDLERS
     Handles node hit-testing, click-to-inspect, double-click-to-toggle-outage,
     drag-to-reposition, and all toolbar / chaos injection buttons.
     ========================================================================== */

  /**
   * Translates a mouse/pointer event into logical canvas pixel coordinates
   * and performs hit-testing against all rendered microservice node cards.
   * @param {MouseEvent} evt - Pointer or mouse event on `#topology-canvas`.
   * @returns {{ x: number, y: number, hitNode: Object|null }} Canvas coords & hit node.
   */
  function hitTestCanvasNode(evt) {
    const rect = dom.topoCanvas.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;

    const state = getEngineState();
    const nodes = state && Array.isArray(state.nodes) ? state.nodes : [];
    const width = appState.topoLogicalWidth;
    const height = appState.topoLogicalHeight;

    // Iterate top-to-bottom (reverse render order) to find topmost clicked node
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      const center = getNodeCanvasCenter(node, width, height);
      const halfW = NODE_CARD_WIDTH * 0.5;
      const halfH = NODE_CARD_HEIGHT * 0.5;

      if (
        x >= center.cx - halfW &&
        x <= center.cx + halfW &&
        y >= center.cy - halfH &&
        y <= center.cy + halfH
      ) {
        return { x, y, hitNode: node };
      }
    }

    return { x, y, hitNode: null };
  }

  /**
   * Syncs the traffic slider UI and text readout with a numeric RPS value.
   * @param {number} rps - Target ingress requests per second.
   */
  function syncTrafficControlUi(rps) {
    const cleanRps = clamp(Math.round(Number(rps) || 1400), MIN_TRAFFIC_RPS, MAX_TRAFFIC_RPS);
    if (dom.trafficSlider) {
      dom.trafficSlider.value = String(cleanRps);
    }
    if (dom.trafficValue) {
      dom.trafficValue.textContent = formatInt(cleanRps) + ' req/s';
    }
  }

  /**
   * Forces an immediate refresh of the DOM inspector, KPIs, and event log
   * after an interactive user action.
   */
  function forceImmediateDomSync() {
    const state = getEngineState();
    if (!state) {
      return;
    }
    updateTopKpiDom(state);
    updateNodeInspectorDom(state);
    updateEventLogDom(state);
    appState.lastDomUpdateTimeMs = performance.now();
  }

  /**
   * Binds all DOM controls, chaos injection deck buttons, node inspector
   * action buttons, and interactive canvas mouse events.
   */
  function bindEventListeners() {
    // 1. Architecture Topology Selector (`#topology-select`)
    if (dom.topologySelect) {
      dom.topologySelect.addEventListener('change', function (e) {
        const chosen = String(e.target.value || '');
        if (!ALLOWED_TOPOLOGIES.has(chosen)) {
          return;
        }
        if (window.ChaosEngine && typeof window.ChaosEngine.loadTopology === 'function') {
          window.ChaosEngine.loadTopology(chosen);
        } else if (window.ChaosEngine && typeof window.ChaosEngine.init === 'function') {
          window.ChaosEngine.init(chosen);
        }
        appState.selectedNodeId = null;
        const st = getEngineState();
        if (st && st.targetRps !== undefined) {
          syncTrafficControlUi(st.targetRps);
        }
        forceImmediateDomSync();
      });
    }

    // 2. Ingress Traffic Slider (`#traffic-slider`)
    if (dom.trafficSlider) {
      dom.trafficSlider.addEventListener('input', function (e) {
        const safeRps = clamp(Number(e.target.value), MIN_TRAFFIC_RPS, MAX_TRAFFIC_RPS);
        syncTrafficControlUi(safeRps);
        if (window.ChaosEngine && typeof window.ChaosEngine.setTargetRps === 'function') {
          window.ChaosEngine.setTargetRps(safeRps);
        }
      });
    }

    // 3. GKE Autopilot & Circuit Breaker Auto-Heal Toggle (`#autoheal-toggle`)
    if (dom.autohealToggle) {
      dom.autohealToggle.addEventListener('change', function (e) {
        const enabled = Boolean(e.target.checked);
        if (window.ChaosEngine && typeof window.ChaosEngine.setAutoHeal === 'function') {
          window.ChaosEngine.setAutoHeal(enabled);
        }
        forceImmediateDomSync();
      });
    }

    // 4. Chaos Deck Button: Kill Random Service (`#btn-kill-node`)
    if (dom.btnKillNode) {
      dom.btnKillNode.addEventListener('click', function () {
        if (window.ChaosEngine && typeof window.ChaosEngine.killRandomNode === 'function') {
          const victim = window.ChaosEngine.killRandomNode();
          const victimId = victim && typeof victim === 'object' ? victim.id : victim;
          if (victimId) {
            appState.selectedNodeId = String(victimId);
            const st = getEngineState();
            const victimNode =
              st && Array.isArray(st.nodes)
                ? st.nodes.find(function (n) { return n.id === victimId; })
                : null;
            if (victimNode) {
              const c = getNodeCanvasCenter(
                victimNode,
                appState.topoLogicalWidth,
                appState.topoLogicalHeight
              );
              spawnRipple(c.cx, c.cy, '#ef4444');
            }
          }
          forceImmediateDomSync();
        }
      });
    }

    // 5. Chaos Deck Button: Traffic Surge 3x DDoS (`#btn-traffic-spike`)
    if (dom.btnTrafficSpike) {
      dom.btnTrafficSpike.addEventListener('click', function () {
        if (window.ChaosEngine && typeof window.ChaosEngine.triggerTrafficSpike === 'function') {
          const newRps = window.ChaosEngine.triggerTrafficSpike();
          const st = getEngineState();
          const syncedRps =
            Number.isFinite(Number(newRps))
              ? Number(newRps)
              : st && st.targetRps
                ? st.targetRps
                : 4200;
          syncTrafficControlUi(syncedRps);
          spawnRipple(appState.topoLogicalWidth * 0.14, appState.topoLogicalHeight * 0.5, '#f59e0b');
          forceImmediateDomSync();
        }
      });
    }

    // 6. Chaos Deck Button: Region Latency Storm (`#btn-latency-storm`)
    if (dom.btnLatencyStorm) {
      dom.btnLatencyStorm.addEventListener('click', function () {
        if (window.ChaosEngine && typeof window.ChaosEngine.triggerLatencyStorm === 'function') {
          window.ChaosEngine.triggerLatencyStorm();
          spawnRipple(appState.topoLogicalWidth * 0.52, appState.topoLogicalHeight * 0.5, '#f59e0b');
          forceImmediateDomSync();
        }
      });
    }

    // 7. Chaos Deck Button: Saturate Primary DB (`#btn-cascade-db`)
    if (dom.btnCascadeDb) {
      dom.btnCascadeDb.addEventListener('click', function () {
        if (window.ChaosEngine && typeof window.ChaosEngine.saturateDatabase === 'function') {
          window.ChaosEngine.saturateDatabase();
          spawnRipple(appState.topoLogicalWidth * 0.72, appState.topoLogicalHeight * 0.5, '#a855f7');
          forceImmediateDomSync();
        }
      });
    }

    // 8. Chaos Deck Button: Auto-Heal & Reset Breakers (`#btn-heal-all`)
    if (dom.btnHealAll) {
      dom.btnHealAll.addEventListener('click', function () {
        if (window.ChaosEngine && typeof window.ChaosEngine.healAll === 'function') {
          window.ChaosEngine.healAll();
          spawnRipple(appState.topoLogicalWidth * 0.5, appState.topoLogicalHeight * 0.5, '#10b981');
          forceImmediateDomSync();
        }
      });
    }

    // 9. Chaos Deck Button: Reset Topology (`#btn-reset`)
    if (dom.btnReset) {
      dom.btnReset.addEventListener('click', function () {
        if (window.ChaosEngine && typeof window.ChaosEngine.reset === 'function') {
          window.ChaosEngine.reset();
        }
        const st = getEngineState();
        if (st && st.targetRps !== undefined) {
          syncTrafficControlUi(st.targetRps);
        } else {
          syncTrafficControlUi(1400);
        }
        if (dom.autohealToggle && st && st.autoHeal !== undefined) {
          dom.autohealToggle.checked = Boolean(st.autoHeal);
        }
        forceImmediateDomSync();
      });
    }

    // 10. Node Inspector Action Button: Toggle Service Outage (`#btn-node-toggle-down`)
    if (dom.btnNodeToggleDown) {
      dom.btnNodeToggleDown.addEventListener('click', function () {
        if (
          appState.selectedNodeId &&
          window.ChaosEngine &&
          typeof window.ChaosEngine.toggleNodeDown === 'function'
        ) {
          window.ChaosEngine.toggleNodeDown(appState.selectedNodeId);
          forceImmediateDomSync();
        }
      });
    }

    // 11. Node Inspector Action Button: Inject +250ms Latency (`#btn-node-add-latency`)
    if (dom.btnNodeAddLatency) {
      dom.btnNodeAddLatency.addEventListener('click', function () {
        if (
          appState.selectedNodeId &&
          window.ChaosEngine &&
          typeof window.ChaosEngine.injectNodeLatency === 'function'
        ) {
          window.ChaosEngine.injectNodeLatency(appState.selectedNodeId, 250);
          forceImmediateDomSync();
        }
      });
    }

    // 12. Node Inspector Action Button: Scale +2 GKE Pods (`#btn-node-scale-up`)
    if (dom.btnNodeScaleUp) {
      dom.btnNodeScaleUp.addEventListener('click', function () {
        if (
          appState.selectedNodeId &&
          window.ChaosEngine &&
          typeof window.ChaosEngine.scaleNodePods === 'function'
        ) {
          window.ChaosEngine.scaleNodePods(appState.selectedNodeId, 2);
          forceImmediateDomSync();
        }
      });
    }

    // 13. Topology Canvas Mouse / Pointer Interactivity (Select, Drag, Double-Click Outage)
    if (dom.topoCanvas) {
      dom.topoCanvas.addEventListener('mousedown', function (evt) {
        const { hitNode } = hitTestCanvasNode(evt);
        if (hitNode) {
          appState.selectedNodeId = hitNode.id;
          appState.draggedNodeId = hitNode.id;
          appState.didDragMove = false;
          const center = getNodeCanvasCenter(
            hitNode,
            appState.topoLogicalWidth,
            appState.topoLogicalHeight
          );
          spawnRipple(center.cx, center.cy, '#00f5d4');
          forceImmediateDomSync();
        }
      });

      dom.topoCanvas.addEventListener('mousemove', function (evt) {
        const { x, y, hitNode } = hitTestCanvasNode(evt);

        // If user is actively dragging a selected node, update its normalized position
        if (appState.draggedNodeId) {
          const st = getEngineState();
          const dragged =
            st && Array.isArray(st.nodes)
              ? st.nodes.find(function (n) { return n.id === appState.draggedNodeId; })
              : null;
          if (dragged) {
            const norm = canvasPixelsToNormalized(
              x,
              y,
              appState.topoLogicalWidth,
              appState.topoLogicalHeight
            );
            dragged.x = norm.x;
            dragged.y = norm.y;
            appState.didDragMove = true;
          }
          return;
        }

        // Update hover state and toggle CSS cursor class
        appState.hoveredNodeId = hitNode ? hitNode.id : null;
        if (hitNode) {
          dom.topoCanvas.classList.add('canvas-hover-node');
        } else {
          dom.topoCanvas.classList.remove('canvas-hover-node');
        }
      });

      window.addEventListener('mouseup', function () {
        appState.draggedNodeId = null;
      });

      dom.topoCanvas.addEventListener('dblclick', function (evt) {
        const { hitNode } = hitTestCanvasNode(evt);
        if (
          hitNode &&
          window.ChaosEngine &&
          typeof window.ChaosEngine.toggleNodeDown === 'function'
        ) {
          appState.selectedNodeId = hitNode.id;
          window.ChaosEngine.toggleNodeDown(hitNode.id);
          const center = getNodeCanvasCenter(
            hitNode,
            appState.topoLogicalWidth,
            appState.topoLogicalHeight
          );
          spawnRipple(center.cx, center.cy, '#ef4444');
          forceImmediateDomSync();
        }
      });
    }
  }

  /* ==========================================================================
     9. MAIN 60FPS ANIMATION & TELEMETRY LOOP
     Steps the physics/queuing engine, renders the interactive topology canvas
     and real-time sparkline canvas at 60FPS, and updates DOM text at ~8 Hz.
     ========================================================================== */

  /**
   * Primary `requestAnimationFrame` callback driving the simulation and renderer.
   * @param {number} nowMs - High-resolution timestamp provided by the browser.
   */
  function animationFrameLoop(nowMs) {
    const rawDtSec = (nowMs - appState.lastFrameTimeMs) / 1000;
    const dtSec = clamp(rawDtSec, 0.001, 0.1);
    appState.lastFrameTimeMs = nowMs;
    appState.animTimeSec += dtSec;

    // 1. Advance distributed systems physics & packet simulation
    if (window.ChaosEngine && typeof window.ChaosEngine.step === 'function') {
      window.ChaosEngine.step(dtSec);
    }

    const state = getEngineState();
    if (state) {
      // 2. Render 60FPS interactive topology canvas
      renderTopologyCanvas(state, dtSec);

      // 3. Render real-time Golden Signals sparkline chart
      renderMetricsChart(state);

      // 4. Throttle DOM text updates to ~8.3 Hz for crisp readability and zero layout thrash
      if (nowMs - appState.lastDomUpdateTimeMs >= DOM_UPDATE_INTERVAL_MS) {
        updateTopKpiDom(state);
        updateNodeInspectorDom(state);
        updateEventLogDom(state);
        appState.lastDomUpdateTimeMs = nowMs;
      }
    }

    window.requestAnimationFrame(animationFrameLoop);
  }

  /* ==========================================================================
     10. APPLICATION BOOTSTRAP ON DOMCONTENTLOADED
     Caches DOM references, initializes `window.ChaosEngine` with the default
     `genai_rag` topology, selects the initial microservice node, and starts
     the 60FPS loop.
     ========================================================================== */

  /**
   * Initializes the visualizer controller once the document structure is ready.
   */
  function initVisualizerApp() {
    // Cache all required DOM elements by ID
    dom.topologySelect = document.getElementById('topology-select');
    dom.trafficSlider = document.getElementById('traffic-slider');
    dom.trafficValue = document.getElementById('traffic-value');
    dom.autohealToggle = document.getElementById('autoheal-toggle');
    dom.systemStatusBadge = document.getElementById('system-status-badge');

    dom.kpiSlo = document.getElementById('kpi-slo');
    dom.kpiLatency = document.getElementById('kpi-latency');
    dom.kpiRps = document.getElementById('kpi-rps');
    dom.kpiErrorRate = document.getElementById('kpi-error-rate');
    dom.kpiPods = document.getElementById('kpi-pods');

    dom.btnKillNode = document.getElementById('btn-kill-node');
    dom.btnTrafficSpike = document.getElementById('btn-traffic-spike');
    dom.btnLatencyStorm = document.getElementById('btn-latency-storm');
    dom.btnCascadeDb = document.getElementById('btn-cascade-db');
    dom.btnHealAll = document.getElementById('btn-heal-all');
    dom.btnReset = document.getElementById('btn-reset');

    dom.topoCanvas = document.getElementById('topology-canvas');
    dom.topoCtx = dom.topoCanvas ? dom.topoCanvas.getContext('2d') : null;

    dom.inspectorTitle = document.getElementById('inspector-title');
    dom.inspectorType = document.getElementById('inspector-type');
    dom.inspectorStatus = document.getElementById('inspector-status');
    dom.inspectorCpu = document.getElementById('inspector-cpu');
    dom.inspectorLatency = document.getElementById('inspector-latency');
    dom.inspectorRps = document.getElementById('inspector-rps');
    dom.inspectorPods = document.getElementById('inspector-pods');
    dom.inspectorError = document.getElementById('inspector-error');

    dom.btnNodeToggleDown = document.getElementById('btn-node-toggle-down');
    dom.btnNodeAddLatency = document.getElementById('btn-node-add-latency');
    dom.btnNodeScaleUp = document.getElementById('btn-node-scale-up');

    dom.metricsCanvas = document.getElementById('metrics-canvas');
    dom.metricsCtx = dom.metricsCanvas ? dom.metricsCanvas.getContext('2d') : null;
    dom.eventLogList = document.getElementById('event-log-list');

    // Initialize the ChaosEngine with the Gemini 4 Argon RAG & Vertex Pipeline preset
    if (window.ChaosEngine && typeof window.ChaosEngine.init === 'function') {
      const initialTopology =
        dom.topologySelect && ALLOWED_TOPOLOGIES.has(dom.topologySelect.value)
          ? dom.topologySelect.value
          : 'genai_rag';
      window.ChaosEngine.init(initialTopology);
    }

    // Select an interesting default core node (`gemini4` or `orchestrator`)
    const initialState = getEngineState();
    if (initialState && Array.isArray(initialState.nodes)) {
      const defaultNode =
        initialState.nodes.find(function (n) { return n.id === 'gemini4'; }) ||
        initialState.nodes.find(function (n) { return n.id === 'orchestrator'; }) ||
        initialState.nodes[0];
      if (defaultNode) {
        appState.selectedNodeId = defaultNode.id;
      }
      if (initialState.targetRps !== undefined) {
        syncTrafficControlUi(initialState.targetRps);
      }
    }

    bindEventListeners();
    forceImmediateDomSync();

    // Start the 60FPS simulation & canvas visualization loop
    appState.lastFrameTimeMs = performance.now();
    window.requestAnimationFrame(animationFrameLoop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVisualizerApp);
  } else {
    initVisualizerApp();
  }
})();
