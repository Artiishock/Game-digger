import React, { useCallback, useEffect, useRef } from "react";
import { resolvePublicUrl } from "../utils/publicUrl";

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

/** Парсит Spine v4 atlas-текст, возвращает map: frameName → FrameInfo */
function parseAtlas(text: string): Map<string, FrameInfo> {
  const map = new Map<string, FrameInfo>();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let currentPage = "";
  let currentFrame = "";

  for (const line of lines) {
    if (/\.png$/i.test(line)) {
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

  const complete = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCompleteRef.current();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) { complete(); return; }
    const ctx = canvas.getContext("2d");
    if (!ctx) { complete(); return; }

    let cancelled = false;
    let rafId = 0;

    // Защита от зависания: максимум 20 секунд на всё
    const fallbackTimer = window.setTimeout(() => {
      if (!cancelled) complete();
    }, 20_000);

    const baseUrl = resolvePublicUrl("Logo_anim/");

    (async () => {
      try {
        // 1. Загружаем и парсим atlas
        const atlasText = await fetch(baseUrl + "Full_logo_mono_white.atlas").then(
          (r) => {
            if (!r.ok) throw new Error(`atlas ${r.status}`);
            return r.text();
          }
        );
        if (cancelled) return;

        const frameMap = parseAtlas(atlasText);

        // 2. Строим последовательность кадров 00000 → 00104
        const frameNames: string[] = [];
        for (let i = 0; i <= 104; i++) {
          const name = `Full_logo_mono_white_${String(i).padStart(5, "0")}`;
          if (frameMap.has(name)) frameNames.push(name);
        }
        if (frameNames.length === 0) { complete(); return; }

        // 3. Порядок страниц для воспроизведения
        const pageOrder: string[] = [];
        const seenPages = new Set<string>();
        for (const name of frameNames) {
          const page = frameMap.get(name)!.page;
          if (!seenPages.has(page)) {
            seenPages.add(page);
            pageOrder.push(page);
          }
        }

        // 4. Параллельная загрузка всех страниц-атласов
        const imageMap = new Map<string, HTMLImageElement>();
        await Promise.all(
          pageOrder.map(
            (page) =>
              new Promise<void>((resolve) => {
                const img = new Image();
                img.onload = () => { imageMap.set(page, img); resolve(); };
                img.onerror = () => resolve(); // не блокируем при ошибке
                img.src = baseUrl + page;
              })
          )
        );
        if (cancelled) return;

        // 5. Функция отрисовки одного кадра
        const draw = (name: string) => {
          const info = frameMap.get(name);
          if (!info) return;
          const img = imageMap.get(info.page);
          if (!img) return;

          // Центрируем с сохранением пропорций (letter/pillarbox)
          const srcAspect = info.w / info.h;
          const dstAspect = canvas.width / canvas.height;
          let dw: number, dh: number, dx: number, dy: number;
          if (dstAspect > srcAspect) {
            dh = canvas.height;
            dw = dh * srcAspect;
            dx = (canvas.width - dw) / 2;
            dy = 0;
          } else {
            dw = canvas.width;
            dh = dw / srcAspect;
            dx = 0;
            dy = (canvas.height - dh) / 2;
          }

          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, info.x, info.y, info.w, info.h, dx, dy, dw, dh);
        };

        // 6. Прогрев GPU — рисуем первый кадр до старта rAF-цикла.
        //    Это вызывает загрузку текстуры в GPU заранее,
        //    чтобы первые кадры анимации не тормозили.
        draw(frameNames[0]!);

        // 7. rAF-цикл воспроизведения
        const FPS = 12.5 * 3; // x3 скорость
        const FRAME_MS = 1000 / FPS;
        let frameIdx = 0;
        let accumulated = 0;
        let prevNow = performance.now();

        const tick = (now: number) => {
          if (cancelled) return;

          accumulated += now - prevNow;
          prevNow = now;

          // Продвигаем кадры — до 4 за один тик, чтобы догнать отставание
          // (на медленном устройстве анимация не «плывёт»).
          let advanced = 0;
          while (
            accumulated >= FRAME_MS &&
            frameIdx < frameNames.length - 1 &&
            advanced < 4
          ) {
            accumulated -= FRAME_MS;
            frameIdx++;
            advanced++;
          }
          // Сбрасываем накопленное если отстали более чем на 4 кадра
          if (accumulated > FRAME_MS * 4) accumulated = 0;

          if (advanced > 0) draw(frameNames[frameIdx]!);

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
    };
  }, [complete]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
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
