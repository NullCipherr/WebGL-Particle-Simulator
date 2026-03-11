/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SimConfig {
  gravity: number;
  friction: number;
  attraction: number;
  repulsion: number;
  particleLife: number;
  particleSize: number;
  vortex: boolean;
  bloom: boolean;
  flocking: boolean;
  collisions: boolean;
  obstacleMode: boolean;
}
