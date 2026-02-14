'use strict';

import { PWD_CHARS, generatePassword } from './password-engine.js';

// --- 常數定義 ---
const STORAGE_KEY_GEN = 'pwd_gen_settings';
const SESSION_KEY_POPUP_STATE = 'popup_state'; // 新增：用於記錄 popup 狀態

// --- DOM 元素引用 ---
const els = {
    // 填入分頁
    fillBtn: document.getElementById("fillBtn"),
    detectBtn: document.getElementById("detectBtn"),
    recordSelect: document.getElementById("recordSelect"),
    currentUrl: document.getElementById("currentUrl"),
    openOptions: document.getElementById("openOptions"),
    msg: document.getElementById("msg"),
    hint: document.getElementById("hint"),
    // 產生分頁
    genResult: document.getElementById('gen-result'),
    genLength: document.getElementById('gen-length'),
    lenVal: document.getElementById('len-val'),
    genRefresh: document.getElementById('gen-refresh'),
    genCopy: document.getElementById('gen-copy'),
    genFill: document.getElementById('gen-fill'),
    genMsg: document.getElementById('gen-msg'),
    strengthBar: document.getElementById('strength-bar'),
    strengthText: document.getElementById('strength-text'),
    entropyText: document.getElementById('entropy-val'),
    btnMinus: document.getElementById('len-minus'),
    btnPlus: document.getElementById('len-plus'),
    // 設定項
    checks: {
        upper: document.getElementById('gen-upper'),
        lower: document.getElementById('gen-lower'),
        nums: document.getElementById('gen-numbers'),
        symbols: document.getElementById('gen-symbols'),
        forceEach: document.getElementById('gen-force-each'),
        ambig: document.getElementById('gen-ambiguous'),
        unsafe: document.getElementById('gen-unsafe')
    }
};

// --- 核心邏輯：密碼產生器 ---

async function saveGenSettings() {
    const s = {
        l: els.genLength.value,
        u: els.checks.upper.checked,
        lo: els.checks.lower.checked,
        n: els.checks.nums.checked,
        s: els.checks.symbols.checked,
        f1: els.checks.forceEach.checked,
        ea: els.checks.ambig.checked,
        ec: els.checks.unsafe.checked
    };
    await chrome.storage.local.set({ [STORAGE_KEY_GEN]: s });
}

async function loadGenSettings() {
    const res = await chrome.storage.local.get([STORAGE_KEY_GEN]);
    const s = res[STORAGE_KEY_GEN];
    if (!s) return;
    els.genLength.value = s.l || 18;
    els.lenVal.textContent = els.genLength.value;
    els.checks.upper.checked = s.u !== false;
    els.checks.lower.checked = s.lo !== false;
    els.checks.nums.checked = s.n !== false;
    els.checks.symbols.checked = s.s !== false;
    els.checks.forceEach.checked = s.f1 !== false;
    els.checks.ambig.checked = !!s.ea;
    els.checks.unsafe.checked = !!s.ec;
    await setOptionsTitle();
}

async function setOptionsTitle() {
    const getSettingItem = (el) => el.closest('.setting-item');
    getSettingItem(els.checks.upper).title = `${PWD_CHARS.UPPER}`;
    getSettingItem(els.checks.lower).title = `${PWD_CHARS.LOWER}`;
    getSettingItem(els.checks.nums).title = `${PWD_CHARS.NUMS}`;
    getSettingItem(els.checks.symbols).title = `${PWD_CHARS.SYMBOLS}`;
    getSettingItem(els.checks.ambig).title = `${PWD_CHARS.AMBIGUOUS}`;
    getSettingItem(els.checks.unsafe).title = `${PWD_CHARS.CODE_UNSAFE}`;
}

/**
 * 更新強度 UI 顯示(僅負責顯示)
 * @param {number} entropy - 已計算好的熵值(bits)
 */
