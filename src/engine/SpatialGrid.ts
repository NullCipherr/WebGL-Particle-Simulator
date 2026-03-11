/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Particle } from './Particle';

const EMPTY_NEIGHBORS: Particle[] = [];

export class SpatialGrid {
  private grid: Map<number, Particle[]>;
  cellSize: number;
  private invCellSize: number;

  constructor(cellSize: number) {
    this.grid = new Map();
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
  }

  setCellSize(cellSize: number) {
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    this.grid.clear();
  }

  clear() {
    // Reuse arrays instead of letting them get GC'd
    for (const cell of this.grid.values()) {
      cell.length = 0;
    }
  }

  private toGridCoord(value: number): number {
    return Math.floor(value * this.invCellSize);
  }

  private hash(gx: number, gy: number): number {
    // Integer hash for 2D coordinates, avoids string allocation
    return ((gx * 73856093) ^ (gy * 19349663)) | 0;
  }

  add(p: Particle) {
    const gx = this.toGridCoord(p.x);
    const gy = this.toGridCoord(p.y);
    const key = this.hash(gx, gy);

    let cell = this.grid.get(key);
    if (!cell) {
      cell = [];
      this.grid.set(key, cell);
    }

    cell.push(p);
  }

  getNeighbors(p: Particle): Particle[] {
    const gx = this.toGridCoord(p.x);
    const gy = this.toGridCoord(p.y);
    const neighbors: Particle[] = [];

    for (let x = gx - 1; x <= gx + 1; x++) {
      for (let y = gy - 1; y <= gy + 1; y++) {
        const cell = this.grid.get(this.hash(x, y));
        if (!cell) continue;

        for (let i = 0; i < cell.length; i++) {
          const other = cell[i];
          if (other !== p) neighbors.push(other);
        }
      }
    }

    return neighbors.length > 0 ? neighbors : EMPTY_NEIGHBORS;
  }

  getNeighborsInto(p: Particle, out: Particle[]) {
    out.length = 0;

    const gx = this.toGridCoord(p.x);
    const gy = this.toGridCoord(p.y);

    for (let x = gx - 1; x <= gx + 1; x++) {
      for (let y = gy - 1; y <= gy + 1; y++) {
        const cell = this.grid.get(this.hash(x, y));
        if (!cell) continue;

        for (let i = 0; i < cell.length; i++) {
          const other = cell[i];
          if (other !== p) out.push(other);
        }
      }
    }
  }

  getCellParticlesAt(x: number, y: number): Particle[] {
    const gx = this.toGridCoord(x);
    const gy = this.toGridCoord(y);
    return this.grid.get(this.hash(gx, gy)) ?? EMPTY_NEIGHBORS;
  }
}