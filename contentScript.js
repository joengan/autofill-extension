function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// function setValue(el, value) {
//     if (!el) return false;

//     const tag = (el.tagName || "").toLowerCase();
//     const isInputLike = ["input", "textarea", "select"].includes(tag);

//     if (isInputLike) {
//         el.focus();
//         el.value = value;
//         el.dispatchEvent(new Event("input", { bubbles: true }));
//         el.dispatchEvent(new Event("change", { bubbles: true }));
//         el.blur?.();
//         return true;
//     }

//     if (el.isContentEditable) {
//         el.focus();
//         el.textContent = value;
//         el.dispatchEvent(new Event("input", { bubbles: true }));
//         el.dispatchEvent(new Event("change", { bubbles: true }));
//         el.blur?.();
//         return true;
//     }

//     return false;
// }

// --- 強化版 setValue：解決問題 2 (框架校驗) 與 5 (反自動化) ---
async function setValue(el, value, useTyping = true) {
    if (!el) return false;

    const tag = (el.tagName || "").toLowerCase();
    const isInputLike = ["input", "textarea", "select"].includes(tag);
    const isEditable = el.isContentEditable;

    if (!isInputLike && !isEditable) return false;

    el.focus();

    // 1. 如果不需要模擬打字（追求速度），走原本的快速路徑
    if (!useTyping) {
        if (isInputLike) el.value = value;
        else if (isEditable) el.textContent = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.blur?.();
        return true;
    }

    // 2. 如果需要高相容性，執行打字模擬 (即原本的 typeValue 邏輯)
    if (isInputLike) el.value = "";
    if (isEditable) el.textContent = "";

    for (const char of value) {
        const eventOptions = { bubbles: true, cancelable: true, composed: true, key: char };
        el.dispatchEvent(new KeyboardEvent("keydown", eventOptions));

        if (isInputLike) el.value += char;
        else if (isEditable) el.textContent += char;

        el.dispatchEvent(new InputEvent("input", eventOptions));
        el.dispatchEvent(new KeyboardEvent("keyup", eventOptions));

        // 短暫停頓模擬真人
        await new Promise(r => setTimeout(r, Math.random() * 20 + 10));
    }

    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur?.();
    return true;
}

/**
 * 輔助函數：繞過 React/Vue 的屬性攔截 (Setter Interception)
 * 確保直接修改 value 也能觸發框架內部的狀態更新
 */
function setNativeValue(el, value) {
    const prototype = Object.getPrototypeOf(el);
    const nativeEventValueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    const inputPrototype = Object.getPrototypeOf(document.createElement("input"));
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(inputPrototype, "value")?.set;

    if (nativeEventValueSetter && nativeEventValueSetter !== nativeInputValueSetter) {
        nativeEventValueSetter.call(el, value);
    } else if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, value);
    } else {
        el.value = value;
    }
}

/**
 * 強化版：模擬真人打字的非同步函數
 * 解決框架校驗、反自動化偵測以及欄位更新無效的問題
 */
async function typeValue(el, value) {
    if (!el) return false;

    // 1. 安全性檢查：確保元素可交互且可見
    if (el.disabled || el.readOnly) return false;
    if (!isVisible(el)) return false;

    const tag = (el.tagName || "").toLowerCase();
    const isInputLike = ["input", "textarea", "select"].includes(tag);
    const isEditable = el.isContentEditable;

    if (!isInputLike && !isEditable) return false;

    // 2. 模擬真人點擊獲取焦點 (觸發 Pointer 與 Mouse 事件鏈)
    const commonOptions = { bubbles: true, cancelable: true, composed: true, view: window };
    el.dispatchEvent(new PointerEvent("pointerdown", commonOptions));
    el.dispatchEvent(new MouseEvent("mousedown", commonOptions));
    el.focus();
    el.dispatchEvent(new Event("focusin", { bubbles: true }));
    el.dispatchEvent(new PointerEvent("pointerup", commonOptions));
    el.dispatchEvent(new MouseEvent("mouseup", commonOptions));
    el.dispatchEvent(new MouseEvent("click", commonOptions));

    // 3. 模擬真人刪除舊資料
    await clearValueHumanLike(el);

    // 4. 逐字模擬輸入
    for (const char of value) {
        const eventOptions = { ...commonOptions, key: char };

        // 發送按鍵按下事件
        el.dispatchEvent(new KeyboardEvent("keydown", eventOptions));

        // 發送輸入前事件 (部分框架會檢查此事件)
        el.dispatchEvent(new InputEvent("beforeinput", {
            ...eventOptions,
            data: char,
            inputType: "insertText"
        }));

        // --- 核心技術：優先使用 execCommand 模擬文字插入 ---
        // 這種方式對 React/Vue 效果最好，因為它會自動觸發框架內部的所有校驗邏輯
        let success = false;
        try {
            success = document.execCommand('insertText', false, char);
        } catch (e) {
            success = false;
        }

        // 如果 execCommand 失敗 (某些極端環境)，則退回到強制的原生 Setter
        if (!success) {
            if (isEditable) {
                el.textContent += char;
            } else {
                setNativeValue(el, el.value + char);
            }
            // 手動觸發 input 事件以防萬一
            el.dispatchEvent(new InputEvent("input", {
                ...eventOptions,
                data: char,
                inputType: "insertText"
            }));
        }

        // 發送按鍵放開事件
        el.dispatchEvent(new KeyboardEvent("keyup", eventOptions));

        // 隨機停頓：模擬真人打字節奏
        await new Promise(r => setTimeout(r, Math.random() * 10 + 10));
    }

    // 5. 輸入完成後的收尾動作
    el.dispatchEvent(new Event("input", { bubbles: true })); // 確保最終狀態更新
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("focusout", { bubbles: true }));

    // 重要：稍微延遲再離開焦點，給網頁腳本時間來保存最後一個字
    await new Promise(r => setTimeout(r, 150));
    el.blur?.();

    return true;
}

