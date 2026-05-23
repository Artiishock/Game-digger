import React, { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../i18n/t";
import { resolvePublicUrl } from "../utils/publicUrl";

interface StartScreenProps {
  width: number;
  height: number;
  onStart: () => void;
  onReady?: () => void;
}

const slides = [
  { image: resolvePublicUrl("rules/multipliers.png"), alt: "Multipliers", titleKey: "collect multipliers" },
  { image: resolvePublicUrl("rules/treats.png"),      alt: "Treats",      titleKey: "avoid threats" },
  { image: resolvePublicUrl("rules/places.png"),      alt: "Places",      titleKey: "get to safe place" },
];

const criticalImageUrls = [
  resolvePublicUrl("rules/background.png"),
  resolvePublicUrl("rules/logo_magnetic.svg"),
  resolvePublicUrl("rules/banner.svg"),
  resolvePublicUrl("rules/button_left.svg"),
  resolvePublicUrl("rules/button_right.svg"),
  resolvePublicUrl("rules/point.svg"),
  resolvePublicUrl("rules/point_active.svg"),
  ...slides.map((slide) => slide.image),
] as const;

interface RulesArrowButtonProps {
  className: string;
  ariaLabel: string;
  src: string;
  onActivate: () => void;
  onReady: () => void;
}

/**
 * RulesArrowButton — встраивает SVG-кнопку inline через fetch(), чтобы обойти
 * CSP-директиву "object-src 'none'" на платформе Stake Engine.
 * Hover/active-эффекты работают, потому что SVG является частью документа.
 */
const RulesArrowButton: React.FC<RulesArrowButtonProps> = ({
  className,
  ariaLabel,
  src,
  onActivate,
  onReady,
}) => {
  const readySentRef = useRef(false);
  const [svgHtml, setSvgHtml] = useState<string | null>(null);

  const markReady = useCallback(() => {
    if (readySentRef.current) return;
    readySentRef.current = true;
    onReady();
  }, [onReady]);

  // Fallback: если fetch завис — всё равно сообщаем о готовности
  useEffect(() => {
    const fallbackId = window.setTimeout(markReady, 800);
    return () => {
      window.clearTimeout(fallbackId);
    };
  }, [markReady]);

  // Загружаем SVG-текст и встраиваем inline — обходит "object-src 'none'"
  useEffect(() => {
    let cancelled = false;
    fetch(src)
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((text) => {
        if (!cancelled) {
          setSvgHtml(text);
          markReady();
        }
      })
      .catch(() => {
        if (!cancelled) markReady();
      });
    return () => {
      cancelled = true;
    };
  }, [src, markReady]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onActivate();
  };

  return (
    <div
      className={`rules-arrow ${className}`}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onActivate}
      onKeyDown={handleKeyDown}
      // dangerouslySetInnerHTML безопасен: src — это наш собственный URL из public/
      dangerouslySetInnerHTML={svgHtml !== null ? { __html: svgHtml } : undefined}
    />
  );
};

