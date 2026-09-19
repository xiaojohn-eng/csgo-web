export class WeaponInspect {
  elapsed = Infinity;
  weight = 0;
  readonly duration = 3.6;
  start() { this.elapsed = 0; }
  cancel() { this.elapsed = Infinity; }
  update(dt: number, interrupted: boolean) {
    const step = Math.max(0, Math.min(0.1, dt));
    if (interrupted) this.cancel();
    this.elapsed += step;
    const active = this.elapsed < this.duration;
    this.weight += ((active ? 1 : 0) - this.weight) * (1 - Math.exp(-step * (interrupted ? 24 : 9)));
    const progress = Math.min(1, this.elapsed / this.duration);
    return { weight: this.weight, turn: active ? Math.sin(progress * Math.PI) : 0 };
  }
}
