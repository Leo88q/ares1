(() => {
  const failures = [];
  const warnings = [];

  function fail(message, element) {
    failures.push({ message, element });
  }

  function warn(message, element) {
    warnings.push({ message, element });
  }

  function accessibleName(element) {
    const direct = element.getAttribute("aria-label");

    if (direct?.trim()) {
      return direct.trim();
    }

    const labelledBy = element.getAttribute("aria-labelledby");

    if (labelledBy) {
      const text = labelledBy
        .trim()
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
        .trim();

      if (text) {
        return text;
      }
    }

    const clone = element.cloneNode(true);

    clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => {
      node.remove();
    });

    return clone.textContent?.trim() ?? "";
  }

  const h1 = document.querySelectorAll("h1");

  if (h1.length !== 1) {
    fail(`Expected one h1; found ${h1.length}.`, document);
  }

  const ids = new Map();

  document.querySelectorAll("[id]").forEach((element) => {
    const id = element.id;

    if (ids.has(id)) {
      fail(`Duplicate id: ${id}`, element);
    } else {
      ids.set(id, element);
    }
  });

  for (const attribute of [
    "aria-labelledby",
    "aria-describedby",
    "aria-controls",
  ]) {
    document.querySelectorAll(`[${attribute}]`).forEach((element) => {
      const references = element
        .getAttribute(attribute)
        ?.trim()
        .split(/\s+/)
        .filter(Boolean) ?? [];

      for (const reference of references) {
        if (!document.getElementById(reference)) {
          fail(`Missing ${attribute} target: ${reference}`, element);
        }
      }
    });
  }

  document.querySelectorAll("button").forEach((button) => {
    if (!accessibleName(button)) {
      fail("Button has no detectable accessible name.", button);
    }
  });

  document
    .querySelectorAll("input:not([type='hidden']), textarea, select")
    .forEach((field) => {
      const labels = field.labels ? Array.from(field.labels) : [];

      if (
        labels.length === 0 &&
        !field.getAttribute("aria-label") &&
        !field.getAttribute("aria-labelledby")
      ) {
        fail("Form field has no associated label.", field);
      }
    });

  const requiredSections = [
    "hero",
    "problem",
    "mechanics",
    "mascot",
    "tokenomics",
    "interstellar",
    "roadmap",
    "social",
    "faq",
    "waitlist",
  ];

  for (const id of requiredSections) {
    if (!document.querySelector(`section#${id}`)) {
      fail(`Missing section: ${id}`, document);
    }
  }

  const viewportWidth = document.documentElement.clientWidth;
  const pageWidth = document.documentElement.scrollWidth;

  if (pageWidth > viewportWidth + 1) {
    fail(
      `Horizontal overflow: ${pageWidth - viewportWidth}px.`,
      document.documentElement,
    );
  }

  document.querySelectorAll('a[href="#"]').forEach((link) => {
    warn("Unresolved hash link.", link);
  });

  const metaDescription = document.querySelector(
    'meta[name="description"]',
  );

  if (!metaDescription?.getAttribute("content")?.trim()) {
    fail("Missing meta description.", document.head);
  }

  if (!document.querySelector('link[rel="canonical"]')) {
    warn(
      "Canonical is absent. Set VITE_SITE_URL for production.",
      document.head,
    );
  }

  const reduced = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  if (
    reduced &&
    document.querySelector(
      ".holographic-dome-canvas, .prize-shader-canvas",
    )
  ) {
    fail(
      "GPU canvas is mounted while reduced motion is enabled.",
      document.body,
    );
  }

  console.group("ARES-1 browser audit");
  console.info("Failures:", failures.length);
  console.info("Warnings:", warnings.length);
  console.table(
    failures.map(({ message }) => ({ level: "FAIL", message })),
  );
  console.table(
    warnings.map(({ message }) => ({ level: "WARN", message })),
  );

  for (const issue of [...failures, ...warnings]) {
    console.log(issue.message, issue.element);
  }

  console.groupEnd();

  return {
    passed: failures.length === 0,
    failures,
    warnings,
  };
})();
