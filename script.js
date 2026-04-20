// ═══════════════════════════════════════════
// AGRIADAPT — HYBRID ML-INFRASTRUCTURE ENGINE
// ═══════════════════════════════════════════

// 1. CONFIG & CONSTANTS
const TOTAL_PIVOTS = 63;
const COOP_PROFIT_BMRK = 1300000000; // 1.3 Billion RWF
const SOLAR_CAPACITY_MW = 3.3;

// SHAP Data (Kirehe XGBoost 2001-2023)
const SHAP = [
  { name:'CDD (Dry Days)', imp:0.24, color:'#FF4F4F' },
  { name:'SM_D8_rel',      imp:0.21, color:'#00F0FF' },
  { name:'RF_CUMUL',       imp:0.18, color:'#0080FF' },
  { name:'NDVI_Peak',      imp:0.15, color:'#00FF66' },
  { name:'LST_Anomaly',    imp:0.12, color:'#FF8000' }
];

// 2. GLOBAL STATE
let GLOBAL_MEMBERS = [];
let LAST_KPI_STATE = { wrsi: 0 };
let _autoMonitorTimer = null;
let _autoMonitorRunning = false;

// Crop Sensitivity Coeffs & Yields (Tonnes per hectare)
const CROP_DATA = { 
    'Maize': { weight: 1.0, yield: 4.5 }, 
    'Beans': { weight: 1.15, yield: 2.1 }, 
    'Coffee': { weight: 0.85, yield: 1.2 }, 
    'Vegetables': { weight: 1.3, yield: 8.5 }
};
const MARKET_PRICE_RWF_T = 350000; // Market price per tonne

// Kirehe Sector Centroids & Soil Profiles
const KIREHE_SECTORS = [
    { n:'Nasho', c:[-2.08, 30.73], fert: 1.15 }, { n:'Mpanga', c:[-2.25, 30.78], fert: 0.95 }, 
    { n:'Gahara', c:[-2.35, 30.60], fert: 0.85 }, { n:'Gatore', c:[-2.25, 30.55], fert: 1.05 }, 
    { n:'Kigarama', c:[-2.15, 30.52], fert: 0.90 }, { n:'Kigina', c:[-2.18, 30.68], fert: 1.00 }, 
    { n:'Mahama', c:[-2.32, 30.85], fert: 0.80 }, { n:'Musaza', c:[-2.28, 30.92], fert: 0.85 }, 
    { n:'Mushikiri', c:[-2.12, 30.62], fert: 1.10 }, { n:'Nyamugari', c:[-2.15, 30.85], fert: 0.95 }, 
    { n:'Nyarubuye', c:[-2.22, 30.82], fert: 0.90 }, { n:'Kirehe', c:[-2.27, 30.65], fert: 1.00 }
];

// ═══════════════════════════════════════════
// TAB SYSTEM
// ═══════════════════════════════════════════
function tab(id) {
  // Ensure members are always loaded before rendering dependent panels
  if (['analysis', 'export', 'ledger'].includes(id) && GLOBAL_MEMBERS.length === 0) {
    _seedMembers();
  }

  ['inputs','risk','ledger','finance','map','impact','model','export','analysis'].forEach(function(t) {
    const pEl = document.getElementById('p-'+t);
    const nEl = document.getElementById('nb-'+t);
    if(pEl) {
        pEl.classList.toggle('active', t===id);
        pEl.style.display = (t === id) ? 'block' : 'none'; // Aggressively enforce display to bypass CSS bugs
    }
    if(nEl) nEl.classList.toggle('active', t===id);
  });
  
  // Conditionally show/hide the giant hero section to save space on inner pages
  const hero = document.querySelector('.hero');
  if (hero) {
      if (['inputs', 'risk', 'impact'].includes(id)) {
          hero.style.display = 'flex';
      } else {
          hero.style.display = 'none';
      }
  }

  try {
      if(id === 'map')      { initLeafletMap(); }
      if(id === 'ledger')   { _ensureMembers(); renderLedger(); }
      if(id === 'export')   { _ensureMembers(); renderExportHub(); }
      if(id === 'analysis') { _ensureMembers(); renderAnalysisHub(); }
      if(id === 'model')    { renderShap(); }
  } catch(err) {
      console.error('Tab render error [' + id + ']:', err);
      const pEl = document.getElementById('p-'+id);
      if (pEl) {
          pEl.style.display = 'block';
          pEl.classList.add('active');
          pEl.innerHTML = `
            <div style="padding:60px; text-align:center; color:white; background:rgba(255,79,79,0.1); border-radius:24px; border:1px solid var(--red);">
                <i class="fa-solid fa-triangle-exclamation fa-3x" style="color:var(--red); margin-bottom:20px;"></i>
                <h3 style="font-family:var(--cab); font-size:24px; margin-bottom:10px;">Render Error Detected</h3>
                <p style="font-family:var(--mono); font-size:12px; opacity:0.7; margin-bottom:20px;">[Panel: ${id}] ${err.message}</p>
                <div style="display:flex; gap:10px; justify-content:center;">
                    <button class="btn btn-mini" onclick="location.reload()">Reload Dashboard</button>
                    <button class="btn btn-mini" onclick="localStorage.removeItem('agriadapt_members'); location.reload();" style="background:var(--red); color:white; border-color:var(--red);">Reset Corrupted Data</button>
                </div>
            </div>
          `;
      }
  }
}

function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  document.getElementById('t-light').classList.toggle('active', t==='light');
  document.getElementById('t-white').classList.toggle('active', t==='white');
  document.getElementById('t-dark').classList.toggle('active', t==='dark');
  document.getElementById('t-black').classList.toggle('active', t==='black');
}

function syncTrend(id, current, last) {
    const el = document.getElementById(id);
    if (!el) return;
    const diff = current - last;
    if (diff > 0) el.innerHTML = `<i class="fa-solid fa-caret-up"></i> +${diff.toFixed(1)}%`;
    else if (diff < 0) el.innerHTML = `<i class="fa-solid fa-caret-down"></i> ${diff.toFixed(1)}%`;
    else el.innerHTML = `<i class="fa-solid fa-equals"></i> 0%`;
}

// ═══════════════════════════════════════════
// INPUT HANDLER
// ═══════════════════════════════════════════
function getInp() {
  return {
    rf_cumul:  parseFloat(document.getElementById('rf_cumul').value),
    cdd:       parseInt(document.getElementById('cdd').value),
    sm_rel:    parseFloat(document.getElementById('sm_rel').value),
    ndvi:      parseFloat(document.getElementById('ndvi').value),
    
    solar_mw:  parseFloat(document.getElementById('solar_mw').value),
    pivots_active: parseInt(document.getElementById('pivots_active').value),
    reservoir: parseInt(document.getElementById('reservoir').value),
    
    dekad:     parseInt(document.getElementById('dekad').value),
    soil_ph:   parseFloat(document.getElementById('soil_ph').value)
  };
}

// ═══════════════════════════════════════════
// HYBRID PREDICTION ENGINE
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
// HYBRID PREDICTION ENGINE (Interrelated Core)
// ═══════════════════════════════════════════

function computeBaselineWRSI(i) {
  let wrsi = 100;
  
  // Risk compounding over time: stress hits harder later in season
  const seasonFactor = i.dekad / 12; // 4/12 to 12/12

  // High CDD & Low Rainfall = Compounded Stress
  let climateStress = (i.cdd / 30) * 0.4 + (Math.max(0, 500 - i.rf_cumul) / 500) * 0.6;
  
  // Severe CDD impact during flowering/grain filling dekads (6-9)
  if (i.cdd > 14 && i.dekad >= 6 && i.dekad <= 9) {
      climateStress *= 1.5; 
  }

  // Calculate cumulative penalty
  let cumulativePenalty = climateStress * 80 * seasonFactor;

  // In Dekad 10+, the crop is drying down. It stops accumulating drought damage.
  // We simulate this by capping the drought penalty to its peak at Dekad 9.
  if (i.dekad >= 10) {
      const lockedSeasonFactor = 9 / 12;
      cumulativePenalty = climateStress * 80 * lockedSeasonFactor;
  }

  wrsi -= cumulativePenalty;
  
  // Soil moisture factor amplifies with time
  if (i.sm_rel < 0.7 && i.dekad <= 9) {
      wrsi -= (20 * seasonFactor);
  } else if (i.dekad >= 10 && i.sm_rel > 0.8) {
      // Fungal rot penalty for excess standing moisture during harvest
      wrsi -= (i.sm_rel - 0.8) * 80;
  }
  
  // NDVI/Health proxy
  if (i.ndvi < 0.35) wrsi -= (15 * seasonFactor);

  // Nutrient & pH interactions: deep systemic impact
  if (i.soil_ph < 5.5 || i.soil_ph > 8.0) {
      wrsi -= 25; // Severe toxicity
  } else if (i.soil_ph < 6.0 || i.soil_ph > 7.5) {
      wrsi -= 10; // Moderate stress
  }
  
  let finalBase = Math.max(15, Math.min(100, Math.round(wrsi)));

  // Strict Biological cap: Even in perfect rain, toxic soil prevents growth
  if (i.soil_ph < 5.5 || i.soil_ph > 8.0) {
      finalBase = Math.min(finalBase, 65);
  } else if (i.soil_ph < 6.0 || i.soil_ph > 7.5) {
      finalBase = Math.min(finalBase, 84);
  }
  
  return finalBase;
}

function computeOptimizedWRSI(base, i) {
  // CRITICAL FAILURE: Reservoir at 0% kills pump pressure
  if (i.reservoir <= 0) return base;

  // Power Factor influenced by active pivots load
  const loadStress = (i.pivots_active / TOTAL_PIVOTS) * 0.1;
  const powerFactor = Math.max(0, (i.solar_mw / SOLAR_CAPACITY_MW) - loadStress);
  
  const activeFactor = (i.pivots_active / TOTAL_PIVOTS);
  const reservoirFactor = Math.pow(i.reservoir / 100, 0.5); // Concave efficiency
  
  let gain = (100 - base) * (powerFactor * activeFactor * reservoirFactor);
  
  // Over-irrigation penalty during harvest dry-down
  if (i.dekad >= 10) {
      gain = 0; // Irrigation provides ZERO restorative benefit in harvest phase
  }

  let opt = base + Math.round(gain);

  // Biological cap: Perfect irrigation CANNOT fix toxic soil lock-out
  if (i.soil_ph < 5.5 || i.soil_ph > 8.0) {
      opt = Math.min(opt, 65); // Severe lockout forcibly caps vitality at 65% max (CRITICAL)
  } else if (i.soil_ph < 6.0 || i.soil_ph > 7.5) {
      opt = Math.min(opt, 84); // Stressed soil forcibly caps vitality at 84% max (STRESSED)
  }

  // Absolute safety guard: adding water shouldn't magically make the crop WORSE than baseline
  opt = Math.max(base, opt);

  return Math.min(98, opt);
}

// ═══════════════════════════════════════════
// NUTRIENT LAB ADVISOR
// ═══════════════════════════════════════════
function updateNutrientLab(i) {
    const advice = document.getElementById('nutrient-advice');
    if(!advice) return;

    if(i.soil_ph < 5.5) {
        advice.innerHTML = "🚨 <strong>ALERT:</strong> Highly acidic soil detected. Base application of Agricultural Lime required before Nitrogen top-dressing to prevent nutrient lock-out.";
    } else if(i.soil_ph < 6.0) {
        advice.innerHTML = "⚠️ <strong>CAUTION:</strong> Moderately acidic conditions. Monitor molybdenum availability. Switch to nitrate-based fertilizers to avoid further soil acidification.";
    } else if(i.soil_ph > 8.0) {
        advice.innerHTML = "🚨 <strong>ALERT:</strong> Highly alkaline soil detected. Severe iron/manganese deficiency risk. Stop Urea. Apply elemental sulfur immediately.";
    } else if(i.soil_ph > 7.5) {
        advice.innerHTML = "⚠️ <strong>CAUTION:</strong> Mildly alkaline conditions. Phosphorus availability is threatened. Use acidifying fertilizers like Ammonium Sulfate.";
    } else if(i.sm_rel < 0.6 || i.reservoir < 15) {
        advice.innerHTML = "🚨 <strong>ALERT:</strong> Water hydraulic deficit detected. Urea application suspended to prevent root salinity burn. Switch to foliar micronutrient feeding.";
    } else if(i.rf_cumul > 450) {
        advice.innerHTML = "⚠️ <strong>CAUTION:</strong> Nitrate leaching risk. Heavy rainfall detected. Split Nitrogen dose and use slow-release nitrification inhibitors.";
    } else {
        const phExact = (i.soil_ph === 6.5) ? "Perfect neutral pH." : "Optimal pH zone.";
        advice.innerHTML = `✅ <strong>OPTIMAL:</strong> ${phExact} Combined fertigation recommended at current moisture. Grid pressure is sufficient for precise liquid Nitrogen delivery.`;
    }
}

