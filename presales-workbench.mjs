export const PRESALES_STAGES = Object.freeze([
  'Intake', 'Sizing', 'Product/BOQ', 'Risk', 'Quote/PDF', 'Handoff'
]);

export const PRESALES_ASSUMPTION_STATUS = Object.freeze({
  preliminary: 'Preliminary / BD estimate',
  needs_source: 'Needs source/date',
  engineering_review: 'Engineering draft / requires review',
  confirmed: 'Engineering confirmed'
});

export const PRESALES_RISK_STATUS = Object.freeze({
  open: 'Open risks',
  needs_review: 'Needs engineering review',
  accepted: 'Accepted for proposal'
});

export const PRESALES_READINESS_LABEL = 'BD Readiness';

export const PRESALES_INTAKE_DEFAULTS = Object.freeze({
  siteName: '',
  location: '',
  facilityType: '',
  monthlyConsumptionKwh: null,
  billMonthsAvailable: null,
  peakDemandKw: null,
  tariffCategory: '',
  tariffSource: '',
  tariffSourceDate: '',
  gensetCapacityKva: null,
  gensetRuntimeHoursMonth: null,
  dieselConsumptionLitersMonth: null,
  gensetUse: 'unknown',
  availableAreaM2: null,
  transformerCapacityKva: null,
  exportEligibility: 'unknown',
  primaryConstraint: '',
  targetSavingPct: null,
  budgetRange: '',
  proposalDueDate: '',
  customerDecisionNote: ''
});

export const PRESALES_EVIDENCE_DEFAULTS = Object.freeze({
  utilityBills: 'missing',
  loadProfile: 'missing',
  sitePhotos: 'missing',
  existingSld: 'missing',
  structuralReport: 'missing'
});

const text = value => String(value ?? '').trim();
const finiteOrNull = value => {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};
const enumValue = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
const evidenceDone = value => ['complete', 'available', 'not_required'].includes(value);

export function normalizePresalesProject(record = {}) {
  const intake = record.intakeBasis && typeof record.intakeBasis === 'object'
    ? record.intakeBasis
    : {};
  const evidence = record.evidenceStatus && typeof record.evidenceStatus === 'object'
    ? record.evidenceStatus
    : {};
  const billMonths = finiteOrNull(intake.billMonthsAvailable);
  return {
    id: text(record.id) || `presales_${Date.now()}`,
    customerName: text(record.customerName),
    siteSummary: text(record.siteSummary),
    stage: enumValue(record.stage, PRESALES_STAGES, 'Intake'),
    quoteId: text(record.quoteId),
    epcDesignProjectId: text(record.epcDesignProjectId),
    assumptionStatus: enumValue(
      record.assumptionStatus,
      Object.keys(PRESALES_ASSUMPTION_STATUS),
      'preliminary'
    ),
    riskStatus: enumValue(record.riskStatus, Object.keys(PRESALES_RISK_STATUS), 'open'),
    intakeBasis: {
      siteName: text(intake.siteName),
      location: text(intake.location),
      facilityType: text(intake.facilityType),
      monthlyConsumptionKwh: finiteOrNull(intake.monthlyConsumptionKwh),
      billMonthsAvailable: billMonths == null ? null : Math.min(12, Math.round(billMonths)),
      peakDemandKw: finiteOrNull(intake.peakDemandKw),
      tariffCategory: text(intake.tariffCategory),
      tariffSource: text(intake.tariffSource),
      tariffSourceDate: text(intake.tariffSourceDate),
      gensetCapacityKva: finiteOrNull(intake.gensetCapacityKva),
      gensetRuntimeHoursMonth: finiteOrNull(intake.gensetRuntimeHoursMonth),
      dieselConsumptionLitersMonth: finiteOrNull(intake.dieselConsumptionLitersMonth),
      gensetUse: enumValue(intake.gensetUse, ['unknown', 'outage', 'peak_shaving', 'continuous'], 'unknown'),
      availableAreaM2: finiteOrNull(intake.availableAreaM2),
      transformerCapacityKva: finiteOrNull(intake.transformerCapacityKva),
      exportEligibility: enumValue(
        intake.exportEligibility,
        ['unknown', 'confirmed', 'restricted', 'not_allowed'],
        'unknown'
      ),
      primaryConstraint: text(intake.primaryConstraint),
      targetSavingPct: finiteOrNull(intake.targetSavingPct),
      budgetRange: text(intake.budgetRange),
      proposalDueDate: text(intake.proposalDueDate),
      customerDecisionNote: text(intake.customerDecisionNote)
    },
    evidenceStatus: {
      utilityBills: enumValue(evidence.utilityBills, ['complete', 'partial', 'missing'], 'missing'),
      loadProfile: enumValue(evidence.loadProfile, ['available', 'requested', 'missing'], 'missing'),
      sitePhotos: enumValue(evidence.sitePhotos, ['available', 'requested', 'missing'], 'missing'),
      existingSld: enumValue(evidence.existingSld, ['available', 'requested', 'missing'], 'missing'),
      structuralReport: enumValue(
        evidence.structuralReport,
        ['available', 'requested', 'not_required', 'missing'],
        'missing'
      )
    },
    updatedAt: text(record.updatedAt)
  };
}

