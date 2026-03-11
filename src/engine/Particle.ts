/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SimConfig } from '../types/simulation';
import { Obstacle } from './Obstacle';

// Global variable to generate unique IDs
let particleIdCounter = 0;

// Hot-path constants
const EPSILON = 0.0002;
const SAFE_DIST = 0.0141421356; // sqrt(0.0002)
const MOUSE_RADIUS_SQ = 160000; // 400^2
const DEFAULT_RESTITUTION = 0.8;
const BOUNDARY_BOUNCE = -0.7;

// Flocking tuning
const MAX_FLOCKING_NEIGHBORS = 8;
const FLOCKING_INTERVAL_MS = 33; // ~30 Hz
const ALIGNMENT_WEIGHT = 0.02;
const COHESION_WEIGHT = 0.001;

// Collision tuning
const MAX_COLLISION_NEIGHBORS = 12;

export class Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  life: number;
  maxLife: number;
  size: number;
  baseSize: number;
  hue: number;
  mass: number;

  // Flocking cache / throttling
  private flockingTimer: number;
  private flockAvgVx: number;
  private flockAvgVy: number;
  private flockAvgX: number;
  private flockAvgY: number;
  private flockNeighborCount: number;

  // Fallback color cache
  private colorString: string;

  constructor(x: number, y: number, color: string, config: SimConfig) {
    this.id = ++particleIdCounter;
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 10;
    this.vy = (Math.random() - 0.5) * 10;
    this.ax = 0;
    this.ay = 0;
    this.maxLife = config.particleLife + Math.random() * 50;
    this.life = this.maxLife;
    this.baseSize = config.particleSize * (0.4 + Math.random() * 0.8);
    this.size = this.baseSize;
    this.hue = 200 + Math.random() * 60;
    this.mass = this.size;

    this.flockingTimer = (this.id % 3) * 11; // stagger between particles
    this.flockAvgVx = 0;
    this.flockAvgVy = 0;
    this.flockAvgX = this.x;
    this.flockAvgY = this.y;
    this.flockNeighborCount = 0;

    this.colorString = color;
  }

  update(
    config: SimConfig,
    canvasWidth: number,
    canvasHeight: number,
    mouseX: number | null,
    mouseY: number | null,
    neighbors: Particle[],
    obstacles: Obstacle[],
    dt: number
  ) {
    // Cache config fields used in hot path
    const {
      attraction,
      repulsion,
      vortex,
      flocking,
      collisions,
      gravity,
      friction
    } = config;

    // 0. Size update
    this.size = this.baseSize;

    // Keep mass aligned with dynamic size if desired
    this.mass = this.size > 0.1 ? this.size : 0.1;

    // 1. Mouse Interaction
    if (mouseX !== null && mouseY !== null) {
      const dx = mouseX - this.x;
      const dy = mouseY - this.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < MOUSE_RADIUS_SQ) {
        const force = (attraction - repulsion) / (distSq + 500);

        this.ax += dx * force;
        this.ay += dy * force;

        if (vortex) {
          const globalVortexForce = 0.03;
          this.ax += dy * globalVortexForce;
          this.ay -= dx * globalVortexForce;
        }
      }
    }

    const len = neighbors.length;

    // 2. Flocking (throttled + limited neighbors)
    if (flocking && len > 0) {
      this.flockingTimer += dt * 16.6667;

      if (this.flockingTimer >= FLOCKING_INTERVAL_MS) {
        this.flockingTimer = 0;

        const flockCount = len < MAX_FLOCKING_NEIGHBORS ? len : MAX_FLOCKING_NEIGHBORS;
        let avgVx = 0;
        let avgVy = 0;
        let avgX = 0;
        let avgY = 0;

        for (let i = 0; i < flockCount; i++) {
          const n = neighbors[i];
          avgVx += n.vx;
          avgVy += n.vy;
          avgX += n.x;
          avgY += n.y;
        }

        const inv = 1 / flockCount;
        this.flockAvgVx = avgVx * inv;
        this.flockAvgVy = avgVy * inv;
        this.flockAvgX = avgX * inv;
        this.flockAvgY = avgY * inv;
        this.flockNeighborCount = flockCount;
      }

      if (this.flockNeighborCount > 0) {
        this.ax += (this.flockAvgVx - this.vx) * ALIGNMENT_WEIGHT;
        this.ay += (this.flockAvgVy - this.vy) * ALIGNMENT_WEIGHT;
        this.ax += (this.flockAvgX - this.x) * COHESION_WEIGHT;
        this.ay += (this.flockAvgY - this.y) * COHESION_WEIGHT;
      }
    }

    // 3. Particle-Particle Collisions
    if (collisions && len > 0) {
      const collisionCount = len < MAX_COLLISION_NEIGHBORS ? len : MAX_COLLISION_NEIGHBORS;

      for (let i = 0; i < collisionCount; i++) {
        const n = neighbors[i];

        // Resolve each pair only once
        if (this.id >= n.id) continue;

        let dx = n.x - this.x;
        let dy = n.y - this.y;
        let distSq = dx * dx + dy * dy;
        const minDist = this.size + n.size;

        if (distSq < minDist * minDist) {
          let dist = SAFE_DIST;

          if (distSq <= 0) {
            dx = 0.01;
            dy = 0.01;
            distSq = EPSILON;
          } else {
            dist = Math.sqrt(distSq);
          }

          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minDist - dist;

          const totalMass = this.mass + n.mass;
          const invTotalMass = totalMass > 0 ? 1 / totalMass : 1;
          const massRatio1 = this.mass * invTotalMass;
          const massRatio2 = n.mass * invTotalMass;

          // Split penetration correction
          this.x -= nx * overlap * massRatio2;
          this.y -= ny * overlap * massRatio2;
          n.x += nx * overlap * massRatio1;
          n.y += ny * overlap * massRatio1;

          // Relative velocity
          const rvx = this.vx - n.vx;
          const rvy = this.vy - n.vy;
          const velAlongNormal = rvx * nx + rvy * ny;

          if (velAlongNormal < 0) {
            const j =
              (-(1 + DEFAULT_RESTITUTION) * velAlongNormal) /
              (1 / this.mass + 1 / n.mass);

            const jx = j * nx;
            const jy = j * ny;

            this.vx += jx / this.mass;
            this.vy += jy / this.mass;
            n.vx -= jx / n.mass;
            n.vy -= jy / n.mass;
          }
        }
      }
    }

    // 4. Obstacle Collisions
    for (let i = 0; i < obstacles.length; i++) {
      const obs = obstacles[i];
      let dx = this.x - obs.x;
      let dy = this.y - obs.y;
      let distSq = dx * dx + dy * dy;
      const minDist = this.size + obs.radius;

      if (distSq < minDist * minDist) {
        let dist = SAFE_DIST;

        if (distSq <= 0) {
          dx = 0.01;
          dy = 0.01;
          distSq = EPSILON;
        } else {
          dist = Math.sqrt(distSq);
        }

        const nx = dx / dist;
        const ny = dy / dist;

        this.x = obs.x + nx * minDist;
        this.y = obs.y + ny * minDist;

        const dot = this.vx * nx + this.vy * ny;
        this.vx = (this.vx - 2 * dot * nx) * DEFAULT_RESTITUTION;
        this.vy = (this.vy - 2 * dot * ny) * DEFAULT_RESTITUTION;
      }
    }

    // 5. Euler Integration with Delta Time
    this.ay += gravity;
    this.vx += this.ax * dt;
    this.vy += this.ay * dt;

    // Time-dependent friction
    const frictionDt = Math.pow(friction, dt);
    this.vx *= frictionDt;
    this.vy *= frictionDt;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    this.ax = 0;
    this.ay = 0;

    // 6. Boundaries
    if (this.x < this.size) {
      this.x = this.size;
      this.vx *= BOUNDARY_BOUNCE;
    } else if (this.x > canvasWidth - this.size) {
      this.x = canvasWidth - this.size;
      this.vx *= BOUNDARY_BOUNCE;
    }

    if (this.y < this.size) {
      this.y = this.size;
      this.vy *= BOUNDARY_BOUNCE;
    } else if (this.y > canvasHeight - this.size) {
      this.y = canvasHeight - this.size;
      this.vy *= BOUNDARY_BOUNCE;
    }

    this.life -= dt;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    config: SimConfig,
    spriteCanvas?: HTMLCanvasElement
  ) {
    const opacity = this.life > 0 ? this.life / this.maxLife : 0;
    ctx.globalAlpha = opacity;

    // Use pre-rendered sprite when available
    if (spriteCanvas) {
      const drawSize = this.size * (config.bloom ? 3 : 1.5);
      ctx.drawImage(
        spriteCanvas,
        this.x - drawSize,
        this.y - drawSize,
        drawSize * 2,
        drawSize * 2
      );
      return;
    }

    // Fallback draw path
    const speedSq = this.vx * this.vx + this.vy * this.vy;
    const dynamicHue = (this.hue + Math.sqrt(speedSq) * 5) | 0;

    this.colorString = `hsl(${dynamicHue}, 85%, 65%)`;
    ctx.fillStyle = this.colorString;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
  }

  isDead() {
    return this.life <= 0;
  }
}