// ═══════════════════════════════════════════
// MAIN UPDATE (The Interrelation Processor)
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
// UI HELPERS (CRASH-PROOF)
// ═══════════════════════════════════════════
const safeSet = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
};

const safeHTML = (id, html) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
};

const safeStyle = (id, prop, val) => {
    const el = document.getElementById(id);
    if (el) el.style[prop] = val;
};

function update() {
  const i = getInp();
  
  // 1. AUTO-DRIFT: Connect Water Stats -> pH Situation unless manually overriden
  if (!window.isUserDraggingPH) {
      let basePH = 6.5; // Kirehe theoretical median
      
      // Heavy seasonal rain leaches base cations (calcium/magnesium), creating acid soils
      if (i.rf_cumul > 300) {
          basePH -= ((i.rf_cumul - 300) / 220) * 1.8; 
      }
      // Sustained irrigation during droughts pulls deep salts to the surface (salinization / alkaline)
      if (i.cdd > 10 && i.pivots_active > 20) {
          basePH += ((i.cdd - 10) / 20) * 1.5 * (i.pivots_active / 63);
      }
      
      const newPH = Math.max(4.5, Math.min(8.5, basePH));
      document.getElementById('soil_ph').value = newPH.toFixed(1);
      i.soil_ph = parseFloat(newPH.toFixed(1)); // Resync for downstream calculations
  }
  
  // INTERRELATED CLIMATIC COUPLING: Rainfall creates clouds (reduces solar)
  if (i.rf_cumul > 450 && i.solar_mw > 1) { 
      const cloudFactor = 0.5; // Dense clouds
      const actualSolar = (i.solar_mw * cloudFactor).toFixed(1);
      safeStyle('v_solar_mw', 'color', 'var(--gold)');
      safeSet('v_solar_mw', `${actualSolar} MW (CLOUDY)`);
  } else {
      safeStyle('v_solar_mw', 'color', 'var(--cyan)');
      safeSet('v_solar_mw', i.solar_mw + ' MW');
  }

  const baseWRSI = computeBaselineWRSI(i);
  const optWRSI = computeOptimizedWRSI(baseWRSI, i);
  
  // EMERGENCY OVERLAY TRIGGER
  const overlay = document.getElementById('emergency-overlay');
  if (i.reservoir <= 0 && overlay) {
      overlay.style.display = 'flex';
      document.body.classList.add('emergency-pulse');
  }

  // Update Indicator Labels
  safeSet('v_rf_cumul', i.rf_cumul + ' mm');
  safeSet('v_cdd', i.cdd + ' d');
  safeSet('v_sm_rel', i.sm_rel);
  safeSet('v_ndvi', i.ndvi);
  safeSet('v_pivots_active', i.pivots_active + ' Units');
  safeSet('v_reservoir', i.reservoir + '%');
  safeSet('v_soil_ph', i.soil_ph);
  
  safeSet('v_dekad', 'Dekad ' + i.dekad);
  const dCount = document.getElementById('day-counter');
  if(dCount) dCount.textContent = i.dekad;
  const tProg = document.getElementById('time-prog');
  if(tProg) tProg.style.width = ((i.dekad/12)*100)+'%';

  // Hero Stats & TRENDS
  safeSet('h-wrsi-opt', optWRSI + '%');
  syncTrend('trend-wrsi', optWRSI, LAST_KPI_STATE.wrsi);
  LAST_KPI_STATE.wrsi = optWRSI;

  safeSet('h-wrsi-base', baseWRSI + '%');

  // Predictive Panel
  safeSet('wrsi-base-big', baseWRSI + '%');
  safeStyle('wrsi-base-fill', 'width', baseWRSI + '%');
  const tagBase = document.getElementById('tag-base');
  if(tagBase) {
      if (baseWRSI < 75) { tagBase.textContent = 'PREDICTED FAILURE'; tagBase.className = 'ptag pt-hi'; }
      else { tagBase.textContent = 'NOMINAL'; tagBase.className = 'ptag pt-lo'; }
  }

  safeSet('wrsi-opt-big', optWRSI + '%');
  safeStyle('wrsi-opt-fill', 'width', optWRSI + '%');
  const tagOpt = document.getElementById('tag-opt');
  if(tagOpt) {
      if (optWRSI < 75) { tagOpt.textContent = 'INSUFFICIENT RECOVERY'; tagOpt.className = 'ptag pt-hi'; }
      else { tagOpt.textContent = 'STABILIZED'; tagOpt.className = 'ptag pt-lo'; }
  }

  // ═══════════════════════════════════════════
  // SUB-SYSTEMS (PROTECTED EXECUTION)
  // ═══════════════════════════════════════════
  try {
      updateROI(baseWRSI, optWRSI, i.dekad);
      updateNarrator(i, baseWRSI, optWRSI);
      updateRecs(i, optWRSI);
      renderShap();
      updateNutrientLab(i);
  } catch (err) {
      console.error("Simulation Sub-system Error:", err);
  }
  
  // ═══════════════════════════════════════════
  // VISUAL SYNC (ORBS & HERO)
  // ═══════════════════════════════════════════
  const orbFill = document.getElementById('orb-fill');
  const orbPct = document.getElementById('orb-pct');
  const orbStatus = document.getElementById('orb-status');
  
  const circ = 2 * Math.PI * 108;
  if(orbFill) {
    orbFill.style.strokeDasharray = circ;
    orbFill.style.strokeDashoffset = circ * (1 - optWRSI/100);
  }
  
  if (orbPct) orbPct.textContent = optWRSI + '%';
  if (orbStatus) {
      if (optWRSI < 70) {
          orbStatus.textContent = 'Critical Risk';
          orbStatus.setAttribute('fill', '#FF4F4F');
      } else if (optWRSI < 85) {
          orbStatus.textContent = 'Stressed';
          orbStatus.setAttribute('fill', '#FBBF24');
      } else {
          orbStatus.textContent = 'Operational';
          orbStatus.setAttribute('fill', '#00F0FF');
      }
  }
  
  // Visual Proof Toggling
  const imgH = document.getElementById('img-healthy');
  const imgS = document.getElementById('img-stressed');
  if(imgH && imgS) {
    imgH.style.opacity = optWRSI > 80 ? '1' : '0.15';
    imgS.style.opacity = optWRSI < 75 ? '1' : '0.15';
  }

  // Elite Comparison Sync
  const crl = document.getElementById('comp-rf-live');
  const cwb = document.getElementById('comp-wrsi-base');
  const cwo = document.getElementById('comp-wrsi-opt');
  if(crl) crl.textContent = i.rf_cumul + ' mm';
  if(cwb) cwb.textContent = baseWRSI + '%';
  if(cwo) cwo.textContent = optWRSI + '%';

  // Lead-time and stats in impact
  const leadWeeks = Math.max(1, 12 - i.dekad);
  const lEl = document.getElementById('imp-lead2');
  if(lEl) lEl.textContent = leadWeeks + ' weeks';
  
  // Health Narrator Lead in Impact
  const irp = document.getElementById('imp-risk-pct2');
  if(irp) irp.textContent = optWRSI;

  // SPATIAL GATING CHECK
  checkSpectralGating();

  // SYNC SPECTRAL HUB (Only if Unlocked and in Simulation Mode)
  if (window.currentSpectralContext === 'sim') {
      syncSpectralFromDashboard();
  }

  // SYNC ANALYSIS HUB (If active)
  if (document.getElementById('p-analysis')?.classList.contains('active')) renderAnalysisHub();
  if (document.getElementById('p-export')?.classList.contains('active')) renderExportHub();
  if (document.getElementById('p-model')?.classList.contains('active')) renderShap();
}

// === SPATIAL GATING ENGINE ===
window.lastActiveArea = null; // Persists even after ledger save

function checkSpectralGating() {
    const hasArea = !!(currentStudyLayer || shpLayer || window.lastActiveArea);
    const overlay = document.getElementById('spectral-lock-overlay');
    if (overlay) {
        overlay.style.opacity = hasArea ? '0' : '1';
        overlay.style.pointerEvents = hasArea ? 'none' : 'auto';
    }
}

function getActiveStudyBounds() {
    if (shpLayer && shpLayer.getLayers().length > 0) return shpLayer.getBounds();
    if (currentStudyLayer) {
        if (currentStudyLayer instanceof L.Circle) return currentStudyLayer.getBounds();
        if (currentStudyLayer.getBounds) return currentStudyLayer.getBounds();
    }
    if (window.lastActiveArea) {
        if (window.lastActiveArea instanceof L.Circle) return window.lastActiveArea.getBounds();
        if (window.lastActiveArea.getBounds) return window.lastActiveArea.getBounds();
    }
    return null;
}

function updateROI(baseWRSI, optWRSI, dekad) {
    let seasonalRevenue = 0;
    let baseRevenue = 0;
    let totalHa = 0;
    let optimalCount = 0;

    const sectorStats = {};
    KIREHE_SECTORS.forEach(s => sectorStats[s.n] = 0);
    
    GLOBAL_MEMBERS.forEach(m => {
        const crop = CROP_DATA[m.crop] || CROP_DATA.Maize;
        const sProf = KIREHE_SECTORS.find(s => s.n === m.sector) || { fert: 1.0 };
        
        // Individualized Simulation
        const mBaseWrsi = Math.min(100, Math.round(baseWRSI / crop.weight));
        const mOptWrsi = Math.min(100, Math.round(optWRSI / crop.weight));
        
        m.wrsi = mOptWrsi; // For display in ledger
        
        const potentialTons = m.ha * crop.yield * sProf.fert;
        
        // Calculate REAL profit benefit
        const mBaseRevenue = potentialTons * (mBaseWrsi / 100) * MARKET_PRICE_RWF_T;
        const mOptRevenue = potentialTons * (mOptWrsi / 100) * MARKET_PRICE_RWF_T;
        
        m.yield_rwf = mOptRevenue; // Store for Map Popups
        
        baseRevenue += mBaseRevenue;
        seasonalRevenue += mOptRevenue;
        totalHa += parseFloat(m.ha);
        
        sectorStats[m.sector] = (sectorStats[m.sector] || 0) + mOptRevenue;
        
        if (m.wrsi > 80) optimalCount++;
    });

    const totalTons = Math.round(totalHa * 4.2 * (optWRSI/100));
    const memberAvg = GLOBAL_MEMBERS.length > 0 ? Math.round(seasonalRevenue / GLOBAL_MEMBERS.length) : 0;
    
    // Status Quo calculation is now dynamic based on REAL rainfall data
    const delta = baseRevenue > 0 ? Math.round(((seasonalRevenue - baseRevenue) / baseRevenue) * 100) : 0;
    
    safeSet('imp-rwf', Math.round(seasonalRevenue).toLocaleString() + ' RWF');
    safeSet('imp-rwf-base', Math.round(baseRevenue).toLocaleString() + ' RWF');
    safeSet('imp-rwf-total', Math.round(seasonalRevenue).toLocaleString());
    safeSet('imp-kg', totalTons.toLocaleString());
    safeSet('imp-weeks', memberAvg.toLocaleString());
    safeSet('imp-delta', '+' + delta + '% Surplus');

    // Update Sector Economic Breakdown in Finance Panel
    updateSectorEconomy(sectorStats);

    // NEW: Community Success HUD
    const statusHtml = `
            <div style="font-size:10px; color:var(--ink-mute); letter-spacing:0.1em;">COMMUNITY SUCCESS RATIO</div>
            <div style="font-size:20px; font-weight:800; color:var(--cyan);">${optimalCount} / ${GLOBAL_MEMBERS.length}</div>
            <div style="font-size:10px; color:var(--ink-soft); margin-top:2px;">Members in Optimal Range (>80% WRSI)</div>
    `;
    safeHTML('community-health', statusHtml);

    // Sync Economy Panel
    updateFinance(getInp(), seasonalRevenue);
    renderLedger(); // Keep table synced with new WRSI values
}

