/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export class Obstacle {
  x: number;
  y: number;
  radius: number;
  color: string;

  constructor(x: number, y: number, radius: number = 40) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.color = 'rgba(255, 255, 255, 0.1)';
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Inner glow
    const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius);
    gradient.addColorStop(0, 'rgba(102, 138, 255, 0.1)');
    gradient.addColorStop(1, 'rgba(102, 138, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();
  }

  contains(x: number, y: number): boolean {
    const dx = x - this.x;
    const dy = y - this.y;
    return dx * dx + dy * dy <= this.radius * this.radius;
  }
}
