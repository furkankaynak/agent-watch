import type { LogEvent } from "../shared/logTypes";

type Props = {
  eventBuffer: LogEvent[];
  currentTime: string | null;
  totalDuration: { start: string; end: string } | null;
  isReplayMode: boolean;
  speed: number;
  onSeek: (eventIndex: number) => void;
  onGoLive: () => void;
  onSpeedChange: (speed: number) => void;
};

function formatTime(ts: string | null): string {
  if (!ts) return "--:--:--";
  return ts.slice(11, 19);
}

const SPEEDS = [1, 2, 4, 8];

export function ReplayControls({
  eventBuffer,
  currentTime,
  totalDuration,
  isReplayMode,
  speed,
  onSeek,
  onGoLive,
  onSpeedChange
}: Props) {
  if (eventBuffer.length === 0) return null;

  const computeProgress = () => {
    if (!currentTime || !totalDuration) return 0;
    const range = Date.parse(totalDuration.end) - Date.parse(totalDuration.start);
    if (range <= 0) return 0;
    const elapsed = Date.parse(currentTime) - Date.parse(totalDuration.start);
    return Math.max(0, Math.min(1, elapsed / range));
  };

  const progress = computeProgress();

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const index = Math.round(ratio * (eventBuffer.length - 1));
    onSeek(index);
  };

  return (
    <div className="replay-controls">
      <div className="replay-controls__inner">
        <button
          className={`replay-controls__live-btn ${!isReplayMode ? "replay-controls__live-btn--active" : ""}`}
          onClick={onGoLive}
        >
          <span className="replay-controls__live-dot" />
          Live
        </button>

        <div className="replay-controls__speeds">
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={`replay-controls__speed-btn ${speed === s ? "replay-controls__speed-btn--active" : ""} ${!isReplayMode ? "replay-controls__speed-btn--disabled" : ""}`}
              disabled={!isReplayMode}
              onClick={() => onSpeedChange(s)}
            >
              {s}x
            </button>
          ))}
        </div>

        <div className="replay-controls__timeline" onClick={handleClick}>
          <div className="replay-controls__track">
            <div
              className="replay-controls__fill"
              style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
            />
            <div
              className="replay-controls__thumb"
              style={{ left: `${Math.min(100, Math.max(0, progress * 100))}%` }}
            />
          </div>
        </div>

        <span className="replay-controls__time">
          {formatTime(currentTime)} / {formatTime(totalDuration?.end ?? null)}
        </span>
      </div>
    </div>
  );
}