function updateFinance(i, revenue) {
    const solarCost = Math.round((i.solar_mw / 3.3) * 450000);
    const batteryCost = 280000;
    const pivotCost = Math.round((i.pivots_active / 63) * 620000);
    const totalOpEx = solarCost + batteryCost + pivotCost;
    const netProfit = revenue - totalOpEx;
    const perHH = GLOBAL_MEMBERS.length > 0 ? Math.round(netProfit / GLOBAL_MEMBERS.length) : 0;

    safeSet('fin-gross-revenue', Math.round(revenue).toLocaleString() + ' RWF');
    safeSet('fin-solar-cost', solarCost.toLocaleString() + ' RWF');
    safeSet('fin-battery-cost', batteryCost.toLocaleString() + ' RWF');
    safeSet('fin-pivot-cost', pivotCost.toLocaleString() + ' RWF');
    safeSet('fin-total-opex', totalOpEx.toLocaleString() + ' RWF');
    safeSet('fin-net-profit', netProfit.toLocaleString() + ' RWF');
    safeSet('fin-per-household', perHH.toLocaleString() + ' RWF');
}

function updateSectorEconomy(stats) {
    const cont = document.getElementById('sector-economy-stats');
    if(!cont) return;
    cont.innerHTML = '';
    
    // Sort sectors by revenue
    const sorted = Object.keys(stats).sort((a,b) => stats[b] - stats[a]);
    
    sorted.forEach(sName => {
        if(stats[sName] === 0) return;
        const block = document.createElement('div');
        block.className = 'inner-glass';
        block.style.padding = '12px';
        block.innerHTML = `
            <div style="font-size:10px; color:var(--ink-soft); text-transform:uppercase;">${sName}</div>
            <div style="font-family:var(--mono); color:var(--cyan); font-weight:800; margin-top:4px;">${Math.round(stats[sName]).toLocaleString()}</div>
            <div style="font-size:9px; color:var(--ink-mute);">RWF Revenue</div>
        `;
        cont.appendChild(block);
    });
}

function renderShap() {
    const cont = document.getElementById('shap-summary');
    if(!cont) return;
    cont.innerHTML = '';
    
    // Sort SHAP by importance
    const sorted = [...SHAP].sort((a,b) => b.imp - a.imp);
    
    sorted.forEach(d => {
        const row = document.createElement('div');
        row.style = 'margin-bottom:15px;';
        const lbl = `<div style="font-size:10px; color:var(--ink-soft); text-transform:uppercase; margin-bottom:5px;">${d.name} <span style="float:right">${(d.imp*100).toFixed(1)}% Impact</span></div>`;
        const bar = `<div style="height:4px; width:100%; background:rgba(255,255,255,0.05); border-radius:2px; overflow:hidden;">
            <div style="height:100%; width:${d.imp * 200}%; background:${d.color}; transition: width 0.5s ease-out;"></div>
        </div>`;
        row.innerHTML = lbl + bar;
        cont.appendChild(row);
    });
}

// ═══════════════════════════════════════════
// SPECTRAL INTELLIGENCE ENGINE
// NDVI · NDWI · SPI Analysis Hub
// ═══════════════════════════════════════════

// Kirehe Season B historical rainfall stats (CHIRPS 2001-2023)
const KIREHE_RF_MEAN = 285; // mm
const KIREHE_RF_STD  = 72;  // mm

// === INTERPRETATION TABLES ===
function interpretNDVI(v) {
    if (v > 0.7) return { label: 'Dense Vegetation',        color: '#00FF66' };
    if (v > 0.5) return { label: 'Healthy Vegetation',       color: '#7FDB00' };
    if (v > 0.3) return { label: 'Moderate Stress',          color: '#FBBF24' };
    if (v > 0.1) return { label: 'Sparse / Stressed',        color: '#FF8800' };
    return            { label: 'Bare Soil / Crop Failure',  color: '#FF4F4F' };
}

function interpretNDWI(v) {
    if (v > 0.3)  return { label: 'High Water Content',      color: '#00F0FF' };
    if (v > 0.0)  return { label: 'Adequate Moisture',       color: '#00AAFF' };
    if (v > -0.2) return { label: 'Mild Water Deficit',      color: '#FBBF24' };
    if (v > -0.4) return { label: 'Moderate Drought Stress', color: '#FF8800' };
    return              { label: 'Severe Water Deficit',     color: '#FF4F4F' };
}

function interpretSPI(v) {
    if (v >  2.0) return { label: 'Extremely Wet',      color: '#00F0FF' };
    if (v >  1.5) return { label: 'Very Wet',            color: '#00AAFF' };
    if (v >  1.0) return { label: 'Moderately Wet',      color: '#0080FF' };
    if (v > -1.0) return { label: 'Near Normal',         color: '#00FF66' };
    if (v > -1.5) return { label: 'Moderate Drought',    color: '#FBBF24' };
    if (v > -2.0) return { label: 'Severe Drought',      color: '#FF8800' };
    return              { label: 'Extreme Drought',      color: '#FF4F4F' };
}

function computeSPI(rf) {
    return (rf - KIREHE_RF_MEAN) / KIREHE_RF_STD;
}

// === MODE TOGGLE ===
function setSpectralMode(mode) {
    window.currentSpectralContext = mode;
    ['sim', 'upload', 'online'].forEach(m => {
        const panel = document.getElementById(`spectral-${m}`);
        const btn   = document.getElementById(`mode-${m}`);
        if (panel) panel.style.display = m === mode ? 'block' : 'none';
        if (btn)   btn.classList.toggle('active', m === mode);
    });
    
    // Reset manual flag when switching modes to allow fresh sync/initialization
    window.isSpectralManual = false;
    if (mode === 'sim') resetSpectralToSim();
}

// === SPECTRAL SLIDER LIVE HANDLERS ===
window.isSpectralManual = false; // Flag to allow manual adjustment without simulation override
window.currentSpectralContext = 'sim'; // Track source: sim, upload, online

// Called every time a spectral slider moves — updates label and re-runs analysis
function onSpectralSlider() {
    window.isSpectralManual = true; // User touched it, enter manual override mode
    
    const ndvi = parseFloat(document.getElementById('sp-ndvi')?.value ?? 0.48);
    const ndwi = parseFloat(document.getElementById('sp-ndwi')?.value ?? 0.05);
    const spi  = parseFloat(document.getElementById('sp-spi')?.value ?? -0.4);

    // Update value labels with live colours
    const ndviInterp = interpretNDVI(ndvi);
    const ndwiInterp = interpretNDWI(ndwi);
    const spiInterp  = interpretSPI(Math.max(-3, Math.min(3, spi)));

    safeSet('sp-ndvi-val', ndvi.toFixed(3));
    safeSet('sp-ndwi-val', ndwi.toFixed(3));
    safeSet('sp-spi-val',  spi.toFixed(2));

    safeStyle('sp-ndvi-val', 'color', ndviInterp.color);
    safeStyle('sp-ndwi-val', 'color', ndwiInterp.color);
    safeStyle('sp-spi-val',  'color', spiInterp.color);

    // Update the badge to show MANUAL mode
    const badge = document.getElementById('spectral-live-badge');
    if (badge) { 
        const contextLabel = window.currentSpectralContext === 'online' ? 'ADJUSTING NASA DATA' : 
                             window.currentSpectralContext === 'upload' ? 'ADJUSTING UPLOADED DATA' : 'MANUAL OVERRIDE';
        badge.innerHTML = `⬤ ${contextLabel}`;
        badge.style.background = 'rgba(251,191,36,0.1)';
        badge.style.color = 'var(--gold)';
        badge.style.borderColor = 'rgba(251,191,36,0.3)';
    }

    displaySpectralResults(ndvi, ndwi, spi, window.currentSpectralContext);
}

// Reset spectral sliders to values derived from the main dashboard sliders
function resetSpectralToSim() {
    syncSpectralFromDashboard();
    onSpectralSlider();
}

// Sync spectral sliders whenever the main update() runs
function syncSpectralFromDashboard() {
    if (window.isSpectralManual) return; // Don't override user's "What-If" adjustments
    
    // GATING: Don't sync if no area (it is locked anyway)
    if (!currentStudyLayer && !shpLayer) return;

    try {
        const i    = getInp();
        const ndvi = Math.max(-1, Math.min(1, i.ndvi));
        const ndwi = Math.max(-1, Math.min(1, (i.sm_rel - 0.75) * 1.8));
        const spi  = Math.max(-3, Math.min(3, computeSPI(i.rf_cumul)));

        const spNDVI = document.getElementById('sp-ndvi');
        const spNDWI = document.getElementById('sp-ndwi');
        const spSPI  = document.getElementById('sp-spi');

        if (spNDVI) spNDVI.value = ndvi.toFixed(2);
        if (spNDWI) spNDWI.value = ndwi.toFixed(2);
        if (spSPI)  spSPI.value  = spi.toFixed(1);

        // Update labels too
        safeSet('sp-ndvi-val', ndvi.toFixed(3));
        safeSet('sp-ndwi-val', ndwi.toFixed(3));
        safeSet('sp-spi-val',  spi.toFixed(2));

        const ndviInterp = interpretNDVI(ndvi);
        const ndwiInterp = interpretNDWI(ndwi);
        const spiInterp  = interpretSPI(spi);
        safeStyle('sp-ndvi-val', 'color', ndviInterp.color);
        safeStyle('sp-ndwi-val', 'color', ndwiInterp.color);
        safeStyle('sp-spi-val',  'color', spiInterp.color);

        // If the results panel is already visible, refresh it live
        const results = document.getElementById('spectral-results');
        if (results && results.style.display !== 'none') {
            displaySpectralResults(ndvi, ndwi, spi, 'sim');
        }
    } catch(e) { /* spectral panel not rendered yet */ }
}

// === QUICK SIM (legacy button — now delegates to slider-based function) ===
function runSpectralSim() {
    resetSpectralToSim();
}



// === GEOTIFF BAND UPLOAD ===
let bandRed = null, bandNIR = null, bandGreen = null;

async function loadBand(file, type) {
    if (!file) return;
    try {
        const statusEl = document.getElementById(`band-${type}-status`);
        if (statusEl) { statusEl.textContent = 'Loading…'; statusEl.style.color = 'var(--gold)'; }

        const buffer = await file.arrayBuffer();
        const tiff   = await GeoTIFF.fromArrayBuffer(buffer);
        const image  = await tiff.getImage();
        const data   = await image.readRasters();
        const w = image.getWidth(), h = image.getHeight();
        const bbox = image.getBoundingBox();
        const band = { data: data[0], width: w, height: h, bbox };

        if (type === 'red')   bandRed   = band;
        if (type === 'nir')   bandNIR   = band;
        if (type === 'green') bandGreen = band;

        if (statusEl) {
            statusEl.textContent = `✅ ${file.name} (${w}×${h})`;
            statusEl.style.color = 'var(--green)';
        }
    } catch (err) {
        const statusEl = document.getElementById(`band-${type}-status`);
        if (statusEl) { statusEl.textContent = `❌ ${err.message}`; statusEl.style.color = 'var(--red)'; }
    }
}

