## ADDED Requirements

### Requirement: Status snapshots preserve route unavailable state
Relay runtime status snapshots and status-line refreshes SHALL use coherent route-action safety probes so a route discovered as unavailable is not displayed as online, idle, busy, paired, or model-ready based on stale partial data.

#### Scenario: Stale idle probe renders offline
- **WHEN** a status-line refresh probes the current route and idle detection reports a stale or unavailable route
- **THEN** the status snapshot treats the session route as unavailable or offline rather than idle or busy

#### Scenario: Stale model probe renders offline
- **WHEN** a status or session snapshot requests model information and model access reports a stale route
- **THEN** the snapshot treats the session route as unavailable or offline instead of preserving an online state with missing model information

#### Scenario: Best-effort status failure remains nonfatal
- **WHEN** local status-line rendering cannot update because the Pi extension UI context is stale or unavailable
- **THEN** PiRelay skips or safely degrades that status update without crashing the session or marking messenger transport health unhealthy
