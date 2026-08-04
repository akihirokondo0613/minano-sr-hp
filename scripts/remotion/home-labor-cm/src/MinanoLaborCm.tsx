import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { AdVideoProps } from "./schema";
import { CaptionTrack } from "./CaptionTrack";
import { Sheen } from "./Finish";
import { KineticText } from "./KineticText";
import { anticipate, springPop, squashLand, tween } from "./motion";

const COLORS = {
  ink: "#111111",
  blue: "#356FAF",
  blueDark: "#244F7D",
  green: "#BFD8C6",
  greenStrong: "#4F8B62",
  paper: "#FFFCF6",
  yellow: "#FFD764",
  yellowSoft: "#FFF3C4",
  white: "#FFFFFF",
};

const FONT =
  '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", YuGothic, system-ui, sans-serif';
const BORDER = `6px solid ${COLORS.ink}`;

type Scene = AdVideoProps["scenes"][number];
type AudioTrack = NonNullable<AdVideoProps["audio"]>["tracks"][number];

const splitItems = (value: string): string[] => value.split("|").map((item) => item.trim()).filter(Boolean);

const BrandBadge: React.FC<{ compact?: boolean; inverted?: boolean }> = ({ compact = false, inverted = false }) => (
  <div
    style={{
      alignItems: "center",
      color: inverted ? COLORS.white : COLORS.ink,
      display: "flex",
      fontFamily: FONT,
      fontSize: compact ? 24 : 29,
      fontWeight: 900,
      gap: 13,
      letterSpacing: "0.02em",
    }}
  >
    <span
      style={{
        alignItems: "center",
        background: inverted ? COLORS.yellow : COLORS.blue,
        border: `4px solid ${COLORS.ink}`,
        borderRadius: "50%",
        color: inverted ? COLORS.ink : COLORS.white,
        display: "inline-flex",
        fontSize: compact ? 26 : 34,
        height: compact ? 54 : 66,
        justifyContent: "center",
        lineHeight: 1,
        width: compact ? 54 : 66,
      }}
    >
      み
    </span>
    <span>みなの社労士</span>
  </div>
);

const SceneTexture: React.FC<{ dark?: boolean }> = ({ dark = false }) => (
  <AbsoluteFill
    aria-hidden
    style={{
      backgroundImage: dark
        ? "radial-gradient(circle, rgba(255,255,255,0.2) 2px, transparent 2px)"
        : "radial-gradient(circle, rgba(53,111,175,0.15) 2px, transparent 2px)",
      backgroundPosition: "0 0",
      backgroundSize: "34px 34px",
      maskImage: "linear-gradient(110deg, rgba(0,0,0,0.8), transparent 72%)",
      opacity: dark ? 0.32 : 0.36,
    }}
  />
);

const FoldedPaperCard: React.FC<{
  color: string;
  frame: number;
  label: string;
  left: number;
  rotate: number;
  start: number;
  top: number;
}> = ({ color, frame, label, left, rotate, start, top }) => {
  const { fps } = useVideoConfig();
  const pop = springPop(frame, fps, { start, damping: 15, stiffness: 220, mass: 0.55 });
  const opacity = tween(frame, { start, duration: 6, ease: "power3Out" });
  return (
    <div
      style={{
        alignItems: "center",
        background: color,
        border: BORDER,
        borderRadius: 22,
        boxShadow: "0 16px 0 rgba(17,17,17,0.12)",
        display: "flex",
        fontFamily: FONT,
        fontSize: 39,
        fontWeight: 950,
        height: 94,
        justifyContent: "center",
        left,
        opacity,
        position: "absolute",
        top,
        transform: `scale(${Math.max(0, pop)}) rotate(${rotate}deg)`,
        transformOrigin: "50% 50%",
        width: 270,
      }}
    >
      <span>{label}</span>
      <span
        aria-hidden
        style={{
          background: COLORS.white,
          borderBottom: `5px solid ${COLORS.ink}`,
          borderLeft: `5px solid ${COLORS.ink}`,
          clipPath: "polygon(100% 0, 0 100%, 100% 100%)",
          height: 27,
          position: "absolute",
          right: -1,
          top: -1,
          width: 27,
        }}
      />
    </div>
  );
};

