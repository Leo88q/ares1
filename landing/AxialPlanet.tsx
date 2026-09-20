import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLivingScene } from "./useLivingScene";
import "./axial-planets.css";

interface AxialPlanetProps {
  readonly planet: "mars" | "earth";
  readonly children: ReactNode;
}

interface SphereSample {
  readonly offset: number;
  readonly longitude: number;
  readonly latitude: number;
  readonly light: number;
  readonly rim: number;
  readonly alpha: number;
}

const textureWidth = 512;
const textureHeight = 256;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function surfaceNoise(x: number, y: number): number {
  return (
    Math.sin(x * 0.033 + Math.sin(y * 0.052) * 2.4) * 0.45 +
    Math.sin(x * 0.081 - y * 0.058) * 0.25 +
    Math.sin(x * 0.17 + y * 0.119) * 0.15 +
    Math.sin(x * 0.013 + y * 0.022) * 0.15
  );
}

function createTexture(
  planet: "mars" | "earth",
): Uint8ClampedArray | null {
  const canvas = document.createElement("canvas");
  canvas.width = textureWidth;
  canvas.height = textureHeight;

  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    return null;
  }

  const image = context.createImageData(textureWidth, textureHeight);

  for (let y = 0; y < textureHeight; y += 1) {
    for (let x = 0; x < textureWidth; x += 1) {
      const offset = (y * textureWidth + x) * 4;
      const noise = surfaceNoise(x, y);
      const detail = Math.sin(x * 1.7 + y * 2.3) * 3;

      if (planet === "mars") {
        const canyon =
          Math.abs(y - 143 - Math.sin(x * 0.023) * 13) < 3 ? 0.55 : 1;

        image.data[offset] = (175 + noise * 48 + detail) * canyon;
        image.data[offset + 1] = (77 + noise * 30 + detail) * canyon;
        image.data[offset + 2] = (39 + noise * 18) * canyon;
      } else {
        image.data[offset] = 24 + noise * 9;
        image.data[offset + 1] = 86 + noise * 18;
        image.data[offset + 2] = 142 + noise * 24;
      }

      image.data[offset + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);

  if (planet === "earth") {
    const continents: readonly (readonly [number, number])[][] = [
      [[32, 65], [61, 36], [100, 41], [130, 59], [113, 88], [130, 111], [107, 131], [77, 116], [62, 102], [38, 94]],
      [[112, 129], [145, 137], [165, 168], [151, 195], [135, 221], [121, 206], [112, 178], [99, 153]],
      [[230, 72], [256, 59], [277, 72], [289, 92], [273, 112], [281, 139], [260, 177], [241, 164], [229, 126], [216, 110]],
      [[263, 55], [296, 38], [355, 49], [377, 69], [423, 64], [448, 88], [426, 112], [391, 106], [365, 127], [344, 110], [321, 138], [299, 107], [282, 93]],
      [[397, 169], [429, 160], [454, 179], [442, 200], [410, 204], [387, 184]],
      [[166, 26], [189, 22], [196, 46], [177, 64], [164, 48]],
    ];

    for (const polygon of continents) {
      context.beginPath();

      polygon.forEach(([x, y], index) => {
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });

      context.closePath();
      context.fillStyle = "#719C62";
      context.fill();
      context.strokeStyle = "#A5B77B";
      context.lineWidth = 1.3;
      context.stroke();
    }

    const surface = context.getImageData(0, 0, textureWidth, textureHeight);

    for (let y = 0; y < textureHeight; y += 1) {
      for (let x = 0; x < textureWidth; x += 1) {
        const offset = (y * textureWidth + x) * 4;
        const red = surface.data[offset] ?? 0;
        const green = surface.data[offset + 1] ?? 0;

        if (red > 80 && green > 100) {
          const noise = surfaceNoise(x * 1.4, y * 1.1);
          surface.data[offset] = red + noise * 24;
          surface.data[offset + 1] = green + noise * 27;
          surface.data[offset + 2] = 70 + noise * 17;
        }
      }
    }

    context.putImageData(surface, 0, 0);

    context.fillStyle = "#D4E5E1";
    context.fillRect(0, 0, textureWidth, 11);
    context.fillRect(0, textureHeight - 12, textureWidth, 12);
  } else {
    for (let index = 0; index < 38; index += 1) {
      const x = (index * 83 + 31) % textureWidth;
      const y = 22 + ((index * 47 + 18) % 210);
      const radius = 2 + index % 7;

      context.beginPath();
      context.ellipse(x, y, radius * 1.4, radius, -0.3, 0, Math.PI * 2);
      context.fillStyle = "rgba(64,25,18,0.24)";
      context.fill();
      context.strokeStyle = "rgba(242,162,112,0.28)";
      context.lineWidth = 1;
      context.stroke();
    }
  }

  const result = context.getImageData(0, 0, textureWidth, textureHeight).data;
  canvas.width = 1;
  canvas.height = 1;

  return result;
}

function createSphereSamples(size: number): readonly SphereSample[] {
  const samples: SphereSample[] = [];
  const radius = size / 2 - 1;
  const tilt = -0.2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5 - size / 2) / radius;
      const ny = -(y + 0.5 - size / 2) / radius;
      const distance = nx * nx + ny * ny;

      if (distance >= 1) {
        continue;
      }

      const nz = Math.sqrt(1 - distance);
      const rotatedX = nx * Math.cos(tilt) - ny * Math.sin(tilt);
      const rotatedY = nx * Math.sin(tilt) + ny * Math.cos(tilt);

      const diffuse = Math.max(0, nx * -0.48 + ny * 0.38 + nz * 0.76);

      samples.push({
        offset: (y * size + x) * 4,
        longitude: Math.atan2(rotatedX, nz),
        latitude: Math.asin(clamp(rotatedY, -1, 1)),
        light: 0.12 + Math.pow(diffuse, 0.9) * 0.97,
        rim: Math.pow(1 - nz, 4),
        alpha: clamp((1 - Math.sqrt(distance)) * radius, 0, 1),
      });
    }
  }

  return samples;
}

