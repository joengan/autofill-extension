const els = {
    recordList: document.getElementById("recordList"),
    addBtn: document.getElementById("addBtn"),
    dupBtn: document.getElementById("dupBtn"),
    editor: document.getElementById("editor"),
    emptyState: document.getElementById("emptyState"),
    toast: document.getElementById("toast"),

    label: document.getElementById("label"),
    urlPatterns: document.getElementById("urlPatterns"),
    addUrlPattern: document.getElementById("addUrlPattern"),
    account: document.getElementById("account"),
    password: document.getElementById("password"),

    accountSelectors: document.getElementById("accountSelectors"),
    passwordSelectors: document.getElementById("passwordSelectors"),
    addAccountSelector: document.getElementById("addAccountSelector"),
    addPasswordSelector: document.getElementById("addPasswordSelector"),

    others: document.getElementById("others"),
    addOther: document.getElementById("addOther"),

    saveBtn: document.getElementById("saveBtn"),
    deleteBtn: document.getElementById("deleteBtn"),

    exportBtn: document.getElementById("exportBtn"),
    importBtn: document.getElementById("importBtn"),
    importFile: document.getElementById("importFile"),

    detectBtn: document.getElementById("detectBtn")
};

let state = {
    records: [],
    selectedId: null,
    unsavedRecord: null, // 用於存放尚未按下儲存的新紀錄 (草稿)
    editingRecord: null // 用於存放正在編輯的臨時副本，防止未儲存時污染原始資料
};

function uid() {
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function showToast(text) {
    els.toast.textContent = text;
    setTimeout(() => (els.toast.textContent = ""), 2500);
}

function suggestPattern(url) {
    try {
        const u = new URL(url);
        return `${u.origin}/*`;
    } catch {
        return "*";
    }
}

function makeEmptyRecord() {
    return {
        id: uid(),
        label: "",
        urlPatterns: [],
        account: "",
        accountSelectors: [""],
        password: "",
        passwordSelectors: [""],
        others: [] // { key, value, selectors: [""] }
    };
}

function getUrlPatterns(rec) {
    const list = [];
    const push = (raw) => {
        const trimmed = String(raw || "").trim();
        if (trimmed && !list.includes(trimmed)) list.push(trimmed);
    };
    if (rec && Array.isArray(rec.urlPatterns)) rec.urlPatterns.forEach(push);
    if (rec && rec.urlPattern) push(rec.urlPattern);
    return list;
}

function upgradeRecord(rec) {
    if (!rec || typeof rec !== "object") return makeEmptyRecord();
    const next = { ...rec };
    if (!next.id) next.id = uid();
    next.accountSelectors = Array.isArray(next.accountSelectors) && next.accountSelectors.length ? next.accountSelectors : [""];
    next.passwordSelectors = Array.isArray(next.passwordSelectors) && next.passwordSelectors.length ? next.passwordSelectors : [""];
    next.others = Array.isArray(next.others) ? next.others : [];

    const patterns = getUrlPatterns(next);
    next.urlPatterns = patterns.length
        ? [...patterns]
        : [];
    delete next.urlPattern;

    return next;
}

async function persist() {
    await chrome.storage.local.set({ records: state.records });
}

function renderList() {
    els.recordList.innerHTML = "";
    state.records.forEach((rec, index) => {
        const div = document.createElement("div");
        div.className = "item" + (rec.id === state.selectedId ? " active" : "");
        div.draggable = true;
        div.dataset.id = rec.id;
        div.dataset.index = index;
        const patterns = getUrlPatterns(rec);
        const patternPreview = patterns.length
            ? (patterns.length > 1 ? `${patterns[0]} 等 ${patterns.length} 筆` : patterns[0])
            : "(未設定網址規則)";
        div.innerHTML = `
      <div><b>${escapeHtml(rec.label || "(未命名)")}</b></div>
            <div class="small">${escapeHtml(patternPreview)}</div>
      <div class="small">帳號：${escapeHtml(rec.account || "(未填)")}</div>
    `;
        div.onclick = (e) => {
            // 只有在非拖拽狀態下才執行選擇
            if (!e.target.closest(".item").dataset.dragging) {
                select(rec.id);
            }
        };

        // 拖拽事件
        div.ondragstart = (e) => {
            div.dataset.dragging = "true";
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/html", div.innerHTML);
            div.style.opacity = "0.5";
        };

        div.ondragend = () => {
            delete div.dataset.dragging;
            div.style.opacity = "1";
        };

        div.ondragover = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const rect = div.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            if (e.clientY < midpoint) {
                div.style.borderTop = "3px solid #111827";
                div.style.borderBottom = "none";
            } else {
                div.style.borderTop = "none";
                div.style.borderBottom = "3px solid #111827";
            }
        };

        div.ondragleave = () => {
            div.style.borderTop = "none";
            div.style.borderBottom = "none";
        };

        div.ondrop = (e) => {
            e.preventDefault();
            e.stopPropagation();
            div.style.borderTop = "none";
            div.style.borderBottom = "none";

            const draggedId = e.dataTransfer.getData("text/html");
            const draggedItem = document.querySelector(`[data-id][data-dragging="true"]`);

            if (draggedItem && draggedItem !== div) {
                const fromIndex = parseInt(draggedItem.dataset.index);
                const toIndex = parseInt(div.dataset.index);

                // 調整順序
                const [movedRecord] = state.records.splice(fromIndex, 1);
                if (fromIndex < toIndex) {
                    state.records.splice(toIndex - 1, 0, movedRecord);
                } else {
                    state.records.splice(toIndex, 0, movedRecord);
                }

                persist().then(() => {
                    renderList();
                    showToast("順序已更新");
                });
            }
        };

        els.recordList.appendChild(div);
    });
}

