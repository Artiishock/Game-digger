import React, { useCallback, useEffect, useRef } from "react";
import { resolvePublicUrl } from "../utils/publicUrl";
import { getUrlParams } from "../rgs/client";

interface LogoSplashScreenProps {
  width: number;
  height: number;
  onComplete: () => void;
}

interface FrameInfo {
  page: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Layout {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** Парсит Spine v4 atlas-текст, возвращает map: frameName → FrameInfo */
function parseAtlas(text: string): Map<string, FrameInfo> {
  const map = new Map<string, FrameInfo>();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let currentPage = "";
  let currentFrame = "";

  for (const line of lines) {
    if (/\.(png|webp)$/i.test(line)) {
      currentPage = line;
      currentFrame = "";
    } else if (line.startsWith("bounds:") && currentFrame && currentPage) {
      const parts = line.slice(7).split(",").map((n) => parseInt(n.trim(), 10));
      if (parts.length >= 4) {
        map.set(currentFrame, {
          page: currentPage,
          x: parts[0]!,
          y: parts[1]!,
          w: parts[2]!,
          h: parts[3]!,
        });
      }
      currentFrame = "";
    } else if (!line.includes(":") && line.length > 0) {
      currentFrame = line;
    }
  }

  return map;
}

function computeLayout(
  canvasW: number,
  canvasH: number,
  frameW: number,
  frameH: number,
): Layout {
  const srcAspect = frameW / frameH;
  const dstAspect = canvasW / canvasH;
  let dw: number;
  let dh: number;
  if (dstAspect > srcAspect) {
    dh = canvasH / 2;
    dw = dh * srcAspect;
  } else {
    dw = canvasW / 2;
    dh = dw / srcAspect;
  }
  return {
    dx: (canvasW - dw) / 2,
    dy: (canvasH - dh) / 2,
    dw,
    dh,
  };
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function bakeFrameBitmap(
  img: HTMLImageElement,
  info: FrameInfo,
  layout: Layout,
): Promise<ImageBitmap | null> {
  const rw = Math.max(1, Math.round(layout.dw));
  const rh = Math.max(1, Math.round(layout.dh));
  try {
    return await createImageBitmap(img, info.x, info.y, info.w, info.h, {
      resizeWidth: rw,
      resizeHeight: rh,
      resizeQuality: "medium",
    });
  } catch {
    const off = document.createElement("canvas");
    off.width = rw;
    off.height = rh;
    const offCtx = off.getContext("2d");
    if (!offCtx) return null;
    offCtx.drawImage(img, info.x, info.y, info.w, info.h, 0, 0, rw, rh);
    try {
      return await createImageBitmap(off);
    } catch {
      return null;
    }
  }
}

/** Грузит текст атласа лого, пробуя `.atlas.txt` и `.atlas` — имя зависит от настроек упаковщика. */
async function fetchLogoAtlasText(baseUrl: string): Promise<string> {
  const stems = ["Full_logo_mono_white.atlas.txt", "Full_logo_mono_white.atlas"];
  let lastStatus = 0;
  for (const stem of stems) {
    const r = await fetch(baseUrl + stem);
    if (r.ok) return r.text();
    lastStatus = r.status;
  }
  throw new Error(`atlas ${lastStatus}`);
}

/**
 * LogoSplashScreen — проигрывает Spine-анимацию логотипа через Canvas 2D.
 * Показывается самой первой, поверх всего. Клик — пропуск.
 */
export const LogoSplashScreen: React.FC<LogoSplashScreenProps> = ({
  width,
  height,
  onComplete,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const isMobile =
    getUrlParams().device === "mobile" ||
    (typeof navigator !== "undefined" &&
      /Android|iP(hone|od|ad)|Mobile/i.test(navigator.userAgent));
  const maxDpr = isMobile ? 1 : 3;
  const dpr =
    typeof window !== "undefined"
      ? Math.min(Math.max(window.devicePixelRatio || 1, 1), maxDpr)
      : 1;

  const complete = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCompleteRef.current();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) { complete(); return; }
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) { complete(); return; }

    let cancelled = false;
    let rafId = 0;
    const bitmapsToClose: ImageBitmap[] = [];

    const closeBaked = () => {
      for (const bm of bitmapsToClose) bm.close();
      bitmapsToClose.length = 0;
    };

    const fallbackTimer = window.setTimeout(() => {
      if (!cancelled) complete();
    }, 20_000);

    const baseUrl = resolvePublicUrl("Logo_anim/");

    (async () => {
      try {
        const atlasText = await fetchLogoAtlasText(baseUrl);
        if (cancelled) return;

        const frameMap = parseAtlas(atlasText);

        const frameNames: string[] = [];
        for (let i = 0; i <= 104; i++) {
          const name = `Full_logo_mono_white_${String(i).padStart(5, "0")}`;
          if (frameMap.has(name)) frameNames.push(name);
        }
        if (frameNames.length === 0) { complete(); return; }

        const firstInfo = frameMap.get(frameNames[0]!)!;
        const layout = computeLayout(
          canvas.width,
          canvas.height,
          firstInfo.w,
          firstInfo.h,
        );

        const pageOrder: string[] = [];
        const seenPages = new Set<string>();
        for (const name of frameNames) {
          const page = frameMap.get(name)!.page;
          if (!seenPages.has(page)) {
            seenPages.add(page);
            pageOrder.push(page);
          }
        }

        const framesByPage = new Map<string, number[]>();
        for (let i = 0; i < frameNames.length; i++) {
          const page = frameMap.get(frameNames[i]!)!.page;
          const list = framesByPage.get(page);
          if (list) list.push(i);
          else framesByPage.set(page, [i]);
        }

        const paintBackground = () => {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        };

        const drawBaked = (idx: number, slots: (ImageBitmap | null)[]) => {
          const bm = slots[idx];
          if (!bm) return;
          paintBackground();
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(bm, layout.dx, layout.dy);
        };

        const drawFromAtlas = (
          name: string,
          imageMap: Map<string, HTMLImageElement>,
        ) => {
          const info = frameMap.get(name);
          if (!info) return;
          const img = imageMap.get(info.page);
          if (!img) return;
          paintBackground();
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(
            img,
            info.x,
            info.y,
            info.w,
            info.h,
            layout.dx,
            layout.dy,
            layout.dw,
            layout.dh,
          );
        };

        if (isMobile) {
          // Мобильный путь: bake в ImageBitmap (размер экрана), атласы 4096² сразу отпускаем.
          // Первый кадр — сразу, остальные bake параллельно с воспроизведением.
          const bakedSlots: (ImageBitmap | null)[] = new Array(frameNames.length).fill(null);

          const bakePage = async (page: string) => {
            if (cancelled) return;
            const img = await loadImage(baseUrl + page);
            if (!img) return;

            const indices = framesByPage.get(page) ?? [];
            await Promise.all(
              indices.map(async (idx) => {
                if (bakedSlots[idx] || cancelled) return;
                const info = frameMap.get(frameNames[idx]!)!;
                const bm = await bakeFrameBitmap(img, info, layout);
                if (bm && !cancelled) {
                  bakedSlots[idx] = bm;
                  bitmapsToClose.push(bm);
                }
              }),
            );

            img.src = "";
            img.onload = null;
          };

          await bakePage(pageOrder[0]!);
          if (cancelled) return;

          if (!bakedSlots[0]) { complete(); return; }
          drawBaked(0, bakedSlots);

          const bakeRest = Promise.all(
            pageOrder.slice(1).map((page) => bakePage(page)),
          );

          const FPS = 60;
          const FRAME_MS = 1000 / FPS;
          const startTime = performance.now();
          let frameIdx = 0;

          const tick = (now: number) => {
            if (cancelled) return;

            const targetIdx = Math.min(
              Math.floor((now - startTime) / FRAME_MS),
              frameNames.length - 1,
            );

            if (targetIdx > frameIdx) {
              let next = frameIdx;
              while (next < targetIdx && bakedSlots[next + 1]) next++;
              if (next !== frameIdx) {
                frameIdx = next;
                drawBaked(frameIdx, bakedSlots);
              }
            }

            if (frameIdx >= frameNames.length - 1 && bakedSlots[frameNames.length - 1]) {
              void bakeRest.finally(() => {
                window.setTimeout(() => {
                  if (!cancelled) complete();
                }, 400);
              });
              return;
            }

            rafId = requestAnimationFrame(tick);
          };

          rafId = requestAnimationFrame(tick);
          return;
        }

        // Десктоп: параллельная загрузка атласов, отрисовка с даунскейлом.
        const imageMap = new Map<string, HTMLImageElement>();
        await Promise.all(
          pageOrder.map(async (page) => {
            const img = await loadImage(baseUrl + page);
            if (img) imageMap.set(page, img);
          }),
        );
        if (cancelled) return;

        drawFromAtlas(frameNames[0]!, imageMap);

        const FPS = 60;
        const FRAME_MS = 1000 / FPS;
        const startTime = performance.now();
        let frameIdx = 0;

        const tick = (now: number) => {
          if (cancelled) return;

          const targetIdx = Math.min(
            Math.floor((now - startTime) / FRAME_MS),
            frameNames.length - 1,
          );

          if (targetIdx !== frameIdx) {
            frameIdx = targetIdx;
            drawFromAtlas(frameNames[frameIdx]!, imageMap);
          }

          if (frameIdx >= frameNames.length - 1) {
            window.setTimeout(() => {
              if (!cancelled) complete();
            }, 400);
            return;
          }

          rafId = requestAnimationFrame(tick);
        };

        rafId = requestAnimationFrame(tick);
      } catch (err) {
        console.warn("[LogoSplash] error:", err);
        if (!cancelled) complete();
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      clearTimeout(fallbackTimer);
      closeBaked();
    };
  }, [complete, isMobile]);

  return (
    <canvas
      ref={canvasRef}
      width={Math.round(width * dpr)}
      height={Math.round(height * dpr)}
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        background: "#000",
        cursor: "pointer",
      }}
      onClick={complete}
      title="Click to skip"
    />
  );
};
