export interface PrizeCanvasEngine {
  resize(width: number, height: number, pixelRatio: number): void;
  frame(elapsedMs: number, deltaSeconds: number): void;
  dispose(): void;
}

interface TrailPoint {
  x: number;
  y: number;
  rotation: number;
}

interface TokenParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  angularVelocity: number;
  radius: number;
  age: number;
  collisionCooldown: number;
  trail: TrailPoint[];
}

interface CrystalParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  angularVelocity: number;
  size: number;
  age: number;
  color: string;
  vertices: ReadonlyArray<readonly [number, number]>;
}

interface SparkParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  age: number;
  lifetime: number;
}

const palette = [
  "#C1440E",
  "#FF2E93",
  "#6B93D6",
  "#FFB347",
  "#7CFF6B",
  "#B85CFF",
] as const;

const tokenCount = 48;
const crystalCount = 64;
const maximumSparks = 120;
const trailLength = 4;
const degreesToRadians = Math.PI / 180;

function randomBetween(minimum: number, maximum: number): number {
  return minimum + Math.random() * (maximum - minimum);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(minimum: number, maximum: number, value: number): number {
  const progress = clamp((value - minimum) / (maximum - minimum), 0, 1);
  return progress * progress * (3 - 2 * progress);
}

function createTokenSprite(): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;

  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  const glow = context.createRadialGradient(48, 48, 20, 48, 48, 46);
  glow.addColorStop(0, "rgba(255,179,71,0.28)");
  glow.addColorStop(1, "rgba(255,179,71,0)");

  context.fillStyle = glow;
  context.fillRect(0, 0, 96, 96);

  context.beginPath();
  context.arc(48, 48, 31, 0, Math.PI * 2);

  const gold = context.createRadialGradient(36, 30, 2, 52, 55, 42);
  gold.addColorStop(0, "#FFE7A8");
  gold.addColorStop(0.35, "#FFB347");
  gold.addColorStop(1, "#C1440E");

  context.fillStyle = gold;
  context.fill();

  context.lineWidth = 2;
  context.strokeStyle = "#FFD593";
  context.stroke();

  context.beginPath();
  context.arc(48, 48, 25, 0, Math.PI * 2);
  context.lineWidth = 1.5;
  context.strokeStyle = "rgba(101,42,11,0.62)";
  context.stroke();

  context.beginPath();
  context.ellipse(42, 32, 17, 7, -0.4, 0, Math.PI * 2);
  context.fillStyle = "rgba(255,255,255,0.3)";
  context.fill();

  context.fillStyle = "#713010";
  context.font = "700 34px monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("$", 48, 49);

  context.beginPath();
  context.moveTo(68, 24);
  context.lineTo(71, 30);
  context.lineTo(77, 33);
  context.lineTo(71, 36);
  context.lineTo(68, 42);
  context.lineTo(65, 36);
  context.lineTo(59, 33);
  context.lineTo(65, 30);
  context.closePath();
  context.fillStyle = "rgba(255,255,255,0.9)";
  context.fill();

  return canvas;
}

