import { useWorkflowStream } from "./hooks/useWorkflowStream";
import { useReplay } from "./hooks/useReplay";
import { EventFeed } from "./components/EventFeed";
import { InspectorPanel } from "./components/InspectorPanel";
import { OfficeBoard } from "./components/OfficeBoard";
import { ReplayControls } from "./components/ReplayControls";
import { selectAgents } from "./shared/workflowReducer";
import type { AgentNode } from "./shared/workflowTypes";

const connectionLabels: Record<string, string> = {
  connecting: "Connecting...",
  live: "Live",
  reconnecting: "Reconnecting...",
  offline: "Offline"
};

export default function App() {
  const { state, eventBuffer, connectionStatus, selectedAgentId, setSelectedAgentId } =
    useWorkflowStream();

  const { replayState, currentTime, totalDuration, isReplayMode, speed, seek, goLive, setSpeed } =
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
        <main className="app-main">
          <OfficeBoard
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={setSelectedAgentId}
          />
        </main>

        <aside className="app-aside">
          <InspectorPanel agent={selectedAgent} />
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
        speed={speed}
        onSeek={seek}
        onGoLive={goLive}
        onSpeedChange={setSpeed}
      />
    </div>
  );
}
