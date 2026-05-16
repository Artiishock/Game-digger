import React, { useCallback, useState } from "react";
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

interface RulesArrowButtonProps {
  className: string;
  ariaLabel: string;
  src: string;
  onActivate: () => void;
}

const RulesArrowButton: React.FC<RulesArrowButtonProps> = ({
  className,
  ariaLabel,
  src,
  onActivate,
}) => {
  const handleObjectLoad = useCallback(
    (event: React.SyntheticEvent<HTMLObjectElement>) => {
      const objectElement = event.currentTarget;
      const svgDocument = objectElement.contentDocument;
      const svgElement = svgDocument?.documentElement;

      if (!svgElement) return;

      svgElement.setAttribute("role", "button");
      svgElement.setAttribute("aria-label", ariaLabel);
      svgElement.style.cursor = "pointer";

      const handleClick = (clickEvent: MouseEvent) => {
        clickEvent.preventDefault();
        onActivate();
      };

      svgElement.addEventListener("click", handleClick);
      objectElement.addEventListener(
        "beforeunload",
        () => svgElement.removeEventListener("click", handleClick),
        { once: true }
      );
    },
    [ariaLabel, onActivate]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLObjectElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    onActivate();
  };

  return (
    <object
      className={`rules-arrow ${className}`}
      type="image/svg+xml"
      data={src}
      aria-label={ariaLabel}
      role="button"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onLoad={handleObjectLoad}
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
              <RulesArrowButton
                className="rules-arrow--left"
                ariaLabel="Previous slide"
                src={resolvePublicUrl("rules/button_left.svg")}
                onActivate={goToPreviousSlide}
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
