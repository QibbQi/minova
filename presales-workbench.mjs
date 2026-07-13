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

export const PRESALES_COPY = Object.freeze({
  en: Object.freeze({
    eyebrow: 'BD Pre-sales', workspace: 'Pre-sales Workspace', newOpportunity: 'New opportunity',
    newCase: 'New Case', save: 'Save', handoff: 'Handoff', switchPrompt: 'Save changes before switching projects?',
    saveAndSwitch: 'Save & Switch', discard: 'Discard', cancel: 'Cancel',
    progressiveIntake: 'Progressive intake', operatingBasis: 'Customer and operating basis',
    customer: 'Customer', energy: 'Energy', diesel: 'Diesel', site: 'Site', objective: 'Objective', evidence: 'Evidence',
    customerName: 'Customer', siteName: 'Site name', location: 'Location', facilityType: 'Facility type',
    monthlyConsumption: 'Monthly consumption (kWh)', billMonths: 'Bill months available', peakDemand: 'Peak demand (kW)',
    tariffCategory: 'Tariff category', tariffSource: 'Tariff source', tariffSourceDate: 'Tariff source date',
    gensetCapacity: 'Genset capacity (kVA)', runtime: 'Runtime (hours/month)', dieselConsumption: 'Diesel (liters/month)',
    gensetUse: 'Genset use', availableArea: 'Available area (m2)', transformerCapacity: 'Transformer capacity (kVA)',
    exportEligibility: 'Export eligibility', primaryConstraint: 'Primary constraint', targetSaving: 'Target saving (%)',
    budgetRange: 'Budget range', proposalDueDate: 'Proposal due date', assumptionStatus: 'Assumption status',
    customerDecisionNote: 'Customer decision note', utilityBills: 'Utility bills', loadProfile: 'Load profile',
    sitePhotos: 'Site photos', existingSld: 'Existing SLD', structuralReport: 'Structural report', riskStatus: 'Risk status',
    rawNotes: 'Raw customer and site notes', linkedWork: 'Linked work', quoteDraft: 'Quote draft', epcDesign: 'Hybrid EPC design',
    useCurrentQuote: 'Use Current Quote', useCurrentEpc: 'Use Current EPC', openQuote: 'Open Quote', openEpc: 'Open EPC',
    customerSummary: 'Customer Summary', engineeringHandoff: 'Engineering Handoff', projectSummary: 'Project summary',
    closeHandoff: 'Close handoff', viewPlainText: 'View plain text', copy: 'Copy',
    readinessLabel: 'BD Readiness', intake: 'Intake', quoteSnapshot: 'Quote snapshot', recommendedBess: 'Recommended BESS', recommendedPcs: 'Recommended PCS', defaultNextAction: 'Capture customer and energy basis', viewBreakdown: 'View breakdown', hideBreakdown: 'Hide breakdown',
    noQuoteLinked: 'No quote linked.', noEpcLinked: 'No EPC concept linked.', pending: 'Pending', pendingEpc: 'Pending EPC', epcDraft: 'EPC draft',
    energyArchitecture: 'Energy architecture', energyContext: 'PV, load, storage and supply context', customerLoad: 'Customer Load', acBusPcs: 'AC Bus / PCS',
    actionableEvidenceGaps: 'Actionable evidence gaps', evidenceReady: 'Evidence and linked work are ready for engineering handoff.',
    customerOutputBlocked: 'Customer-facing output blocked by High risk', customerOutputBlockedReason: 'Customer-facing output blocked by open High risk. Resolve or acknowledge the High risk in EPC before release.',
    saveFailed: 'Save failed - Retry Save', saving: 'Saving...', saved: 'Saved', notSaved: 'Not saved', unsavedChanges: 'Unsaved changes',
    quoteVersion: 'Quote version', approvalStatus: 'Approval status', notChecked: 'not checked', loadingQuote: 'Loading saved quote snapshot',
    quoteTotal: 'Quote Total', lineItems: 'Line Items', monthlyUsage: 'Monthly Usage', targetGeneration: 'Target Generation', proposedPv: 'Proposed PV', payback: 'Payback',
    snapshotRows: 'Snapshot rows', loadSnapshotRows: 'Load snapshot for row detail', keyRoiInput: 'Key ROI input', sizingBasis: 'Sizing basis', loadQuote: 'Load quote for ROI KPI', preliminaryEstimate: 'Preliminary / BD estimate until inputs are reviewed.', loadDetails: 'Load Details',
    engineeringDraft: 'Engineering draft / requires review', reportsBlocked: 'Reports blocked by open High risk', noBlockingHighRisk: 'No blocking High risk',
    recommendedPvBessPcs: 'Recommended PV/BESS/PCS', loadBasis: 'Load Basis', openHighRisks: 'Open High Risks', boqLines: 'BOQ Lines', openRisks: 'open risks', totalRisks: 'total risks',
    productMasterReadiness: 'Product Master readiness still required', reviewElectricalArchitecture: 'Review electrical architecture and BOQ before firm proposal.', schemes: 'Schemes', risks: 'Risks', boq: 'BOQ',
    customerSummaryTitle: 'Customer Summary', internalHandoffTitle: 'Internal Engineering Handoff', locationPending: 'Pending customer/site inputs.', notLinked: 'Not linked', unconfirmedRisks: 'Unconfirmed risks',
    customerSiteBasis: 'Customer/site basis', billMonthsShort: 'bill months', tariff: 'Tariff', source: 'source', date: 'date', diesel: 'Diesel',
    hoursMonth: 'hours/month', litersMonth: 'liters/month', use: 'use', transformer: 'transformer', export: 'export', constraint: 'constraint',
    savingTarget: 'saving', budget: 'budget', due: 'due', decision: 'decision', bills: 'bills', structural: 'structural',
    customerCopyDenied: 'Customer output is blocked by open High risk'
  }),
  zh: Object.freeze({
    eyebrow: '售前', workspace: '售前工作台', newOpportunity: '新商机',
    newCase: '新建项目', save: '保存', handoff: '交接', switchPrompt: '切换项目之前保存更改？',
    saveAndSwitch: '保存并切换', discard: '放弃更改', cancel: '取消',
    progressiveIntake: '渐进式信息采集', operatingBasis: '客户与运行基础',
    customer: '客户', energy: '能源', diesel: '柴油', site: '现场', objective: '目标', evidence: '证据',
    customerName: '客户', siteName: '现场名称', location: '地点', facilityType: '设施类型',
    monthlyConsumption: '月用电量 (kWh)', billMonths: '已具备账单月数', peakDemand: '峰值需量 (kW)',
    tariffCategory: '电价类别', tariffSource: '电价来源', tariffSourceDate: '电价来源日期',
    gensetCapacity: '发电机容量 (kVA)', runtime: '运行时间 (小时/月)', dieselConsumption: '柴油用量 (升/月)',
    gensetUse: '发电机用途', availableArea: '可用面积 (m2)', transformerCapacity: '变压器容量 (kVA)',
    exportEligibility: '上网资格', primaryConstraint: '主要约束', targetSaving: '目标节省 (%)',
    budgetRange: '预算范围', proposalDueDate: '方案截止日期', assumptionStatus: '假设状态',
    customerDecisionNote: '客户决策备注', utilityBills: '电费账单', loadProfile: '负荷曲线',
    sitePhotos: '现场照片', existingSld: '现有单线图', structuralReport: '结构报告', riskStatus: '风险状态',
    rawNotes: '客户与现场原始记录', linkedWork: '关联工作', quoteDraft: '报价草稿', epcDesign: 'Hybrid EPC 设计',
    useCurrentQuote: '使用当前报价', useCurrentEpc: '使用当前 EPC', openQuote: '打开报价', openEpc: '打开 EPC',
    customerSummary: '客户摘要', engineeringHandoff: '工程交接', projectSummary: '项目摘要',
    closeHandoff: '关闭交接', viewPlainText: '查看纯文本', copy: '复制',
    readinessLabel: '商务就绪度', intake: '信息采集', quoteSnapshot: '报价快照', recommendedBess: '建议 BESS', recommendedPcs: '建议 PCS', defaultNextAction: '补充客户与用能基础信息', viewBreakdown: '查看明细', hideBreakdown: '收起明细',
    noQuoteLinked: '未关联报价。', noEpcLinked: '未关联 EPC 概念。', pending: '待补充', pendingEpc: '待补充 EPC', epcDraft: 'EPC 草案',
    energyArchitecture: '能源架构', energyContext: '光伏、负荷、储能与供电背景', customerLoad: '客户负荷', acBusPcs: '交流母线 / PCS',
    actionableEvidenceGaps: '待补证据', evidenceReady: '证据与关联工作已满足工程交接条件。',
    customerOutputBlocked: '高风险未关闭，客户输出已阻止', customerOutputBlockedReason: '存在未关闭的高风险，客户输出已阻止。请先在 EPC 中解决或确认该高风险后再发布。',
    saveFailed: '保存失败 - 请重试保存', saving: '正在保存...', saved: '已保存', notSaved: '未保存', unsavedChanges: '有未保存更改',
    quoteVersion: '报价版本', approvalStatus: '审批状态', notChecked: '未核对', loadingQuote: '正在加载已保存报价快照',
    quoteTotal: '报价总额', lineItems: '报价行', monthlyUsage: '月用电量', targetGeneration: '目标发电量', proposedPv: '建议光伏', payback: '回本期',
    snapshotRows: '快照行', loadSnapshotRows: '加载快照以查看报价行', keyRoiInput: 'ROI 关键输入', sizingBasis: '容量配置基础', loadQuote: '加载报价以查看 ROI 指标', preliminaryEstimate: '在输入复核前，此为初步商务估算。', loadDetails: '加载详情',
    engineeringDraft: '工程草案 / 需要复核', reportsBlocked: '未关闭的高风险阻止报告', noBlockingHighRisk: '无阻止性高风险',
    recommendedPvBessPcs: '建议 PV/BESS/PCS', loadBasis: '负荷基础', openHighRisks: '未关闭高风险', boqLines: 'BOQ 行数', openRisks: '项未关闭风险', totalRisks: '项总风险',
    productMasterReadiness: '仍需确认产品主数据就绪度', reviewElectricalArchitecture: '正式提案前请复核电气架构与 BOQ。', schemes: '方案', risks: '风险', boq: 'BOQ',
    customerSummaryTitle: '客户摘要', internalHandoffTitle: '内部工程交接', locationPending: '待补充客户/现场信息。', notLinked: '未关联', unconfirmedRisks: '未确认风险',
    customerSiteBasis: '客户/现场基础', billMonthsShort: '个月账单', tariff: '电价', source: '来源', date: '日期', diesel: '柴油',
    hoursMonth: '小时/月', litersMonth: '升/月', use: '用途', transformer: '变压器', export: '上网', constraint: '约束',
    savingTarget: '节省', budget: '预算', due: '截止', decision: '决策', bills: '账单', structural: '结构',
    customerCopyDenied: '存在未关闭的高风险，客户输出已阻止'
  })
});

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
