# EPC Device Work And EMS Refinement Design

## Goal

Make Device Work shock controls operate against the real equipment work window, expose the DC/AC engineering assumption consistently, and make EMS dispatch and aggregation auditable without bypassing the PCS power limit.

## Confirmed Behavior

### Device Work Model

- Load shock `startup` and `early` positions are measured from the first active load interval, not from midnight or the first zero-load source row.
- `startup` places the first shock immediately after active load begins. `early` places shocks inside the first quarter of the active load window.
- The model editor is rendered as one LOAD row and one GENSET row.
- `gensetStepEnabled` and `gensetPlatforms` remain normalized and used by dispatch, but their controls are hidden from the UI.
- Load Work Profile keeps the existing `5 min / 1 hour` switch and gains a sticky summary row. Power columns show duration-weighted average kW; the summary label also reports modeled load energy for the displayed period. SOC shows the final interval value.

### DC/AC Ratio

- `assumptions.pvDcAcRatio` is the canonical project-level field with a default of `1.2`.
- Detail Inputs exposes `DC/AC Ratio` as an editable engineering input.
- PV Simulator reads the canonical ratio automatically and presents it as read-only. Its AC rating remains `PV DC / DC/AC Ratio`.
- Existing simulator-only `settings.dcAcRatio` values are accepted as a compatibility fallback, but normalized projects persist the canonical assumption.

### EMS Dispatch

- EMS dispatch is calculated on the 5-minute profile. Display aggregation never changes dispatch decisions.
- PV serves load first. Battery then serves the remaining load up to the minimum of load deficit, PCS kW limit, and SOC-safe discharge power. Genset serves only the residual load unless explicit genset shock preemption is enabled.
- The PCS power limit is retained as a physical constraint. A nonzero Genset value while SOC remains above Min SOC is valid when the battery is power-limited by PCS.
- Each profile row carries an auditable Genset reason: `PCS limit`, `SOC limit`, `Manual strategy`, `Shock preemption`, or blank when Genset is off.
- EMS animation displays the active PCS limit and the Genset reason. The table adds a `Genset reason` column.

### EMS Table

- Replace `Merge hourly` with a `5 min / 1 hour` segmented control; default is `1 hour`.
- Store the display choice in `emsFlowDisplaySettings.emsTableIntervalMinutes`. Continue reading legacy `mergeHourly` values during normalization.
- Hourly power values are duration-weighted averages. Hourly SOC is the final 5-minute SOC, not an average.
- The table has a fixed maximum height, sticky header, internal scrolling, and a sticky total row.

## Data Compatibility

- No D1 schema migration is required. EPC projects remain JSON payloads.
- New normalized fields:
  - `assumptions.pvDcAcRatio`
  - `emsFlowDisplaySettings.emsTableIntervalMinutes`
- Existing fields `mergeHourly`, `deviceWorkModel.gensetStepEnabled`, `deviceWorkModel.gensetPlatforms`, and PV Simulator `settings.dcAcRatio` remain readable for backward compatibility.

## Verification

- Engine normalization tests cover DC/AC and EMS table interval compatibility.
- UI/state tests cover active-window shock placement helpers, hidden Genset platform controls, two-row model layout, Load Work summary, fixed EMS table, interval switch, PCS display, and Genset reason.
- Browser verification changes `startup` to `early`, confirms shock movement after load startup, checks PV Simulator ratio synchronization, and confirms hourly rows use final SOC and display the PCS-limited Genset reason.

