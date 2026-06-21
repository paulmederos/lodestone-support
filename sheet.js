/* ============================================================================
   Lodestone — iOS-style bottom sheet
   Slide-up spring + dimmed scrim, grabber, tap-scrim / Esc / drag-down to
   dismiss, body scroll-lock. Triggered by any [data-sheet="id"]; the element's
   href is the no-JS fallback.
   ========================================================================== */
(() => {
  "use strict";
  const scrim = document.getElementById("scrim");
  if (!scrim) return;

  let active = null;          // currently open sheet element
  let lastTrigger = null;     // element to restore focus to

  function open(sheet, trigger) {
    if (active) return;
    active = sheet;
    lastTrigger = trigger || null;
    sheet.hidden = false;
    scrim.hidden = false;
    sheet.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    // force a reflow so the off-screen start state commits before we transition
    // (reliable regardless of rAF throttling in background tabs)
    void sheet.offsetHeight;
    scrim.classList.add("show");
    sheet.classList.add("show");
    sheet.focus({ preventScroll: true });
  }

  function close() {
    if (!active) return;
    const sheet = active;
    active = null;
    scrim.classList.remove("show");
    sheet.classList.remove("show");
    sheet.style.transform = "";
    let finished = false;
    const done = (e) => {
      if (finished || (e && e.target !== sheet)) return;
      finished = true;
      clearTimeout(fallback);
      sheet.hidden = true;
      scrim.hidden = true;
      sheet.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      sheet.removeEventListener("transitionend", done);
      if (lastTrigger && lastTrigger.focus) lastTrigger.focus();
    };
    sheet.addEventListener("transitionend", done);
    // fallback in case transitionend is dropped (interrupted / backgrounded tab)
    const fallback = setTimeout(done, 520);
  }

  // open triggers (href stays as the no-JS fallback)
  document.querySelectorAll("[data-sheet]").forEach((el) => {
    el.addEventListener("click", (e) => {
      const sheet = document.getElementById(el.getAttribute("data-sheet"));
      if (!sheet) return;
      e.preventDefault();
      open(sheet, el);
    });
  });

  scrim.addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  document.querySelectorAll(".sheet-grab").forEach((g) => g.addEventListener("click", close));

  // drag-to-dismiss (from the grabber / header; body scrolls natively)
  document.querySelectorAll(".sheet").forEach((sheet) => {
    const body = sheet.querySelector(".sheet-body");
    let startY = null, dy = 0, dragging = false;

    sheet.addEventListener("pointerdown", (e) => {
      if (e.target.closest("a, button:not(.sheet-grab)")) return;
      if (body && body.scrollTop > 0) return;     // let the body scroll first
      dragging = true; startY = e.clientY; dy = 0;
      sheet.style.transition = "none";
      sheet.setPointerCapture && sheet.setPointerCapture(e.pointerId);
    });
    sheet.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      dy = Math.max(0, e.clientY - startY);
      sheet.style.transform = `translateY(${dy}px)`;
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      sheet.style.transition = "";
      if (dy > 110) close();
      else sheet.style.transform = "";
      startY = null; dy = 0;
    };
    sheet.addEventListener("pointerup", end);
    sheet.addEventListener("pointercancel", end);
  });
})();