function select(id) {
    // 切換選擇時，清除編輯副本（自動放棄未儲存的更改）
    state.editingRecord = null;

    // 如果目前有未儲存的草稿，應該自動丟棄（復原）
    if (state.unsavedRecord && state.selectedId === state.unsavedRecord.id) {
        state.unsavedRecord = null;
    }
    state.selectedId = id;
    renderList();
    const rec = currentRecord();
    renderEditor(rec);
}

function renderEditor(rec) {
    if (!rec) {
        els.editor.style.display = "none";
        els.emptyState.style.display = "block";
        return;
    }

    els.editor.style.display = "block";
    els.emptyState.style.display = "none";

    els.label.value = rec.label || "";
    els.account.value = rec.account || "";
    els.password.value = rec.password || "";

    rec.urlPatterns = Array.isArray(rec.urlPatterns) ? rec.urlPatterns : [];
    renderUrlPatterns(rec);

    renderSelectors(els.accountSelectors, rec.accountSelectors, (next) => {
        rec.accountSelectors = next;
    }, "例如：#username 或 input[name='user']");

    renderSelectors(els.passwordSelectors, rec.passwordSelectors, (next) => {
        rec.passwordSelectors = next;
    }, "例如：#password 或 input[type='password']");

    renderOthers(rec);
}

function renderUrlPatterns(rec) {
    if (!els.urlPatterns) return;
    if (!Array.isArray(rec.urlPatterns)) rec.urlPatterns = [];

    els.urlPatterns.innerHTML = "";

    if (rec.urlPatterns.length === 0) {
        const emptyHint = document.createElement("div");
        emptyHint.className = "hint";
        emptyHint.textContent = "尚未新增網址規則。";
        els.urlPatterns.appendChild(emptyHint);
        return;
    }

    rec.urlPatterns.forEach((value, idx) => {
        const safeValue = typeof value === "string" ? value : "";
        const row = document.createElement("div");
        row.className = "chip";
        row.innerHTML = `
            <input placeholder="${escapeAttr("例如：*://192.168.0.1/* 或 *login*")}" value="${escapeAttr(safeValue)}" />
      <button class="btn secondary" title="刪除">－</button>
    `;

        const input = row.querySelector("input");
        const del = row.querySelector("button");

        input.oninput = () => {
            rec.urlPatterns[idx] = input.value;
            renderList();
        };

        del.onclick = () => {
            rec.urlPatterns.splice(idx, 1);
            renderUrlPatterns(rec);
            renderList();
        };

        els.urlPatterns.appendChild(row);
    });
}