export function buildPresalesEvidenceGaps(project = {}, quote = null, epc = null) {
  const normalized = normalizePresalesProject(project);
  const intake = normalized.intakeBasis;
  const evidence = normalized.evidenceStatus;
  const gaps = [];
  const add = (priority, id, label, actionLabel, target) => {
    gaps.push({ priority, id, label, actionLabel, target });
  };

  if (Number(epc?.openHighRiskCount || 0) > 0 || epc?.reportBlocked) {
    add(0, 'high-risk', `${Number(epc?.openHighRiskCount || 0)} open High risks`, 'Open EPC High Risks', 'risks');
  }
  if (!intake.tariffSource || !intake.tariffSourceDate) {
    add(10, 'tariff-source-date', 'Tariff source/date missing', 'Add tariff evidence', 'energy');
  }
  if ((intake.billMonthsAvailable || 0) < 12 || evidence.utilityBills !== 'complete') {
    const missing = Math.max(0, 12 - Number(intake.billMonthsAvailable || 0));
    add(20, 'utility-bills', `Bills ${intake.billMonthsAvailable || 0}/12`, `Add ${missing} months`, 'evidence');
  }
  if (evidence.loadProfile !== 'available') {
    add(30, 'load-profile', 'Load profile missing', 'Request from customer', 'evidence');
  }
  if (evidence.sitePhotos !== 'available') {
    add(31, 'site-photos', 'Site photos missing', 'Request site photos', 'evidence');
  }
  if (evidence.existingSld !== 'available') {
    add(32, 'existing-sld', 'Existing SLD missing', 'Request existing SLD', 'evidence');
  }
  if (!evidenceDone(evidence.structuralReport)) {
    add(33, 'structural-report', 'Structural basis missing', 'Confirm structural path', 'evidence');
  }
  if (!normalized.quoteId || !quote) {
    add(40, 'quote-link', 'Quote not linked', 'Select Quote Draft', 'quote');
  }
  if (!normalized.epcDesignProjectId || !epc) {
    add(50, 'epc-link', 'EPC concept not linked', 'Select Hybrid EPC Design', 'epc');
  }
  return gaps.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

export function calculatePresalesReadiness(project = {}, quote = null, epc = null) {
  const normalized = normalizePresalesProject(project);
  const intake = normalized.intakeBasis;
  const evidence = normalized.evidenceStatus;
  const intakeChecks = [
    normalized.customerName,
    intake.location,
    intake.facilityType,
    Number(intake.monthlyConsumptionKwh || 0) > 0,
    Number(intake.targetSavingPct || 0) > 0 || intake.customerDecisionNote,
    intake.proposalDueDate
  ];
  const intakePoints = intakeChecks.filter(Boolean).length * 5;
  const evidencePoints =
    (evidence.utilityBills === 'complete' ? 5 : evidence.utilityBills === 'partial' ? 2 : 0) +
    (evidenceDone(evidence.loadProfile) ? 5 : 0) +
    (evidenceDone(evidence.sitePhotos) ? 5 : 0) +
    (evidenceDone(evidence.existingSld) ? 5 : 0) +
    (evidenceDone(evidence.structuralReport) ? 5 : 0);
  const quotePoints = (normalized.quoteId ? 5 : 0) + (quote?.loaded ? 5 : 0) + (Number(quote?.quoteTotal || 0) > 0 ? 5 : 0);
  const recommendationReady = Number(epc?.pvMwp || 0) > 0 || Number(epc?.bessMwh || 0) > 0 || Number(epc?.pcsMw || 0) > 0;
  const epcPoints = (normalized.epcDesignProjectId ? 5 : 0) + (epc?.loaded ? 5 : 0) + (recommendationReady ? 10 : 0);
  const riskPoints = (normalized.riskStatus === 'accepted' ? 5 : 0) + (epc?.loaded && !epc?.reportBlocked && !Number(epc?.openHighRiskCount || 0) ? 5 : 0);
  const rawScore = Math.round(intakePoints + evidencePoints + quotePoints + epcPoints + riskPoints);
  const blocked = Boolean(epc?.reportBlocked || Number(epc?.openHighRiskCount || 0) > 0);
  const score = Math.max(0, Math.min(blocked ? 79 : 100, rawScore));
  const gaps = buildPresalesEvidenceGaps(normalized, quote, epc);
  return {
    label: PRESALES_READINESS_LABEL,
    score,
    rawScore,
    capped: score !== rawScore,
    blocked,
    breakdown: {
      intake: intakePoints,
      evidence: evidencePoints,
      quote: quotePoints,
      epc: epcPoints,
      risk: riskPoints
    },
    nextAction: gaps[0]?.actionLabel || 'Ready for engineering handoff'
  };
}

export function buildPresalesOpportunityModel(project = {}, quote = null, epc = null) {
  const normalized = normalizePresalesProject(project);
  return {
    project: normalized,
    quote,
    epc,
    gaps: buildPresalesEvidenceGaps(normalized, quote, epc),
    readiness: calculatePresalesReadiness(normalized, quote, epc)
  };
}
