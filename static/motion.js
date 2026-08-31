(() => {
  const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let presenceSequence = 0;
  const duration = Object.freeze({ fast: 160, normal: 240, slow: 340, modal: 300 });
  const spring = Object.freeze({
    soft: Object.freeze({ damping: 25, mass: 1, stiffness: 230 }),
    responsive: Object.freeze({ damping: 30, mass: 0.9, stiffness: 330 }),
    snappy: Object.freeze({ damping: 34, mass: 0.8, stiffness: 420 }),
    modal: Object.freeze({ damping: 28, mass: 1, stiffness: 290 }),
    layout: Object.freeze({ damping: 34, mass: 0.9, stiffness: 360 }),
  });

  function reduced() {
    return mediaQuery.matches;
  }

  function finish(animation) {
    return animation?.finished?.catch(() => undefined) ?? Promise.resolve();
  }

  function springProgress(time, profile) {
    const omega = Math.sqrt(profile.stiffness / profile.mass);
    const ratio = profile.damping / (2 * Math.sqrt(profile.stiffness * profile.mass));
    if (ratio >= 1) return 1 - Math.exp(-omega * time);
    const damped = omega * Math.sqrt(1 - ratio ** 2);
    const progress = 1 - Math.exp(-ratio * omega * time) * (Math.cos(damped * time) + (ratio * omega / damped) * Math.sin(damped * time));
    return Math.min(1.015, Math.max(0, progress));
  }

  function frames(from, to, profile, steps = 14) {
    return Array.from({ length: steps }, (_, index) => {
      const progress = index === steps - 1 ? 1 : springProgress(index / (steps - 1), profile);
      const scale = from.scale + (to.scale - from.scale) * progress;
      const x = from.x + (to.x - from.x) * progress;
      const y = from.y + (to.y - from.y) * progress;
      const opacity = from.opacity + (to.opacity - from.opacity) * Math.min(1, progress);
      const blur = from.blur + (to.blur - from.blur) * Math.min(1, progress);
      return { filter: `blur(${blur}px)`, opacity, transform: `translate3d(${x}px, ${y}px, 0) scale(${scale})` };
    });
  }

  function animate(element, keyframes, options = {}) {
    if (!element || reduced() || typeof element.animate !== "function") return Promise.resolve();
    return finish(element.animate(keyframes, { duration: duration.normal, easing: "cubic-bezier(.22,1,.36,1)", fill: "both", ...options }));
  }

  const presets = Object.freeze({
    image: Object.freeze({ from: { blur: 0, opacity: 0, scale: 1.015, x: 0, y: 0 }, profile: spring.soft, to: { blur: 0, opacity: 1, scale: 1, x: 0, y: 0 } }),
    list: Object.freeze({ from: { blur: 0, opacity: 0, scale: 0.985, x: 0, y: 10 }, profile: spring.responsive, to: { blur: 0, opacity: 1, scale: 1, x: 0, y: 0 } }),
    menu: Object.freeze({ from: { blur: 2, opacity: 0, scale: 0.96, x: 0, y: -7 }, profile: spring.snappy, to: { blur: 0, opacity: 1, scale: 1, x: 0, y: 0 } }),
    modal: Object.freeze({ from: { blur: 3, opacity: 0, scale: 0.88, x: 0, y: 20 }, profile: spring.modal, to: { blur: 0, opacity: 1, scale: 1, x: 0, y: 0 } }),
    page: Object.freeze({ from: { blur: 0, opacity: 0, scale: 0.99, x: 0, y: 10 }, profile: spring.soft, to: { blur: 0, opacity: 1, scale: 1, x: 0, y: 0 } }),
    panel: Object.freeze({ from: { blur: 1, opacity: 0, scale: 0.98, x: 0, y: 8 }, profile: spring.responsive, to: { blur: 0, opacity: 1, scale: 1, x: 0, y: 0 } }),
  });

  function enter(element, kind = "panel") {
    const preset = presets[kind] || presets.panel;
    return animate(element, frames(preset.from, preset.to, preset.profile), { duration: kind === "modal" ? duration.modal : duration.normal });
  }

  function exit(element, kind = "panel") {
    const preset = presets[kind] || presets.panel;
    const target = { ...preset.from, opacity: 0, scale: Math.max(.94, preset.from.scale) };
    return animate(element, [preset.to, target], { duration: duration.fast, easing: "cubic-bezier(.4,0,1,1)" });
  }

  function show(element, kind = "panel") {
    if (!element) return Promise.resolve();
    element.dataset.motionPresence = String(++presenceSequence);
    element.hidden = false;
    return enter(element, kind);
  }

  function hide(element, kind = "panel") {
    if (!element || element.hidden) return Promise.resolve();
    const sequence = String(++presenceSequence);
    element.dataset.motionPresence = sequence;
    return exit(element, kind).then(() => {
      if (element.dataset.motionPresence === sequence) element.hidden = true;
    });
  }

  function openDialog(dialog) {
    if (!dialog.open) dialog.showModal();
    return enter(dialog, "modal");
  }

  function closeDialog(dialog) {
    if (!dialog?.open || dialog.dataset.motionClosing === "true") return Promise.resolve();
    dialog.dataset.motionClosing = "true";
    return exit(dialog, "modal").then(() => dialog.close()).finally(() => { delete dialog.dataset.motionClosing; });
  }

  function layout(element, mutate) {
    if (!element || reduced()) return mutate();
    const first = element.getBoundingClientRect();
    mutate();
    const last = element.getBoundingClientRect();
    const deltaX = first.left - last.left;
    const deltaY = first.top - last.top;
    const scaleX = last.width ? first.width / last.width : 1;
    const scaleY = last.height ? first.height / last.height : 1;
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1 && Math.abs(scaleX - 1) < .01 && Math.abs(scaleY - 1) < .01) return undefined;
    return animate(element, [
      { transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`, transformOrigin: "top center" },
      { transform: "translate3d(0, 0, 0) scale(1, 1)", transformOrigin: "top center" },
    ], { duration: duration.normal, easing: "cubic-bezier(.22,1,.36,1)" });
  }

  function stagger(elements, kind = "list") {
    if (reduced()) return;
    Array.from(elements).slice(0, 8).forEach((element, index) => {
      const preset = presets[kind] || presets.list;
      void animate(element, frames(preset.from, preset.to, preset.profile, 10), { delay: index * 28, duration: duration.normal });
    });
  }

  function replace(container, child, kind = "image") {
    if (!container) return;
    container.replaceChildren(child);
    void enter(child, kind);
  }

  function pulse(element, strength = 1.06) {
    return animate(element, [
      { transform: "scale(1)" },
      { transform: `scale(${strength})`, offset: .42 },
      { transform: "scale(1)" },
    ], { duration: duration.fast, easing: "cubic-bezier(.22,1,.36,1)" });
  }

  function syncPreference() {
    document.documentElement.dataset.motion = reduced() ? "reduced" : "full";
  }

  mediaQuery.addEventListener?.("change", syncPreference);
  syncPreference();
  window.EliteHubMotion = Object.freeze({ animate, closeDialog, duration, enter, exit, hide, layout, openDialog, pulse, reduced, replace, show, spring, stagger });
})();