function computeBandIndex() {
    if (!bandRed || !bandNIR) {
        alert('Please upload at least the Red (B04) and NIR (B08) bands.');
        return;
    }
    const { width, height, bbox } = bandRed;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);

    let sumNDVI = 0, sumNDWI = 0, count = 0;

    for (let idx = 0; idx < width * height; idx++) {
        const red   = bandRed.data[idx];
        const nir   = bandNIR.data[idx];
        const green = bandGreen ? bandGreen.data[idx] : null;
        const denom = nir + red;
        if (denom === 0) continue;

        const ndvi = (nir - red) / denom;
        const ndwi = (green && (green + nir) > 0) ? (green - nir) / (green + nir) : 0;
        sumNDVI += ndvi; sumNDWI += ndwi; count++;

        // NDVI colormap: red→orange→yellow→green
        let r, g, b;
        if      (ndvi > 0.5)  { r = 0;   g = 200; b = 80; }
        else if (ndvi > 0.3)  { r = 130; g = 200; b = 0;  }
        else if (ndvi > 0.1)  { r = 255; g = 165; b = 0;  }
        else                  { r = 200; g = 50;  b = 50; }

        const p = idx * 4;
        imgData.data[p]     = r;
        imgData.data[p + 1] = g;
        imgData.data[p + 2] = b;
        imgData.data[p + 3] = 180;
    }
    ctx.putImageData(imgData, 0, 0);

    // Overlay on Leaflet map
    if (map && bbox) {
        const bounds = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]];
        if (window.spectralOverlay) map.removeLayer(window.spectralOverlay);
        window.spectralOverlay = L.imageOverlay(canvas.toDataURL(), bounds, { opacity: 0.75 }).addTo(map);
        map.fitBounds(bounds);
    }

    const meanNDVI = count > 0 ? sumNDVI / count : 0;
    const meanNDWI = count > 0 ? sumNDWI / count : 0;
    const spi = computeSPI(getInp().rf_cumul);
    displaySpectralResults(meanNDVI, meanNDWI, spi, 'band');
}

// === HISTORICAL DATA VARIANCE ENGINE ===
// Generates unique but deterministic values based on the year/month
function getHistoricalVariance(dateStr) {
    if (!dateStr) return { ndvi: 0.45, ndwi: 0.05, spi: 0.0 };
    
    const year  = parseInt(dateStr.split('-')[0]);
    const month = parseInt(dateStr.split('-')[1]);
    const today = new Date();
    
    // HALLUCINATION GUARD: Block future data in the historical engine
    const selectedDate = new Date(year, month - 1);
    if (selectedDate > today) {
        return null; // Signals future data rejection
    }
    
    // Simple deterministic hash from date string
    let hash = 0;
    for (let j = 0; j < dateStr.length; j++) {
        hash = ((hash << 5) - hash) + dateStr.charCodeAt(j);
        hash |= 0; 
    }
    
    // Base stats for Kirehe (median)
    let ndvi = 0.50 + ((hash % 10) / 40);
    let ndwi = 0.05 + ((hash % 7) / 30);
    let spi  = ((hash % 13) / 5) - 1.2;
    
    // Seasonality adjustment (East Africa Season B peaks Mar-May)
    if (month >= 3 && month <= 5) {
        ndvi += 0.15; ndwi += 0.10; spi += 0.8;
    }
    // Historical event weighting (Simple)
    if (year === 2012 || year === 2017) { // Notable dry periods
        ndvi -= 0.25; ndwi -= 0.15; spi -= 1.5;
    }
    if (year === 2003 || year === 2024) { // Higher rain years
        ndvi += 0.1; ndwi += 0.1; spi += 1.2;
    }

    return { 
        ndvi: Math.max(0.1, Math.min(0.9, ndvi)), 
        ndwi: Math.max(-0.6, Math.min(0.6, ndwi)), 
        spi:  Math.max(-3, Math.min(3, spi))
    };
}

// === ONLINE NASA GIBS ===
async function fetchOnlineNDVI() {
    const dateVal = document.getElementById('online-date')?.value;
    const layer   = document.getElementById('online-layer')?.value || 'MODIS_Terra_L3_NDVI_Monthly';
    if (!dateVal) { alert('Please select a date.'); return; }

    const year  = parseInt(dateVal.split('-')[0]);
    const month = parseInt(dateVal.split('-')[1]);
    const today = new Date();
    const selectedDate = new Date(year, month - 1);
    
    // REAL WORLD DATA GUARDRAILS
    if (selectedDate > today) {
        alert(`🚨 FUTURE DATA ERROR: We are currently in April 2026. Data for ${dateVal} does not exist yet. Please use the "Predictive Modeling" tab for future climate projections.`);
        return;
    }

    // Satellite Launch History Guards
    if (layer.includes('Landsat9') && year < 2021) {
        alert(`🛰 Landsat 9 was launched in Sept 2021. No data exists for ${year}.`); return;
    }
    if (layer.includes('Landsat8') && year < 2013) {
        alert(`🛰 Landsat 8 was launched in Feb 2013. No data exists for ${year}.`); return;
    }
    if (layer.includes('MODIS') && year < 2000) {
        alert(`🛰 MODIS Terra data only begins in February 2000. No satellite imagery exists for ${year}.`); return;
    }

    safeSet('online-status', '⏳ Connecting to NASA GIBS WMS…');

    try {
        if (!map) { safeSet('online-status', '❌ Asset Map is uninitialized.'); return; }
        
        // SPATIAL EXTENT LOCK
        const bounds = getActiveStudyBounds();
        if (!bounds) {
            safeSet('online-status', "❌ Error: Define a study area on map first.");
            alert("🚨 SPATIAL LOCK: NASA data retrieval requires a study area. Please draw a zone on the map first.");
            return;
        }

        if (window.ndviWMSLayer) map.removeLayer(window.ndviWMSLayer);

        window.ndviWMSLayer = L.tileLayer.wms('https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', {
            layers:      layer,
            format:      'image/png',
            transparent: true,
            version:     '1.3.0',
            time:        `${dateVal}-01`,
            opacity:     0.80,
            bounds:      bounds, // SPATIAL CLIPPING: Obey the extent
            attribution: 'NASA GIBS / MODIS Terra'
        }).addTo(map);

        // Map extent alignment
        map.fitBounds(bounds, { padding: [50, 50] });
        safeSet('online-status', `✅ ${layer} loaded for ${dateVal} (Spatial Extent Locked)`);

        // Update current context
        window.currentSpectralContext = 'online';
        window.isSpectralManual = false; 

        // Generate Historical Results based on the Date
        const hist = getHistoricalVariance(dateVal);
        const ndvi = hist.ndvi;
        const ndwi = hist.ndwi;
        const spi  = hist.spi;
        
        // Sync the actual HTML sliders
        const spNDVI = document.getElementById('sp-ndvi');
        const spNDWI = document.getElementById('sp-ndwi');
        const spSPI  = document.getElementById('sp-spi');
        if (spNDVI) spNDVI.value = ndvi.toFixed(2);
        if (spNDWI) spNDWI.value = ndwi.toFixed(2);
        if (spSPI)  spSPI.value  = spi.toFixed(1);
        
        const sourceLabel = layer.includes('Landsat') ? 'NASA GIBS Landsat 8/9' : 'NASA GIBS MODIS Terra';
        displaySpectralResults(ndvi, ndwi, spi, `${sourceLabel} · ${dateVal}`);
    } catch (err) {
        safeSet('online-status', `❌ ${err.message}`);
    }
}

// === RESULTS DISPLAY ===
function displaySpectralResults(ndvi, ndwi, spi, source) {
    const iN = interpretNDVI(ndvi);
    const iW = interpretNDWI(ndwi);
    const spiClamped = Math.max(-3, Math.min(3, spi));
    const iS = interpretSPI(spiClamped);
    const interp = generateSpectralInterpretation(ndvi, ndwi, spi, iN, iW, iS);

    const html = `
        <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:20px;">
            ${renderIndexGauge('NDVI', ndvi, -1, 1, iN)}
            ${renderIndexGauge('NDWI', ndwi, -1, 1, iW)}
            ${renderIndexGauge('SPI',  spiClamped, -3, 3, iS)}
        </div>
        <div class="inner-glass" style="padding:20px;">
            <div class="sec-label" style="margin-bottom:14px; color:var(--gold);">
                <i class="fa-solid fa-brain"></i> AI Field Interpretation
            </div>
            <div style="font-family:var(--serif); font-size:13px; line-height:1.9; color:rgba(255,255,255,0.85);">
                ${interp}
            </div>
            <div style="margin-top:15px; padding-top:12px; border-top:1px solid var(--border); font-size:10px; color:var(--ink-mute); font-family:var(--mono);">
                Source: ${source === 'sim' ? 'Simulated from dashboard sliders' : source === 'band' ? 'Computed from uploaded GeoTIFF bands (pixel-level mean)' : 'NASA GIBS WMS + simulation state'} · ${new Date().toLocaleString()}
            </div>
        </div>
    `;
    safeHTML('spectral-results-content', html);
    safeStyle('spectral-results', 'display', 'block');
    safeSet('spectral-interpretation', interp);

    // === NEW: CENTRAL ATTACHMENT LOGIC ===
    if (window.lastActiveArea) {
        const popup = window.lastActiveArea.getPopup();
        if (popup) {
            const content = popup.getContent();
            const mNameMatch = content.match(/STAKEHOLDER: (.*?)<\/div>/);
            const mName = mNameMatch ? mNameMatch[1] : null;
            
            if (mName) {
                const member = GLOBAL_MEMBERS.find(gm => gm.name.trim() === mName.trim());
                if (member) {
                    member.ndvi = ndvi;
                    member.spi = spi;
                    member.ai_interp = interp;
                    localStorage.setItem('agriadapt_members', JSON.stringify(GLOBAL_MEMBERS));
                    console.log(`Live Spectral Intelligence synced to ${member.name}'s profile.`);
                }
            }
        }
    }
}

function renderIndexGauge(name, value, min, max, interp) {
    const pct = Math.round(((value - min) / (max - min)) * 100);
    return `
        <div class="inner-glass" style="padding:16px; text-align:center;">
            <div style="font-size:10px; color:var(--ink-soft); text-transform:uppercase; letter-spacing:0.12em; margin-bottom:10px;">${name}</div>
            <div style="font-size:30px; font-weight:900; color:${interp.color}; font-family:var(--mono);">${value.toFixed(3)}</div>
            <div style="margin:12px 0 8px; height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden;">
                <div style="height:100%; width:${pct}%; background:${interp.color}; transition:width 0.6s ease;"></div>
            </div>
            <div style="font-size:11px; color:${interp.color}; font-weight:700;">${interp.label}</div>
        </div>`;
}

function generateSpectralInterpretation(ndvi, ndwi, spi, iN, iW, iS) {
    const parts = [];

    // NDVI
    if (ndvi > 0.5)
        parts.push(`🌿 <strong>Vegetation is thriving</strong> (NDVI: ${ndvi.toFixed(2)}). Chlorophyll density is high, indicating robust photosynthetic activity consistent with a well-watered growing season.`);
    else if (ndvi > 0.3)
        parts.push(`⚠️ <strong>Vegetation shows mild stress</strong> (NDVI: ${ndvi.toFixed(2)}). Canopy density is below optimal — likely emerging water or nutrient deficiency.`);
    else
        parts.push(`🚨 <strong>Severe vegetation stress detected</strong> (NDVI: ${ndvi.toFixed(2)}). Significant yield reduction is probable unless immediate intervention is applied.`);

    // NDWI
    if (ndwi > 0.0)
        parts.push(`💧 <strong>Water content is adequate</strong> (NDWI: ${ndwi.toFixed(2)}). Soil and canopy water availability is within the healthy threshold for active crop growth.`);
    else if (ndwi > -0.3)
        parts.push(`⚠️ <strong>Mild water deficit detected</strong> (NDWI: ${ndwi.toFixed(2)}). Plant water potential is declining — recommend increased irrigation frequency in the next dekad.`);
    else
        parts.push(`🚨 <strong>Significant water stress</strong> (NDWI: ${ndwi.toFixed(2)}). Canopy has lost critical water content. Emergency supplemental irrigation is advised immediately.`);

    // SPI
    if (Math.abs(spi) < 1.0)
        parts.push(`☁️ <strong>Precipitation is near-normal</strong> (SPI: ${spi.toFixed(2)}). Kirehe rainfall is within ±1 standard deviation of the 2001–2023 CHIRPS historical mean (${KIREHE_RF_MEAN}mm).`);
    else if (spi < -1.5)
        parts.push(`🌵 <strong>Meteorological drought confirmed</strong> (SPI: ${spi.toFixed(2)}). Cumulative rainfall is significantly below the ${KIREHE_RF_MEAN}mm seasonal mean. The solar-powered irrigation grid is the critical buffer against yield failure.`);
    else if (spi > 1.5)
        parts.push(`🌊 <strong>Excess precipitation risk</strong> (SPI: ${spi.toFixed(2)}). Above-average rainfall may cause waterlogging in low-lying sectors (Gahara, Mahama). Monitor drainage carefully.`);

    // Combined recommendation
    const risks = [iN.color, iW.color, iS.color];
    const isCritical = risks.some(c => c === '#FF4F4F');
    const isHigh     = risks.some(c => c === '#FF8800');
    if (isCritical)
        parts.push(`📋 <strong>RECOMMENDATION:</strong> Combined indices indicate a <span style="color:var(--red); font-weight:800;">CRITICAL agricultural stress event</span>. Activate full irrigation grid at maximum pump capacity and escalate to district agronomist for emergency soil amendment.`);
    else if (isHigh)
        parts.push(`📋 <strong>RECOMMENDATION:</strong> System is under <span style="color:#FF8800; font-weight:800;">elevated stress</span>. Increase irrigation output by 30% and schedule a nutrient audit within 7 days.`);
    else
        parts.push(`📋 <strong>RECOMMENDATION:</strong> Conditions are within the <span style="color:var(--green); font-weight:800;">manageable range</span>. Continue standard AGRIAdapt operational protocol with routine daily monitoring.`);

    return parts.join('<br><br>');
}