export function createPrizeCanvas(
  canvas: HTMLCanvasElement,
): PrizeCanvasEngine | null {
  const maybeContext = canvas.getContext("2d", { alpha: true });
  const maybeSprite = createTokenSprite();

  if (!maybeContext || !maybeSprite) {
    return null;
  }

  const context: CanvasRenderingContext2D = maybeContext;
  const sprite: HTMLCanvasElement = maybeSprite;

  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let disposed = false;
  let tokensStarted = false;
  let crystalsStarted = false;

  const tokens: TokenParticle[] = [];
  const crystals: CrystalParticle[] = [];
  const sparks: SparkParticle[] = [];

  function origin(): { x: number; y: number } {
    return {
      x: width * 0.5,
      y: height * 0.43,
    };
  }

  function spawnTokens(): void {
    const center = origin();

    for (let index = 0; index < tokenCount; index += 1) {
      const angle = -Math.PI / 2 + randomBetween(-Math.PI / 4, Math.PI / 4);
      const speed = randomBetween(300, 600);
      const rotation = randomBetween(0, Math.PI * 2);

      tokens.push({
        x: center.x + randomBetween(-12, 12),
        y: center.y + randomBetween(-10, 10),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rotation,
        angularVelocity: randomBetween(-720, 720) * degreesToRadians,
        radius: randomBetween(10, 18),
        age: 0,
        collisionCooldown: 0,
        trail: Array.from({ length: trailLength }, () => ({
          x: center.x,
          y: center.y,
          rotation,
        })),
      });
    }
  }

  function spawnSparks(x: number, y: number): void {
    const available = maximumSparks - sparks.length;
    const count = Math.min(available, 5);

    for (let index = 0; index < count; index += 1) {
      const angle = randomBetween(0, Math.PI * 2);
      const speed = randomBetween(35, 140);

      sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: randomBetween(1, 2),
        age: 0,
        lifetime: randomBetween(0.18, 0.4),
      });
    }
  }

  function spawnCrystals(): void {
    const center = origin();

    for (let index = 0; index < crystalCount; index += 1) {
      const angle = randomBetween(0, Math.PI * 2);
      const speed = randomBetween(130, 620);
      const vertexCount = Math.floor(randomBetween(5, 8));

      const vertices: Array<readonly [number, number]> = [];

      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        const vertexAngle = (vertex / vertexCount) * Math.PI * 2;
        const distance = randomBetween(0.45, 1);

        vertices.push([
          Math.cos(vertexAngle) * distance,
          Math.sin(vertexAngle) * distance,
        ]);
      }

      crystals.push({
        x: center.x,
        y: center.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 100,
        rotation: randomBetween(0, Math.PI * 2),
        angularVelocity: randomBetween(-540, 540) * degreesToRadians,
        size: randomBetween(5, 15),
        age: 0,
        color: palette[index % palette.length] ?? "#FFB347",
        vertices,
      });
    }
  }

  function drawToken(
    x: number,
    y: number,
    rotation: number,
    radius: number,
    opacity: number,
  ): void {
    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    context.scale(Math.max(0.26, Math.abs(Math.cos(rotation * 0.7))), 1);
    context.globalAlpha = opacity;

    const size = radius * 3;
    context.drawImage(sprite, -size / 2, -size / 2, size, size);
    context.restore();
  }

  function updateTokens(deltaSeconds: number, elapsedMs: number): void {
    const drag = Math.pow(0.98, deltaSeconds * 60);
    const globalFade = 1 - smoothstep(2050, 2800, elapsedMs);

    for (const token of tokens) {
      for (let index = token.trail.length - 1; index > 0; index -= 1) {
        const previous = token.trail[index - 1];
        const current = token.trail[index];

        if (previous && current) {
          current.x = previous.x;
          current.y = previous.y;
          current.rotation = previous.rotation;
        }
      }

      const newest = token.trail[0];

      if (newest) {
        newest.x = token.x;
        newest.y = token.y;
        newest.rotation = token.rotation;
      }

      token.age += deltaSeconds;
      token.collisionCooldown = Math.max(
        0,
        token.collisionCooldown - deltaSeconds,
      );
      token.vx *= drag;
      token.vy = token.vy * drag + 800 * deltaSeconds;
      token.x += token.vx * deltaSeconds;
      token.y += token.vy * deltaSeconds;
      token.rotation += token.angularVelocity * deltaSeconds;

      let collided = false;

      if (token.x < token.radius) {
        token.x = token.radius;
        token.vx = Math.abs(token.vx) * 0.64;
        collided = true;
      } else if (token.x > width - token.radius) {
        token.x = width - token.radius;
        token.vx = -Math.abs(token.vx) * 0.64;
        collided = true;
      }

      if (token.y < token.radius) {
        token.y = token.radius;
        token.vy = Math.abs(token.vy) * 0.55;
        collided = true;
      } else if (token.y > height - token.radius) {
        token.y = height - token.radius;
        token.vy = -Math.abs(token.vy) * 0.52;
        collided = true;
      }

      if (collided && token.collisionCooldown === 0) {
        spawnSparks(token.x, token.y);
        token.collisionCooldown = 0.09;
      }

      for (let index = token.trail.length - 1; index >= 0; index -= 1) {
        const point = token.trail[index];

        if (!point) {
          continue;
        }

        drawToken(
          point.x,
          point.y,
          point.rotation,
          token.radius,
          globalFade * 0.15 * (1 - index / token.trail.length),
        );
      }

      drawToken(
        token.x,
        token.y,
        token.rotation,
        token.radius,
        globalFade,
      );
    }
  }

  function updateCrystals(deltaSeconds: number): void {
    const drag = Math.pow(0.987, deltaSeconds * 60);

    for (const crystal of crystals) {
      crystal.age += deltaSeconds;
      crystal.vx *= drag;
      crystal.vy = crystal.vy * drag + 600 * deltaSeconds;
      crystal.x += crystal.vx * deltaSeconds;
      crystal.y += crystal.vy * deltaSeconds;
      crystal.rotation += crystal.angularVelocity * deltaSeconds;

      const opacity = 1 - smoothstep(0.35, 1, crystal.age);

      if (opacity <= 0) {
        continue;
      }

      context.save();
      context.translate(crystal.x, crystal.y);
      context.rotate(crystal.rotation);
      context.scale(
        Math.max(0.2, Math.abs(Math.cos(crystal.rotation))),
        1,
      );
      context.globalAlpha = opacity;
      context.beginPath();

      crystal.vertices.forEach((vertex, index) => {
        const x = vertex[0] * crystal.size;
        const y = vertex[1] * crystal.size;

        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      });

      context.closePath();
      context.fillStyle = crystal.color;
      context.fill();

      context.lineWidth = 0.7;
      context.strokeStyle = "rgba(255,255,255,0.7)";
      context.stroke();

      context.beginPath();
      context.moveTo(0, -crystal.size * 0.7);
      context.lineTo(0, crystal.size * 0.6);
      context.strokeStyle = "rgba(255,255,255,0.35)";
      context.stroke();

      context.restore();
    }
  }

  function updateSparks(deltaSeconds: number): void {
    for (let index = sparks.length - 1; index >= 0; index -= 1) {
      const spark = sparks[index];

      if (!spark) {
        continue;
      }

      spark.age += deltaSeconds;

      if (spark.age >= spark.lifetime) {
        sparks.splice(index, 1);
        continue;
      }

      spark.vy += 200 * deltaSeconds;
      spark.x += spark.vx * deltaSeconds;
      spark.y += spark.vy * deltaSeconds;

      context.globalAlpha = 1 - spark.age / spark.lifetime;
      context.fillStyle = "#FFFFFF";
      context.beginPath();
      context.arc(spark.x, spark.y, spark.radius, 0, Math.PI * 2);
      context.fill();
    }

    context.globalAlpha = 1;
  }

  return {
    resize(nextWidth, nextHeight, nextPixelRatio) {
      if (disposed) {
        return;
      }

      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      pixelRatio = clamp(nextPixelRatio, 1, 1.75);

      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    },

    frame(elapsedMs, deltaSeconds) {
      if (disposed) {
        return;
      }

      context.clearRect(0, 0, width, height);

      if (elapsedMs >= 400 && !tokensStarted) {
        tokensStarted = true;
        spawnTokens();
      }

      if (elapsedMs >= 1800 && !crystalsStarted) {
        crystalsStarted = true;
        spawnCrystals();
      }

      updateTokens(deltaSeconds, elapsedMs);
      updateCrystals(deltaSeconds);
      updateSparks(deltaSeconds);
    },

    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      tokens.length = 0;
      crystals.length = 0;
      sparks.length = 0;

      context.clearRect(0, 0, width, height);
      canvas.width = 1;
      canvas.height = 1;
      sprite.width = 1;
      sprite.height = 1;
    },
  };
}