function renderSelectors(container, list, onChange, placeholderText) {
    container.innerHTML = "";
    const arr = Array.isArray(list) && list.length ? list : [""];
    const placeholder = placeholderText || "例如：#username 或 input[name='user']";

    arr.forEach((val, idx) => {
        const row = document.createElement("div");
        row.className = "chip";
        row.innerHTML = `
      <input placeholder="${escapeAttr(placeholder)}" value="${escapeAttr(val)}" />
      <button class="btn secondary" title="刪除">－</button>
    `;
        const input = row.querySelector("input");
        const del = row.querySelector("button");

        input.oninput = () => {
            arr[idx] = input.value;
            onChange([...arr]);
        };

        del.onclick = () => {
            const next = arr.filter((_, i) => i !== idx);
            onChange(next.length ? next : [""]);
            renderEditor(currentRecord());
        };

        container.appendChild(row);
    });
}

function renderOthers(rec) {
    els.others.innerHTML = "";

    rec.others = Array.isArray(rec.others) ? rec.others : [];

    rec.others.forEach((item, idx) => {
        const box = document.createElement("div");
        box.className = "section";
        box.innerHTML = `
      <h2>其他資訊 #${idx + 1}</h2>
      <div class="col">
        <label>名稱（key，可選）</label>
        <input data-k="key" placeholder="例如：domain" value="${escapeAttr(item.key || "")}" />
      </div>
      <div class="col">
        <label>值（value）</label>
        <input data-k="value" placeholder="要填入的文字" value="${escapeAttr(item.value || "")}" />
      </div>
      <div class="col">
        <label>selectors（可多筆，同步填入）</label>
        <div class="chips" data-k="selectors"></div>
        <button class="btn secondary" data-act="addSel">＋新增 selector</button>
      </div>
      <button class="btn danger" data-act="delOther">刪除此其他資訊</button>
    `;

        const keyInput = box.querySelector("input[data-k='key']");
        const valInput = box.querySelector("input[data-k='value']");
        const selBox = box.querySelector("div[data-k='selectors']");
        const addSelBtn = box.querySelector("button[data-act='addSel']");
        const delOtherBtn = box.querySelector("button[data-act='delOther']");

        keyInput.oninput = () => { item.key = keyInput.value; };
        valInput.oninput = () => { item.value = valInput.value; };

        const selectors = Array.isArray(item.selectors) && item.selectors.length ? item.selectors : [""];
        const rerenderSelectors = () => {
            selBox.innerHTML = "";
            selectors.forEach((s, sidx) => {
                const row = document.createElement("div");
                row.className = "chip";
                row.innerHTML = `
          <input placeholder="例如：#domain" value="${escapeAttr(s)}" />
          <button class="btn secondary" title="刪除">－</button>
        `;
                const input = row.querySelector("input");
                const del = row.querySelector("button");
                input.oninput = () => { selectors[sidx] = input.value; item.selectors = [...selectors]; };
                del.onclick = () => {
                    selectors.splice(sidx, 1);
                    if (!selectors.length) selectors.push("");
                    item.selectors = [...selectors];
                    rerenderSelectors();
                };
                selBox.appendChild(row);
            });
            item.selectors = [...selectors];
        };
        rerenderSelectors();

        addSelBtn.onclick = () => {
            selectors.push("");
            item.selectors = [...selectors];
            rerenderSelectors();
        };

        delOtherBtn.onclick = () => {
            rec.others.splice(idx, 1);
            renderEditor(rec);
        };

        els.others.appendChild(box);
    });
}