function updateNarrator(i, base, opt) {
    const nt = document.getElementById('narrator-text');
    const nw = document.getElementById('narrator-why');
    if(!nt || !nw) return;

    nt.innerHTML = `Baseline WRSI: <strong>${base}%</strong> · Current (Optimized): <strong>${opt}%</strong><br>
                    The ML model predicts a <strong>${base < 70 ? 'High' : 'Low'}</strong> baseline risk. Kirehe Infrastructure has closed the gap by <strong>${opt-base}%</strong>.`;
    
    let why = [];
    if(i.dekad >= 10) {
        why.push(`🌾 <strong>Harvest Phase Active:</strong> Crop is in dry-down. Low water is beneficial for yield preservation.`);
    } else if(i.cdd > 14) {
        why.push(`🚨 <strong>CDD (${i.cdd}d)</strong> is the primary risk driver. Supplemental irrigation is mandatory.`);
    }
    if(i.sm_rel < 0.7) why.push(`💧 <strong>Soil Moisture</strong> below threshold. Increasing sprinkler pressure.`);
    if(i.soil_ph < 5.5) why.push(`🧪 <strong>Toxic Acidity (${i.soil_ph} pH)</strong> causing nutrient lock-out. Irrigation recovery is physically capped.`);
    else if(i.soil_ph > 8.0) why.push(`🧪 <strong>Toxic Alkalinity (${i.soil_ph} pH)</strong> preventing absorption. Irrigation recovery is physically capped.`);
    else if(i.soil_ph < 6.0 || i.soil_ph > 7.5) why.push(`🧪 <strong>Sub-optimal pH (${i.soil_ph})</strong> is limiting maximum crop vitality.`);
    
    nw.innerHTML = why.length > 0 ? why.join('<br>') : "✅ Conditions are currently within the optimized safety zone.";
}

function updateRecs(i, wrsi) {
    const rlm = document.getElementById('rec-list-main');
    if(!rlm) return;
    
    let recs = [];
    
    // Phenological Stage Awareness
    if (i.dekad >= 10 && i.pivots_active > 5) {
        recs.push({ icon:'<i class="fa-solid fa-wheat-awn-circle-exclamation"></i>', cls:'ri-r', pri:'CRITICAL', title:'Suspend Irrigation (Dry-Down)', desc:'Crop has entered the harvest stage. Active sprinklers are causing grain rot. Shut down the grid immediately.' });
    } else if(wrsi < 70 && i.dekad < 10) {
        recs.push({ icon:'<i class="fa-solid fa-bolt"></i>', cls:'ri-r', pri:'URGENT', title:'Increase Pumping Load', desc:'WRSI below 70 threshold. Activate nighttime pumping from battery reserves to satisfy mid-season demand.' });
    }
    if(i.sm_rel > 1.1) {
        recs.push({ icon:'<i class="fa-solid fa-water-ladder"></i>', cls:'ri-a', pri:'HIGH', title:'Soil Waterlogging Risk', desc:'Excess moisture detected. Suspend active sprinklers in Sector 3 & 4 until evaporation balances levels.' });
    }
    if(recs.length === 0) {
        recs.push({ icon:'<i class="fa-solid fa-circle-check"></i>', cls:'ri-g', pri:'NOMINAL', title:'Scientific Targets Met', desc:'Water requirement satisfaction is stable. Continue standard AGRIAdapt infrastructure maintenance.' });
    }

    rlm.innerHTML = recs.map(r => `
        <div class="rec-item">
            <div class="rec-ico ${r.cls}">${r.icon}</div>
            <div style="flex:1;">
                <div class="rec-title">${r.title} <span class="ptag ${r.cls === 'ri-r' ? 'pt-hi' : 'pt-lo'}">${r.pri}</span></div>
                <div class="rec-body" style="color:var(--ink-soft); font-family:var(--serif); margin-top:4px;">${r.desc}</div>
            </div>
        </div>
    `).join('');
}

// ═══════════════════════════════════════════
// ASSET MAP (GEOSPATIAL ENGINE)
// ═══════════════════════════════════════════
let map, shpLayer;

function initLeafletMap() {
    if (map) {
        setTimeout(() => { map.invalidateSize(); }, 200);
        return;
    }
    
    // Kirehe District Center
    map = L.map('map').setView([-2.20, 30.65], 11);

    // BASEMAPS
    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
    const terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17 });

    satellite.addTo(map); // Default

    const baseMaps = {
        "Satellite (High-Res)": satellite,
        "Standard Streets": streets,
        "Topographic Terrain": terrain
    };

    L.control.layers(baseMaps).addTo(map);

    // Geoman Tools (Manual Drawing)
    map.pm.addControls({
        position: 'topleft',
        drawCircle: true,
        drawMarker: false,
        drawPolyline: false,
        drawRectangle: true,
        drawPolygon: true,
        drawCircleMarker: false,
        rotateMode: false,
    });
    
    map.pm.setGlobalOptions({ 
        measurements: { measurement: true, displayFormat: 'metric' },
        templineStyle: { color: 'var(--gold)', dashArray: '5, 5' },
        hintlineStyle: { color: 'var(--gold)', dashArray: '5, 5' }
    });

    map.on('pm:create', (e) => {
        const layer = e.layer;
        currentStudyLayer = layer;
        
        // AREA CALCS
        let statsHtml = "";
        if (layer instanceof L.Circle) {
            const radiusM = layer.getRadius();
            const areaM2 = Math.PI * Math.pow(radiusM, 2);
            const hectares = (areaM2 / 10000).toFixed(2);
            statsHtml = `<span style="color:var(--gold)">${hectares} ha</span><br><span style="font-size:11px;color:var(--ink-soft)">Radius: ${radiusM.toFixed(1)}m (Pivot Arm)</span>`;
            lastStudyHa = hectares;
        } else {
            const geojson = layer.toGeoJSON();
            const areaM2 = turf.area(geojson);
            const hectares = (areaM2 / 10000).toFixed(2);
            statsHtml = `${hectares} ha`;
            lastStudyHa = hectares;
        }

        // SECTOR DETECTION for Drawn Area
        const center = layer instanceof L.Circle ? [layer.getLatLng().lng, layer.getLatLng().lat] : turf.centroid(layer.toGeoJSON()).geometry.coordinates;
        lastStudySector = detectSectorFromCoord(center);

        document.getElementById('study-area-stats').innerHTML = statsHtml;
        document.getElementById('gis-study-nexus').style.display = 'block';
    });

    // Geocoder Search (with coordinate support)
    const geocoder = L.Control.geocoder({
        defaultMarkGeocode: true,
        placeholder: "Search name or '-2.27, 30.65'..."
    }).on('markgeocode', function(e) {
        map.fitBounds(e.geocode.bbox);
        
        // AUTO-TRIGGER REGISTRATION FOR SEARCHED AREA
        const areaM2 = turf.area(turf.bboxPolygon(e.geocode.bbox));
        lastStudyHa = (areaM2 / 10000).toFixed(2);
        const center = [e.geocode.center.lng, e.geocode.center.lat];
        lastStudySector = detectSectorFromCoord(center);
        
        document.getElementById('study-area-stats').innerHTML = `${lastStudyHa} ha (Searched Area)`;
        document.getElementById('gis-study-nexus').style.display = 'block';
    }).addTo(map);

    // Custom Coordinate Parser
    const gElem = geocoder.getContainer();
    const wrapper = document.getElementById('geocoder-input-wrapper');
    if (wrapper && gElem) {
        wrapper.appendChild(gElem);
        const inp = gElem.querySelector('input');
        inp.addEventListener('keydown', (e) => {
            if(e.key === 'Enter') {
                const parts = inp.value.split(',').map(p => parseFloat(p.trim()));
                if(parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                    map.setView(parts, 15);
                    L.marker(parts).addTo(map).bindPopup(`Location: ${parts[0]}, ${parts[1]}`).openPopup();
                }
            }
        });
    }

    // Sample Kirehe Sector Outline (Placeholder)
    const kireheBounds = [[-2.45, 30.45], [-2.35, 30.85], [-2.15, 30.95], [-2.05, 30.65], [-2.15, 30.45]];
    L.polygon(kireheBounds, { color: 'var(--cyan)', weight: 1, fillOpacity: 0.1 }).addTo(map);
}

// STUDY HUB LOGIC
let currentStudyLayer, lastStudyHa, lastStudySector;

function detectSectorFromCoord(coord) {
    let best = "Kirehe Rural";
    let minDist = 999;
    KIREHE_SECTORS.forEach(s => {
        const dist = turf.distance(coord, [s.c[1], s.c[0]]);
        if (dist < minDist) { minDist = dist; best = s.n; }
    });
    return best;
}

function saveStudyToLedger() {
    const name = document.getElementById('study-name').value;
    const crop = document.getElementById('study-crop').value;
    if (!name) { alert("Please enter Stakeholder Name"); return; }

    addMember(name, lastStudySector, lastStudyHa, crop, 'K-GEO');
    
    // Calculate Instant ROIs
    const cData = CROP_DATA[crop] || CROP_DATA.Maize;
    const i = getInp();
    const currentWRSI = computeOptimizedWRSI(computeBaselineWRSI(i), i);
    const estYieldTons = lastStudyHa * cData.yield * (currentWRSI / 100);
    const estRev = estYieldTons * MARKET_PRICE_RWF_T;

    // Success feedback on map
    if(currentStudyLayer) {
        window.lastActiveArea = currentStudyLayer; // Preserve for Spectral analysis
        currentStudyLayer.bindPopup(`
            <div style="min-width:180px;">
                <div style="font-size:10px; color:var(--ink-mute); text-transform:uppercase;">STAKEHOLDER: ${name}</div>
                <div style="font-size:18px; font-weight:700; color:white; margin:4px 0;">${crop} Estate</div>
                <div style="font-size:12px; color:var(--ink-soft); margin-bottom:10px;">${lastStudyHa} ha in ${lastStudySector}</div>
                <div style="padding-top:10px; border-top:1px solid rgba(255,255,255,0.1);">
                    <div style="font-size:10px; color:var(--green); font-weight:800; letter-spacing:0.05em;">EST. SEASONAL REVENUE</div>
                    <div style="font-size:22px; font-weight:900; color:var(--green); font-family:var(--mono);">${Math.round(estRev).toLocaleString()} RWF</div>
                    <div style="font-size:10px; color:var(--ink-mute); margin-top:2px;">Based on ${currentWRSI}% Vitality Index</div>
                </div>
                <button class="btn-mini" style="width:%; margin-top:15px; background:rgba(0,255,102,0.1); border-color:var(--green); color:white;" onclick="tab('ledger')">View in Success Ledger</button>
            </div>
        `).openPopup();
    }
    
    // UI Notification for "Direct Added" Feedback
    showToast(`Registered ${name} to Member Success`, "View", () => tab('ledger'));
    
    // PERSISTENCE: Save to LocalStorage
    localStorage.setItem('agriadapt_members', JSON.stringify(GLOBAL_MEMBERS));

    currentStudyLayer = null;
    document.getElementById('gis-study-nexus').style.display = 'none';
    document.getElementById('study-name').value = ''; // Reset
}

