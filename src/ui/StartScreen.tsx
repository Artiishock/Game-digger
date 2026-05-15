import React, { useEffect, useMemo, useState } from "react";
import { t } from "../i18n/t";
import { resolvePublicUrl } from "../utils/publicUrl";

interface StartScreenProps {
  width: number;
  height: number;
  onStart: () => void;
}

const slides = [
  { image: resolvePublicUrl("rules/multipliers.png"), alt: "Multipliers", titleKey: "collect multipliers" },
  { image: resolvePublicUrl("rules/treats.png"),      alt: "Treats",      titleKey: "avoid threats" },
  { image: resolvePublicUrl("rules/places.png"),      alt: "Places",      titleKey: "get to safe place" },
];

interface InlineSvgImageProps {
  idPrefix: string;
  src: string;
}

const prefixSvgIds = (markup: string, prefix: string) =>
  markup
    .replace(/\sid="([^"]+)"/g, ` id="${prefix}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${prefix}-$1"`);

const InlineSvgImage: React.FC<InlineSvgImageProps> = ({ idPrefix, src }) => {
  const [markup, setMarkup] = useState<string | null>(null);
  const svgMarkup = useMemo(
    () => (markup ? prefixSvgIds(markup, idPrefix) : null),
    [idPrefix, markup]
  );

  useEffect(() => {
    let isMounted = true;

    fetch(src)
      .then((response) => (response.ok ? response.text() : null))
      .then((loadedMarkup) => {
        if (isMounted) {
          setMarkup(loadedMarkup);
        }
      })
      .catch(() => {
        if (isMounted) {
          setMarkup(null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [src]);

  if (!svgMarkup) {
    return <img src={src} alt="" />;
  }

  return (
    <span
      className="rules-inline-svg"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  );
};

export const StartScreen: React.FC<StartScreenProps> = ({ width, height, onStart }) => {
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [bannerSrc, setBannerSrc] = useState(resolvePublicUrl("rules/banner.svg"));
  const [slideAnimation, setSlideAnimation] = useState<"left" | "right">("right");

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
    <div className="rules-start-screen" style={{ width, height }}>
      <img className="rules-logo" src={resolvePublicUrl("rules/logo_magnetic.svg")} alt="Magnetic" />

      <div className="rules-content">
        <img
          className="rules-banner"
          src={bannerSrc}
          alt="Deep Rush"
          onError={() => setBannerSrc(resolvePublicUrl("rules/logo_magnetic.svg"))}
        />

        <div className="rules-center">
          <div className="rules-multipliers-block">
            <div
              className={`rules-slide-main ${
                isPlacesSlide ? "rules-slide-main--places" : ""
              } rules-slide-main--${slideAnimation}`}
            >
              <button
                className="rules-arrow rules-arrow--left"
                type="button"
                aria-label="Previous slide"
                onClick={goToPreviousSlide}
              >
                <InlineSvgImage idPrefix="rules-left-arrow" src={resolvePublicUrl("rules/button_left.svg")} />
              </button>

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
                    draggable={false}
                  />
                ))}
              </div>

              <div
                key={`${slides[activeSlideIndex].titleKey}-${slideAnimation}`}
                className="rules-title">
                {t(slides[activeSlideIndex].titleKey)}
              </div>

              <button
                className="rules-arrow rules-arrow--right"
                type="button"
                aria-label="Next slide"
                onClick={goToNextSlide}
              >
                <InlineSvgImage idPrefix="rules-right-arrow" src={resolvePublicUrl("rules/button_right.svg")} />
              </button>
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
