// Multi-Page Quote Logic

// Mark quote as dirty when any input changes
document.addEventListener('input', (e) => {
    if (e.target.closest('#view-quotation')) {
        isQuoteDirty = true;
    }
});

// Update the list of saved quotes in the dropdown
function renderSavedQuotesList() {
    const select = document.getElementById('saved-quotes-select');
    if (!select) return;
    
    // Preserve the first option
    select.innerHTML = '<option value="">-- 新建报价 (New) --</option>';
    
    savedQuotes.forEach(quote => {
        const opt = document.createElement('option');
        opt.value = quote.id;
        opt.textContent = quote.name || quote.no || 'Unnamed Quote';
        select.appendChild(opt);
    });
    
    select.value = currentSavedQuoteId || '';
}

// Switch between subpages
function switchQuoteSubpage(pageNumber) {
    if (isQuoteDirty) {
        if (confirm('当前页面有未保存的改动，是否保存？\n(点“确定”保存，点“取消”直接切换)')) {
            saveCurrentQuote();
        } else {
            // Optional: reset dirtiness if they don't want to save?
            // isQuoteDirty = false;
        }
    }
    
    for (let i = 1; i <= 5; i++) {
        const page = document.getElementById(`quote-page-${i}`);
        if (page) {
            if (i == pageNumber) {
                page.classList.remove('hidden');
                page.classList.add('block');
            } else {
                page.classList.add('hidden');
                page.classList.remove('block');
            }
        }
    }
    
    document.getElementById('quote-page-select').value = pageNumber;
    
    if (pageNumber == 3) {
        renderPartBreakdown();
    }
}

// Create a new empty quote
function createNewQuote() {
    if (isQuoteDirty && confirm('当前页面有未保存的改动，是否保存？')) {
        saveCurrentQuote();
    }
    
    currentSavedQuoteId = null;
    isQuoteDirty = false;
    
    // Reset Page 1 inputs
    document.getElementById('input-customer-name').value = '';
    document.getElementById('input-customer-contact').value = '';
    document.getElementById('input-site-address').value = '';
    document.getElementById('quote-no').value = '';
    
    // Reset quoteRows globally
    quoteRows = [{ id: Date.now(), description: '', vendor: '', spec: '', batchNo: '', quantity: 1, price: 0, cost: 0, productId: '', inventoryId: '' }];
    renderQuote();
    
    // Reset Page 2
    document.getElementById('roi-before-bill').value = '0';
    document.getElementById('roi-after-bill').value = '0';
    calculateROI();
    
    // Reset Page 4
    document.getElementById('ref-notes').value = '';
    clearRefImage();
    
    // Reset Page 5
    clearSiteImage();
    sitePVPanels = [];
    renderSiteWorkspace();
    
    renderSavedQuotesList();
    switchQuoteSubpage(1);
}

// --- Image Upload Helpers ---
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function resizeImageBase64(base64Str, maxWidth = 800) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            if (img.width <= maxWidth) {
                resolve(base64Str);
                return;
            }
            const canvas = document.createElement('canvas');
            const ratio = maxWidth / img.width;
            canvas.width = maxWidth;
            canvas.height = img.height * ratio;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = base64Str;
    });
}

// --- Page 2: ROI Logic ---
function calculateROI() {
    const before = parseFloat(document.getElementById('roi-before-bill').value) || 0;
    const after = parseFloat(document.getElementById('roi-after-bill').value) || 0;
    const monthlySaving = before - after;
    const yearlySaving = monthlySaving * 12;
    
    document.getElementById('roi-monthly-saving').textContent = monthlySaving.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    document.getElementById('roi-yearly-saving').textContent = yearlySaving.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    
    const tbody = document.getElementById('roi-table-body');
    tbody.innerHTML = '';
    
    let cumulative = 0;
    for (let i = 1; i <= 20; i++) {
        cumulative += yearlySaving;
        const tr = document.createElement('tr');
        tr.className = "border-b border-slate-50";
        tr.innerHTML = `
            <td class="py-2 px-2 text-slate-500 font-bold">Year ${i}</td>
            <td class="py-2 px-2 text-right text-purple-700 font-bold"><span class="currency-symbol">${currentCurrency==='CNY'?'¥':'RM'}</span>${yearlySaving.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
            <td class="py-2 px-2 text-right text-purple-900 font-black"><span class="currency-symbol">${currentCurrency==='CNY'?'¥':'RM'}</span>${cumulative.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
        `;
        tbody.appendChild(tr);
    }
}