function registerMember() {
    const name = document.getElementById('reg-name')?.value;
    const sector = document.getElementById('reg-sector')?.value;
    const ha = document.getElementById('reg-ha')?.value || 1.5;
    const crop = document.getElementById('reg-crop')?.value || 'Maize';
    
    if(!name) { alert('Please enter Stakeholder Name'); return; }

    addMember(name, sector, ha, crop, 'K-REG');
    
    // UI Feedback
    const regName = document.getElementById('reg-name');
    if(regName) regName.value = '';
    const regHa = document.getElementById('reg-ha');
    if(regHa) regHa.value = '';
}

function addMember(name, sector, ha, crop, typePrefix = 'K-USR') {
    const m = {
        id: typePrefix + '-' + Math.random().toString(36).substr(2, 5).toUpperCase(),
        name: name,
        sector: sector,
        ha: parseFloat(ha),
        crop: crop,
        wrsi: 0, 
        status: 'Active',
        ndvi: 0.45, // Initial baselines
        spi: 0.0,
        ai_interp: "Baseline data only. Satellite analysis required for verified field report."
    };
    GLOBAL_MEMBERS.unshift(m);
    
    // Add permanent marker to map if dynamic
    if (currentStudyLayer) {
        currentStudyLayer.bindTooltip(name, { permanent: true, direction: 'center', className: 'map-label' }).addTo(map);
    }

    renderLedger();
    update(); // Sync Financials
}

function fillLedger() {
  // PERSISTENCE CHECK: Only fill if empty
  const saved = localStorage.getItem('agriadapt_members');
  if (saved) {
      try {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.length > 0) {
              GLOBAL_MEMBERS = parsed;
              renderLedger();
              update();
              return;
          }
      } catch(e) {
          console.warn("Storage empty or corrupted, rebuilding ledger.");
      }
  }

  const firstNames = ['Jean', 'Marie', 'Basile', 'Claudine', 'Bosco', 'Alice', 'Emmanuel', 'Pascasie', 'Theophile', 'Bernadette'];
  const lastNames = ['Mukasa', 'Uwimana', 'Habimana', 'Ndayisaba', 'Gakwaya', 'Murenzi', 'Rugira', 'Kamanzi', 'Sebahutu', 'Bigirimana'];
  const sectors = ['Nasho', 'Mpanga', 'Gahara', 'Gatore', 'Kigarama', 'Kigina', 'Mahama', 'Musaza', 'Mushikiri', 'Nyamugari', 'Nyarubuye'];
  const crops = ['Maize', 'Beans', 'Coffee', 'Vegetables'];
  
  GLOBAL_MEMBERS = [];
  for(let i=1; i<=100; i++) {
    GLOBAL_MEMBERS.push({
        id: 'K-' + String(i).padStart(3,'0'),
        name: firstNames[i%10] + ' ' + lastNames[(i+3)%10],
        sector: sectors[i % sectors.length],
        ha: parseFloat((2 + (i % 8)).toFixed(1)),
        crop: crops[i % crops.length],
        wrsi: Math.round(70 + Math.random() * 25),
        ndvi: parseFloat((0.35 + (i % 10) * 0.04).toFixed(2)),
        spi: parseFloat(((i % 5) / 2.5 - 1).toFixed(1)),
        ai_interp: 'Baseline simulation data only.',
        yield_rwf: 0
    });
  }
  renderLedger();
  update(); // Sync financials immediately for new members
}

function renderLedger() {
  const body = document.getElementById('ledger-body');
  if(!body) return;
  body.innerHTML = '';
  
  GLOBAL_MEMBERS.forEach(m => {
    const tr = document.createElement('tr');
    tr.style.background = 'rgba(255,255,255,0.02)';
    const color = m.wrsi > 85 ? 'var(--green)' : (m.wrsi > 70 ? 'var(--gold)' : 'var(--red)');
    
    tr.innerHTML = `
      <td><span style="font-weight:700; color:white; font-size:14px;">${m.name}</span><br><span style="font-size:10px;color:var(--ink-mute)">ID: ${m.id}</span></td>
      <td style="color:var(--ink-soft);">${m.sector}</td>
      <td>${m.ha} ha <span style="font-size:10px; color:var(--ink-mute)">(${m.crop})</span></td>
      <td style="font-family:var(--mono);">${Math.round(m.ha * 120).toLocaleString()}</td>
      <td style="color:${color}; font-weight:900; font-size:16px;">${m.wrsi}%</td>
      <td style="color:var(--green); font-weight:700; family:var(--mono);">${Math.round(m.yield_rwf || 0).toLocaleString()}</td>
      <td>
        <button class="btn-mini" onclick="removeMember('${m.id}')" style="color:var(--red); border-color:var(--red-pale); background:rgba(255,100,100,0.1);">Delete</button>
      </td>
    `;
    body.appendChild(tr);
  });
}

function removeMember(mid) {
    // IMMEDIATE FINANCIAL IMPACT
    GLOBAL_MEMBERS = GLOBAL_MEMBERS.filter(m => m.id !== mid);
    localStorage.setItem('agriadapt_members', JSON.stringify(GLOBAL_MEMBERS));
    renderLedger();
    update(); // Triggers updateROI and updateFinance
    
    // UI Notification of Financial Adjustment
    console.log("Member removed. Grid Economy recalculated based on new district volume.");
}

function cancelStudy() {
    if (currentStudyLayer && map) map.removeLayer(currentStudyLayer);
    currentStudyLayer = null;
    document.getElementById('gis-study-nexus').style.display = 'none';
}

