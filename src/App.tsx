import React, { useCallback, useEffect, useRef, useState } from "react";
import { GameCanvas } from "./game/GameCanvas";
import { Hud } from "./ui/hud/Hud";
import { DigButton } from "./ui/controls/DigButton";
import { TopBar } from "./ui/controls/TopBar";
import { ResultOverlay } from "./ui/modals/ResultOverlay";
import { AutoplayModal } from "./ui/modals/AutoplayModal";
import { ToastNotification } from "./ui/modals/ToastNotification";
import { BurgerMenu } from "./ui/menus/BurgerMenu";
import { ErrorScreen } from "./ui/modals/ErrorScreen";
import { StartScreen } from "./ui/StartScreen";
import { LogoSplashScreen } from "./ui/LogoSplashScreen";
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
  const phase          = useGameStore(s => s.phase)
  const multiplier     = useGameStore(s => s.stats.multiplier)
  const settings       = useGameStore(s => s.settings, shallow)
  const replayPending  = useGameStore(s => s.replayPending)
  const prevPhase = useRef<string>('')
  const [logoSplashDone, setLogoSplashDone] = useState(() => isReplayMode())
  const [assetsReady, setAssetsReady] = useState(false)
  const [gameStarted, setGameStarted] = useState(() => isReplayMode())
  const [gameCanvasReady, setGameCanvasReady] = useState(() => isReplayMode())
  const [startScreenReady, setStartScreenReady] = useState(() => isReplayMode())
  const [startTransitionRequested, setStartTransitionRequested] = useState(false)
  const [startDismissing, setStartDismissing] = useState(false)
  const [startScreenGone, setStartScreenGone] = useState(() => isReplayMode())
  const gameSurfaceMounted = assetsReady && phase !== "BOOT"
  const showBootOverlay = !assetsReady || phase === "BOOT" || (!startScreenGone && !startScreenReady)
  const handleGameCanvasReady = useCallback(() => {
    setGameCanvasReady(true)
    if (!isReplayMode()) return
    const s = useGameStore.getState()
    console.log('[Replay] handleGameCanvasReady: replayPending=', s.replayPending, 'events=', s.events.length)
    if (s.replayPending) {
      console.log('[Replay] auto-starting from renderer ready')
      try { gameAudio.unlock() } catch { /* ignore autoplay policy */ }
      gameEngine.startReplay(s.events, s.worldSeed, s.roundID)
    }
  }, [])
  const handleStartScreenReady = useCallback(() => setStartScreenReady(true), [])

  useEffect(() => {
    if (!startTransitionRequested || startDismissing) return;
    if (!gameCanvasReady) return;

    let firstRafId = 0;
    let secondRafId = 0;

    firstRafId = window.requestAnimationFrame(() => {
      secondRafId = window.requestAnimationFrame(() => {
        setStartDismissing(true);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstRafId);
      window.cancelAnimationFrame(secondRafId);
    };
  }, [startTransitionRequested, gameCanvasReady, startDismissing]);

  useEffect(() => {
    if (!startTransitionRequested || startDismissing || startScreenGone || gameCanvasReady) return;

    const fallbackId = window.setTimeout(() => {
      setStartDismissing(true);
    }, 120);

    return () => {
      window.clearTimeout(fallbackId);
    };
  }, [startTransitionRequested, startDismissing, startScreenGone, gameCanvasReady]);

  useEffect(() => {
    if (!startDismissing || startScreenGone) return;

    const fallbackId = window.setTimeout(() => {
      setStartScreenGone(true);
    }, 700);

    return () => {
      window.clearTimeout(fallbackId);
    };
  }, [startDismissing, startScreenGone]);

  // ── Boot ─────────────────────────────────────────────────────────────────────
  // Preload и boot стартуют ПОСЛЕ завершения логотипа (logoSplashDone).
  // Причина: preloadStartupAssets() делает gl.texImage2D() для Pixi-текстур и Spine-атласов —
  // это блокирует главный поток и крадёт rAF-бюджет у Canvas2D анимации логотипа,
  // вызывая видимые подвисания на мобильных. Логотип длится ~3 сек, за это время
  // сеть простаивает — ничего не теряем, зато анимация идёт плавно.
  // В replay-режиме logoSplashDone = true сразу, поэтому задержки нет.
  useEffect(() => {
    if (!logoSplashDone) return;
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
  }, [logoSplashDone]);

  useEffect(() => {
    gameAudio.syncPhase(phase, multiplier)
  }, [phase, multiplier])

  useEffect(() => {
    if (phase === "LOSE") useGameStore.getState().setPhase("IDLE")
  }, [phase])

  useEffect(() => {
    gameAudio.refreshFromStore();
  }, [settings]);

  // Fallback: if renderer.ready didn't resolve, start replay after 1s
  useEffect(() => {
    if (!replayPending || phase !== 'IDLE' || !isReplayMode()) return
    console.log('[Replay] fallback timer started')
    const id = window.setTimeout(() => {
      const s = useGameStore.getState()
      console.log('[Replay] fallback fired: replayPending=', s.replayPending, 'phase=', s.phase)
      if (s.replayPending && s.phase === 'IDLE') {
        console.log('[Replay] auto-starting from fallback')
        try { gameAudio.unlock() } catch { /* ignore */ }
        gameEngine.startReplay(s.events, s.worldSeed, s.roundID)
      }
    }, 1000)
    return () => window.clearTimeout(id)
  }, [replayPending, phase])


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
      {gameSurfaceMounted && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: startScreenGone || startDismissing ? 1 : 0,
            transition: startDismissing ? "opacity 0.6s ease" : "none",
            pointerEvents: startScreenGone || startDismissing ? "auto" : "none",
          }}
        >
          {/* ── PixiJS canvas ── */}
          <GameCanvas
            width={width}
            height={height}
            onReady={handleGameCanvasReady}
          />

          {/* ── HUD (bottom bar) ── */}
          {gameStarted && <Hud />}

          {/* ── DIG button + Autoplay button ── */}
          {gameStarted && !isReplayMode() && <DigButton />}


          {/* ── Top-right controls ── */}
          {gameStarted && <TopBar />}

          {/* ── Overlays ── */}
          {gameStarted && <ResultOverlay />}
          {gameStarted && <AutoplayModal />}
          {gameStarted && <BurgerMenu />}
          <ToastNotification />
        </div>
      )}

      {showBootOverlay && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 30,
            background: "#1A0E08",
            fontFamily: "'Barlow', sans-serif",
          }}
        >
          <div className="ui-boot">
            <div className="ui-boot-spinner" />
            <div className="ui-boot-title">DEEP RUSH</div>
          </div>
        </div>
      )}

      {/* ── Logo splash: проигрывается самой первой, поверх всего ── */}
      {!logoSplashDone && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 50,
            background: "#000",
          }}
        >
          <LogoSplashScreen
            width={width}
            height={height}
            onComplete={() => setLogoSplashDone(true)}
          />
        </div>
      )}

      {/* ── Rules/Start overlay: фейдится поверх канваса, пока Pixi прогревается ── */}
      {!startScreenGone && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 10,
            opacity: startDismissing ? 0 : 1,
            transition: startDismissing ? "opacity 0.6s ease" : "none",
            pointerEvents: startDismissing ? "none" : "auto",
          }}
          onTransitionEnd={(event) => {
            if (event.currentTarget !== event.target || event.propertyName !== "opacity") return;
            setStartScreenGone(true);
          }}
        >
          <StartScreen
            width={width}
            height={height}
            onReady={handleStartScreenReady}
            onStart={() => {
              gameAudio.unlock();
              setGameStarted(true);
              setStartTransitionRequested(true);
            }}
          />
        </div>
      )}
    </div>
  );
};