// --- Page 3: Part Breakdown Logic ---
let partImages = {}; // { rowId: { brandImg: base64, productImg: base64 } }

function renderPartBreakdown() {
    const container = document.getElementById('part-breakdown-container');
    container.innerHTML = '';
    
    const validRows = quoteRows.filter(r => !r.isBlank && ((r.description||'').trim() || (r.spec||'').trim()));
    
    if (validRows.length === 0) {
        container.innerHTML = '<p class="text-slate-400 text-sm text-center py-10">No products selected in quotation.</p>';
        return;
    }
    
    validRows.forEach((row, idx) => {
        const imgs = partImages[row.id] || {};
        
        const div = document.createElement('div');
        div.className = "border border-slate-200 rounded-xl p-6 bg-slate-50 flex flex-col md:flex-row gap-6";
        
        div.innerHTML = `
            <div class="flex-1">
                <div class="flex items-center gap-3 mb-2">
                    <span class="w-6 h-6 bg-purple-700 text-white rounded flex items-center justify-center text-xs font-bold">${idx + 1}</span>
                    <h3 class="text-lg font-black text-slate-800">${row.description || 'Unknown'}</h3>
                </div>
                <p class="text-sm text-slate-500 mb-1"><span class="font-bold text-slate-400">Brand:</span> ${row.vendor || '-'}</p>
                <p class="text-sm text-slate-500"><span class="font-bold text-slate-400">Spec:</span> ${row.spec || '-'}</p>
            </div>
            <div class="flex gap-4">
                <div class="flex flex-col items-center gap-2">
                    <p class="text-[10px] font-bold text-slate-400 uppercase">Brand Logo</p>
                    <label class="w-24 h-24 border-2 border-dashed border-slate-300 rounded-lg flex items-center justify-center cursor-pointer overflow-hidden bg-white hover:border-purple-400 relative">
                        <input type="file" accept="image/*" class="hidden no-print" onchange="uploadPartImage('${row.id}', 'brandImg', this)">
                        ${imgs.brandImg ? `<img src="${imgs.brandImg}" class="w-full h-full object-contain">` : `<span class="text-xs text-slate-400 no-print">+</span>`}
                    </label>
                </div>
                <div class="flex flex-col items-center gap-2">
                    <p class="text-[10px] font-bold text-slate-400 uppercase">Product Image</p>
                    <label class="w-32 h-32 border-2 border-dashed border-slate-300 rounded-lg flex items-center justify-center cursor-pointer overflow-hidden bg-white hover:border-purple-400 relative">
                        <input type="file" accept="image/*" class="hidden no-print" onchange="uploadPartImage('${row.id}', 'productImg', this)">
                        ${imgs.productImg ? `<img src="${imgs.productImg}" class="w-full h-full object-contain">` : `<span class="text-xs text-slate-400 no-print">+</span>`}
                    </label>
                </div>
            </div>
        `;
        container.appendChild(div);
    });
}

async function uploadPartImage(rowId, type, input) {
    if (!input.files || !input.files[0]) return;
    const base64 = await fileToBase64(input.files[0]);
    const resized = await resizeImageBase64(base64, 400);
    
    if (!partImages[rowId]) partImages[rowId] = {};
    partImages[rowId][type] = resized;
    isQuoteDirty = true;
    renderPartBreakdown();
}

// --- Page 4: Reference Logic ---
let refImageBase64 = null;