export function AxialPlanet({
  planet,
  children,
}: AxialPlanetProps): JSX.Element {
  const { ref, active } = useLivingScene<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const angleRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });

    if (!canvas || !context) {
      return;
    }

    const texture = createTexture(planet);

    if (!texture) {
      return;
    }

    const size = window.matchMedia("(pointer: coarse)").matches ? 180 : 224;
    canvas.width = size;
    canvas.height = size;

    const output = context.createImageData(size, size);
    const samples = createSphereSamples(size);

    let raf: number | null = null;
    let previous: number | null = null;
    let disposed = false;

    function render(angle: number): void {
      if (!texture || !context) {
        return;
      }

      for (const sample of samples) {
        const longitude = sample.longitude + angle;
        const u = ((longitude / (Math.PI * 2) + 0.5) % 1 + 1) % 1;
        const v = clamp(0.5 - sample.latitude / Math.PI, 0, 0.999);

        const tx = Math.floor(u * textureWidth);
        const ty = Math.floor(v * textureHeight);
        const offset = (ty * textureWidth + tx) * 4;

        let red = texture[offset] ?? 0;
        let green = texture[offset + 1] ?? 0;
        let blue = texture[offset + 2] ?? 0;

        if (planet === "earth") {
          const cloudNoise =
            Math.sin(longitude * 8 + Math.sin(sample.latitude * 11) * 2.5 + angle * 0.22) *
            Math.cos(sample.latitude * 21 - longitude * 3) +
            Math.sin(longitude * 19 + sample.latitude * 15) * 0.35;

          const clouds = clamp((cloudNoise - 0.56) * 1.3, 0, 0.68);

          red = red * (1 - clouds) + 225 * clouds;
          green = green * (1 - clouds) + 238 * clouds;
          blue = blue * (1 - clouds) + 243 * clouds;
        }

        const rimStrength = planet === "earth" ? 0.6 : 0.25;
        const rim = sample.rim * rimStrength;

        output.data[sample.offset] = red * sample.light + rim * 66;
        output.data[sample.offset + 1] =
          green * sample.light + rim * (planet === "earth" ? 142 : 77);
        output.data[sample.offset + 2] =
          blue * sample.light + rim * (planet === "earth" ? 220 : 80);
        output.data[sample.offset + 3] = sample.alpha * 255;
      }

      context.putImageData(output, 0, 0);
    }

    function frame(now: number): void {
      raf = null;

      if (disposed || document.hidden || !active || !context) {
        return;
      }

      if (previous === null) {
        previous = now;
      }

      const delta = now - previous;

      if (delta >= 1000 / 24) {
        previous = now;
        angleRef.current +=
          Math.min(delta, 100) / 1000 * (Math.PI * 2 / (planet === "earth" ? 85 : 105));

        render(angleRef.current);
      }

      raf = window.requestAnimationFrame(frame);
    }

    render(angleRef.current);
    setReady(true);

    if (active) {
      raf = window.requestAnimationFrame(frame);
    }

    return () => {
      disposed = true;

      if (raf !== null) {
        window.cancelAnimationFrame(raf);
      }
    };
  }, [active, planet]);

  return (
    <div ref={ref} className="axial-planet" aria-hidden="true">
      {children}
      <canvas
        ref={canvasRef}
        className="axial-planet-surface"
        style={{ opacity: ready ? 1 : 0 }}
      />
    </div>
  );
}
