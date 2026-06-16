# EPC Grid-Tied C&I Roadmap

## Purpose

This roadmap captures the next EPC slice after the off-grid core. It focuses on C&I grid-tied and grid-hybrid projects where utility interface, export control, anti-islanding, PCC protection, and approval workflows become first-class design drivers.

## Candidate Topologies

- `C1`: C&I grid-tied PV only.
- `C6`: Grid + PV + BESS + Genset.
- `R1`, `R2`, and `R3`: residential variants if Minova later supports smaller channel-partner workflows.

## Required Additions

- Grid/PCC data inputs: utility voltage, transformer ownership, metering position, export permission, import demand, maximum export, and outage behavior.
- Grid-code checks: anti-islanding, export control, reverse power, sync check, voltage/frequency functions, and authority review status.
- Financial separation: theoretical PV generation, simulated self-consumption, export energy, curtailment, net saving, and promised saving.
- Report separation: customer summary, engineering calculation, authority submission checklist, and quote package.

## Recommended Sequence

1. Add grid-tied topology library entries and validation rules.
2. Add PCC and export-control fields to EPC project JSON.
3. Extend EMS state machine for `GRID_NORMAL`, `PV_PRIORITY`, `BATTERY_SUPPORT`, `GRID_OUTAGE`, and `ISLAND_TRANSITION`.
4. Add grid import/export rows to EMS Flow and Simulation outputs.
5. Add authority and certification checklist integration from the Engineering Workspace standards catalog.

## Non-Goals For Off-Grid Core

- Do not block off-grid delivery on utility-specific workflows.
- Do not claim final relay settings, IEC 60909 short-circuit study, load flow, harmonic study, or protection coordination.
- Do not migrate EPC projects out of their current JSON/D1 business entity storage until the workflow stabilizes.