async function uploadRefImage(input) {
    if (!input.files || !input.files[0]) return;
    const base64 = await fileToBase64(input.files[0]);
    refImageBase64 = await resizeImageBase64(base64, 1000);
    
    document.getElementById('ref-image-preview').src = refImageBase64;
    document.getElementById('ref-image-preview').classList.remove('hidden');
    document.getElementById('ref-image-placeholder').classList.add('hidden');
    isQuoteDirty = true;
}

function clearRefImage() {
    refImageBase64 = null;
    document.getElementById('ref-image-preview').src = '';
    document.getElementById('ref-image-preview').classList.add('hidden');
    document.getElementById('ref-image-placeholder').classList.remove('hidden');
    document.getElementById('ref-image-upload').value = '';
    isQuoteDirty = true;
}

// --- Page 5: Site Overview Logic ---
let siteImageBase64 = null;
let sitePVPanels = []; // {id, x, y, w, h}

async function uploadSiteImage(input) {
    if (!input.files || !input.files[0]) return;
    const base64 = await fileToBase64(input.files[0]);
    siteImageBase64 = await resizeImageBase64(base64, 1200);
    
    document.getElementById('site-image-preview').src = siteImageBase64;
    document.getElementById('site-image-preview').classList.remove('hidden');
    
    document.getElementById('btn-add-pv-panel').style.display = 'inline-block';
    document.getElementById('btn-clear-site').style.display = 'inline-block';
    isQuoteDirty = true;
}

function clearSiteImage() {
    siteImageBase64 = null;
    sitePVPanels = [];
    document.getElementById('site-image-preview').src = '';
    document.getElementById('site-image-preview').classList.add('hidden');
    document.getElementById('site-image-upload').value = '';
    
    document.getElementById('btn-add-pv-panel').style.display = 'none';
    document.getElementById('btn-clear-site').style.display = 'none';
    renderSiteWorkspace();
    isQuoteDirty = true;
}

function addSitePVPanel() {
    const workspace = document.getElementById('site-workspace');
    const panel = {
        id: 'pv_' + Date.now(),
        x: workspace.offsetWidth / 2 - 40,
        y: workspace.offsetHeight / 2 - 60,
        w: 80,
        h: 120
    };
    sitePVPanels.push(panel);
    renderSiteWorkspace();
    isQuoteDirty = true;
}

function renderSiteWorkspace() {
    const workspace = document.getElementById('site-workspace');
    // Remove existing panels
    workspace.querySelectorAll('.pv-panel').forEach(el => el.remove());
    
    sitePVPanels.forEach(panel => {
        const el = document.createElement('div');
        el.className = "pv-panel absolute bg-[#582C83]/80 border-2 border-[#582C83] flex items-center justify-center cursor-move group hover:bg-[#582C83]";
        el.style.left = panel.x + 'px';
        el.style.top = panel.y + 'px';
        el.style.width = panel.w + 'px';
        el.style.height = panel.h + 'px';
        
        // The V shape inside
        el.innerHTML = `
            <svg viewBox="0 0 24 24" class="w-1/2 h-1/2 text-white/50 group-hover:text-white" fill="none" stroke="currentColor" stroke-width="3">
                <path d="M4 6l8 12 8-12" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <div class="resize-handle absolute right-0 bottom-0 w-4 h-4 bg-white/50 cursor-se-resize hidden group-hover:block no-print"></div>
            <button class="delete-handle absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] hidden group-hover:flex items-center justify-center no-print" onclick="deletePVPanel('${panel.id}')">✕</button>
        `;
        
        // Dragging logic
        let isDragging = false;
        let startX, startY, initialX, initialY;
        
        el.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('resize-handle') || e.target.classList.contains('delete-handle')) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            initialX = panel.x;
            initialY = panel.y;
            e.stopPropagation();
        });
        
        // Resizing logic
        let isResizing = false;
        let initialW, initialH;
        
        const resizeHandle = el.querySelector('.resize-handle');
        if(resizeHandle) {
            resizeHandle.addEventListener('mousedown', (e) => {
                isResizing = true;
                startX = e.clientX;
                startY = e.clientY;
                initialW = panel.w;
                initialH = panel.h;
                e.stopPropagation();
            });
        }
        
        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                panel.x = initialX + (e.clientX - startX);
                panel.y = initialY + (e.clientY - startY);
                el.style.left = panel.x + 'px';
                el.style.top = panel.y + 'px';
                isQuoteDirty = true;
            } else if (isResizing) {
                panel.w = Math.max(20, initialW + (e.clientX - startX));
                panel.h = Math.max(20, initialH + (e.clientY - startY));
                el.style.width = panel.w + 'px';
                el.style.height = panel.h + 'px';
                isQuoteDirty = true;
            }
        });
        
        document.addEventListener('mouseup', () => {
            isDragging = false;
            isResizing = false;
        });
        
        workspace.appendChild(el);
    });
}

