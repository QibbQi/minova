# Hybrid EPC v4 Review

## Source Review

The v4 wireframe spec is a strong target model for concept-stage hybrid EPC design. Its most valuable requirements for the current Minova app are traceable calculations, load-first sizing, editable topology, LV/MV screening, cable screening, EMS logic, and explicit engineering disclaimers.

The spec is broader than one Minova implementation slice. It describes a future multi-page engineering platform with Next.js, React Flow, GIS, API services, PostgreSQL/PostGIS, object storage, review workflows, and export services. Minova today is a static GitHub Pages app with a Cloudflare Worker/D1 backend, a large `index.html`, a browser global EPC engine, JSON business payloads, and Node tests.

## Current Minova Fit

Already present:

- EPC tab with quick/detailed modes, permissions, D1-backed JSON projects, static sync, and report export.
- Load methods for energy meter, equipment schedule, genset kVA/load factor, and diesel/SFC.
- PV/BESS/PCS sizing, formula trace, risks, BOQ, GSA solar resource import, PV Simulator, EMS Flow, Device Work, and Battery Control.
- Baseline tests for engine, UI state, permissions, persistence, and EPC flow controls.

Missing or shallow:

- No first-class EPC graph model with LV/MV bus nodes and power/control edge types.
- No standard topology library driving off-grid EPC design classification.
- No connection legality engine for voltage mismatch, transformer insertion, EMS communication-only rules, or direct load warnings.
- LV/MV architecture output is currently a single recommendation, not a comparable candidate set.
- No cable candidate table, voltage-drop screening, transformer sizing summary, or protection matrix in the EPC UI.

## Implementation Recommendation

Adopt the v4 spec in slices. The first slice should be off-grid first because Minova's current EPC cases target genset replacement and island/hybrid customers. It should use the existing Minova storage and UI patterns, not a greenfield stack.

For the first slice:

- Keep EPC projects as JSON records under `epc_design_project`; no D1 migration.
- Add topology and electrical screening fields to normalized EPC project JSON.
- Generate off-grid standard topologies `C2`, `C3`, `C5`, and `C7`.
- Default island projects to `C5 Off-Grid Microgrid`.
- Add validator results and advisory suggested fixes; do not silently mutate a user topology.
- Add compact Topology and Electrical panels inside the existing EPC tab.

Later slices can add true canvas editing, GIS route measurement, detailed simulation modes, C&I grid-tied workflows, version approvals, and external report exports.
