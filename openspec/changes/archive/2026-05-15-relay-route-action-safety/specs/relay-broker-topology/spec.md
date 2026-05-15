## ADDED Requirements

### Requirement: Broker uses shared route-action safety
Broker-mediated prompt delivery, requester file delivery, image retrieval, abort, and compact actions SHALL use the same route-action safety outcomes as in-process messenger adapters.

#### Scenario: Broker prompt race reports unavailable
- **WHEN** the broker forwards an authorized prompt to a registered route and the route becomes unavailable during delivery
- **THEN** the broker responds with a safe unavailable error and does not report successful delivery to the ingress adapter

#### Scenario: Broker abort rolls back unavailable race
- **WHEN** the broker marks a route abort-requested and the route abort action reports unavailable
- **THEN** the broker clears the abort-requested state and returns an unavailable error to the requester

#### Scenario: Broker compact race is contained
- **WHEN** the broker receives a compact request for a route that becomes unavailable during compaction
- **THEN** the broker returns an unavailable error instead of allowing an uncaught rejection or claiming compaction succeeded

#### Scenario: Broker file action fails closed on unavailable workspace
- **WHEN** a broker-mediated requester file or image action cannot prove the target route workspace is available
- **THEN** the broker returns a safe unavailable error and does not fall back to stale route workspace data

### Requirement: Broker route status uses coherent probes
Broker route registration, status snapshots, and session lists SHALL preserve route unavailable state when any route-action probe detects stale or unavailable session-bound objects.

#### Scenario: Broker status detects unavailable route
- **WHEN** broker status rendering probes a route whose live context has become unavailable
- **THEN** the route is reported offline or unavailable rather than online idle or online busy

#### Scenario: Broker does not use stale model data
- **WHEN** a route model lookup fails because the route is unavailable
- **THEN** broker status does not keep the route online using stale or missing model data
