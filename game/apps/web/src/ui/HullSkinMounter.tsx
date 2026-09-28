import { useEffect } from 'react';

/**
 * Монтирует сгенерированный арт-каркас корпуса (public/ares/hull-frame.webp)
 * во все элементы .hull-skin. Картинка тянется вместе с панелью средствами CSS,
 * поэтому наблюдатели размеров не нужны — только отслеживание новых узлов.
 */
export function HullSkinMounter(): null {
 useEffect(() => {
  const mounted = new WeakSet<Element>();

  function apply(host: Element) {
   if (mounted.has(host)) return;
   mounted.add(host);

   const span = document.createElement('span');
   span.className = 'hull-frame-mount';
   span.setAttribute('aria-hidden', 'true');
   span.innerHTML =
    '<img src="/ares/hull-frame.webp" alt="" draggable="false" style="display:block;width:100%;height:100%;max-width:none" />';
   host.appendChild(span);
  }

  function scan() {
   document.querySelectorAll('.hull-skin').forEach((el) => apply(el));
  }

  scan();
  const mo = new MutationObserver(() => scan());
  mo.observe(document.body, { childList: true, subtree: true });

  return () => {
   mo.disconnect();
   document.querySelectorAll('.hull-frame-mount').forEach((n) => n.remove());
  };
 }, []);

 return null;
}
