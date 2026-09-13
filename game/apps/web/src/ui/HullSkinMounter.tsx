import { useEffect } from 'react';

interface Geo {
 outer: string;
 inner: string;
 top: string;
 bottom: string;
 right: string;
 service: string;
 fasteners: Array<[number, number]>;
 plate: boolean;
 hazard: boolean;
 ticks: boolean;
 w: number;
 h: number;
}

function geo(w0: number, h0: number): Geo {
 const w = Math.max(36, w0);
 const h = Math.max(36, h0);
 const L = 1, T = 1, R = w - 1, B = h - 1;
 const sh = Math.min(22, w * 0.08, h * 0.12);
 const he = Math.min(14, w * 0.06, h * 0.1);
 const sTop = Math.max(sh + 16, Math.min(h * 0.4, h - 64));
 const sBot = Math.min(B - he - 14, sTop + Math.min(40, h * 0.18));
 const lS = Math.max(48, w * 0.67);
 const lE = Math.min(R - sh - 8, lS + 28);
 const lock = w >= 190 && lE > lS + 8;
 const serv = h >= 150;

 const p: string[] = [];
 p.push(`M${L + sh} ${T}`, `L${R - he} ${T}`, `L${R} ${T + he}`);
 if (serv) p.push(`L${R} ${sTop}`, `L${R - 5} ${sTop + 5}`, `L${R - 5} ${sBot - 5}`, `L${R} ${sBot}`);
 p.push(`L${R} ${B - sh}`, `L${R - sh} ${B}`);
 if (lock) p.push(`L${lE} ${B}`, `L${lE - 4} ${B - 5}`, `L${lS + 4} ${B - 5}`, `L${lS} ${B}`);
 p.push(`L${L + he} ${B}`, `L${L} ${B - he}`, `L${L} ${T + sh}`, 'Z');

 const i = 5;
 const inner =
  `M${L + sh + 2} ${T + i} L${R - he - 2} ${T + i} L${R - i} ${T + he + 2} ` +
  `L${R - i} ${B - sh - 2} L${R - sh - 2} ${B - i} L${L + he + 2} ${B - i} ` +
  `L${L + i} ${B - he - 2} L${L + i} ${T + sh + 2} Z`;

 return {
  outer: p.join(' '),
  inner,
  top: `M${L} ${T + sh + 18} V${T + sh} L${L + sh} ${T} H${L + sh + 42}`,
  bottom: `M${R - sh - 43} ${B} H${R - sh} L${R} ${B - sh} V${B - sh - 20}`,
  right: `M${R - he - 27} ${T} H${R - he} L${R} ${T + he} V${T + he + 13}`,
  service: serv ? `M${R - 2} ${sTop + 8} V${sBot - 8}` : '',
  fasteners: [
   [L + 12, T + sh + 13],
   [R - he - 12, T + 12],
   [R - 12, B - sh - 13],
   [L + he + 12, B - 12],
  ],
  plate: w >= 180 && h >= 140,
  hazard: serv,
  ticks: h >= 140,
  w,
  h,
 };
}