const PaperAvalancheScene: React.FC<{ scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const visualItems = splitItems(scene.visual);
  const imageIn = tween(frame, { start: 0, duration: 10, ease: "power3Out" });
  const positions = [
    { left: 790, top: 94, rotate: -3, color: COLORS.yellow },
    { left: 948, top: 210, rotate: 2, color: COLORS.white },
    { left: 770, top: 327, rotate: -2, color: COLORS.green },
    { left: 930, top: 448, rotate: 3, color: COLORS.yellowSoft },
  ];

  return (
    <AbsoluteFill style={{ background: COLORS.paper, overflow: "hidden" }}>
      <SceneTexture />
      <div style={{ left: 52, position: "absolute", top: 34, zIndex: 5 }}>
        <BrandBadge compact />
      </div>
      <div
        aria-hidden
        style={{
          background: COLORS.yellowSoft,
          border: BORDER,
          borderRadius: "50%",
          height: 520,
          left: 50,
          position: "absolute",
          top: 122,
          width: 680,
        }}
      />
      <Img
        src={staticFile(scene.imagePath ?? "minano/illustrations/admin-work.webp")}
        style={{
          height: 515,
          left: 28,
          mixBlendMode: "multiply",
          objectFit: "contain",
          opacity: imageIn,
          position: "absolute",
          top: 130,
          transform: `scale(${0.96 + imageIn * 0.04})`,
          width: 720,
        }}
      />
      {positions.map((position, index) => (
        <FoldedPaperCard
          key={visualItems[index] ?? index}
          color={position.color}
          frame={frame}
          label={visualItems[index] ?? "労務"}
          left={position.left}
          rotate={position.rotate}
          start={8 + index * 17}
          top={position.top}
        />
      ))}
    </AbsoluteFill>
  );
};

const TimeFreezeScene: React.FC<{ scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const handProgress = tween(frame, { start: 0, duration: 14, ease: "power3Out" });
  const stopPop = tween(frame, { start: 14, duration: 9, ease: "backOutHard" });
  return (
    <AbsoluteFill style={{ background: COLORS.blue, color: COLORS.white, overflow: "hidden" }}>
      <SceneTexture dark />
      <div style={{ left: 58, position: "absolute", top: 40 }}>
        <BrandBadge compact inverted />
      </div>
      <div style={{ left: 58, position: "absolute", top: 150, width: 740 }}>
        <KineticText
          as="h1"
          enter="clip"
          ease="power4Out"
          from="start"
          perItem={1}
          split="chars"
          startFrame={2}
          text={scene.headline}
          style={{
            fontFamily: FONT,
            fontSize: 88,
            fontWeight: 950,
            letterSpacing: "-0.06em",
            lineHeight: 1.07,
            margin: 0,
          }}
        />
      </div>
      <div
        style={{
          alignItems: "center",
          background: COLORS.white,
          border: BORDER,
          borderRadius: "50%",
          display: "flex",
          height: 270,
          justifyContent: "center",
          position: "absolute",
          right: 92,
          top: 150,
          width: 270,
        }}
      >
        <div
          style={{
            background: COLORS.ink,
            borderRadius: 6,
            height: 87,
            left: 128,
            position: "absolute",
            top: 48,
            transform: `rotate(${-42 + handProgress * 72}deg)`,
            transformOrigin: "50% 87px",
            width: 12,
          }}
        />
        <div
          style={{
            background: COLORS.yellow,
            border: BORDER,
            borderRadius: "50%",
            color: COLORS.ink,
            display: "grid",
            fontFamily: FONT,
            fontSize: 58,
            fontWeight: 950,
            height: 132,
            opacity: Math.min(1, stopPop * 1.5),
            placeItems: "center",
            transform: `scale(${Math.max(0, stopPop)}) rotate(-8deg)`,
            width: 132,
            zIndex: 2,
          }}
        >
          止
        </div>
      </div>
      <div
        style={{
          background: COLORS.yellow,
          border: `5px solid ${COLORS.ink}`,
          bottom: 115,
          color: COLORS.ink,
          fontFamily: FONT,
          fontSize: 27,
          fontWeight: 900,
          left: 72,
          opacity: tween(frame, { start: 24, duration: 10, ease: "power3Out" }),
          padding: "12px 20px",
          position: "absolute",
          transform: "rotate(-2deg)",
        }}
      >
        何を、いつまでに。
      </div>
    </AbsoluteFill>
  );
};

const TimelineCard: React.FC<{
  frame: number;
  label: string;
  left: number;
  start: number;
}> = ({ frame, label, left, start }) => {
  const { fps } = useVideoConfig();
  const pop = springPop(frame, fps, { start, damping: 16, stiffness: 230, mass: 0.55 });
  return (
    <div
      style={{
        alignItems: "center",
        background: COLORS.white,
        border: BORDER,
        borderRadius: 22,
        display: "flex",
        fontFamily: FONT,
        fontSize: 32,
        fontWeight: 950,
        height: 86,
        justifyContent: "center",
        left,
        position: "absolute",
        top: 485,
        transform: `scale(${Math.max(0, pop)})`,
        width: 180,
      }}
    >
      {label}
    </div>
  );
};