async function handleMapUpload(event) {
    const file = event.target.files[0];
    if (!file || !map) return;
    
    const status = document.getElementById('map-status');
    status.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Processing ${file.name}...`;

    try {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const buffer = e.target.result;
            const geojson = await shp(buffer);
            
            if (shpLayer) map.removeLayer(shpLayer);
            
            shpLayer = L.geoJSON(geojson, {
                style: { color: 'var(--gold)', weight: 2, fillOpacity: 0.3 },
                onEachFeature: (f, layer) => {
                    // SPATIAL INTELLIGENCE PIPELINE
                    const areaM2 = turf.area(f);
                    const hectares = (areaM2 / 10000).toFixed(2);
                    
                    const center = turf.centroid(f).geometry.coordinates;
                    let bestSector = "Kirehe District (Rural)";
                    let minDist = 999;
                    
                    KIREHE_SECTORS.forEach(s => {
                        const dist = turf.distance(center, [s.c[1], s.c[0]]);
                        if (dist < minDist) { minDist = dist; bestSector = s.n; }
                    });

                    // CROP SENSITIVITY CALC
                    const selectedCrop = document.getElementById('study-crop')?.value || 'Maize';
                    const weight = (CROP_DATA[selectedCrop] || CROP_DATA.Maize).weight;
                    const baseWRSI = computeBaselineWRSI(getInp());
                    const cropWRSI = Math.max(0, Math.min(100, Math.round(baseWRSI / weight)));

                    // Trigger Stakeholder Registration in UI
                    lastStudyHa = hectares;
                    lastStudySector = bestSector;
                    document.getElementById('study-area-stats').innerHTML = `${hectares} ha (Imported)`;
                    document.getElementById('gis-study-nexus').style.display = 'block';

                    layer.bindPopup(`
                        <div style="min-width:180px;">
                            <div class="sec-label" style="color:var(--cyan);font-size:10px;">SECTOR: ${bestSector.toUpperCase()}</div>
                            <div style="font-family:var(--cab);font-size:18px;margin-top:5px;">Area: ${hectares} ha</div>
                            <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.1);">
                                <div style="font-size:10px;color:var(--ink-soft);">LIVE CROP VITALITY</div>
                                <div style="font-size:20px;font-weight:900;color:${cropWRSI > 80 ? 'var(--green)' : 'var(--red)'}">${cropWRSI}% WRSI</div>
                            </div>
                        </div>
                    `);
                }
            }).addTo(map);
            
            map.fitBounds(shpLayer.getBounds());
            status.innerHTML = `✅ Successfully imported ${file.name} (Spatial Insights Generated)`;
        };
        reader.readAsArrayBuffer(file);
    } catch (err) {
        console.error(err);
        status.innerHTML = `❌ Error parsing Shapefile ZIP. Ensure it contains .shp and .dbf components.`;
    }
}

function resetEmergency() {
    document.getElementById('emergency-overlay').style.display = 'none';
    document.body.classList.remove('emergency-pulse');
    const res = document.getElementById('reservoir');
    if(res) res.value = 50; 
    update();
}

let simRunning = false;
let simInterval;
function toggleSim() {
  simRunning = !simRunning;
  const btn = document.getElementById('btn-play');
  if (simRunning) {
    btn.innerHTML = '<i class="fa-solid fa-pause"></i> Pause Metabolism';
    
    simInterval = setInterval(() => {
      const i = getInp();
      const dSlider = document.getElementById('dekad');
      const resSlider = document.getElementById('reservoir');
      const ndviSlider = document.getElementById('ndvi');
      const wrsi = computeOptimizedWRSI(computeBaselineWRSI(i), i);
      
      // DEKAD ADVANCE
      let val = parseInt(dSlider.value);
      if (val < 12) {
          dSlider.value = val + 1;
          
          // HYDROLOGICAL FEEDBACK: Pivots drain reservoir level
          const drain = (i.pivots_active / TOTAL_PIVOTS) * 8;
          resSlider.value = Math.max(0, parseInt(resSlider.value) - drain);
          
          // SMART GRID ADAPTATION: Auto-suspend pivots in late season for harvest dry-down
          if (val + 1 >= 10) {
              const pivotSlider = document.getElementById('pivots_active');
              pivotSlider.value = Math.max(0, Math.floor(parseInt(pivotSlider.value) * 0.4)); // Spin down
          }
          
          // BIOLOGICAL COUPLING: NDVI reflects sustained WRSI health
          let ndvi = parseFloat(ndviSlider.value);
          if (wrsi > 85) ndvi = Math.min(0.9, ndvi + 0.05); // Rapid Growth
          else if (wrsi < 65) ndvi = Math.max(0.1, ndvi - 0.08); // Browning/Wither
          ndviSlider.value = ndvi.toFixed(2);
          
      } else toggleSim();
      update();
    }, 1200);
  } else {
    btn.innerHTML = '<i class="fa-solid fa-play"></i> Seasonal Pulse';
    clearInterval(simInterval);
  }
}

window.isUserDraggingPH = false;

// ═══════════════════════════════════════════
// MEMBER DATA HELPERS
// ═══════════════════════════════════════════
function _seedMembers() {
  const firstNames = ['Jean','Marie','Basile','Claudine','Bosco','Alice','Emmanuel','Pascasie','Theophile','Bernadette'];
  const lastNames  = ['Mukasa','Uwimana','Habimana','Ndayisaba','Gakwaya','Murenzi','Rugira','Kamanzi','Sebahutu','Bigirimana'];
  const sectors    = ['Nasho','Mpanga','Gahara','Gatore','Kigarama','Kigina','Mahama','Musaza','Mushikiri','Nyamugari','Nyarubuye'];
  const crops      = ['Maize','Beans','Coffee','Vegetables'];
  GLOBAL_MEMBERS = [];
  for (let k = 1; k <= 100; k++) {
    GLOBAL_MEMBERS.push({
      id: 'K-' + String(k).padStart(3,'0'),
      name: firstNames[k%10] + ' ' + lastNames[(k+3)%10],
      sector: sectors[k % sectors.length],
      ha: parseFloat((2 + (k % 8)).toFixed(1)),
      crop: crops[k % crops.length],
      wrsi: Math.round(70 + (k % 25)),
      ndvi: parseFloat((0.35 + (k % 10) * 0.04).toFixed(2)),
      spi: parseFloat(((k % 5) / 2.5 - 1).toFixed(1)),
      ai_interp: 'Baseline simulation data only.',
      yield_rwf: 0
    });
  }
}

function _ensureMembers() {
  if (GLOBAL_MEMBERS.length > 0) return;
  // Try localStorage first
  try {
    const saved = localStorage.getItem('agriadapt_members');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.length > 0) { GLOBAL_MEMBERS = parsed; return; }
    }
  } catch(e) { /* ignore */ }
  _seedMembers();
  try { update(); } catch(e) { /* sync financials */ }
}

window.onload = function() {
  // Bind manual drag tracking so the system doesn't fight the user if they want to manually test a pH
  const phSlider = document.getElementById('soil_ph');
  if(phSlider) {
      phSlider.addEventListener('mousedown', () => window.isUserDraggingPH = true);
      phSlider.addEventListener('mouseup', () => window.isUserDraggingPH = false);
      phSlider.addEventListener('touchstart', () => window.isUserDraggingPH = true);
      phSlider.addEventListener('touchend', () => window.isUserDraggingPH = false);
  }

  fillLedger();  // Populates GLOBAL_MEMBERS from localStorage or seeds 100 demo members
  update();      // Compute all WRSI & financial values
  startAutoMonitor(); // Begin background district health monitoring
};

// ═══════════════════════════════════════════
// AUTO MONITORING ENGINE
// ─ Runs every 15s, audits all member health,
//   flags at-risk fields, updates live badges
// ═══════════════════════════════════════════
function startAutoMonitor() {
  if (_autoMonitorRunning) return;
  _autoMonitorRunning = true;
  _runMonitorCycle(); // Run immediately
  _autoMonitorTimer = setInterval(_runMonitorCycle, 15000);
  console.log('[AGRIAdapt Monitor] District health monitoring active — cycling every 15s');
}

function stopAutoMonitor() {
  _autoMonitorRunning = false;
  if (_autoMonitorTimer) { clearInterval(_autoMonitorTimer); _autoMonitorTimer = null; }
}

function _runMonitorCycle() {
  if (!GLOBAL_MEMBERS || GLOBAL_MEMBERS.length === 0) return;

  let i;
  try { i = getInp(); } catch(e) { return; }

  const baseWRSI = computeBaselineWRSI(i);
  const optWRSI  = computeOptimizedWRSI(baseWRSI, i);

  let atRisk = 0, critical = 0;

  GLOBAL_MEMBERS.forEach(m => {
    const crop  = CROP_DATA[m.crop]  || CROP_DATA.Maize;
    const sProf = KIREHE_SECTORS.find(s => s.n === m.sector) || { fert: 1.0 };
    const mOptWrsi = Math.min(100, Math.round(optWRSI / crop.weight));
    const potTons  = m.ha * crop.yield * sProf.fert;
    m.wrsi     = mOptWrsi;
    m.yield_rwf = potTons * (mOptWrsi / 100) * MARKET_PRICE_RWF_T;
    if (mOptWrsi < 70) critical++;
    else if (mOptWrsi < 80) atRisk++;
  });

  // Update monitor badge in UI (if element exists)
  const badge = document.getElementById('monitor-badge');
  if (badge) {
    const ts = new Date().toLocaleTimeString();
    if (critical > 0) {
      badge.style.background = 'rgba(255,79,79,0.15)';
      badge.style.color = 'var(--red)';
      badge.style.borderColor = 'rgba(255,79,79,0.3)';
      badge.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> ' + critical + ' CRITICAL · ' + atRisk + ' AT RISK · ' + ts;
    } else if (atRisk > 0) {
      badge.style.background = 'rgba(251,191,36,0.15)';
      badge.style.color = 'var(--gold)';
      badge.style.borderColor = 'rgba(251,191,36,0.3)';
      badge.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ' + atRisk + ' AT RISK · MONITORING · ' + ts;
    } else {
      badge.style.background = 'rgba(0,255,102,0.1)';
      badge.style.color = 'var(--green)';
      badge.style.borderColor = 'rgba(0,255,102,0.2)';
      badge.innerHTML = '<i class="fa-solid fa-circle-check"></i> ALL ' + GLOBAL_MEMBERS.length + ' MEMBERS NOMINAL · ' + ts;
    }
  }

  // Live-refresh open panels without full re-render
  if (document.getElementById('p-analysis')?.classList.contains('active')) renderAnalysisHub();
  if (document.getElementById('p-export')?.classList.contains('active'))   renderExportHub();
  if (document.getElementById('p-ledger')?.classList.contains('active'))   renderLedger();
  if (document.getElementById('p-model')?.classList.contains('active'))    renderShap();
}

// === TOAST NOTIFICATION SYSTEM ===
function showToast(msg, actionText = "View", actionCallback = null) {
    let toast = document.getElementById('toast-container');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-container';
        toast.style.cssText = `
            position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
            background: #111827; color: white; padding: 12px 24px; border-radius: 40px;
            display: flex; align-items: center; gap: 15px; z-index: 9999;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1);
            font-family: var(--mono); font-size: 13px; transition: all 0.3s ease; opacity: 0;
        `;
        document.body.appendChild(toast);
    }
    
    toast.innerHTML = `
        <span style="color:var(--green)">✓</span> ${msg}
        ${actionCallback ? `<button id="toast-action" style="background:var(--green); border:none; color:#000; font-weight:900; padding:4px 12px; border-radius:12px; cursor:pointer; font-size:10px; text-transform:uppercase;">${actionText}</button>` : ''}
    `;
    
    toast.style.opacity = '1';
    toast.style.bottom = '40px';
    
    const btn = document.getElementById('toast-action');
    if (btn && actionCallback) btn.onclick = () => { actionCallback(); hideToast(); };
    
    setTimeout(hideToast, 5000);
}

function hideToast() {
    const toast = document.getElementById('toast-container');
    if (toast) {
        toast.style.opacity = '0';
        toast.style.bottom = '30px';
    }
}

// === REPORTING & EXPORT ENGINE ===
function renderExportHub() {
    const grid = document.getElementById('export-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    GLOBAL_MEMBERS.forEach(m => {
        const div = document.createElement('div');
        div.className = 'inner-glass';
        div.style.padding = '20px';
        div.style.borderLeft = '4px solid var(--cyan)';
        
        const hasSatellite = m.ndvi !== 0.45;
        
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:start;">
                <div>
                    <div style="font-size:16px; font-weight:900;">${m.name}</div>
                    <div style="font-size:10px; color:var(--ink-soft); text-transform:uppercase;">${m.sector || 'Kirehe'} · ${m.crop}</div>
                </div>
                <div style="font-size:12px; font-family:var(--mono); color:var(--cyan);">${m.ha} ha</div>
            </div>
            <div style="margin-top:20px; display:flex; gap:10px;">
                <div style="flex:1; background:rgba(255,255,255,0.05); padding:10px; border-radius:8px;">
                     <div style="font-size:9px; color:var(--ink-mute);">Verified NDVI</div>
                     <div style="font-weight:bold;">${m.ndvi ? m.ndvi.toFixed(2) : '0.45'}</div>
                </div>
                <div style="flex:1; background:rgba(255,255,255,0.05); padding:10px; border-radius:8px;">
                     <div style="font-size:9px; color:var(--ink-mute);">Status</div>
                     <div style="color:${hasSatellite ? 'var(--green)' : 'var(--gold)'}; font-size:10px; font-weight:bold;">${hasSatellite ? 'SATELLITE SYNC' : 'OFFLINE'}</div>
                </div>
            </div>
            <button class="btn btn-mini" style="width:%; margin-top:20px; background:var(--green); color:#000; border:none; font-weight:800;" onclick="generateIndividualReport('${m.id}')">
                <i class="fa-solid fa-file-export"></i> Export Analysis Report
            </button>
        `;
        grid.appendChild(div);
    });
}

function generateIndividualReport(mid) {
    const m = GLOBAL_MEMBERS.find(gm => gm.id === mid);
    if (!m) return;
    
    // Populate Template
    safeSet('rpt-id', `K-CERT-${m.id}`);
    safeSet('rpt-name', m.name);
    safeSet('rpt-sector', (m.sector || 'Kirehe') + ' Sector');
    safeSet('rpt-ha', m.ha + ' ha');
    safeSet('rpt-crop', m.crop + ' Field');
    safeSet('rpt-ndvi', m.ndvi ? m.ndvi.toFixed(2) : '0.45');
    safeSet('rpt-spi', m.spi ? m.spi.toFixed(2) : '0.00');
    safeSet('rpt-wrsi', (m.wrsi || 0) + '%');
    safeSet('rpt-rev', Math.round(m.yield_rwf || 0).toLocaleString() + ' RWF');
    safeSet('rpt-ai', m.ai_interp || "Baseline simulation data. Direct satellite verification recommended.");
    
    // Switch Visibility for Printing
    const printArea = document.getElementById('print-area');
    if (printArea) printArea.style.display = 'block';
    
    window.print();
    
    // Restore
    if (printArea) printArea.style.display = 'none';
}

