# EPC Off-Grid Core v4 Design

## Goal

Add an off-grid-first EPC design layer to the existing Minova EPC tab: standard topology selection, graph normalization, connection legality validation, LV/MV architecture comparison, cable screening, protection matrix, and an Electrical Workspace panel.

## Scope

This slice stays inside the current Minova architecture:

- `epc-design-engine.mjs` owns deterministic EPC calculations and normalized JSON.
- `epc-design-engine.global.js` mirrors the browser global companion.
- `index.html` owns the EPC tab UI and rendering.
- EPC projects remain JSON records under the existing `epc_design_project` D1 domain.
- No D1 schema migration and no React Flow editor in this slice.

## Data Model

Each normalized EPC project gains:

- `selectedTopologyId`: standard topology identifier, defaulting to `C5` for island/off-grid projects.
- `topology.nodes`: normalized power graph nodes.
- `topology.edges`: normalized power graph edges.

Each calculated EPC result gains:

- `standardTopologies`: available off-grid topology library entries.
- `topologyValidation`: validity, warnings, errors, and suggested fixes.
- `electricalArchitecture`: LV/MV architecture candidates and recommendation.
- `cableScreening`: budget-level cable candidates.
- `protectionMatrix`: required concept-stage protection functions.
- `emsStateMachine`: EMS modes and required operator actions.

Supported node types: `GRID`, `PV_ARRAY`, `PV_INVERTER`, `BATTERY`, `PCS`, `HYBRID_INVERTER`, `GENSET`, `LV_BUS`, `MV_BUS`, `MV_SWITCHBOARD`, `LV_SWITCHBOARD`, `TRANSFORMER`, `METER`, `ATS`, `STS`, `LOAD`, `CRITICAL_LOAD_PANEL`, `EMS`, and `SCADA`.

Supported edge types: `DC_POWER`, `AC_LV_POWER`, `AC_MV_POWER`, `COMMUNICATION`, and `CONTROL`.

## Behavior

Standard topology library:

- `C2`: PV + Genset, no battery.
- `C3`: AC-coupled PV + BESS + Genset.
- `C5`: Off-grid microgrid, default for island mode.
- `C7`: MV ring microgrid for high-power, long-distance sites.

Validation:

- `PV_ARRAY -> LV_BUS` is invalid because a PV inverter is required.
- `BATTERY -> LV_BUS` is invalid unless represented as an integrated hybrid inverter.
- LV sources connecting to MV buses require a transformer suggestion.
- `PCS -> LOAD` is a warning because bus/switchboard mediation is normally required.
- `EMS` power edges are invalid; EMS may only use communication/control edges.

Electrical screening:

- Preserve current fields: `architecture`, `mvRecommended`, `lvCurrentA`, `voltageOptions`, `flags`, and `recommendation`.
- Add candidate architectures: `415V Centralized`, `Distributed 415V`, `6.6kV Radial`, `11kV Radial`, and `11kV Ring`.
- Estimate transformer kVA using `MaximumCoincident_kW / (PF x loading target)`.
- Estimate cable options with ampacity, derating, voltage-drop percentage, parallel runs, losses, and status.
- Return a concept-stage protection matrix without final relay settings.

UI:

- Add `Topology` and `Electrical` EPC panel tabs.
- Topology panel shows selector, budget SLD, node/edge lists, validation warnings/errors, and suggested fixes.
- Electrical panel shows architecture comparison, transformer summary, cable candidates, protection matrix, and engineering disclaimers.
- Detailed engineering controls remain permission-gated by `epcDesignEngineering`.

## Acceptance Criteria

- Island projects default to `C5` and produce LV/MV bus topology data.
- Invalid graph connections are blocked in validation output with specific codes and suggested fixes.
- Large off-grid projects rank MV options ahead of single centralized 415V.
- Cable screening returns at least one LV and one MV candidate with `PASS`, `REVIEW`, or `FAIL`.
- UI exposes the new panels without removing current EPC Flow, Device Work, Battery Control, or PV Simulator behavior.
