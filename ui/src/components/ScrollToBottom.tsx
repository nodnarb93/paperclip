import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { usePanel } from "../context/PanelContext";
import { cn } from "../lib/utils";

function resolveScrollTarget() {
  const mainContent = document.getElementById("main-content");

  if (mainContent instanceof HTMLElement) {
    const overflowY = window.getComputedStyle(mainContent).overflowY;
    const usesOwnScroll =
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay")
      && mainContent.scrollHeight > mainContent.clientHeight + 1;

    if (usesOwnScroll) {
      return { type: "element" as const, element: mainContent };
    }
  }

  return { type: "window" as const };
}

function distanceFromBottom(target: ReturnType<typeof resolveScrollTarget>) {
  if (target.type === "element") {
    return target.element.scrollHeight - target.element.scrollTop - target.element.clientHeight;
  }

  const scroller = document.scrollingElement ?? document.documentElement;
  return scroller.scrollHeight - window.scrollY - window.innerHeight;
}

function distanceFromTop(target: ReturnType<typeof resolveScrollTarget>) {
  if (target.type === "element") return target.element.scrollTop;
  return window.scrollY;
}

function scrollToBottom(behavior: ScrollBehavior) {
  const target = resolveScrollTarget();
  if (target.type === "element") {
    target.element.scrollTo({ top: target.element.scrollHeight, behavior });
    return;
  }
  const scroller = document.scrollingElement ?? document.documentElement;
  window.scrollTo({ top: scroller.scrollHeight, behavior });
}

function scrollToTop(behavior: ScrollBehavior) {
  const target = resolveScrollTarget();
  if (target.type === "element") {
    target.element.scrollTo({ top: 0, behavior });
    return;
  }
  window.scrollTo({ top: 0, behavior });
}

/**
 * Floating scroll-to-bottom and scroll-to-top buttons that follow the active
 * page scroller. On desktop that is `#main-content`; on mobile it falls back
 * to window/page scroll.
 *
 * PATCH(nodnarb93): scroll-bottom (Patch 13) — added a paired up-arrow
 * button (mirror of the existing down-arrow), and on initial mount the
 * component instant-scrolls the page to the bottom once the content has
 * settled (no animation = no dizziness). The auto-scroll cancels if the
 * user interacts (wheel/touch/key) before content settles, so reading the
 * top of a slow-loading page isn't interrupted by an unwanted jump.
 */
export function ScrollToBottom() {
  const [showDown, setShowDown] = useState(false);
  const [showUp, setShowUp] = useState(false);
  const { panelVisible, panelContent } = usePanel();

  // Visibility tracking for both arrows. Down shown when far from bottom,
  // up shown when far from top.
  useEffect(() => {
    const check = () => {
      const target = resolveScrollTarget();
      setShowDown(distanceFromBottom(target) > 300);
      setShowUp(distanceFromTop(target) > 300);
    };

    const mainContent = document.getElementById("main-content");

    check();
    mainContent?.addEventListener("scroll", check, { passive: true });
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);

    return () => {
      mainContent?.removeEventListener("scroll", check);
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  // PATCH(nodnarb93): scroll-bottom (Patch 13) — auto-scroll to bottom on
  // initial mount. The chat thread loads asynchronously so we can't just
  // scroll on the first paint; instead we poll scrollHeight for stability
  // (no growth for ~300ms = content has stopped loading) and then scroll.
  // Use behavior:"instant" so the user perceives the page as having always
  // been at the bottom rather than seeing an animated jump.
  //
  // Bail-out conditions:
  //   - user interacts via wheel/touch/key (real input, not programmatic)
  //   - 5s safety timeout (e.g. infinite-growing pages)
  useEffect(() => {
    let cancelled = false;
    let lastHeight = -1;
    let stableTicks = 0;
    const POLL_INTERVAL_MS = 100;
    const STABLE_TICKS_REQUIRED = 3; // ~300ms of no growth
    const SAFETY_TIMEOUT_MS = 5000;
    const startedAt = Date.now();

    const cancelOnUserInput = () => {
      cancelled = true;
    };

    // Wheel/touch/key = real user intent. Don't use the generic "scroll"
    // event — that would fire from our own programmatic scrollTo().
    window.addEventListener("wheel", cancelOnUserInput, { passive: true, once: true });
    window.addEventListener("touchstart", cancelOnUserInput, { passive: true, once: true });
    window.addEventListener("keydown", cancelOnUserInput, { once: true });

    const tick = () => {
      if (cancelled) return;
      if (Date.now() - startedAt > SAFETY_TIMEOUT_MS) return;

      const target = resolveScrollTarget();
      const currentHeight = target.type === "element"
        ? target.element.scrollHeight
        : (document.scrollingElement ?? document.documentElement).scrollHeight;

      if (currentHeight === lastHeight && currentHeight > 0) {
        stableTicks += 1;
        if (stableTicks >= STABLE_TICKS_REQUIRED) {
          scrollToBottom("instant");
          return;
        }
      } else {
        lastHeight = currentHeight;
        stableTicks = 0;
      }
      window.setTimeout(tick, POLL_INTERVAL_MS);
    };

    window.setTimeout(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.removeEventListener("wheel", cancelOnUserInput);
      window.removeEventListener("touchstart", cancelOnUserInput);
      window.removeEventListener("keydown", cancelOnUserInput);
    };
  }, []);

  // PATCH(nodnarb93): scroll-bottom (Patch 13) — explicit button clicks
  // use smooth scroll (user-initiated, conventional behavior). Only the
  // auto-scroll-on-mount uses instant.
  const onClickDown = useCallback(() => scrollToBottom("smooth"), []);
  const onClickTop = useCallback(() => scrollToTop("smooth"), []);

  if (!showDown && !showUp) return null;

  // Both buttons positioned at right side. Up arrow sits above the down
  // arrow when both are shown (which happens for tall pages mid-scroll).
  const sharedClasses = cn(
    "fixed right-6 z-40 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background shadow-md hover:bg-accent transition-[background-color,right,bottom] duration-200",
    panelVisible && panelContent && "md:right-[calc(320px+1.5rem)]",
  );

  return (
    <>
      {showDown ? (
        <button
          onClick={onClickDown}
          className={cn(
            sharedClasses,
            "bottom-[calc(1.5rem+5rem+env(safe-area-inset-bottom))] md:bottom-6",
          )}
          aria-label="Scroll to bottom"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      ) : null}
      {showUp ? (
        <button
          onClick={onClickTop}
          className={cn(
            sharedClasses,
            // Up arrow sits 3rem above the down arrow when both are shown,
            // or at the down arrow's normal spot when only up is visible.
            showDown
              ? "bottom-[calc(1.5rem+5rem+3rem+env(safe-area-inset-bottom))] md:bottom-[calc(1.5rem+3rem)]"
              : "bottom-[calc(1.5rem+5rem+env(safe-area-inset-bottom))] md:bottom-6",
          )}
          aria-label="Scroll to top"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      ) : null}
    </>
  );
}
