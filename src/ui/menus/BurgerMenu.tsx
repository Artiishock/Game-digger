import React, { useEffect, useRef, useState } from "react";
import { useGameStore } from "../../store/gameStore";
import { SettingsPanel } from "./SettingsPanel";
import { InfoPanel, ReplayPanel } from "./InfoAndReplay";
import { t, T } from "../../i18n/t";
import "../ui.css";
import infoIcon from "/ui/info.svg";
import historyIcon from "/ui/history.svg";
import settingsIcon from "/ui/settings.svg";
import cross from "/ui/cross.svg";

type Tab = "settings" | "info" | "replay";

const TABS: { id: Tab; labelKey: string; icon: string }[] = [
  { id: "info", labelKey: "information", icon: infoIcon },
  { id: "replay", labelKey: "history", icon: historyIcon },
  { id: "settings", labelKey: "settings", icon: settingsIcon },
];

const THUMB_HEIGHT = 110;

export const BurgerMenu: React.FC = () => {
  const isOpen = useGameStore((s) => s.menuOpen);
  const tab = useGameStore((s) => s.menuTab);
  const setOpen = useGameStore((s) => s.setMenuOpen);
  const setTab = useGameStore((s) => s.setMenuTab);
  const phase = useGameStore((s) => s.phase);

  const bodyRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartScrollTopRef = useRef(0);

  const [thumbTop, setThumbTop] = useState(0);
  const [showScrollbar, setShowScrollbar] = useState(false);

  const getScrollElement = () => {
    if (tab === "replay") {
      return bodyRef.current?.querySelector<HTMLDivElement>(".replay-table-shell") ?? bodyRef.current;
    }

    return bodyRef.current;
  };

  const updateScrollThumb = () => {
    const el = getScrollElement();
    if (!el) return;

    const track = trackRef.current;
    const thumbHeight = thumbRef.current?.offsetHeight ?? THUMB_HEIGHT;
    const maxScroll = el.scrollHeight - el.clientHeight;
    const maxThumbTop = (track?.clientHeight ?? el.clientHeight) - thumbHeight;

    setShowScrollbar(maxScroll > 0);

    if (maxScroll <= 0 || maxThumbTop <= 0) {
      setThumbTop(0);
      return;
    }

    setThumbTop((el.scrollTop / maxScroll) * maxThumbTop);
  };

  const handleThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = getScrollElement();
    if (!el) return;

    isDraggingRef.current = true;
    dragStartYRef.current = e.clientY;
    dragStartScrollTopRef.current = el.scrollTop;

    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const handleThumbPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = getScrollElement();
    const track = trackRef.current;
    if (!el || !track || !isDraggingRef.current) return;

    const thumbHeight = thumbRef.current?.offsetHeight ?? THUMB_HEIGHT;
    const maxScroll = el.scrollHeight - el.clientHeight;
    const maxThumbTop = track.clientHeight - thumbHeight;

    if (maxScroll <= 0 || maxThumbTop <= 0) return;

    const deltaY = e.clientY - dragStartYRef.current;
    const scrollDelta = (deltaY / maxThumbTop) * maxScroll;

    el.scrollTop = dragStartScrollTopRef.current + scrollDelta;
  };

  const handleThumbPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false;

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  useEffect(() => {
    const el = getScrollElement();
    if (!el || !isOpen) return;

    el.scrollTop = 0;
    updateScrollThumb();
    const rafId = window.requestAnimationFrame(updateScrollThumb);

    el.addEventListener("scroll", updateScrollThumb);
    window.addEventListener("resize", updateScrollThumb);

    return () => {
      window.cancelAnimationFrame(rafId);
      el.removeEventListener("scroll", updateScrollThumb);
      window.removeEventListener("resize", updateScrollThumb);
    };
  }, [isOpen, tab]);

  if (!isOpen) return null;

  return (
    <div className="ui-overlay" onClick={() => setOpen(false)}>
      <div
        className="ui-modal ui-menu-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ui-modal-header">
          <span className="ui-modal-title">{T('settings')}</span>
          <button className="ui-modal-close" onClick={() => setOpen(false)}>
            <img src={cross} alt="Close" className="sys-settings-slider-icon-cross" />
          </button>
        </div>

        <div className="ui-tabs">
          {TABS.map((tabItem) => (
            <button
              key={tabItem.id}
              onClick={() => setTab(tabItem.id)}
              className={`ui-tab ${tab === tabItem.id ? "ui-tab--active" : ""}`}
            >
              <span
                className="ui-tab-icon"
                aria-hidden="true"
                style={{
                  maskImage: `url(${tabItem.icon})`,
                  WebkitMaskImage: `url(${tabItem.icon})`,
                }}
              />
              <span className="ui-tab-label">{t.label}</span>
            </button>
          ))}
        </div>

        <div className="ui-modal-body" ref={bodyRef}>
          {tab === "settings" && <SettingsPanel />}
          {tab === "info" && <InfoPanel />}
          {tab === "replay" && <ReplayPanel />}
        </div>

        {showScrollbar && (
          <div className="ui-modal-scrollbar" ref={trackRef}>
            <div
              ref={thumbRef}
              className="ui-modal-scrollbar-thumb"
              style={{ transform: `translateY(${thumbTop}px)` }}
              onPointerDown={handleThumbPointerDown}
              onPointerMove={handleThumbPointerMove}
              onPointerUp={handleThumbPointerUp}
              onPointerCancel={handleThumbPointerUp}
            />
          </div>
        )}

        {phase === "RUNNING" && (
          <div className="ui-modal-footer">
            {t('game paused')}
          </div>
        )}
      </div>
    </div>
  );
};
