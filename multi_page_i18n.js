// Add translations dynamically to existing i18n object if possible
if (typeof i18n !== 'undefined') {
    Object.assign(i18n.zh, {
        roiTitle: "ROI / 财务分析",
        beforeBill: "安装前 (月电费)",
        afterBill: "安装后 (月电费)",
        monthlySaving: "每月节省",
        yearlySaving: "每年节省",
        yearCol: "年份",
        energySavingCol: "节省电费",
        cumulativeSavingCol: "累计节省",
        partBreakdownTitle: "产品明细与保修",
        brandLogoText: "品牌图",
        productImageText: "产品图",
        referenceTitle: "参考资料",
        uploadRefImageText: "点击或拖拽上传 APP 控制页截图",
        siteOverviewTitle: "现场概览",
        uploadRoofImageText: "上传屋顶图片",
        addPvPanelText: "+ 添加光伏板",
        clearImageText: "清除图片",
        pdfPagesTitle: "选择要生成的 PDF 页面",
        pdfQuotation: "1. 报价单",
        pdfNext: "下一步：选择附件",
        pdfCancel: "取消"
    });

    Object.assign(i18n.en, {
        roiTitle: "ROI / Financial Analysis",
        beforeBill: "Before Installation (Monthly Bill)",
        afterBill: "After Installation (Monthly Bill)",
        monthlySaving: "Monthly Saving",
        yearlySaving: "Yearly Saving",
        yearCol: "Year",
        energySavingCol: "Energy Saving",
        cumulativeSavingCol: "Cumulative Saving",
        partBreakdownTitle: "Part Breakdown & Warranty",
        brandLogoText: "Brand Logo",
        productImageText: "Product Image",
        referenceTitle: "Reference",
        uploadRefImageText: "Click or drag to upload APP control page screenshot",
        siteOverviewTitle: "Site Overview",
        uploadRoofImageText: "Upload Roof Image",
        addPvPanelText: "+ Add PV Panel",
        clearImageText: "Clear Image",
        pdfPagesTitle: "Select PDF Pages to Generate",
        pdfQuotation: "1. Quotation",
        pdfNext: "Next: Attachments",
        pdfCancel: "Cancel"
    });
}

// Hook into toggleLanguage and toggleCurrency
const originalToggleLanguage = window.toggleLanguage;
window.toggleLanguage = () => {
    if (originalToggleLanguage) {
        originalToggleLanguage();
    }
    updateMultiPageLanguageLabels();
};

function updateMultiPageLanguageLabels() {
    
    if (typeof currentLanguage === 'undefined' || typeof i18n === 'undefined') return;
    const t = i18n[currentLanguage];
    if (!t) return;

    // Translation helper
    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
    };
    const setHtml = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = text;
    };

    // Update headings (Page 2-5)
    const headings = document.querySelectorAll('.quote-subpage h2');
    if (headings[1]) headings[1].innerText = t.roiTitle;
    if (headings[2]) headings[2].innerText = t.partBreakdownTitle;
    if (headings[3]) headings[3].innerText = t.referenceTitle;
    if (headings[4]) headings[4].innerText = t.siteOverviewTitle;

    // Page 2: ROI
    const roiLabels = document.querySelectorAll('#quote-page-2 label');
    if (roiLabels[0]) roiLabels[0].innerText = t.beforeBill;
    if (roiLabels[1]) roiLabels[1].innerText = t.afterBill;
    
    const roiSavingLabels = document.querySelectorAll('#quote-page-2 .text-center p.text-\\[10px\\]');
    if (roiSavingLabels[0]) roiSavingLabels[0].innerText = t.monthlySaving;
    if (roiSavingLabels[1]) roiSavingLabels[1].innerText = t.yearlySaving;
    
    const roiThs = document.querySelectorAll('#quote-page-2 th');
    if (roiThs[0]) roiThs[0].innerText = t.yearCol;
    if (roiThs[1]) roiThs[1].innerText = t.energySavingCol;
    if (roiThs[2]) roiThs[2].innerText = t.cumulativeSavingCol;

    // Page 4: Reference
    const refPlaceholder = document.querySelector('#ref-image-placeholder p');
    if (refPlaceholder) refPlaceholder.innerText = t.uploadRefImageText;

    // Page 5: Site Overview
    const siteUploadLabel = document.querySelector('#quote-page-5 label');
    if (siteUploadLabel) {
        // preserve the input inside label
        const inputHtml = '<input type="file" id="site-image-upload" accept="image/*" onchange="uploadSiteImage(this)" class="hidden">';
        siteUploadLabel.innerHTML = t.uploadRoofImageText + '\n' + inputHtml;
    }
    
    setText('btn-add-pv-panel', t.addPvPanelText);
    setText('btn-clear-site', t.clearImageText);
    setText('btn-clear-ref', t.clearImageText);

    // Modal
    const modalTitle = document.querySelector('#pdf-selection-modal h3');
    if (modalTitle) modalTitle.innerText = t.pdfPagesTitle;
    
    const pdfQuoteSpan = document.querySelector('#pdf-page-checkboxes span');
    if (pdfQuoteSpan) pdfQuoteSpan.innerText = t.pdfQuotation;
    
    const modalBtns = document.querySelectorAll('#pdf-selection-modal button');
    if (modalBtns.length >= 2) {
        modalBtns[0].innerText = t.pdfCancel;
        modalBtns[1].innerText = t.pdfNext;
    }
    
    // Also re-render dynamic parts
    calculateROI();
    renderPartBreakdown();
};

// Also monkey-patch toggleCurrency
const originalToggleCurrency = window.toggleCurrency;
window.toggleCurrency = () => {
    if (originalToggleCurrency) {
        originalToggleCurrency();
    }
    // Re-render ROI table and saving to update currency symbol
    calculateROI();
};
updateMultiPageLanguageLabels();