const OrganizeScene: React.FC<{ scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const items = splitItems(scene.visual);
  const lineProgress = tween(frame, { start: 16, duration: 72, ease: "power3InOut" });
  const check = tween(frame, { start: 86, duration: 12, ease: "backOutHard" });
  return (
    <AbsoluteFill style={{ background: COLORS.yellowSoft, overflow: "hidden" }}>
      <SceneTexture />
      <div
        style={{
          background: COLORS.blue,
          border: BORDER,
          color: COLORS.white,
          fontFamily: FONT,
          fontSize: 24,
          fontWeight: 900,
          left: 55,
          padding: "10px 18px",
          position: "absolute",
          top: 42,
          transform: "rotate(-2deg)",
        }}
      >
        {scene.eyebrow}
      </div>
      <div style={{ left: 55, position: "absolute", top: 112, width: 610 }}>
        <KineticText
          as="h2"
          accentColor={COLORS.blue}
          accentWords={["ひとつに"]}
          enter="rise"
          ease="power3Out"
          perItem={1}
          split="chars"
          startFrame={4}
          text={scene.headline}
          style={{
            color: COLORS.ink,
            fontFamily: FONT,
            fontSize: 78,
            fontWeight: 950,
            letterSpacing: "-0.06em",
            lineHeight: 1.08,
            margin: 0,
          }}
        />
      </div>
      <Img
        src={staticFile(scene.imagePath ?? "minano/illustrations/workflow-organizing.webp")}
        style={{
          height: 470,
          mixBlendMode: "multiply",
          objectFit: "contain",
          position: "absolute",
          right: 45,
          top: 58,
          width: 600,
        }}
      />
      <div
        style={{
          background: COLORS.ink,
          height: 8,
          left: 135,
          position: "absolute",
          top: 525,
          transform: `scaleX(${lineProgress})`,
          transformOrigin: "left center",
          width: 705,
        }}
      />
      {items.map((item, index) => (
        <TimelineCard key={item} frame={frame} label={item} left={66 + index * 215} start={26 + index * 31} />
      ))}
      <div
        style={{
          alignItems: "center",
          background: COLORS.green,
          border: BORDER,
          borderRadius: "50%",
          display: "flex",
          height: 96,
          justifyContent: "center",
          left: 770,
          position: "absolute",
          top: 480,
          transform: `scale(${Math.max(0, check)}) rotate(-7deg)`,
          width: 96,
        }}
      >
        <span
          style={{
            borderBottom: `10px solid ${COLORS.ink}`,
            borderRight: `10px solid ${COLORS.ink}`,
            height: 42,
            marginTop: -10,
            transform: "rotate(43deg)",
            width: 23,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

const ServiceChip: React.FC<{
  color: string;
  frame: number;
  label: string;
  left: number;
  start: number;
  top: number;
}> = ({ color, frame, label, left, start, top }) => {
  const { fps } = useVideoConfig();
  const pop = springPop(frame, fps, { start, damping: 15, stiffness: 250, mass: 0.52 });
  return (
    <div
      style={{
        background: color,
        border: `5px solid ${COLORS.ink}`,
        borderRadius: 999,
        fontFamily: FONT,
        fontSize: 25,
        fontWeight: 950,
        left,
        padding: "10px 20px",
        position: "absolute",
        top,
        transform: `scale(${Math.max(0, pop)})`,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </div>
  );
};

const SupportMapScene: React.FC<{ scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const items = splitItems(scene.visual);
  const pathProgress = tween(frame, { start: 12, duration: 62, ease: "power3InOut" });
  const chipPositions = [
    { left: 645, top: 315, color: COLORS.yellow },
    { left: 850, top: 315, color: COLORS.white },
    { left: 1030, top: 315, color: COLORS.green },
    { left: 750, top: 405, color: COLORS.white },
    { left: 960, top: 405, color: COLORS.yellowSoft },
  ];
  return (
    <AbsoluteFill style={{ background: COLORS.paper, overflow: "hidden" }}>
      <SceneTexture />
      <Img
        src={staticFile(scene.imagePath ?? "minano/illustrations/consult-documents.webp")}
        style={{
          height: 520,
          left: 30,
          mixBlendMode: "multiply",
          objectFit: "contain",
          position: "absolute",
          top: 65,
          width: 570,
        }}
      />
      <div
        style={{
          background: COLORS.yellow,
          border: `5px solid ${COLORS.ink}`,
          fontFamily: FONT,
          fontSize: 23,
          fontWeight: 900,
          left: 640,
          padding: "9px 16px",
          position: "absolute",
          top: 46,
          transform: "rotate(2deg)",
        }}
      >
        {scene.eyebrow}
      </div>
      <div style={{ left: 640, position: "absolute", top: 108, width: 585 }}>
        <KineticText
          as="h2"
          enter="clip"
          ease="power4Out"
          perItem={1}
          split="chars"
          startFrame={4}
          text={scene.headline}
          style={{
            color: COLORS.ink,
            fontFamily: FONT,
            fontSize: 77,
            fontWeight: 950,
            letterSpacing: "-0.06em",
            lineHeight: 1.06,
            margin: 0,
          }}
        />
      </div>
      <svg
        aria-hidden
        height="260"
        style={{ left: 620, position: "absolute", top: 270 }}
        viewBox="0 0 620 260"
        width="620"
      >
        <path
          d="M35 88 C150 15 275 135 365 74 S520 38 575 116 C520 208 365 150 270 196 S105 224 42 164"
          fill="none"
          pathLength={1}
          stroke={COLORS.blue}
          strokeDasharray={1}
          strokeDashoffset={1 - pathProgress}
          strokeLinecap="round"
          strokeWidth={9}
        />
      </svg>
      {items.map((item, index) => {
        const position = chipPositions[index] ?? chipPositions[chipPositions.length - 1];
        return (
          <ServiceChip
            key={item}
            color={position.color}
            frame={frame}
            label={item}
            left={position.left}
            start={18 + index * 11}
            top={position.top}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const CtaScene: React.FC<{ cta: string; scene: Scene }> = ({ cta, scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logoPop = springPop(frame, fps, { start: 2, damping: 14, stiffness: 230, mass: 0.58 });
  const logoSquash = squashLand(frame, { land: 8, intensity: 0.1, hold: 2, recover: 8 });
  const buttonWindup = anticipate(frame, { start: 15, dip: 0.05, dipFrames: 4, releaseFrames: 8 });
  const buttonPop = springPop(frame, fps, { start: 19, damping: 13, stiffness: 210, mass: 0.65 });
  return (
    <AbsoluteFill style={{ background: COLORS.paper, overflow: "hidden" }}>
      <SceneTexture />
      <div
        aria-hidden
        style={{
          background: COLORS.yellow,
          border: BORDER,
          borderRadius: "50%",
          height: 310,
          left: 45,
          position: "absolute",
          top: 160,
          width: 310,
        }}
      />
      <div
        style={{
          alignItems: "center",
          background: COLORS.blue,
          border: BORDER,
          borderRadius: "50%",
          color: COLORS.white,
          display: "flex",
          fontFamily: FONT,
          fontSize: 88,
          fontWeight: 950,
          height: 168,
          justifyContent: "center",
          left: 116,
          position: "absolute",
          top: 231,
          transform: `scale(${Math.max(0, logoPop) * logoSquash.scaleX}, ${Math.max(0, logoPop) * logoSquash.scaleY}) rotate(-5deg)`,
          width: 168,
        }}
      >
        み
      </div>
      <div style={{ left: 380, position: "absolute", top: 105, width: 820 }}>
        <div style={{ color: COLORS.blueDark, fontFamily: FONT, fontSize: 34, fontWeight: 950 }}>
          {scene.eyebrow}
        </div>
        <KineticText
          as="h2"
          enter="rise"
          ease="power3Out"
          perItem={1}
          split="chars"
          startFrame={5}
          text={scene.headline}
          style={{
            color: COLORS.ink,
            fontFamily: FONT,
            fontSize: 61,
            fontWeight: 950,
            letterSpacing: "-0.055em",
            lineHeight: 1.12,
            margin: "18px 0 0",
          }}
        />
      </div>
      <div
        style={{
          alignItems: "center",
          background: COLORS.blue,
          border: BORDER,
          borderRadius: 22,
          boxShadow: "0 14px 0 rgba(17,17,17,0.16)",
          color: COLORS.white,
          display: "flex",
          fontFamily: FONT,
          fontSize: 38,
          fontWeight: 950,
          height: 86,
          justifyContent: "center",
          left: 416,
          opacity: Math.min(1, buttonPop * 1.7),
          overflow: "hidden",
          position: "absolute",
          top: 470,
          transform: `scale(${Math.max(0, buttonPop) * buttonWindup})`,
          width: 470,
        }}
      >
        {cta}
        <Sheen start={38} duration={15} period={48} opacity={0.55} />
      </div>
      <svg
        aria-hidden
        height="105"
        style={{ bottom: 0, left: 0, position: "absolute" }}
        viewBox="0 0 1280 105"
        width="1280"
      >
        <path
          d="M0 83 C160 34 268 98 420 62 C575 24 673 90 845 50 C1000 15 1110 78 1280 32"
          fill="none"
          stroke={COLORS.ink}
          strokeWidth="8"
        />
      </svg>
      <div
        style={{
          bottom: 16,
          color: COLORS.blueDark,
          fontFamily: FONT,
          fontSize: 17,
          fontWeight: 700,
          letterSpacing: "0.02em",
          opacity: 0.76,
          position: "absolute",
          right: 28,
        }}
      >
        音声：VOICEVOX:冥鳴ひまり
      </div>
    </AbsoluteFill>
  );
};

const BrandWipe: React.FC<{ color: string }> = ({ color }) => {
  const frame = useCurrentFrame();
  const enter = tween(frame, { start: 0, duration: 9, ease: "power4Out" });
  const exit = tween(frame, { start: 11, duration: 9, ease: "power3In" });
  const translate = -105 + enter * 105 + exit * 110;
  return (
    <AbsoluteFill style={{ overflow: "hidden", zIndex: 40 }}>
      <div
        style={{
          background: color,
          borderLeft: `9px solid ${COLORS.ink}`,
          borderRight: `9px solid ${COLORS.ink}`,
          height: 930,
          left: -130,
          position: "absolute",
          top: -105,
          transform: `translateX(${translate}%) skewX(-10deg)`,
          width: 1540,
        }}
      />
    </AbsoluteFill>
  );
};

const AudioLayer: React.FC<{ tracks: AudioTrack[] }> = ({ tracks }) => (
  <>
    {tracks.map((track) => {
      if (!track.src) {
        return null;
      }
      const from = track.startFrame ?? 0;
      const audio = (
        <Audio
          loop={track.loop ?? false}
          src={staticFile(track.src)}
          volume={track.volume ?? (track.kind === "musicBed" ? 0.18 : 0.6)}
        />
      );
      return track.durationFrames ? (
        <Sequence key={track.id} durationInFrames={track.durationFrames} from={from}>
          {audio}
        </Sequence>
      ) : (
        <Sequence key={track.id} from={from}>
          {audio}
        </Sequence>
      );
    })}
  </>
);

export const MinanoLaborCm: React.FC<AdVideoProps> = (props) => {
  const sceneById = new Map(props.scenes.map((scene) => [scene.id, scene]));
  const requiredScene = (id: string): Scene => {
    const scene = sceneById.get(id);
    if (!scene) {
      throw new Error(`Missing required scene: ${id}`);
    }
    return scene;
  };

  return (
    <AbsoluteFill style={{ background: COLORS.paper, fontFamily: FONT, overflow: "hidden" }}>
      <Sequence durationInFrames={90} from={0} premountFor={30}>
        <PaperAvalancheScene scene={requiredScene("paper-avalanche")} />
      </Sequence>
      <Sequence durationInFrames={66} from={90} premountFor={20}>
        <TimeFreezeScene scene={requiredScene("time-freeze-question")} />
      </Sequence>
      <Sequence durationInFrames={114} from={156} premountFor={20}>
        <OrganizeScene scene={requiredScene("snap-organize-workflow")} />
      </Sequence>
      <Sequence durationInFrames={84} from={270} premountFor={20}>
        <SupportMapScene scene={requiredScene("consultant-support-map")} />
      </Sequence>
      <Sequence durationInFrames={96} from={354} premountFor={20}>
        <CtaScene cta={props.cta} scene={requiredScene("cta-card")} />
      </Sequence>

      <Sequence durationInFrames={20} from={146} premountFor={10}>
        <BrandWipe color={COLORS.yellowSoft} />
      </Sequence>
      <Sequence durationInFrames={20} from={260} premountFor={10}>
        <BrandWipe color={COLORS.white} />
      </Sequence>
      <Sequence durationInFrames={20} from={344} premountFor={10}>
        <BrandWipe color={COLORS.yellow} />
      </Sequence>

      {props.captions ? (
        <CaptionTrack
          accentColor={COLORS.blue}
          accentSwaps={[{ from: 90, to: 156, color: COLORS.yellow }]}
          captions={props.captions}
          fontFamily={FONT}
          zIndex={50}
        />
      ) : null}
      {props.audio?.enabled ? <AudioLayer tracks={props.audio.tracks} /> : null}
    </AbsoluteFill>
  );
};