// === ANALYTICAL ENGINE (Individual Results) ===
function renderAnalysisHub() {
    const grid = document.getElementById('analysis-grid');
    const summaryHub = document.getElementById('analysis-summary-hub');
    if (!grid) return;
    grid.innerHTML = '';
    
    // Explicitly enforce visibility to prevent any 0x0 flex/grid collapse bugs
    grid.style.display = 'grid';
    grid.style.minHeight = '400px';
    grid.style.width = '100%';
    
    // Get Search & Filter Inputs
    const searchText = document.getElementById('analysis-search')?.value.toLowerCase() || "";
    const filterSector = document.getElementById('analysis-filter-sector')?.value || "all";
    const filterRisk = document.getElementById('analysis-filter-risk')?.value || "all";

    // Get current dashboard state for comparative calculations
    const i = getInp();
    const baseWRSI = computeBaselineWRSI(i);
    const optWRSI = computeOptimizedWRSI(baseWRSI, i);
    
    if (GLOBAL_MEMBERS.length === 0) {
        grid.innerHTML = '<div style="padding:80px; text-align:center; color:var(--ink-soft);"><i class="fa-solid fa-cloud-download fa-3x" style="margin-bottom:20px; opacity:0.5;"></i><br><span style="font-size:18px; font-weight:700;">No members found in database.</span><br>Initializing simulation seeds...</div>';
        _seedMembers();
        setTimeout(renderAnalysisHub, 1000);
        return;
    }

    // Filter Logic
    const filtered = GLOBAL_MEMBERS.filter(m => {
        const matchesSearch = m.name.toLowerCase().includes(searchText);
        const matchesSector = filterSector === "all" || m.sector === filterSector;
        
        const crop = CROP_DATA[m.crop] || CROP_DATA.Maize;
        const mOptWrsi = Math.min(100, Math.round(optWRSI / crop.weight));
        let matchesRisk = true;
        if (filterRisk === "high") matchesRisk = mOptWrsi >= 80;
        else if (filterRisk === "med") matchesRisk = mOptWrsi >= 70 && mOptWrsi < 80;
        else if (filterRisk === "low") matchesRisk = mOptWrsi < 70;

        return matchesSearch && matchesSector && matchesRisk;
    });

    // Summary Statistics Calculation
    let totalHa = 0, totalOptRev = 0, sumWrsi = 0;
    let highRiskCount = 0;

    filtered.forEach(m => {
        const crop = CROP_DATA[m.crop] || CROP_DATA.Maize;
        const sProf = KIREHE_SECTORS.find(s => s.n === m.sector) || { fert: 1.0 };
        const mOptWrsi = Math.min(100, Math.round(optWRSI / crop.weight));
        const potentialTons = m.ha * crop.yield * sProf.fert;
        const optRev = potentialTons * (mOptWrsi / 100) * MARKET_PRICE_RWF_T;
        
        totalHa += m.ha;
        totalOptRev += optRev;
        sumWrsi += mOptWrsi;
        if (mOptWrsi < 70) highRiskCount++;
    });

    const avgWrsi = filtered.length > 0 ? Math.round(sumWrsi / filtered.length) : 0;

    // Render Premium Summary Hub
    if (summaryHub) {
        summaryHub.innerHTML = `
            <div class="stat-pill" style="border-left:4px solid var(--cyan); background: linear-gradient(145deg, rgba(255,255,255,0.05), transparent);">
                <div style="font-size:10px; font-weight:700; color:var(--ink-soft); letter-spacing:0.1em; text-transform:uppercase;">Registered Stakeholders</div>
                <div style="font-size:28px; font-family:var(--cab); font-weight:900; color:white; margin-top:8px;">${filtered.length} <span style="font-size:12px; font-weight:400; color:var(--ink-mute); font-family:var(--mono);">Filtered Active</span></div>
            </div>
            <div class="stat-pill" style="border-left:4px solid ${avgWrsi > 75 ? 'var(--green)' : 'var(--gold)'}; background: linear-gradient(145deg, rgba(255,255,255,0.05), transparent);">
                <div style="font-size:10px; font-weight:700; color:var(--ink-soft); letter-spacing:0.1em; text-transform:uppercase;">Overall Vitality (WRSI)</div>
                <div style="font-size:28px; font-family:var(--cab); font-weight:900; color:${avgWrsi > 75 ? 'var(--green)' : 'var(--gold)'}; margin-top:8px;">${avgWrsi}%</div>
            </div>
            <div class="stat-pill" style="border-left:4px solid var(--green); background: linear-gradient(145deg, rgba(255,255,255,0.05), transparent);">
                <div style="font-size:10px; font-weight:700; color:var(--ink-soft); letter-spacing:0.1em; text-transform:uppercase;">Community Economic Yield</div>
                <div style="font-size:28px; font-family:var(--cab); font-weight:900; color:var(--green); margin-top:8px;">${Math.round(totalOptRev).toLocaleString()} <span style="font-size:14px; font-family:var(--mono);">RWF</span></div>
            </div>
            <div class="stat-pill" style="border-left:4px solid ${highRiskCount > 0 ? 'var(--red)' : 'var(--green)'}; background: linear-gradient(145deg, rgba(255,255,255,0.05), transparent);">
                <div style="font-size:10px; font-weight:700; color:var(--ink-soft); letter-spacing:0.1em; text-transform:uppercase;">Critical Risk Alerts</div>
                <div style="font-size:28px; font-family:var(--cab); font-weight:900; color:${highRiskCount > 0 ? 'var(--red)' : 'var(--green)'}; margin-top:8px;">${highRiskCount} <span style="font-size:12px; font-weight:400; color:var(--ink-mute); font-family:var(--mono);">Fields</span></div>
            </div>
        `;
    }

    if (filtered.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; padding:80px; text-align:center; color:var(--ink-mute); font-family:var(--serif);"><i class="fa-solid fa-filter-circle-xmark fa-4x" style="opacity:0.2; margin-bottom:20px;"></i><br><span style="font-size:20px; color:var(--ink-soft);">No stakeholders match your current filter criteria.</span><br>Try adjusting the search or risk parameters.</div>';
        return;
    }

    // Grid Layout Enforcement
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(340px, 1fr))";
    grid.style.gap = "24px";
    
    // Performance optimization: Generate all HTML first
    let gridHTML = "";

    filtered.forEach(m => {
        const crop = CROP_DATA[m.crop] || CROP_DATA.Maize;
        const sProf = KIREHE_SECTORS.find(s => s.n === m.sector) || { fert: 1.0 };
        
        // Individualized Simulation
        const mBaseWrsi = Math.min(100, Math.round(baseWRSI / crop.weight));
        const mOptWrsi = Math.min(100, Math.round(optWRSI / crop.weight));
        
        const potentialTons = m.ha * crop.yield * sProf.fert;
        const baseRev = potentialTons * (mBaseWrsi / 100) * MARKET_PRICE_RWF_T;
        const optRev  = potentialTons * (mOptWrsi / 100) * MARKET_PRICE_RWF_T;
        const delta   = optRev - baseRev;
        const boostPct = baseRev > 0 ? (delta / baseRev) * 100 : 0;
        
        const phImpact = (i.soil_ph < 5.5 || i.soil_ph > 8.0) ? "Critical Lockout" : (i.soil_ph < 6.0 || i.soil_ph > 7.5) ? "Acid Stress" : "Optimal Intake";

        let riskColorVar = mOptWrsi > 80 ? 'var(--green)' : (mOptWrsi > 70 ? 'var(--gold)' : 'var(--red)');
        let ptagClass = mOptWrsi > 80 ? 'pt-lo' : (mOptWrsi > 70 ? 'pt-med' : 'pt-hi');
        let statusText = mOptWrsi > 80 ? 'STABLE' : (mOptWrsi > 70 ? 'RECOVERING' : 'CRITICAL');

        const sparks = Array.from({length: 12}, (_, k) => {
            const h = k < i.dekad ? Math.max((mOptWrsi * ((k+1)/12) * 0.4), 4) : 4;
            const isPast = k < i.dekad;
            const isCurrent = k === (i.dekad - 1);
            
            return `<div class="spark-bar ${isPast ? 'opt-fill' : ''}" 
                        style="height:${h}px; 
                        background: ${isPast ? riskColorVar : 'rgba(255,255,255,0.05)'}; 
                        box-shadow: ${isCurrent ? '0 0 15px ' + riskColorVar : 'none'};
                        opacity: ${isPast ? '1' : '0.3'};
                        ${isCurrent ? 'border: 1px solid white;' : ''}">
                    </div>`;
        }).join('');

        gridHTML += `
            <div class="inner-glass analysis-card" style="padding: 28px; border-top: 4px solid ${riskColorVar}; display: flex; flex-direction: column; justify-content: space-between; overflow: visible; height: 100%; min-height: 420px;">
                <!-- Header -->
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div>
                        <div style="font-size:10px; color:var(--cyan); font-family:var(--mono); text-transform:uppercase; font-weight:700; margin-bottom:4px;">${m.id}</div>
                        <div style="font-size:20px; font-weight:900; line-height:1.2; color:var(--ink);">${m.name}</div>
                        <div style="font-size:11px; color:var(--ink-soft); text-transform:uppercase; letter-spacing:0.05em; margin-top:4px;">
                            <i class="fa-solid fa-location-dot" style="opacity:0.6;"></i> ${m.sector} <span style="margin: 0 4px; opacity:0.3;">|</span> 
                            <i class="fa-solid fa-seedling" style="opacity:0.6;"></i> ${m.crop} <span style="margin: 0 4px; opacity:0.3;">|</span> 
                            ${m.ha} HA
                        </div>
                    </div>
                    <div class="ptag ${ptagClass}">
                        ${statusText}
                    </div>
                </div>
                
                <!-- Financial & Satellite Blocks -->
                <div class="stat-grid" style="margin-top:25px;">
                    <div class="stat-pill">
                        <div style="font-size:9px; color:var(--ink-mute); font-family:var(--mono); text-transform:uppercase;">Optimized Income</div>
                        <div style="font-size:16px; font-family:var(--mono); font-weight:800; color:var(--green); margin-top:4px;">${(optRev || 0).toLocaleString()} RWF</div>
                    </div>
                    <div class="stat-pill">
                        <div style="font-size:9px; color:var(--ink-mute); font-family:var(--mono); text-transform:uppercase;">Soil Biome</div>
                        <div style="font-size:13px; font-weight:800; color:var(--ink); margin-top:4px;">${phImpact}</div>
                    </div>
                    <div class="stat-pill">
                        <div style="font-size:9px; color:var(--ink-mute); font-family:var(--mono); text-transform:uppercase;">Verified NDVI</div>
                        <div style="font-size:14px; font-weight:800; color:#7FDB00; margin-top:4px;">${m.ndvi ? (typeof m.ndvi === 'number' ? m.ndvi.toFixed(3) : parseFloat(m.ndvi).toFixed(3)) : '0.450'}</div>
                    </div>
                    <div class="stat-pill">
                        <div style="font-size:9px; color:var(--ink-mute); font-family:var(--mono); text-transform:uppercase;">SPI (CHIRPS)</div>
                        <div style="font-size:14px; font-weight:800; color:#FBBF24; margin-top:4px;">${m.spi ? (typeof m.spi === 'number' ? m.spi.toFixed(2) : parseFloat(m.spi).toFixed(2)) : '0.00'}</div>
                    </div>
                </div>
                
                <!-- Dekad Sparkline -->
                <div style="margin-top:25px;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-end; font-size:10px; margin-bottom:8px;">
                        <span style="color:var(--ink-soft); font-family:var(--mono); text-transform:uppercase;">Seasonal Growth Curve</span>
                        <span style="color:${riskColorVar}; font-weight:900; font-family:var(--cab); font-size:16px;">${mOptWrsi}% VITALITY</span>
                    </div>
                    <div class="spark-box" style="height: 45px; display: flex; align-items: flex-end; gap: 4px; padding: 8px 10px; border-radius: 8px;">
                        ${sparks}
                    </div>
                </div>
                
                <!-- Smart Insight -->
                <div class="insight-tag" style="margin-top:20px; padding:14px; border-radius:10px; background:var(--paper); border: 1px dashed var(--border); display:flex; gap:12px; align-items:flex-start;">
                    <i class="fa-solid fa-microchip" style="color:var(--cyan); font-size:14px; margin-top:2px;"></i>
                    <span style="font-size:12px; color:var(--ink-soft); font-family:var(--serif); line-height:1.5;">${generateMemberInsight(m, mOptWrsi, i.dekad)}</span>
                </div>

                <!-- Actions -->
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:25px;">
                    <button class="btn-mini" style="background:var(--paper); border:1px solid var(--border); color:var(--ink-soft); width:100%; padding:10px;" onclick="generateIndividualReport('${m.id}')">
                        <i class="fa-regular fa-file-pdf"></i> Download PDF
                    </button>
                    <button class="btn-mini" style="background:var(--cyan-pale); color:var(--cyan); border-color:var(--cyan); width:100%; padding:10px; box-shadow: 0 0 10px rgba(0,240,255,0.1);" onclick="generateIndividualReport('${m.id}')">
                        <i class="fa-solid fa-print"></i> Field Report
                    </button>
                </div>
            </div>
        `;
    });

    grid.innerHTML = gridHTML;
}


function generateMemberInsight(m, wrsi, dekad) {
    // Priority 1: Use stored high-fidelity AI interpretation if available (and not the default message)
    if (m.ai_interp && !m.ai_interp.includes('Baseline simulation data')) {
        // Strip out HTML tags for the small card preview if needed, or just return a snippet
        return m.ai_interp.split('<br>')[0].replace(/<\/?[^>]+(>|$)/g, "");
    }

    // Priority 2: Context-aware simulation insights
    if (dekad >= 10) return "<strong>Harvest Window:</strong> Bio-available water sufficient for peak dry-down quality.";
    if (wrsi < 70) return "<strong>Critical Alert:</strong> Soil hydraulic deficit detected. Recommend 4h supplemental solar pumping.";
    if (wrsi < 80) return "<strong>Risk Warning:</strong> Marginal moisture stress. Potential yield reduction of ~12% if uncorrected.";
    if (m.ha > 7) return "<strong>Strategic Asset:</strong> High-hectarage field. Vitality contributes significantly to district ROI.";
    return "<strong>Operational Nominal:</strong> Growth curve follows expected XGBoost trajectory for Season B.";
}

function exportAnalysisFull(format) {
    const data = GLOBAL_MEMBERS.map(m => ({
        id: m.id,
        name: m.name,
        sector: m.sector,
        ha: m.ha,
        crop: m.crop,
        wrsi: m.wrsi,
        income_rwf: Math.round(m.yield_rwf || 0)
    }));
    
    let content = "";
    let mimeType = "";
    
    if (format === 'csv') {
        const headers = ['ID', 'Name', 'Sector', 'Hectares', 'Crop', 'WRSI (%)', 'Est. Income (RWF)'];
        content = headers.join(',') + '\n';
        data.forEach(d => {
            content += `${d.id},"${d.name}",${d.sector},${d.ha},${d.crop},${d.wrsi},${d.income_rwf}\n`;
        });
        mimeType = 'text/csv';
    } else {
        content = JSON.stringify(data, null, 2);
        mimeType = 'application/json';
    }
    
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AgriAdapt_Analysis_Export_${new Date().toISOString().split('T')[0]}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    showToast(`Full District ${format.toUpperCase()} Exported`, "OK");
}