export const StartScreen: React.FC<StartScreenProps> = ({ width, height, onStart, onReady }) => {
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [bannerSrc, setBannerSrc] = useState(resolvePublicUrl("rules/banner.svg"));
  const [slideAnimation, setSlideAnimation] = useState<"left" | "right" | null>(null);
  const [loadedArrowObjects, setLoadedArrowObjects] = useState(0);
  const backgroundImage = `url("${resolvePublicUrl("rules/background.png")}")`;

  const handleArrowReady = useCallback(() => {
    setLoadedArrowObjects((current) => Math.min(2, current + 1));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let firstRafId = 0;
    let secondRafId = 0;

    const decodeImage = (url: string) =>
      new Promise<void>((resolve) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => {
          if (!image.decode) {
            resolve();
            return;
          }

          void image.decode().then(
            () => resolve(),
            () => resolve()
          );
        };
        image.onerror = () => resolve();
        image.src = url;
      });

    void (async () => {
      await Promise.all(criticalImageUrls.map(decodeImage));
      await Promise.race([
        document.fonts?.ready ?? Promise.resolve(),
        new Promise((resolve) => window.setTimeout(resolve, 350)),
      ]);
      if (loadedArrowObjects < 2) return;
      if (cancelled) return;

      firstRafId = window.requestAnimationFrame(() => {
        secondRafId = window.requestAnimationFrame(() => {
          if (!cancelled) onReady?.();
        });
      });
    })();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstRafId);
      window.cancelAnimationFrame(secondRafId);
    };
  }, [loadedArrowObjects, onReady]);

  const goToPreviousSlide = () => {
    setSlideAnimation("left");
    setActiveSlideIndex((currentIndex) =>
      currentIndex === 0 ? slides.length - 1 : currentIndex - 1
    );
  };

  const goToNextSlide = () => {
    setSlideAnimation("right");
    setActiveSlideIndex((currentIndex) =>
      currentIndex === slides.length - 1 ? 0 : currentIndex + 1
    );
  };

  const isPlacesSlide = activeSlideIndex === 2;

  return (
    <div className="rules-start-screen" style={{ width, height, backgroundImage }}>
      <img
        className="rules-logo"
        src={resolvePublicUrl("rules/logo_magnetic.svg")}
        alt="Magnetic"
        loading="eager"
        decoding="sync"
      />

      <div className="rules-content">
        <img
          className="rules-banner"
          src={bannerSrc}
          alt="Deep Rush"
          loading="eager"
          decoding="sync"
          onError={() => setBannerSrc(resolvePublicUrl("rules/logo_magnetic.svg"))}
        />

        <div className="rules-center">
          <div className="rules-multipliers-block">
            <div
              className={`rules-slide-main ${
                isPlacesSlide ? "rules-slide-main--places" : ""
              } ${slideAnimation ? `rules-slide-main--${slideAnimation}` : ""}`}
            >
              <RulesArrowButton
                className="rules-arrow--left"
                ariaLabel="Previous slide"
                src={resolvePublicUrl("rules/button_left.svg")}
                onActivate={goToPreviousSlide}
                onReady={handleArrowReady}
              />

              <div className="rules-image-slot">
                {slides.map((slide, index) => (
                  <img
                    key={`${slide.image}-${index === activeSlideIndex ? slideAnimation : "idle"}`}
                    className={`rules-multipliers ${
                      index === activeSlideIndex ? "rules-multipliers--active" : ""
                    } ${index === 2 ? "rules-multipliers--places" : ""}`}
                    src={slide.image}
                    alt={index === activeSlideIndex ? slide.alt : ""}
                    aria-hidden={index === activeSlideIndex ? undefined : true}
                    loading="eager"
                    decoding={index === activeSlideIndex ? "sync" : "async"}
                    draggable={false}
                  />
                ))}
              </div>

              <div
                key={`${slides[activeSlideIndex].titleKey}-${slideAnimation}`}
                className="rules-title">
                {t(slides[activeSlideIndex].titleKey)}
              </div>

              <RulesArrowButton
                className="rules-arrow--right"
                ariaLabel="Next slide"
                src={resolvePublicUrl("rules/button_right.svg")}
                onActivate={goToNextSlide}
                onReady={handleArrowReady}
              />
            </div>

            <div className="rules-points">
              {slides.map((slide, index) => (
                <button
                  key={slide.image}
                  className="rules-point-btn"
                  type="button"
                  aria-label={`Go to slide ${index + 1}`}
                  aria-current={activeSlideIndex === index}
                  onClick={() => {
                    if (index === activeSlideIndex) return;
                    setSlideAnimation(index > activeSlideIndex ? "right" : "left");
                    setActiveSlideIndex(index);
                  }}
                >
                  <img
                    src={
                      activeSlideIndex === index
                        ? resolvePublicUrl("rules/point_active.svg")
                        : resolvePublicUrl("rules/point.svg")
                    }
                    alt=""
                    loading="eager"
                    decoding="sync"
                  />
                </button>
              ))}
            </div>

            <button
              className="rules-start-btn"
              type="button"
              aria-label="Start game"
              onClick={onStart}
            >
              <span>Start</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