function deletePVPanel(id) {
    sitePVPanels = sitePVPanels.filter(p => p.id !== id);
    renderSiteWorkspace();
    isQuoteDirty = true;
}


// --- Save & Load Logic ---
function saveCurrentQuote() {
    const name = document.getElementById('input-customer-name').value.trim() || 'Unnamed Quote';
    const no = document.getElementById('quote-no').value.trim();
    
    if (!currentSavedQuoteId) {
        currentSavedQuoteId = 'quote_' + Date.now();
    }
    
    const quoteData = {
        id: currentSavedQuoteId,
        name: name,
        no: no,
        updatedAt: Date.now(),
        // Page 1 specific values
        customerName: name,
        customerContact: document.getElementById('input-customer-contact').value,
        siteAddress: document.getElementById('input-site-address').value,
        quoteDate: document.getElementById('currentDate').value,
        quoteRows: JSON.parse(JSON.stringify(quoteRows)),
        shippingHandling: document.getElementById('val-shipping-handling').value,
        proposedSize: document.getElementById('input-proposed-size').value,
        solarProgram: document.getElementById('select-solar-program').value,
        
        // Payment & Timelines (basic extraction)
        timeline1: document.getElementById('val-step1').value,
        timeline1Days: document.getElementById('timeline-days-1').value,
        timeline2: document.getElementById('val-step2').value,
        timeline2Days: document.getElementById('timeline-days-2').value,
        timeline3: document.getElementById('val-step3').value,
        timeline3Days: document.getElementById('timeline-days-3').value,
        
        paymentConfPct: document.getElementById('payment-confirmation-percent').value,
        paymentInstPct: document.getElementById('payment-installation-percent').value,
        paymentTestPct: document.getElementById('payment-testing-percent').value,
        paymentFinalPct: document.getElementById('payment-final-percent').value,
        paymentFinalShow: !document.getElementById('payment-final-container').classList.contains('hidden'),
        
        // Page 2
        roiBeforeBill: document.getElementById('roi-before-bill').value,
        roiAfterBill: document.getElementById('roi-after-bill').value,
        
        // Page 3
        partImages: JSON.parse(JSON.stringify(partImages)),
        
        // Page 4
        refImageBase64: refImageBase64,
        refNotes: document.getElementById('ref-notes').value,
        
        // Page 5
        siteImageBase64: siteImageBase64,
        sitePVPanels: JSON.parse(JSON.stringify(sitePVPanels))
    };
    
    const idx = savedQuotes.findIndex(q => q.id === currentSavedQuoteId);
    if (idx >= 0) {
        savedQuotes[idx] = quoteData;
    } else {
        savedQuotes.push(quoteData);
    }
    
    isQuoteDirty = false;
    renderSavedQuotesList();
    
    // Save to GitHub
    try {
        if (window.buildUpdatedHtml) {
            window.buildUpdatedHtml();
        }
        if (window.commitPagesUpdateWithDeletes) {
            window.commitPagesUpdateWithDeletes({
                message: `minova: save quote ${quoteData.no || quoteData.id}`
            }).then(() => alert('报价已保存并同步')).catch(e => console.warn('Sync failed, saved locally:', e));
        }
    } catch(e) {
        console.error(e);
        alert('保存到本地成功，但同步到云端失败。');
    }
}