// 偵測目前欄位長度，並逐次發送 Backspace 事件。
async function clearValueHumanLike(el) {
    el.focus();
    let val = el.isContentEditable ? el.textContent : el.value;

    // 如果本來就沒東西，直接返回
    if (!val || val.length === 0) return;

    const eventOptions = { bubbles: true, cancelable: true, composed: true, key: "Backspace" };

    // 模擬逐字刪除（比較像真人遇到舊資料的反應）
    while (val.length > 0) {
        el.dispatchEvent(new KeyboardEvent("keydown", eventOptions));

        val = val.slice(0, -1); // 刪除最後一個字
        if (el.isContentEditable) el.textContent = val;
        else el.value = val;

        el.dispatchEvent(new InputEvent("input", { ...eventOptions, data: null }));
        el.dispatchEvent(new KeyboardEvent("keyup", eventOptions));

        // 刪除的速度通常比打字快一點
        await new Promise(r => setTimeout(r, Math.random() * 15 + 10));
    }
}

function queryAll(selector, root = document) {
    try {
        return Array.from(root.querySelectorAll(selector));
    } catch {
        return [];
    }
}

// function queryAllDeep(selector) {
//     const results = new Set();
//     const roots = [document];

//     while (roots.length) {
//         const root = roots.shift();
//         try {
//             root.querySelectorAll(selector).forEach(el => results.add(el));
//         } catch { }

//         let all = [];
//         try { all = Array.from(root.querySelectorAll("*")); } catch { }
//         for (const el of all) {
//             if (el.shadowRoot) roots.push(el.shadowRoot);
//         }
//     }

//     return Array.from(results);
// }

// --- 強化版 queryAllDeep：解決問題 1 (Shadow DOM) ---
// 遞迴搜尋所有節點，包含隱藏在 Shadow Root 裡面的元素
function queryAllDeep(selector, root = document) {
    let nodes = Array.from(root.querySelectorAll(selector));

    // 找出所有具有 ShadowRoot 的元素
    const allElements = root.querySelectorAll('*');
    for (const el of allElements) {
        if (el.shadowRoot) {
            // 遞迴進入 Shadow DOM 搜尋
            const shadowNodes = queryAllDeep(selector, el.shadowRoot);
            nodes = nodes.concat(shadowNodes);
        }
    }
    return nodes;
}

function normalizeSelectorList(input) {
    if (Array.isArray(input)) {
        const list = input.map(s => String(s || "").trim());
        return list.filter(Boolean);
    }

    if (typeof input === "string") {
        return input.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    }

    if (input == null) return [];
    return null;
}

async function fillSelectors(selectors, value) {
    let filled = 0;
    const source = Array.isArray(selectors) ? selectors : [];
    const list = source.map(s => String(s || "").trim()).filter(Boolean);
    if (!list.length) return filled;

    for (let attempt = 0; attempt < 10; attempt++) {
        let anyFound = false;

        for (const sel of list) {
            let els = queryAll(sel);
            if (!els.length) els = queryAllDeep(sel);

            if (els.length) anyFound = true;
            for (const el of els) {
                //if (setValue(el, value, false)) filled++;
                // 改成一律模擬人類輸入
                if (await typeValue(el, value)) filled++;
            }
        }

        if (anyFound) break;
        await sleep(300);
    }
    return filled;
}

/* ---------- 偵測欄位 ---------- */