function updateStrengthUI(entropy) {
    if (isNaN(entropy) || !isFinite(entropy) || entropy <= 0) {
        els.entropyText.textContent = `熵值估算 ≈ 0.000 bits`;
        els.strengthText.textContent = `強度：-`;
        els.strengthBar.style.setProperty('--bar-width', '0%');
        els.strengthBar.style.setProperty('--bar-bg', 'inherit');
        els.strengthText.style.setProperty('--label-color', 'inherit');
        return;
    }

    // 強制保留三位小數，不足則補 0
    const formattedEntropy = entropy.toFixed(3);

    // 考慮到視覺上的對稱感，大多狀況下會顯示三位數字，同時已足夠清晰，反映排除極端案例下，大多數變動對熵值的影響，故小數亦固定為三位。
    els.entropyText.textContent = `熵值估算 ≈ ${formattedEntropy} bits`;

    // 改關注點分離，顏色應由css控制
    const levels = [
        {
            min: 512,
            color: 'var(--strength-safe-gradient)',
            labelColor: 'var(--strength-safe-text)',
            widthPercentage: 100,
            label: '安全'
        },
        { min: 256, color: 'var(--strength-prof)', labelColor: 'var(--strength-prof)', widthPercentage: 100, label: '專業' },
        { min: 128, color: 'var(--strength-tight)', labelColor: 'var(--strength-tight)', widthPercentage: 100, label: '嚴密' },
        // 預設情況下，100 bits 已經足夠安全，為避免使用者誤判安全性能，100 bits 以上進度條皆為滿格，專業特殊情況再以樣色區分。
        { min: 100, color: 'var(--strength-top)', labelColor: 'var(--strength-top)', widthPercentage: 100, label: '頂級' },
        { min: 80, color: 'var(--strength-strong)', labelColor: 'var(--strength-strong)', widthPercentage: 80, label: '極強' },
        { min: 60, color: 'var(--strength-good)', labelColor: 'var(--strength-good)', widthPercentage: 60, label: '良好' },
        { min: 40, color: 'var(--strength-normal)', labelColor: 'var(--strength-normal)', widthPercentage: 40, label: '普通' },
        { min: 1, color: 'var(--strength-weak)', labelColor: 'var(--strength-weak)', widthPercentage: 20, label: '弱' },
        { min: 0, color: 'inherit', labelColor: 'inherit', widthPercentage: 0, label: '-' }
    ];

    // 友善等級判斷使用原始值作判斷，不使用四捨五入後的值，是為了排除邊界模糊
    // 例如：79.9995 bits 應該還是屬於「良好」等級，而非「極強」，但顯示會是 80.000 bits，這是故意且正常的。
    const state = levels.find(l => entropy >= l.min);

    // 設定強度文字
    els.strengthText.textContent = `強度：${state.label}`;

    // 套用 CSS 變數
    //els.strengthBar.style.setProperty('--bar-width', state.width);
    // 調整比較平滑的多級顯示
    let entropyWidthPercentage = entropy < 100 ? entropy : 100;
    const entropyWidth = entropyWidthPercentage + "%";
    els.strengthBar.style.setProperty('--bar-width', entropyWidth);
    els.strengthBar.style.setProperty('--bar-bg', state.color);
    els.strengthText.style.setProperty('--label-color', state.labelColor);
}

function generate() {
    els.genCopy.textContent = "複製";

    const options = {
        length: els.genLength.value,
        upper: els.checks.upper.checked,
        lower: els.checks.lower.checked,
        nums: els.checks.nums.checked,
        symbols: els.checks.symbols.checked,
        forceEach: els.checks.forceEach.checked,
        ambig: els.checks.ambig.checked,
        unsafe: els.checks.unsafe.checked
    };

    const result = generatePassword(options);

    if (result.error) {
        els.genResult.textContent = result.error;
        disabledGeneratePwUI(true);
        return;
    }

    // 最終密碼
    els.genResult.textContent = result.password;

    // 更新熵值
    updateStrengthUI(result.entropy);

    // 更新密碼生成畫面顯示狀態
    disabledGeneratePwUI(false);

    saveGenSettings();

    // 立即同步更新 session 中的密碼狀態(包含熵值)
    updateSessionPassword(result.password, result.entropy);
}