function buildSvg(g: Geo): string {
 const accent = '#D4A576';
 let s = `<svg viewBox="0 0 ${g.w} ${g.h}" preserveAspectRatio="none" focusable="false">`;
 s += `<path d="${g.outer}" fill="#1B202C" stroke="#56515A" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
 s += `<path d="${g.outer}" fill="url(#hull-mach)"/>`;
 s += `<path d="${g.outer}" fill="url(#hull-brush)"/>`;
 s += `<path d="${g.outer}" fill="url(#hull-ribs)"/>`;
 s += `<path d="${g.inner}" fill="none" stroke="#000000" stroke-opacity="0.4" stroke-width="1" vector-effect="non-scaling-stroke" transform="translate(0 1.5)"/>`;
 s += `<path d="${g.inner}" fill="#10141E" stroke="#93818E" stroke-opacity="0.22" stroke-width="0.75" vector-effect="non-scaling-stroke"/>`;
 s += `<path d="M${Math.min(22, g.w * 0.08) + 4} 2.5 H${g.w - 16}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`;
 s += `<path d="M${Math.min(14, g.w * 0.06) + 4} ${g.h - 2} H${g.w - 24}" stroke="rgba(0,0,0,0.55)" stroke-width="2"/>`;

 if (g.hazard) {
  s += `<rect x="${g.w - 11}" y="${Math.max(62, g.h * 0.57)}" width="5" height="${Math.min(36, g.h * 0.14)}" fill="url(#hull-haz)" opacity="0.5"/>`;
 }
 if (g.ticks) {
  for (let k = 0; k < 7; k++) {
   s += `<path d="M${g.w - 15} ${g.h - 54 - k * 6}h${k % 3 === 0 ? 7 : 4}" stroke="#B19BAA" stroke-opacity="${k % 3 === 0 ? 0.45 : 0.2}" stroke-width="0.75"/>`;
  }
 }

 s += `<path d="${g.top}" fill="none" stroke="${accent}" stroke-width="2.2" stroke-linecap="square" vector-effect="non-scaling-stroke"/>`;
 s += `<path d="${g.bottom}" fill="none" stroke="${accent}" stroke-width="2.2" stroke-linecap="square" vector-effect="non-scaling-stroke"/>`;
 s += `<path d="${g.right}" fill="none" stroke="#C9B9A8" stroke-opacity="0.45" stroke-width="1.3" vector-effect="non-scaling-stroke"/>`;
 if (g.service) {
  s += `<path d="${g.service}" fill="none" stroke="${accent}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
 }

 if (g.plate) {
  s +=
   '<g transform="translate(36 1)">' +
   '<path d="M0 0H80L75 12H0Z" fill="#2E292B" stroke="#82716B" stroke-width="0.7"/>' +
   `<rect x="5" y="3" width="2" height="6" fill="${accent}"/>` +
   '<text x="14" y="8.5" fill="#D8C4AD" font-family="\'JetBrains Mono\', monospace" font-size="6.5" letter-spacing="1.3">ARES-1</text>' +
   '</g>';
 }


 s += `<path d="M${g.w - 33} ${g.h - 12}h10" stroke="${accent}" stroke-width="2" opacity="0.3"/>`;
 s += `<path class="hull-trace hull-trace--outer" d="${g.outer}" pathLength="1000" fill="none" stroke="#A7DCFF" stroke-width="2" stroke-linecap="round" stroke-dasharray="60 940"/>`;
 s += `<path class="hull-trace hull-trace--inner" d="${g.inner}" pathLength="1000" fill="none" stroke="#FF87CC" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="36 964"/>`;
 s += '</svg>';
 return s;
}

/**
 * Находит все элементы .hull-skin в DOM (включая появившиеся динамически)
 * и вставляет в каждый настоящий SVG-каркас корпуса.
 */
export function HullSkinMounter(): JSX.Element {
 useEffect(() => {
  const mounted = new WeakSet<Element>();
  const observers = new Map<Element, ResizeObserver>();

  function apply(host: Element) {
   if (mounted.has(host)) return;
   mounted.add(host);

   const span = document.createElement('span');
   span.className = 'hull-frame-mount';
   span.setAttribute('aria-hidden', 'true');
   host.appendChild(span);

   const render = () => {
    const r = host.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    span.innerHTML = buildSvg(geo(r.width, r.height));
   };

   render();
   const ro = new ResizeObserver(() => render());
   ro.observe(host);
   observers.set(host, ro);
  }

  function scan() {
   document.querySelectorAll('.hull-skin').forEach((el) => apply(el));
  }

  scan();
  const mo = new MutationObserver(() => scan());
  mo.observe(document.body, { childList: true, subtree: true });

  return () => {
   mo.disconnect();
   observers.forEach((ro) => ro.disconnect());
   observers.clear();
   document.querySelectorAll('.hull-frame-mount').forEach((n) => n.remove());
  };
 }, []);

 return (
  <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
   <defs>
    <pattern id="hull-mach" width="6" height="6" patternUnits="userSpaceOnUse">
     <path d="M0 5.5H6" stroke="#D9C9B7" stroke-opacity="0.09" stroke-width="0.5" />
    </pattern>
    <pattern id="hull-haz" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
     <rect width="3" height="8" fill="#B17C4F" />
    </pattern>
    <pattern id="hull-brush" width="4" height="4" patternUnits="userSpaceOnUse">
     <path d="M0 1H4" stroke="#FFFFFF" stroke-opacity="0.025" stroke-width="0.6" />
     <path d="M0 3H4" stroke="#000000" stroke-opacity="0.06" stroke-width="0.6" />
    </pattern>
    <pattern id="hull-ribs" width="8" height="5" patternUnits="userSpaceOnUse">
     <path d="M0 1H8" stroke="#000000" stroke-opacity="0.2" stroke-width="1.2" />
     <path d="M0 3.5H8" stroke="#FFFFFF" stroke-opacity="0.035" stroke-width="0.7" />
    </pattern>
   </defs>
  </svg>
 );
}
