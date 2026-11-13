// Ported from Zudoku (src/components/ui/sonner.tsx) without next-themes:
// the theme follows the system, like the rest of the app (see main.tsx).
//
// Placement (Ztyle 05 safe areas): toasts never cover the board, its strips or the bottom bars; see
// `toasterPlacement.ts` for the three layouts (beside the landscape board, beside a wide portrait
// board, above the portrait bottom chrome). StatusBar keeps the landscape bottom right free, and
// while toasts show there the right rail moves up above them (`RAIL_TOASTS_VAR`).
import { useEffect, useRef, useState, type RefObject } from "react";
import { Toaster as Sonner, toast } from "sonner";
import { useIsMobileLandscape } from "@/hooks/use-orientation";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RAIL_TOASTS_VAR, railToastsValue, toastStackPx, toasterPlacement, type Viewport } from "./toasterPlacement";

function currentViewport(): Viewport {
  return typeof window === "undefined" ? { width: 1024, height: 768 } : { width: window.innerWidth, height: window.innerHeight };
}

/** The window size, following resizes and rotations. */
function useViewport(): Viewport {
  const [viewport, setViewport] = useState(currentViewport);
  useEffect(() => {
    const update = () =>
      setViewport((v) => {
        const next = currentViewport();
        return next.width === v.width && next.height === v.height ? v : next;
      });
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  return viewport;
}

/** The toasts on screen (not leaving), the front one first, and whether sonner shows them expanded. */
function toastStack(region: HTMLElement): { heights: number[]; expanded: boolean } {
  const toasts = [...region.querySelectorAll<HTMLElement>("[data-sonner-toast]")].filter((el) => el.dataset.removed !== "true");
  toasts.sort((a, b) => Number(b.dataset.front === "true") - Number(a.dataset.front === "true"));
  return { heights: toasts.map((el) => el.offsetHeight), expanded: toasts.some((el) => el.dataset.expanded === "true") };
}

/**
 * Mobile landscape: publishes how much of the bottom right the toasts take (`RAIL_TOASTS_VAR`), so
 * the right rail (toolbar or scoring bar) moves up above them instead of being covered.
 */
function usePublishRailToasts(region: RefObject<HTMLElement | null>, rail: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    const node = region.current;
    if (!rail || !node) {
      root.style.removeProperty(RAIL_TOASTS_VAR);
      return;
    }
    let frame = 0;
    const publish = () => {
      frame = 0;
      const { heights, expanded } = toastStack(node);
      const px = toastStackPx(heights, expanded);
      if (px > 0) root.style.setProperty(RAIL_TOASTS_VAR, railToastsValue(px));
      else root.style.removeProperty(RAIL_TOASTS_VAR);
    };
    // Toasts come, go, change their text and expand: sonner's attributes change with each.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(publish);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(node, { subtree: true, childList: true, attributes: true, characterData: true });
    window.addEventListener("resize", schedule);
    publish();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
      root.style.removeProperty(RAIL_TOASTS_VAR);
    };
  }, [region, rail]);
}

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ className, ...props }: ToasterProps) => {
  const { t } = useI18n();
  const landscape = useIsMobileLandscape();
  const viewport = useViewport();
  const placement = toasterPlacement(landscape, viewport);
  const region = useRef<HTMLElement>(null);
  usePublishRailToasts(region, placement.layout === "rail");
  return (
    <Sonner
      ref={region}
      theme="system"
      position={placement.position}
      containerAriaLabel={t("platform.notifications")}
      offset={placement.offset}
      mobileOffset={placement.mobileOffset}
      style={placement.style}
      className={cn("toaster group", placement.className, className)}
      toastOptions={{
        classNames: {
          // `toast` gives custom toasts (requests) Ztyle's frame; `justify-start` undoes that recipe's
          // space-between, which pushed a system toast's text away from its icon.
          toast:
            "group toast justify-start group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:font-mono group-[.toaster]:rounded-xl",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-foreground group-[.toast]:text-background group-[.toast]:uppercase group-[.toast]:tracking-wider",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

// eslint-disable-next-line react-refresh/only-export-components -- shadcn re-exports toast with the Toaster
export { Toaster, toast };