function disabledGeneratePwUI(flag) {
    if (flag) {
        updateStrengthUI(0); // 空密碼,熵值為 0

        // 「已複製」狀態時需重置
        if (els.genCopy.textContent === '已複製') {
            els.genCopy.textContent = '複製';
        }

        els.genCopy.disabled = true;
        els.genRefresh.disabled = true;
        els.genFill.disabled = true;
        els.btnMinus.disabled = true;
        els.btnPlus.disabled = true;
        els.genLength.disabled = true;
        els.lenVal.classList.add('disabled');
        return;
    } else {
        els.genCopy.disabled = false;
        els.genRefresh.disabled = false;
        els.genFill.disabled = false;
        els.btnMinus.disabled = false;
        els.btnPlus.disabled = false;
        els.genLength.disabled = false;
        els.lenVal.classList.remove('disabled');
    }
}

// 獲取當前設定的 hash,用於檢測設定是否變更
function getSettingsHash() {
    return JSON.stringify({
        l: els.genLength.value,
        u: els.checks.upper.checked,
        lo: els.checks.lower.checked,
        n: els.checks.nums.checked,
        s: els.checks.symbols.checked,
        f1: els.checks.forceEach.checked,
        ea: els.checks.ambig.checked,
        ec: els.checks.unsafe.checked
    });
}

// 同步更新 session 中的密碼和狀態
async function updateSessionPassword(password, entropy) {
    const currentState = await chrome.storage.session.get([SESSION_KEY_POPUP_STATE]);
    const state = currentState[SESSION_KEY_POPUP_STATE] || {};

    await chrome.storage.session.set({
        [SESSION_KEY_POPUP_STATE]: {
            ...state,
            lastPassword: password,
            entropy: entropy, // 直接儲存已計算好的熵值
            settingsHash: getSettingsHash(),
            passwordTimestamp: Date.now()
        }
    });
}

// --- 擴充功能共用功能 ---

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
}

async function detectFields(tabId) {
    try {
        return await chrome.tabs.sendMessage(tabId, { action: "detectFields" });
    } catch (e) { return { ok: false, error: String(e) }; }
}

async function ensureContentScript(tabId) {
    try {
        await chrome.tabs.sendMessage(tabId, { action: "ping" });
    } catch {
        await chrome.scripting.executeScript({ target: { tabId }, files: ["contentScript.js"] });
    }
}

// --- 初始化入口 ---

