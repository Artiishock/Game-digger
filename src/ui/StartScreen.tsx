import React, { useState } from "react";
import { t } from "../i18n/t";

interface StartScreenProps {
  width: number;
  height: number;
  onStart: () => void;
}

const slides = [
  { image: "/rules/multipliers.png", alt: "Multipliers", titleKey: "collect multipliers" },
  { image: "/rules/treats.png",      alt: "Treats",      titleKey: "avoid threats" },
  { image: "/rules/places.png",      alt: "Places",      titleKey: "get to safe place" },
];

export const StartScreen: React.FC<StartScreenProps> = ({ width, height, onStart }) => {
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);

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
      <img className="rules-logo" src="/rules/logo_magnetic.png" alt="Magnetic" />

      <div className="rules-content">
        <img className="rules-banner" src="/rules/banner.png" alt="Deep Rush" />

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
                <img src="/rules/button_left.svg" alt="" />
              </button>

              <div className="rules-image-slot">
                <img
                  className="rules-multipliers"
                  src={slides[activeSlideIndex].image}
                  alt={slides[activeSlideIndex].alt}
                />
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
                <img src="/rules/button_right.svg" alt="" />
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
                        ? "/rules/point_active.svg"
                        : "/rules/point.svg"
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
              <img src="/rules/start_button.svg" alt="" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};