function isVisible(el) {
    if (!el) return false;
    if (el.type === "hidden") return false;
    const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    // offsetParent 對 fixed 元素可能是 null，這裡用 bounding box 判斷
    const rect = el.getBoundingClientRect?.();
    if (!rect) return true;
    return rect.width > 0 && rect.height > 0;
}

function cssEscape(value) {
    try {
        return CSS.escape(value);
    } catch {
        return String(value).replace(/["\\]/g, "\\$&");
    }
}

function makeSelector(el) {
    if (!el || !el.tagName) return null;
    const doc = el.ownerDocument || document;
    const tag = el.tagName.toLowerCase();

    // 1) id
    if (el.id) {
        const sel = `#${cssEscape(el.id)}`;
        if (queryAll(sel, doc).length === 1) return sel;
        return sel; // 即使不唯一也可用（會多填）
    }

    // 2) name
    const name = el.getAttribute("name");
    if (name) {
        const sel = `${tag}[name="${cssEscape(name)}"]`;
        return sel;
    }

    // 3) autocomplete
    const ac = el.getAttribute("autocomplete");
    if (ac) {
        const sel = `${tag}[autocomplete="${cssEscape(ac)}"]`;
        return sel;
    }

    // 4) aria-label / placeholder（只取較短且常見者）
    const aria = el.getAttribute("aria-label");
    if (aria && aria.length <= 40) {
        const sel = `${tag}[aria-label="${cssEscape(aria)}"]`;
        return sel;
    }
    const ph = el.getAttribute("placeholder");
    if (ph && ph.length <= 40) {
        const sel = `${tag}[placeholder="${cssEscape(ph)}"]`;
        return sel;
    }

    // 5) 簡易路徑（到 form 或 body）
    let cur = el;
    const parts = [];
    for (let i = 0; i < 4 && cur && cur !== doc.body; i++) {
        const t = cur.tagName?.toLowerCase();
        if (!t) break;

        let part = t;
        const cls = (cur.className && typeof cur.className === "string")
            ? cur.className.split(/\s+/).filter(Boolean).slice(0, 2)
            : [];
        if (cls.length) part += "." + cls.map(cssEscape).join(".");

        // nth-of-type
        const parent = cur.parentElement;
        if (parent) {
            const same = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
            if (same.length > 1) {
                const idx = same.indexOf(cur) + 1;
                part += `:nth-of-type(${idx})`;
            }
        }
        parts.unshift(part);

        if (t === "form") break;
        cur = cur.parentElement;
    }

    if (parts.length) return parts.join(" > ");
    return `${tag}`;
}

function bestUsernameCandidate(passwordEl) {
    const doc = passwordEl.ownerDocument || document;
    const form = passwordEl.closest?.("form");

    const candidates = (root) => {
        const inputs = Array.from(root.querySelectorAll("input, textarea"))
            .filter(el => el !== passwordEl)
            .filter(el => isVisible(el))
            .filter(el => {
                const tag = el.tagName.toLowerCase();
                if (tag === "textarea") return true;
                const type = (el.getAttribute("type") || "text").toLowerCase();
                if (["text", "email", "tel", "number", ""].includes(type)) return true;
                return false;
            });

        // 依 autocomplete/name/id/placeholder 加權
        const score = (el) => {
            const t = ((el.getAttribute("type") || "text").toLowerCase());
            const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
            const id = (el.id || "").toLowerCase();
            const name = (el.getAttribute("name") || "").toLowerCase();
            const ph = (el.getAttribute("placeholder") || "").toLowerCase();

            let s = 0;
            if (t === "email") s += 6;
            if (ac.includes("username")) s += 10;
            if (ac.includes("email")) s += 8;

            const text = `${id} ${name} ${ph}`;
            if (text.match(/user|account|login|email|mail|id/)) s += 8;
            if (text.match(/phone|mobile/)) s += 2;

            // 距離 password 越近越好（DOM 位置）
            const pos = el.compareDocumentPosition(passwordEl);
            // 2 = preceding, 4 = following
            if (pos & Node.DOCUMENT_POSITION_PRECEDING) s += 4;
            if (pos & Node.DOCUMENT_POSITION_FOLLOWING) s += 2;

            return s;
        };

        inputs.sort((a, b) => score(b) - score(a));
        return inputs[0] || null;
    };

    return candidates(form || doc);
}

function collectDetectFromDoc(doc) {
    const passwords = Array.from(doc.querySelectorAll('input[type="password"]'))
        .filter(isVisible)
        .filter(el => !el.disabled && !el.readOnly);

    const accountSelectors = [];
    const passwordSelectors = [];
    const otherCandidates = [];

    // 記錄偵測到的數值
    let accountValue = "";
    let passwordValue = "";

    const addUnique = (arr, v) => {
        if (!v) return;
        if (!arr.includes(v)) arr.push(v);
    };

    for (const pw of passwords) {
        addUnique(passwordSelectors, makeSelector(pw));

        // 抓取第一個密碼欄位的值
        if (!passwordValue) passwordValue = pw.value;

        const user = bestUsernameCandidate(pw);
        if (user) {
            addUnique(accountSelectors, makeSelector(user));
            // 抓取對應帳號欄位的值
            if (!accountValue) accountValue = user.value;
        }
    }

    // 其他候選（給你做 other 欄位用的提示）
    const otherKeys = ["domain", "tenant", "company", "org", "organization", "workspace", "site"];
    const others = Array.from(doc.querySelectorAll("input, textarea"))
        .filter(isVisible)
        .filter(el => !el.disabled && !el.readOnly)
        .filter(el => {
            const id = (el.id || "").toLowerCase();
            const name = (el.getAttribute("name") || "").toLowerCase();
            const ph = (el.getAttribute("placeholder") || "").toLowerCase();
            const text = `${id} ${name} ${ph}`;
            return otherKeys.some(k => text.includes(k));
        });

    for (const el of others.slice(0, 5)) {
        otherCandidates.push({
            key: "other",
            selector: makeSelector(el)
        });
    }

    return { accountSelectors, passwordSelectors, otherCandidates, accountValue, passwordValue };
}

function collectDetectAllFramesTopDoc() {
    const merged = { accountSelectors: [], passwordSelectors: [], otherCandidates: [], accountValue: "", passwordValue: "" };

    const fromMain = collectDetectFromDoc(document);
    Object.assign(merged, fromMain); // 優先取主頁面的值

    const iframes = Array.from(document.querySelectorAll("iframe"));
    for (const iframe of iframes) {
        try {
            const d = iframe.contentDocument;
            if (!d) continue;
            const r = collectDetectFromDoc(d);
            // 這裡僅合併 Selectors，數值若主頁面沒有則取 iframe 的
            if (!merged.accountValue) merged.accountValue = r.accountValue;
            if (!merged.passwordValue) merged.passwordValue = r.passwordValue;
            // ... (合併 Selectors 邏輯保持不變)
        } catch { }
    }
    return merged;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.action) {
        sendResponse({ ok: false, error: "bad message" });
        return; // 不要 return true
    }

    if (msg.action === "ping") {
        sendResponse({ ok: true });
        return; // 不要 return true
    }

    if (msg.action === "detectFields") {
        if (window.top !== window) {
            sendResponse({ ok: true, ignored: true });
            return;
        }

        try {
            const r = collectDetectAllFramesTopDoc();
            sendResponse({
                ok: true,
                accountSelectors: r.accountSelectors,
                passwordSelectors: r.passwordSelectors,
                otherCandidates: r.otherCandidates,
                accountValue: r.accountValue,
                passwordValue: r.passwordValue
            });
        } catch (err) {
            sendResponse({ ok: false, error: String(err) });
        }
        return; // 不要 return true（這段是同步回覆）
    }

    if (msg.action === "fill") {
        (async () => {
            const record = msg.payload || {};
            let filledCount = 0;

            const accountSelectors = normalizeSelectorList(record.accountSelectors);
            if (accountSelectors === null) {
                sendResponse({ ok: false, error: "帳號欄位 selectors 格式錯誤" });
                return;
            }

            const passwordSelectors = normalizeSelectorList(record.passwordSelectors);
            if (passwordSelectors === null) {
                sendResponse({ ok: false, error: "密碼欄位 selectors 格式錯誤" });
                return;
            }

            if (record.others != null && !Array.isArray(record.others)) {
                sendResponse({ ok: false, error: "其他欄位資料格式錯誤" });
                return;
            }

            filledCount += await fillSelectors(accountSelectors, record.account ?? "");
            filledCount += await fillSelectors(passwordSelectors, record.password ?? "");

            const others = Array.isArray(record.others) ? record.others : [];
            for (let i = 0; i < others.length; i++) {
                const item = others[i] || {};
                const selectors = normalizeSelectorList(item.selectors);
                if (selectors === null) {
                    sendResponse({ ok: false, error: `第 ${i + 1} 個其他欄位的 selectors 格式錯誤` });
                    return;
                }

                if (!selectors.length) continue;
                filledCount += await fillSelectors(selectors, item.value ?? "");
            }

            sendResponse({ ok: true, filledCount });
        })().catch(err => {
            sendResponse({ ok: false, error: String(err) });
        });

        return true; // ✅ 只有這種「真的 async」才 return true
    }

    sendResponse({ ok: false, error: "unknown action" });
});