async function main() {
    // 讀取 session 中的 popup 狀態
    const sessionData = await chrome.storage.session.get([SESSION_KEY_POPUP_STATE]);
    const savedState = sessionData[SESSION_KEY_POPUP_STATE];
    const currentOpenTime = Date.now();

    // 立即設定本次打開的時間戳（用於下次重開時判斷時間間隔）
    const initialState = {
        ...(savedState || {}),
        lastOpenTimestamp: currentOpenTime
    };
    await chrome.storage.session.set({ [SESSION_KEY_POPUP_STATE]: initialState });

    // 1. 分頁切換
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = async () => {
            document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
            btn.classList.add('active');
            const targetTabId = btn.dataset.tab;
            document.getElementById(targetTabId).classList.add('active');

            // 保存當前頁籤狀態到 session（使用 await 確保寫入完成）
            const currentState = await chrome.storage.session.get([SESSION_KEY_POPUP_STATE]);
            await chrome.storage.session.set({
                [SESSION_KEY_POPUP_STATE]: {
                    ...currentState[SESSION_KEY_POPUP_STATE],
                    activeTab: targetTabId
                    // 注意：不更新 lastOpenTimestamp，保持 popup 打開時的時間戳
                }
            });

            // 只有切換到密碼產生分頁時，才執行產生功能
            if (targetTabId === 'gen-tab') {
                generate();
            }
        };
    });

    const tab = await getActiveTab();
    const url = tab?.url || "";
    els.currentUrl.textContent = url;

    // 2. 密碼產生器初始化
    await loadGenSettings();
    els.genLength.oninput = () => {
        els.lenVal.textContent = els.genLength.value;
    };
    // 拆開更新事件，滑鼠完才重產密碼
    els.genLength.onchange = () => {
        generate();
    };
    els.genRefresh.onclick = generate;
    [...Object.values(els.checks)].forEach(c => c.onchange = generate);

    els.genCopy.onclick = async () => {
        await navigator.clipboard.writeText(els.genResult.textContent);
        els.genCopy.textContent = "已複製";
        setTimeout(() => els.genCopy.textContent = "複製", 1500);
    };

    let repeatTimer = null;
    /** 數值按鈕處理事件 */
    const handleStep = {
        /**
         * 僅執行數值與視覺變更（不重算）
         * @param {number} delta
         */
        handleStepVisual: (delta) => {
            let val = parseInt(els.genLength.value);
            let newVal = val + delta;

            if (newVal >= 5 && newVal <= 128) {
                els.genLength.value = newVal;
                els.lenVal.textContent = newVal; // 即時更新數字
            }
        },
        /**
         * 僅執行數值與視覺變更（不重算）
         * @param {number} delta 
         * @returns 
         */
        startRepeat: (e, delta) => {
            // 防止滑鼠與觸控事件重複觸發，並避免長按時彈出系統選單
            if (e.cancelable) e.preventDefault();

            if (repeatTimer) return;

            handleStep.handleStepVisual(delta);

            repeatTimer = setTimeout(() => {
                repeatTimer = setInterval(() => handleStep.handleStepVisual(delta), 50);
            }, 500);
        },
        /**
         * 停止連續變更並觸發重算
         */
        stopRepeat: () => {
            if (repeatTimer) {
                clearTimeout(repeatTimer);
                clearInterval(repeatTimer);
                repeatTimer = null;
                generate();
            }
        }
    };
    // --- 事件綁定：加號 ---
    // 滑鼠事件
    els.btnPlus.addEventListener('mousedown', (e) => handleStep.startRepeat(e, 1));
    els.btnPlus.addEventListener('mouseup', handleStep.stopRepeat);
    els.btnPlus.addEventListener('mouseleave', handleStep.stopRepeat);
    // 觸控事件
    els.btnPlus.addEventListener('touchstart', (e) => handleStep.startRepeat(e, 1), { passive: false });
    els.btnPlus.addEventListener('touchend', handleStep.stopRepeat);
    // 處理系統中斷
    els.btnPlus.addEventListener('touchcancel', handleStep.stopRepeat);

    els.btnMinus.addEventListener('mousedown', (e) => handleStep.startRepeat(e, -1));
    els.btnMinus.addEventListener('mouseup', handleStep.stopRepeat);
    els.btnMinus.addEventListener('mouseleave', handleStep.stopRepeat);
    // 觸控事件
    els.btnMinus.addEventListener('touchstart', (e) => handleStep.startRepeat(e, -1), { passive: false });
    els.btnMinus.addEventListener('touchend', handleStep.stopRepeat);
    els.btnMinus.addEventListener('touchcancel', handleStep.stopRepeat);

    // els.genFill.onclick = async () => {
    //     els.genMsg.textContent = "偵測欄位中...";
    //     const res = await detectFields(tab.id);
    //     if (res?.ok && res.passwordSelectors.length > 0) {
    //         await ensureContentScript(tab.id);
    //         await chrome.tabs.sendMessage(tab.id, {
    //             action: "fill",
    //             payload: { password: els.genResult.textContent, passwordSelectors: res.passwordSelectors }
    //         });
    //         els.genMsg.textContent = "✅ 已填入密碼欄位";
    //     } else {
    //         els.genMsg.textContent = "❌ 找不到密碼欄位";
    //     }
    // };

    // 增強填入功能

    // 建立一個廣播函數
    async function broadcastToAllFrames(tabId, message) {
        // 獲取該分頁內所有的 frames
        const frames = await chrome.webNavigation.getAllFrames({ tabId });

        // 對每個 frame 嘗試發送訊息
        for (const frame of frames) {
            chrome.tabs.sendMessage(tabId, message, { frameId: frame.frameId }).catch(() => {
                // 忽略某些尚未準備好或限制存取的 frame
            });
        }
    }

    // 應用到 genFill.onclick
    els.genFill.onclick = async () => {
        els.genMsg.textContent = "偵測欄位中...";
        const tab = await getActiveTab();

        // 這裡我們直接對所有 frame 廣播「填入」指令
        // contentScript 會在自己負責的區域尋找是否有相符的選擇器
        await broadcastToAllFrames(tab.id, {
            action: "fill",
            payload: { password: els.genResult.textContent, passwordSelectors: ["input[type='password']", "#password"] }
        });

        els.genMsg.textContent = "✅ 指令已發送至所有頁面框架";
    };

    // 恢復之前的頁籤狀態（如果是短時間內重新打開）
    if (savedState && savedState.activeTab) {
        // 判斷是否在短時間內重新打開（例如 5 秒內）
        // 使用 lastOpenTimestamp（上次 popup 打開的時間）來計算時間差
        const timeSinceLastOpen = currentOpenTime - (savedState.lastOpenTimestamp || 0);
        const isRecentReopen = timeSinceLastOpen < 5000; // 5 秒內視為「不小心關閉後重開」

        if (isRecentReopen) {
            // 切換到之前的頁籤
            document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
            const savedTabBtn = document.querySelector(`[data-tab="${savedState.activeTab}"]`);
            const savedTabContent = document.getElementById(savedState.activeTab);

            if (savedTabBtn && savedTabContent) {
                savedTabBtn.classList.add('active');
                savedTabContent.classList.add('active');

                // 如果是密碼產生分頁，檢查設定是否變更
                if (savedState.activeTab === 'gen-tab' && savedState.lastPassword) {
                    const currentSettingsHash = getSettingsHash();
                    const savedSettingsHash = savedState.settingsHash;

                    // 只有在設定未變更時,才恢復之前的密碼
                    if (currentSettingsHash === savedSettingsHash) {
                        els.genResult.textContent = savedState.lastPassword;
                        // 直接使用儲存的熵值,無需重複計算
                        updateStrengthUI(savedState.entropy || 0);
                    } else {
                        // 設定已變更,產生新密碼
                        generate();
                    }
                }
            }
        } else {
            // 超過時間限制，視為新的開啟，清除 session
            await chrome.storage.session.remove([SESSION_KEY_POPUP_STATE]);
        }
    }

    // 3. 原有一鍵填入功能
    const { records = [] } = await chrome.storage.local.get(["records"]);
    const isPatternMatch = (u, p) => {
        if (p.startsWith("re:")) try { return new RegExp(p.slice(3), "i").test(u); } catch { return false; }
        if (p.includes("*")) return new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i").test(u);
        return u.toLowerCase().includes(p.toLowerCase());
    };
    const matches = records.filter(r => (Array.isArray(r.urlPatterns) ? r.urlPatterns : [r.urlPattern]).some(p => isPatternMatch(url, p)));

    els.detectBtn.onclick = async () => {
        els.msg.textContent = "偵測中...";
        const res = await detectFields(tab.id);
        if (res?.ok) {
            els.msg.textContent = `偵測完成：帳號 ${res.accountSelectors.length}、密碼 ${res.passwordSelectors.length}`;
            document.getElementById("detectJson").textContent = JSON.stringify(res, null, 2);
            document.getElementById("detectOut").style.display = "block";
        }
    };

    if (matches.length > 0) {
        els.fillBtn.disabled = false;
        els.fillBtn.classList.add("green");
        let selected = matches[0];
        if (matches.length > 1) {
            els.recordSelect.style.display = "block";
            els.recordSelect.innerHTML = matches.map(r => `<option value="${r.id}">${r.label || r.account}</option>`).join("");
            els.recordSelect.onchange = () => selected = matches.find(r => r.id === els.recordSelect.value);
        }
        els.fillBtn.onclick = async () => {
            await ensureContentScript(tab.id);
            const res = await chrome.tabs.sendMessage(tab.id, { action: "fill", payload: selected });
            els.msg.textContent = res?.ok ? `完成：填入 ${res.filledCount} 個欄位` : `失敗：${res?.error}`;
        };
    } else {
        els.fillBtn.textContent = "尚未設定此網址";
    }

    els.openOptions.onclick = async () => {
        const tab = await getActiveTab();
        if (!tab?.id) return chrome.runtime.openOptionsPage();

        // 1. 執行偵測，取得目前頁面的 Selectors 與 已填寫的值
        const res = await detectFields(tab.id);

        // 2. 將資訊存入 storage，options.js 的 load() 函式會讀取這些欄位
        await chrome.storage.local.set({
            prefillUrl: tab.url,
            prefillDetect: res
        });

        // 3. 開啟設定頁
        chrome.runtime.openOptionsPage();
    };
}

main();