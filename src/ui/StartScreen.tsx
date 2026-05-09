import React, { useState } from "react";
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

export const StartScreen: React.FC<StartScreenProps> = ({ width, height, onStart }) => {
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [bannerSrc, setBannerSrc] = useState(resolvePublicUrl("rules/banner.svg"));

  const goToPreviousSlide = () => {
    setActiveSlideIndex((currentIndex) =>
      currentIndex === 0 ? slides.length - 1 : currentIndex - 1
    );
  };

  const goToNextSlide = () => {
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
              }`}
            >
              <button
                className="rules-arrow rules-arrow--left"
                type="button"
                aria-label="Previous slide"
                onClick={goToPreviousSlide}
              >
                <img src={resolvePublicUrl("rules/button_left.svg")} alt="" />
              </button>

              <div className="rules-image-slot">
                {slides.map((slide, index) => (
                  <img
                    key={slide.image}
                    className={`rules-multipliers ${
                      index === activeSlideIndex ? "rules-multipliers--active" : ""
                    } ${index === 2 ? "rules-multipliers--places" : ""}`}
                    src={slide.image}
                    alt={index === activeSlideIndex ? slide.alt : ""}
                    aria-hidden={index === activeSlideIndex ? undefined : true}
                  />
                ))}
              </div>

              <div
                className="rules-title">
                {t(slides[activeSlideIndex].titleKey)}
              </div>

              <button
                className="rules-arrow rules-arrow--right"
                type="button"
                aria-label="Next slide"
                onClick={goToNextSlide}
              >
                <img src={resolvePublicUrl("rules/button_right.svg")} alt="" />
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
                  onClick={() => setActiveSlideIndex(index)}
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
              <img src={resolvePublicUrl("rules/start_button.svg")} alt="" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