function currentRecord() {
    // 優先檢查是否正在編輯「未存檔」的草稿
    if (state.unsavedRecord && state.selectedId === state.unsavedRecord.id) {
        return state.unsavedRecord;
    }

    // 如果有編輯副本，返回編輯副本（臨時副本，未儲存時不會污染原始資料）
    if (state.editingRecord && state.selectedId === state.editingRecord.id) {
        return state.editingRecord;
    }

    const original = state.records.find(r => r.id === state.selectedId) || null;

    // 當切換到不同記錄時，為原始記錄建立一個臨時副本用於編輯
    if (original && !state.editingRecord) {
        state.editingRecord = structuredClone(original);
        state.editingRecord.id = original.id; // 保持 id 一致以便辨識
    }

    return state.editingRecord || original;
}

function escapeHtml(s) {
    return String(s || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function escapeAttr(s) {
    return escapeHtml(s).replaceAll("\n", " ");
}

function cleanList(arr) {
    const a = (Array.isArray(arr) ? arr : []).map(x => String(x || "").trim());
    const nonEmpty = a.filter(Boolean);
    return nonEmpty.length ? nonEmpty : [""];
}

function mergeSelectors(oldList, newList) {
    const oldClean = cleanList(oldList);
    const newClean = (Array.isArray(newList) ? newList : []).map(s => String(s || "").trim()).filter(Boolean);
    const set = new Set(oldClean.filter(Boolean));
    for (const s of newClean) set.add(s);
    const merged = Array.from(set);
    return merged.length ? merged : oldClean;
}

//（用於比對網址規則）
function isPatternMatch(url, pattern) {
    if (!pattern) return false;
    // 支援 re: 開頭的正則表示式
    if (pattern.startsWith("re:")) {
        try { return new RegExp(pattern.slice(3), "i").test(url); } catch { return false; }
    }
    // 支援 wildcard (*)
    if (pattern.includes("*")) {
        const regexStr = "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$";
        return new RegExp(regexStr, "i").test(url);
    }
    // 預設為包含關係
    return url.toLowerCase().includes(pattern.toLowerCase());
}

async function load() {
    const { records = [], prefillUrl, prefillDetect } = await chrome.storage.local.get(["records", "prefillUrl", "prefillDetect"]);
    state.records = (Array.isArray(records) ? records : []).map(upgradeRecord);

    if (prefillUrl) {
        // --- 核心邏輯：先搜尋是否有符合規則的現有設定檔 ---
        const existingRecord = state.records.find(r =>
            getUrlPatterns(r).some(p => isPatternMatch(prefillUrl, p))
        );

        if (existingRecord) {
            // A. 若找到符合的設定，則切換到該筆
            state.selectedId = existingRecord.id;

            if (prefillDetect && prefillDetect.ok) {
                // 只有在原紀錄沒帳密時才補上偵測到的值
                if (!existingRecord.account) existingRecord.account = prefillDetect.accountValue || "";
                if (!existingRecord.password) existingRecord.password = prefillDetect.passwordValue || "";
            }
            // 注意：這裡不呼叫 persist()，讓使用者決定是否要儲存變更
            showToast("已為您開啟現有的符合設定檔。");
        } else {
            // B. 若找不到符合的設定，建立「草稿」而非正式紀錄
            const rec = makeEmptyRecord();
            rec.label = (() => { try { return new URL(prefillUrl).host; } catch { return ""; } })();
            const suggestion = suggestPattern(prefillUrl);
            rec.urlPatterns = suggestion ? [suggestion] : [];

            if (prefillDetect && prefillDetect.ok) {
                rec.accountSelectors = prefillDetect.accountSelectors?.length ? prefillDetect.accountSelectors : [""];
                rec.passwordSelectors = prefillDetect.passwordSelectors?.length ? prefillDetect.passwordSelectors : [""];
                rec.account = prefillDetect.accountValue || "";
                rec.password = prefillDetect.passwordValue || "";
            }

            // 存入草稿狀態，不放入 state.records 也不呼叫 persist()
            state.unsavedRecord = rec;
            state.selectedId = rec.id;

            showToast("已自動帶入資訊，請記得按「儲存」按鈕才會新增。");
        }

        await chrome.storage.local.remove(["prefillUrl", "prefillDetect"]);
    }

    renderList();
    if (state.selectedId) {
        renderEditor(currentRecord());
    } else if (state.records.length) {
        state.selectedId = state.records[0].id;
        renderEditor(currentRecord());
        renderList();
    } else {
        renderEditor(null);
    }
}

els.addBtn.onclick = () => {
    // 手動新增時，也先作為草稿處理
    const rec = makeEmptyRecord();
    state.unsavedRecord = rec;
    state.editingRecord = null;
    state.selectedId = rec.id;
    renderList();
    renderEditor(rec);
    showToast("已建立新設定草稿。");
};

els.dupBtn.onclick = () => {
    const rec = currentRecord();
    if (!rec) return;
    const copy = structuredClone(rec);
    copy.id = uid();
    copy.label = (copy.label || "(未命名)") + " - 複製";

    // 複製也先作為草稿，避免手滑產生大量垃圾資料
    state.unsavedRecord = copy;
    state.editingRecord = null;
    state.selectedId = copy.id;
    renderList();
    renderEditor(copy);
    showToast("已建立副本草稿，請按儲存以完成新增。");
};

if (els.addUrlPattern) {
    els.addUrlPattern.onclick = () => {
        const rec = currentRecord();
        if (!rec) return;
        rec.urlPatterns = Array.isArray(rec.urlPatterns) ? rec.urlPatterns : getUrlPatterns(rec);
        if (!Array.isArray(rec.urlPatterns)) rec.urlPatterns = [];

        const lastValue = rec.urlPatterns[rec.urlPatterns.length - 1];
        if (typeof lastValue === "string" && lastValue.trim() === "") {
            const inputs = els.urlPatterns.querySelectorAll("input");
            inputs[inputs.length - 1]?.focus();
            return;
        }

        rec.urlPatterns.push("");
        renderUrlPatterns(rec);

        const inputs = els.urlPatterns.querySelectorAll("input");
        inputs[inputs.length - 1]?.focus();
    };
}

els.addAccountSelector.onclick = () => {
    const rec = currentRecord();
    if (!rec) return;
    rec.accountSelectors = Array.isArray(rec.accountSelectors) ? rec.accountSelectors : [""];
    rec.accountSelectors.push("");
    renderEditor(rec);
};

els.addPasswordSelector.onclick = () => {
    const rec = currentRecord();
    if (!rec) return;
    rec.passwordSelectors = Array.isArray(rec.passwordSelectors) ? rec.passwordSelectors : [""];
    rec.passwordSelectors.push("");
    renderEditor(rec);
};

els.addOther.onclick = () => {
    const rec = currentRecord();
    if (!rec) return;
    rec.others = Array.isArray(rec.others) ? rec.others : [];
    rec.others.push({ key: "", value: "", selectors: [""] });
    renderEditor(rec);
};

els.saveBtn.onclick = async () => {
    const rec = currentRecord();
    if (!rec) return;

    rec.label = els.label.value.trim();
    rec.account = els.account.value;
    rec.password = els.password.value;

    const savedPatterns = getUrlPatterns(rec);
    rec.urlPatterns = savedPatterns;
    delete rec.urlPattern;

    rec.accountSelectors = cleanList(rec.accountSelectors);
    rec.passwordSelectors = cleanList(rec.passwordSelectors);

    rec.others = (Array.isArray(rec.others) ? rec.others : [])
        .map(o => ({
            key: String(o.key || "").trim(),
            value: String(o.value || ""),
            selectors: cleanList(o.selectors)
        }))
        .filter(o => o.value !== "" || o.key !== "" || (o.selectors && o.selectors.some(s => s.trim())));

    // 如果目前是新的草稿，轉為正式紀錄並推入清單
    if (state.unsavedRecord && state.selectedId === state.unsavedRecord.id) {
        state.records.unshift(state.unsavedRecord);
        state.unsavedRecord = null;
    }
    // 如果是編輯副本，將更改同步回原始記錄
    else if (state.editingRecord && state.selectedId === state.editingRecord.id) {
        const originalIndex = state.records.findIndex(r => r.id === rec.id);
        if (originalIndex !== -1) {
            state.records[originalIndex] = rec;
        }
    }

    state.editingRecord = null; // 儲存完成後清除編輯副本
    await persist();
    renderList();
    renderEditor(currentRecord());
    showToast("已儲存。");
    alert("已儲存設定！請記得重新載入你要填入的頁面，讓擴充功能可以取得最新的設定。");
};

els.deleteBtn.onclick = async () => {
    const rec = currentRecord();
    if (!rec) return;

    // 如果是尚未存檔的草稿，直接捨棄即可，不需確認
    if (state.unsavedRecord && state.selectedId === state.unsavedRecord.id) {
        state.unsavedRecord = null;
        state.editingRecord = null;
        state.selectedId = state.records[0]?.id || null;
        renderList();
        renderEditor(currentRecord());
        showToast("已取消新增。");
        return;
    }

    if (confirm("確定要刪除此筆設定嗎？刪除後無法復原。") !== true) return;
    state.records = state.records.filter(r => r.id !== rec.id);
    state.editingRecord = null;
    state.selectedId = state.records[0]?.id || null;
    await persist();
    renderList();
    renderEditor(currentRecord());
    showToast("已刪除。");
};

els.label.oninput = () => { const r = currentRecord(); if (r) r.label = els.label.value; };
els.account.oninput = () => { const r = currentRecord(); if (r) r.account = els.account.value; };
els.password.oninput = () => { const r = currentRecord(); if (r) r.password = els.password.value; };

// 匯出/匯入
els.exportBtn.onclick = async () => {
    const { records = [] } = await chrome.storage.local.get(["records"]);
    const blob = new Blob([JSON.stringify({ records }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "autofill-records.json";
    a.click();
    URL.revokeObjectURL(url);
};

els.importBtn.onclick = () => els.importFile.click();

els.importFile.onchange = async () => {
    const file = els.importFile.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
        const data = JSON.parse(text);
        if (!data || !Array.isArray(data.records)) throw new Error("格式不正確（需要 { records: [...] }）");
        state.records = data.records.map(upgradeRecord);
        state.selectedId = state.records[0]?.id || null;
        state.unsavedRecord = null; // 匯入時清除草稿
        await persist();
        renderList();
        renderEditor(currentRecord());
        showToast("已匯入。");
    } catch (e) {
        showToast("匯入失敗：" + String(e.message || e));
    } finally {
        els.importFile.value = "";
    }
};

// 偵測目前頁面欄位
if (els.detectBtn) {
    els.detectBtn.onclick = async () => {
        const rec = currentRecord();
        if (!rec) return;

        showToast("偵測中...（請保持你要偵測的分頁為作用中）");
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
            showToast("找不到作用中分頁");
            return;
        }

        let res;
        try {
            res = await chrome.tabs.sendMessage(tab.id, { action: "detectFields" });
        } catch (e) {
            showToast("偵測失敗：" + String(e));
            return;
        }

        if (!res?.ok) {
            showToast("偵測失敗：" + (res?.error || "未知錯誤"));
            return;
        }

        // 若沒有網址規則，順便帶入
        if (!getUrlPatterns(rec).length) {
            const suggestion = suggestPattern(tab.url || "");
            rec.urlPatterns = suggestion ? [suggestion] : [];
            renderUrlPatterns(rec);
        }

        // 合併 selectors（不會覆蓋你原本填的）
        rec.accountSelectors = mergeSelectors(rec.accountSelectors, res.accountSelectors);
        rec.passwordSelectors = mergeSelectors(rec.passwordSelectors, res.passwordSelectors);

        // 注意：偵測完同樣不自動 persist()，等待使用者按儲存按鈕
        renderEditor(rec);
        renderList();

        const otherHint = (res.otherCandidates?.length)
            ? `；其他候選：${res.otherCandidates.slice(0, 3).map(x => x.key).join(", ")}`
            : "";

        showToast(`偵測完成：帳號 ${res.accountSelectors.length}、密碼 ${res.passwordSelectors.length}${otherHint}`);
    };
}

load();