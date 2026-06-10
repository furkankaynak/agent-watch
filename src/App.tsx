import { useWorkflowStream } from "./hooks/useWorkflowStream";
import { useSessions } from "./hooks/useSessions";
import { useReplay } from "./hooks/useReplay";
import { EventFeed } from "./components/EventFeed";
import { InspectorPanel } from "./components/InspectorPanel";
import AgentCanvas from "./components/AgentCanvas";
import { ReplayControls } from "./components/ReplayControls";
import { SessionSidebar } from "./components/SessionSidebar";
import { selectAgents } from "./shared/workflowReducer";
import type { AgentNode } from "./shared/workflowTypes";

const connectionLabels: Record<string, string> = {
  connecting: "Connecting...",
  live: "Live",
  reconnecting: "Reconnecting...",
  offline: "Offline"
};

export default function App() {
  const { sessions, selectedSessionId, activeSessionId, setSelectedSessionId } = useSessions();
  const { state, eventBuffer, connectionStatus, selectedAgentId, setSelectedAgentId } =
    useWorkflowStream(selectedSessionId);

  const { replayState, currentTime, totalDuration, isReplayMode, isPlaying, speed, seek, goLive, setSpeed, togglePlay } =
    useReplay(eventBuffer);

  const displayState = isReplayMode ? replayState : state;
  const agents: AgentNode[] = selectAgents(displayState);

  const selectedAgent = selectedAgentId
    ? agents.find((a) => a.id === selectedAgentId)
    : undefined;

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <span className="eyebrow">Agent Office</span>
          <h1>Dashboard</h1>
        </div>
        <div className={`connection-badge connection-badge--${connectionStatus}`}>
          <span className="connection-dot" />
          {connectionLabels[connectionStatus] ?? connectionStatus}
        </div>
      </header>

      <div className="app-body">
        <SessionSidebar
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          activeSessionId={activeSessionId}
          onSelect={(id) => setSelectedSessionId(id)}
        />
        <main className="app-main">
          <AgentCanvas
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={setSelectedAgentId}
          />
        </main>

        <aside className="app-aside">
          <InspectorPanel agent={selectedAgent} events={displayState.events} agents={displayState.agents} />
          <EventFeed
            events={displayState.events}
            conversationToAgentId={displayState.conversationToAgentId}
            agents={displayState.agents}
          />
        </aside>
      </div>

      <ReplayControls
        eventBuffer={eventBuffer}
        currentTime={currentTime}
        totalDuration={totalDuration}
        isReplayMode={isReplayMode}
        isPlaying={isPlaying}
        speed={speed}
        onSeek={seek}
        onTogglePlay={togglePlay}
        onGoLive={goLive}
        onSpeedChange={setSpeed}
      />
    </div>
  );
}
