import React, { useEffect, useRef, useState } from "react";
import { GameCanvas } from "./game/GameCanvas";
import { Hud } from "./ui/hud/Hud";
import { DigButton } from "./ui/controls/DigButton";
import { TopBar } from "./ui/controls/TopBar";
import { ResultOverlay } from "./ui/modals/ResultOverlay";
import { AutoplayModal } from "./ui/modals/AutoplayModal";
import { BurgerMenu } from "./ui/menus/BurgerMenu";
import { ErrorScreen } from "./ui/modals/ErrorScreen";
import { StartScreen } from "./ui/StartScreen";
import { useGameStore } from "./store/gameStore";
import { shallow } from "zustand/shallow";
import { gameAudio } from "./audio/GameAudio";
import { useWindowSize } from "./hooks/useWindowSize";
import { gameEngine } from "./game/GameEngine";
import { addReplayRound } from "./ui/menus/InfoAndReplay";
import { toDisplay, isReplayMode } from "./rgs/client";
import { preloadStartupAssets } from "./game/gameAssets";
import "./ui/ui.css";

// Import Bebas Neue from Google Fonts
const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
fontLink.href =
  "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@300;400;600;700&display=swap";
document.head.appendChild(fontLink);

export const App: React.FC = () => {
  const { width, height } = useWindowSize()
  const phase    = useGameStore(s => s.phase)
  const multiplier = useGameStore(s => s.stats.multiplier)
  const settings = useGameStore(s => s.settings, shallow)
  const prevPhase = useRef<string>('')
  const [assetsReady, setAssetsReady] = useState(false)
  const [gameStarted, setGameStarted] = useState(() => isReplayMode())

  // ── Boot ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await preloadStartupAssets();
      if (cancelled) return;
      setAssetsReady(true);
      gameEngine.boot();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    gameAudio.syncPhase(phase, multiplier)
  }, [phase, multiplier])

  useEffect(() => {
    if (phase === "LOSE") useGameStore.getState().setPhase("IDLE")
  }, [phase])

  useEffect(() => {
    gameAudio.refreshFromStore();
  }, [settings]);

  // Блокируем браузерный zoom, чтобы масштаб игры не менялся от Ctrl-комбинаций.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      const k = e.key;
      if (k === "+" || k === "-" || k === "=" || k === "_" || k === "0") {
        e.preventDefault();
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", onWheel);
    };
  }, []);

  // ── Record round history for Bet Replay ─────────────────────────────────────
  useEffect(() => {
    const prev = prevPhase.current;
    prevPhase.current = phase;

    if ((phase === "WIN" || phase === "LOSE") && prev === "RUNNING") {
      const store = useGameStore.getState();

      if (store.replayMode) {
        store.setReplayMode(false);
        return;
      }

      const balAfterDisplay = toDisplay(store.balance);
      const bet = store.bet;
      const win = store.lastWin;
      const profit = win - bet;

      const d = new Date();
      const time = `${d.toLocaleDateString("en-GB")}
${d.toLocaleTimeString("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})}`;

      addReplayRound({
        time,
        currency: store.currency,
        bet,
        win,
        profit,
        balBefore: balAfterDisplay - profit,
        balAfter: balAfterDisplay,
        roundID: store.roundID,
        worldSeed: store.worldSeed,
        events: store.events,
      });
    }
  }, [phase]);

  if (phase === "ERROR") return <ErrorScreen />;
  if (!assetsReady || phase === "BOOT") {
    return (
      <div
        style={{
          position: "relative",
          width,
          height,
          overflow: "hidden",
          background: "#1A0E08",
          fontFamily: "'Barlow', sans-serif",
        }}
      >
        <div className="ui-boot">
          <div className="ui-boot-spinner" />
          <div className="ui-boot-title">DEEP RUSH</div>
        </div>
      </div>
    );
  }

  if (!gameStarted) {
    return (
      <StartScreen
        width={width}
        height={height}
        onStart={() => {
          gameAudio.unlock();
          setGameStarted(true);
        }}
      />
    );
  }

  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        overflow: "hidden",
        background: "#1A0E08",
        fontFamily: "'Barlow', sans-serif",
      }}
    >
      {/* ── PixiJS canvas ── */}
      <GameCanvas width={width} height={height} />

      {/* ── HUD (bottom bar) ── */}
      <Hud />

      {/* ── DIG button + Autoplay button ── */}
      {!isReplayMode() && <DigButton />}

      {/* ── Top-right controls ── */}
      <TopBar />

      {/* ── Overlays ── */}
      <ResultOverlay />
      <AutoplayModal />
      <BurgerMenu />
    </div>
  );
};