function onSavedQuoteSelect(id) {
    if (!id) {
        createNewQuote();
        return;
    }
    
    if (isQuoteDirty && confirm('当前页面有未保存的改动，是否保存？')) {
        saveCurrentQuote();
    }
    
    loadSavedQuote(id);
}

function loadSavedQuote(id) {
    const quote = savedQuotes.find(q => q.id === id);
    if (!quote) return;
    
    currentSavedQuoteId = id;
    
    // Page 1
    document.getElementById('input-customer-name').value = quote.customerName || '';
    document.getElementById('input-customer-contact').value = quote.customerContact || '';
    document.getElementById('input-site-address').value = quote.siteAddress || '';
    document.getElementById('quote-no').value = quote.no || '';
    document.getElementById('currentDate').value = quote.quoteDate || '';
    
    quoteRows = quote.quoteRows || [];
    
    document.getElementById('val-shipping-handling').value = quote.shippingHandling || '已包含';
    document.getElementById('input-proposed-size').value = quote.proposedSize || '';
    document.getElementById('select-solar-program').value = quote.solarProgram || 'gridtied';
    if(window.updateSolarProgramIcon) updateSolarProgramIcon();
    
    document.getElementById('val-step1').value = quote.timeline1 || '现场勘测';
    document.getElementById('timeline-days-1').value = quote.timeline1Days || '0';
    document.getElementById('val-step2').value = quote.timeline2 || '材料采购与安装规划';
    document.getElementById('timeline-days-2').value = quote.timeline2Days || '0';
    document.getElementById('val-step3').value = quote.timeline3 || '安装';
    document.getElementById('timeline-days-3').value = quote.timeline3Days || '0';
    
    document.getElementById('payment-confirmation-percent').value = quote.paymentConfPct || '30';
    document.getElementById('payment-installation-percent').value = quote.paymentInstPct || '40';
    document.getElementById('payment-testing-percent').value = quote.paymentTestPct || '30';
    document.getElementById('payment-final-percent').value = quote.paymentFinalPct || '0';
    
    if (quote.paymentFinalShow && window.toggleFinalPayment) {
        toggleFinalPayment(true);
    } else if (window.toggleFinalPayment) {
        toggleFinalPayment(false);
    }
    
    renderQuote();
    calculateQuote();
    
    // Page 2
    document.getElementById('roi-before-bill').value = quote.roiBeforeBill || '0';
    document.getElementById('roi-after-bill').value = quote.roiAfterBill || '0';
    calculateROI();
    
    // Page 3
    partImages = quote.partImages || {};
    renderPartBreakdown();
    
    // Page 4
    refImageBase64 = quote.refImageBase64 || null;
    document.getElementById('ref-notes').value = quote.refNotes || '';
    if (refImageBase64) {
        document.getElementById('ref-image-preview').src = refImageBase64;
        document.getElementById('ref-image-preview').classList.remove('hidden');
        document.getElementById('ref-image-placeholder').classList.add('hidden');
    } else {
        clearRefImage();
    }
    
    // Page 5
    siteImageBase64 = quote.siteImageBase64 || null;
    sitePVPanels = quote.sitePVPanels || [];
    if (siteImageBase64) {
        document.getElementById('site-image-preview').src = siteImageBase64;
        document.getElementById('site-image-preview').classList.remove('hidden');
        document.getElementById('btn-add-pv-panel').style.display = 'inline-block';
        document.getElementById('btn-clear-site').style.display = 'inline-block';
    } else {
        clearSiteImage();
    }
    renderSiteWorkspace();
    
    isQuoteDirty = false;
    document.getElementById('saved-quotes-select').value = id;
}


// --- Multi-Page PDF Generation Logic ---
window.openPDFSelectionModal = () => {
    document.getElementById('pdf-selection-modal').classList.remove('hidden');
    document.getElementById('pdf-selection-modal').classList.add('flex');
};

window.closePDFSelectionModal = () => {
    document.getElementById('pdf-selection-modal').classList.add('hidden');
    document.getElementById('pdf-selection-modal').classList.remove('flex');
};

    
    
// Initialization hook
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        renderSavedQuotesList();
    }, 1000);
});
