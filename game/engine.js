// Browser and score verifier use the same 60 Hz simulation.
const SwimGameEngine = (() => {
  const STEP = 1 / 60;
  const MAX_TICKS = 5 * 60 * 60;
  const SWIMMER_X = 0.28;
  const RADIUS_Y = 0.037;
  const ROPE_Y = 0.034;
  const ASPECT = 0.62;
  const RADIUS_X = RADIUS_Y / ASPECT;
  const ROPE_X = ROPE_Y / ASPECT;
  const ROPE_SPACING = 0.58;

  function addRope(run, x) {
    let seed = run.seed;
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    run.seed = seed >>> 0;

    const gap = Math.max(0.26, 0.44 - run.meters * 0.0012) + ROPE_Y;
    const low = 0.10 + gap / 2;
    const high = 1 - low;
    const previous = run.ropes.at(-1)?.center ?? 0.5;
    const center = low + run.seed / 0x100000000 * (high - low);
    run.ropes.push({
      x,
      gap,
      center: Math.max(low, Math.min(high, Math.max(previous - 0.26, Math.min(previous + 0.26, center)))),
      passed: false,
    });
  }

  function create(seed) {
    const run = { seed: seed >>> 0 || 1, ticks: 0, meters: 0, y: 0.5, vy: 0, ropes: [], ended: false };
    for (let index = 0; index < 3; index++) addRope(run, 0.9 + ROPE_SPACING * index);
    return run;
  }

  function step(run, stroke) {
    if (run.ended) return;
    run.ticks++;
    if (stroke) run.vy = -0.58;
    run.vy = Math.min(0.95, run.vy + 1.28 * STEP);
    run.y += run.vy * STEP;
    if (run.y + RADIUS_Y > 1 || run.y - RADIUS_Y < 0) {
      run.ended = true;
      return;
    }

    const move = (0.34 + Math.min(run.meters, 60) * 0.003) * STEP;
    for (const rope of run.ropes) {
      const oldX = rope.x;
      rope.x -= move;
      const atSwimmer = rope.x - ROPE_X / 2 < SWIMMER_X + RADIUS_X &&
        oldX + ROPE_X / 2 > SWIMMER_X - RADIUS_X;
      if (atSwimmer && (run.y - RADIUS_Y < rope.center - rope.gap / 2 ||
                        run.y + RADIUS_Y > rope.center + rope.gap / 2)) {
        run.ended = true;
        return;
      }
      if (!rope.passed && rope.x + ROPE_X / 2 <= SWIMMER_X - RADIUS_X) {
        rope.passed = true;
        run.meters += 25;
      }
    }
    if (run.ropes[0].x < -ROPE_X * 1.5) {
      run.ropes.shift();
      addRope(run, run.ropes.at(-1).x + ROPE_SPACING);
    }
    run.ended = run.ticks >= MAX_TICKS;
  }

  function replay(seed, ticks, taps) {
    if (!Number.isInteger(ticks) || ticks < 1 || ticks > MAX_TICKS ||
        !Array.isArray(taps) || taps.length > ticks || taps[0] !== 0) return null;
    let lastTap = -1;
    for (const tap of taps) {
      if (!Number.isInteger(tap) || tap <= lastTap || tap >= ticks) return null;
      lastTap = tap;
    }
    const run = create(seed);
    let nextTap = 0;
    while (!run.ended && run.ticks < ticks) {
      const stroke = taps[nextTap] === run.ticks;
      if (stroke) nextTap++;
      step(run, stroke);
    }
    return run.ended && run.ticks === ticks ? run.meters : null;
  }

  return Object.freeze({ STEP, MAX_TICKS, SWIMMER_X, RADIUS_Y, ROPE_Y, ASPECT, create, step, replay });
})();
