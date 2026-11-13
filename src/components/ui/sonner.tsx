// Ported from Zudoku (src/components/ui/sonner.tsx) without next-themes:
// the theme follows the system, like the rest of the app (see main.tsx).
//
// Placement (Ztyle 05 safe areas): toasts never cover the board, its strips or the bottom bars; see
// `toasterPlacement.ts` for the three layouts (beside the landscape board, beside a wide portrait
// board, above the portrait bottom chrome). StatusBar keeps the landscape bottom right free.
import { useEffect, useState } from "react";
import { Toaster as Sonner, toast } from "sonner";
import { useIsMobileLandscape } from "@/hooks/use-orientation";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { toasterPlacement, type Viewport } from "./toasterPlacement";

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

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ className, ...props }: ToasterProps) => {
  const { t } = useI18n();
  const landscape = useIsMobileLandscape();
  const viewport = useViewport();
  const placement = toasterPlacement(landscape, viewport);
  return (
    <Sonner
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
