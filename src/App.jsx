import { useState, useMemo, useEffect } from "react";
import { gasGet, gasPost } from "./api";

// ─── Utilities ───
const generateId = () => Math.random().toString(36).substr(2, 9);
// 兄弟グループIDは名前をソートして常に同じIDになるよう正規化
const makeSiblingGroupId = (nameA, nameB) => "sib_" + [nameA, nameB].sort().join("_");

// レスポンス一覧を正規化し、兄弟が未提出の場合はペアレコードを自動生成
const buildResponsesWithSiblings = (rawResponses) => {
  const normalized = rawResponses.map((r) => ({
    ...r,
    preferredSlots: (r.preferredSlots || []).map((s) => String(s).trim()).filter(Boolean),
    allDayDates: (r.allDayDates || []).map(normalizeDate).filter(Boolean),
    siblingGroupId: r.hasSibling && r.siblingName ? makeSiblingGroupId(r.studentName, r.siblingName) : null,
  }));
  // 兄弟未提出のペアを自動生成
  const synthetic = [];
  normalized.forEach((r) => {
    if (!r.hasSibling || !r.siblingName || !r.siblingClass) return;
    const already = normalized.find((x) => x.studentName === r.siblingName && x.className === r.siblingClass)
      || synthetic.find((x) => x.studentName === r.siblingName && x.className === r.siblingClass);
    if (!already) {
      synthetic.push({
        id: "syn_" + generateId(),
        studentName: r.siblingName,
        parentName: "（自動生成）",
        className: r.siblingClass,
        hasSibling: true,
        siblingName: r.studentName,
        siblingClass: r.className,
        siblingGroupId: makeSiblingGroupId(r.siblingName, r.studentName),
        preferredSlots: r.preferredSlots || [],
        allDayDates: r.allDayDates.length > 0 ? [...r.allDayDates] : [],
        submittedAt: r.submittedAt,
        isSynthetic: true,
      });
    }
  });
  return [...normalized, ...synthetic];
};
const normalizeDate = (d) => {
  if (!d) return null;
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Google Sheets serial number (days since 1899-12-30)
  const num = Number(s);
  if (!isNaN(num) && num > 30000 && num < 70000) {
    const epoch = new Date(1899, 11, 30);
    epoch.setDate(epoch.getDate() + Math.round(num));
    return `${epoch.getFullYear()}-${String(epoch.getMonth() + 1).padStart(2, "0")}-${String(epoch.getDate()).padStart(2, "0")}`;
  }
  // Try general date parsing (e.g. "3/26/2026", "2026/03/26")
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
  }
  return null;
};
const formatDate = (dateStr) => {
  const normalized = normalizeDate(dateStr) || dateStr;
  const d = new Date(normalized + "T00:00:00");
  if (isNaN(d.getTime())) return String(dateStr);
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getMonth() + 1}/${d.getDate()}（${days[d.getDay()]}）`;
};
const formatTime = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
};
const generateSlots = (dates, startTime, endTime, slotMinutes, excludedSlots) => {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const slots = [];
  dates.forEach((date) => {
    for (let t = startMin; t + slotMinutes <= endMin; t += slotMinutes) {
      const key = `${date}_${formatTime(t)}`;
      if (!excludedSlots.includes(key)) slots.push({ date, time: formatTime(t), key, minutes: t });
    }
  });
  return slots;
};

// ─── Colors & Styles ───
const C = {
  bg: "#F7F5F0", card: "#FFFFFF", primary: "#2B6B5E", primaryLight: "#E8F3F0",
  primaryDark: "#1E4D43", accent: "#D4A853", accentLight: "#FFF3DC",
  text: "#2C2C2C", textSub: "#6B6B6B", border: "#E5E0D8",
  danger: "#C44B3F", dangerLight: "#FDE8E6", success: "#2B8A3E", successLight: "#E6F5EA",
  selected: "#2B6B5E", selectedText: "#FFFFFF",
  heatLow: "#E8F3F0", heatMid: "#A8D8C8", heatHigh: "#2B6B5E",
  siblingColors: ["#5C7CFA", "#E67E22", "#9B59B6", "#1ABC9C", "#E74C3C"],
};
const CLASS_OPTIONS = [{ value: "", label: "全クラス" }, ...[1,2,3,4,5,6].flatMap((g) => [1,2,3].map((c) => ({ value: `${g}年${c}組`, label: `${g}年${c}組` })))];
const font = `'Noto Sans JP', 'Hiragino Kaku Gothic ProN', 'Meiryo', sans-serif`;
const btn = (bg, color, size = "md") => ({
  background: bg, color, border: "none", borderRadius: 8,
  padding: size === "sm" ? "6px 14px" : size === "lg" ? "14px 32px" : "10px 22px",
  fontSize: size === "sm" ? 13 : size === "lg" ? 16 : 14,
  fontWeight: 600, fontFamily: font, cursor: "pointer",
  transition: "all 0.15s ease", display: "inline-flex", alignItems: "center", gap: 6,
});
const cardStyle = {
  background: C.card, borderRadius: 14, padding: 24,
  boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: `1px solid ${C.border}`,
};
const inputStyle = {
  width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`,
  fontSize: 14, fontFamily: font, color: C.text, outline: "none", boxSizing: "border-box",
};
const labelStyle = { fontSize: 13, fontWeight: 600, color: C.textSub, marginBottom: 6, display: "block" };

// ─── Small Components ───
function Spinner({ message }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 12 }}>
      <div style={{ width: 36, height: 36, border: `3px solid ${C.border}`, borderTop: `3px solid ${C.primary}`, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <span style={{ fontSize: 14, color: C.textSub }}>{message || "読み込み中..."}</span>
    </div>
  );
}

function Toast({ message, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  if (!message) return null;
  const bg = type === "error" ? C.dangerLight : type === "success" ? C.successLight : C.accentLight;
  const color = type === "error" ? C.danger : type === "success" ? C.success : C.accent;
  return (
    <div style={{
      position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
      background: bg, color, padding: "12px 24px", borderRadius: 10, fontSize: 14,
      fontWeight: 600, fontFamily: font, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", zIndex: 1000,
      border: `1px solid ${color}`, maxWidth: "90vw",
    }}>{message}</div>
  );
}

// ─── Assignment Algorithm ───

// Returns the effective preferred slots for a response:
// specific time slots + all slots on all-day dates
function getEffectiveSlots(r, allSlots) {
  const specific = r.preferredSlots || [];
  const allDay = (r.allDayDates || []).flatMap((date) =>
    allSlots.filter((s) => s.date === date).map((s) => s.key)
  );
  return [...new Set([...specific, ...allDay])];
}

function runAssignment(responses, allSlots) {
  const assigned = {};
  const unassigned = [];
  // クラスごとに独立した使用済みスロット管理
  const usedByClass = {};
  const getUsed = (cls) => { if (!usedByClass[cls]) usedByClass[cls] = new Set(); return usedByClass[cls]; };
  const assignSlot = (rId, cls, key) => { assigned[rId] = key; getUsed(cls).add(key); };
  const availableFor = (cls) => allSlots.filter((s) => !getUsed(cls).has(s.key));

  const slotsByDate = {};
  allSlots.forEach((s) => { if (!slotsByDate[s.date]) slotsByDate[s.date] = []; slotsByDate[s.date].push(s); });

  const siblingGroups = {};
  const standalone = [];
  responses.forEach((r) => {
    if (r.hasSibling && r.siblingGroupId) {
      if (!siblingGroups[r.siblingGroupId]) siblingGroups[r.siblingGroupId] = [];
      siblingGroups[r.siblingGroupId].push(r);
    } else { standalone.push(r); }
  });

  Object.entries(siblingGroups).forEach(([, members]) => {
    const isSameClass = members.every((m) => m.className === members[0].className);
    let placed = false;

    if (isSameClass) {
      // 同クラス：同日連続スロットに配置（全員が希望枠に入る場合のみ）
      const cls = members[0].className;
      for (const date of Object.keys(slotsByDate)) {
        if (placed) break;
        const dateSlots = slotsByDate[date].filter((s) => !getUsed(cls).has(s.key));
        for (let i = 0; i <= dateSlots.length - members.length; i++) {
          const consecutive = dateSlots.slice(i, i + members.length);
          const best = findBestSiblingMatch(members, consecutive, allSlots);
          if (best) {
            const score = best.filter(({ response, slot }) => getEffectiveSlots(response, allSlots).includes(slot.key)).length;
            // 全員が希望枠に入る場合のみ配置（score === members.length）
            if (score === members.length) {
              best.forEach(({ response, slot }) => assignSlot(response.id, cls, slot.key));
              placed = true; break;
            }
          }
        }
      }
    } else {
      // 異クラス：全員が同日の希望枠に入れる日を探す
      let bestDate = null; let bestScore = -1;
      for (const date of Object.keys(slotsByDate)) {
        const allHavePref = members.every((m) =>
          (slotsByDate[date] || []).some((s) => !getUsed(m.className).has(s.key) && getEffectiveSlots(m, allSlots).includes(s.key))
        );
        if (!allHavePref) continue;
        const score = members.reduce((sum, m) => {
          return sum + ((slotsByDate[date] || []).filter((s) => !getUsed(m.className).has(s.key) && getEffectiveSlots(m, allSlots).includes(s.key)).length);
        }, 0);
        if (score > bestScore) { bestScore = score; bestDate = date; }
      }
      if (bestDate !== null) {
        const dateSlots = slotsByDate[bestDate] || [];
        const tempAssigned = {};
        let allOk = true;
        for (const m of members) {
          const pref = dateSlots.filter((s) =>
            !getUsed(m.className).has(s.key) &&
            !Object.values(tempAssigned).includes(s.key) &&
            getEffectiveSlots(m, allSlots).includes(s.key)
          );
          // 希望枠がある場合のみ配置（希望外への強制配置なし）
          if (pref[0]) { tempAssigned[m.id] = { cls: m.className, key: pref[0].key }; }
          else { allOk = false; break; }
        }
        if (allOk) {
          Object.entries(tempAssigned).forEach(([rId, { cls, key }]) => assignSlot(rId, cls, key));
          placed = true;
        }
      }
    }
    if (!placed) members.forEach((m) => standalone.push(m));
  });

  // 時間指定あり優先→終日のみ後回し
  standalone.sort((a, b) => {
    const aS = (a.preferredSlots || []).length > 0, bS = (b.preferredSlots || []).length > 0;
    if (aS && !bS) return -1; if (!aS && bS) return 1;
    return getEffectiveSlots(a, allSlots).length - getEffectiveSlots(b, allSlots).length;
  });

  standalone.forEach((r) => {
    const effective = getEffectiveSlots(r, allSlots);
    const used = getUsed(r.className);
    const available = effective.filter((s) => !used.has(s));
    if (available.length > 0) {
      // 同クラス内で競合が少ないスロットを優先
      const classResps = responses.filter((resp) => resp.className === r.className);
      const pop = {};
      available.forEach((s) => { pop[s] = classResps.filter((resp) => getEffectiveSlots(resp, allSlots).includes(s)).length; });
      available.sort((a, b) => pop[a] - pop[b]);
      assignSlot(r.id, r.className, available[0]);
    } else {
      // 希望枠が埋まっている場合は強制配置せず「割り振り不可」に追加
      unassigned.push({ ...r, reason: "希望枠が埋まっています" });
    }
  });
  return { assigned, unassigned };
}

function findBestSiblingMatch(members, slots, allSlots) {
  if (members.length === 0) return [];
  if (members.length === 1) return [{ response: members[0], slot: slots[0] }];
  const perms = permutations(members);
  let bestScore = -1, bestMatch = null;
  perms.forEach((perm) => {
    let score = 0;
    perm.forEach((m, idx) => { if (getEffectiveSlots(m, allSlots).includes(slots[idx].key)) score++; });
    if (score > bestScore) { bestScore = score; bestMatch = perm.map((m, idx) => ({ response: m, slot: slots[idx] })); }
  });
  return bestMatch;
}
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const result = [];
  arr.forEach((item, i) => {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    permutations(rest).forEach((perm) => result.push([item, ...perm]));
  });
  return result;
}

// ═══════════════════════════════════════════
//  Main App
// ═══════════════════════════════════════════
export default function App() {
  const [page, setPage] = useState("home");
  const [event, setEvent] = useState(null);
  const [responses, setResponses] = useState([]);
  const [allSlots, setAllSlots] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [unassigned, setUnassigned] = useState([]);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState("GASから設定を読み込み中...");
  const [toast, setToast] = useState({ message: "", type: "" });
  const [parentView, setParentView] = useState(false);
  const [isParentMode, setIsParentMode] = useState(false); // URLパラメータ ?parent=1 で起動
  const [parentForm, setParentForm] = useState({
    studentName: "", className: "",
    hasSibling: false, siblingName: "", siblingClass: "", selectedSlots: [], allDayDates: [],
  });

  useEffect(() => {
    // URLパラメータ ?parent=1 の場合は保護者専用モード
    const params = new URLSearchParams(window.location.search);
    if (params.get("parent") === "1") {
      setIsParentMode(true);
      setParentView(true);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const isParent = new URLSearchParams(window.location.search).get("parent") === "1";
        // 3つのGASリクエストを同時並行で実行（大幅に高速化）
        const [data, respData, assignData] = await Promise.all([
          gasGet("getEvent"),
          gasGet("getResponses"),
          isParent ? Promise.resolve({}) : gasGet("getAssignments"),
        ]);
        if (data.error || !data.name) { setPage("home"); setLoading(false); return; }
        const normalizeTime = (t) => {
          if (!t) return "14:00";
          if (t.includes("T")) {
             const d = new Date(t);
             return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
          }
          return t;
        };
        data.startTime = normalizeTime(data.startTime);
        data.endTime = normalizeTime(data.endTime);
        const slots = generateSlots(data.dates, data.startTime, data.endTime, data.slotMinutes, data.excludedSlots || []);
        setEvent({ id: "gas", ...data });
        setAllSlots(slots);
        setConfirmed(data.status === "confirmed");

        if (respData.responses) {
          setResponses(buildResponsesWithSiblings(respData.responses));
        }

        if (!isParent) {
          if (assignData.assignments?.length > 0) {
            const map = {};
            assignData.assignments.forEach((a) => { map[a.responseId] = a.slotKey; });
            setAssignments(map);
            setPage("assignment");
          } else {
            setPage("dashboard");
          }
        }
      } catch (e) {
        console.error("GAS load error:", e);
        setPage("home");
      }
      setLoading(false);
    })();
  }, []);

  const showToast = (message, type = "success") => setToast({ message, type });

  const handleCreateEvent = async (config) => {
    setLoading(true); setLoadingMsg("イベントをGASに保存中...");
    try {
      const result = await gasPost({ action: "initEvent", ...config });
      if (result.error) { showToast(result.error, "error"); setLoading(false); return; }
      setEvent({ id: "gas", ...config, status: "collecting" });
      setAllSlots(generateSlots(config.dates, config.startTime, config.endTime, config.slotMinutes, config.excludedSlots));
      setResponses([]); setAssignments({}); setConfirmed(false);
      setPage("dashboard");
      showToast("イベントを作成しました");
    } catch (e) { showToast("GASへの保存に失敗: " + e.message, "error"); }
    setLoading(false);
  };

  const handleParentSubmit = async () => {
    setLoading(true); setLoadingMsg("回答を送信中...");
    try {
      const result = await gasPost({
        action: "submitResponse",
        studentName: parentForm.studentName, parentName: "",
        className: parentForm.className, hasSibling: parentForm.hasSibling,
        siblingName: parentForm.siblingName || "", siblingClass: parentForm.siblingClass || "",
        preferredSlots: parentForm.selectedSlots, allDayDates: parentForm.allDayDates,
      });
      if (result.error) { showToast(result.error, "error"); setLoading(false); return; }
      const newResp = {
        id: result.responseId || generateId(),
        studentName: parentForm.studentName, parentName: "",
        className: parentForm.className, hasSibling: parentForm.hasSibling,
        siblingName: parentForm.siblingName, siblingClass: parentForm.siblingClass,
        siblingGroupId: parentForm.hasSibling ? makeSiblingGroupId(parentForm.studentName, parentForm.siblingName) : null,
        preferredSlots: parentForm.selectedSlots, allDayDates: parentForm.allDayDates, submittedAt: new Date().toISOString(),
      };
      setResponses((prev) => [...prev.filter((r) => !(r.studentName === newResp.studentName && r.className === newResp.className)), newResp]);
      setParentView(false);
      setParentForm({ studentName: "", className: "", hasSibling: false, siblingName: "", siblingClass: "", selectedSlots: [], allDayDates: [] });
      showToast(result.updated ? "回答を更新しました" : "回答を送信しました");
    } catch (e) { showToast("送信失敗: " + e.message, "error"); }
    setLoading(false);
  };

  const handleManualAdd = async (formData) => {
    setLoading(true); setLoadingMsg("手動追加中...");
    try {
      const result = await gasPost({
        action: "submitResponse",
        studentName: formData.studentName, parentName: "（手動追加）",
        className: formData.className, hasSibling: formData.hasSibling,
        siblingName: formData.siblingName || "", siblingClass: formData.siblingClass || "",
        preferredSlots: formData.selectedSlots, allDayDates: formData.allDayDates,
      });
      if (result.error) { showToast(result.error, "error"); setLoading(false); return; }
      const newResp = {
        id: result.responseId || generateId(),
        studentName: formData.studentName, parentName: "（手動追加）",
        className: formData.className, hasSibling: formData.hasSibling,
        siblingName: formData.siblingName, siblingClass: formData.siblingClass,
        siblingGroupId: formData.hasSibling ? makeSiblingGroupId(formData.studentName, formData.siblingName) : null,
        preferredSlots: formData.selectedSlots, allDayDates: formData.allDayDates, submittedAt: new Date().toISOString(),
      };
      setResponses((prev) => [...prev.filter((r) => !(r.studentName === newResp.studentName && r.className === newResp.className)), newResp]);
      showToast(`${formData.studentName} さんを追加しました`);
    } catch (e) { showToast("追加失敗: " + e.message, "error"); }
    setLoading(false);
  };

  const handleRefresh = async () => {
    setLoading(true); setLoadingMsg("最新データを取得中...");
    try {
      const respData = await gasGet("getResponses");
      if (respData.responses) {
        const resps = buildResponsesWithSiblings(respData.responses);
        setResponses(resps);
        showToast(`${resps.length}件の回答を読み込みました`);
      }
    } catch (e) { showToast("取得失敗", "error"); }
    setLoading(false);
  };

  const handleRunAssignment = () => {
    const valid = responses.filter((r) => r.submittedAt && ((r.preferredSlots?.length || 0) > 0 || (r.allDayDates?.length || 0) > 0));
    if (valid.length === 0) { showToast("回答データがありません", "error"); return; }
    const result = runAssignment(valid, allSlots);
    setAssignments(result.assigned); setUnassigned(result.unassigned);
    setPage("assignment");
    showToast(`${Object.keys(result.assigned).length}名を割り当てました`);
  };

  const handleSaveAssignments = async (confirm = false) => {
    setLoading(true); setLoadingMsg(confirm ? "日程を確定中..." : "割り当てを保存中...");
    try {
      const arr = Object.entries(assignments).map(([rId, sKey]) => {
        const r = responses.find((x) => x.id === rId);
        const inPref = r ? (getEffectiveSlots(r, allSlots).includes(sKey) || r.isSynthetic) : false;
        return { responseId: rId, studentName: r?.studentName || "", className: r?.className || "", slotKey: sKey, inPreference: inPref, siblingGroupId: r?.siblingGroupId || "" };
      });
      const result = await gasPost({ action: "saveAssignments", assignments: arr, confirm });
      if (result.error) { showToast(result.error, "error"); setLoading(false); return; }
      if (confirm) { setConfirmed(true); setEvent((p) => ({ ...p, status: "confirmed" })); showToast("日程を確定しました！"); }
      else showToast("割り当てを保存しました");
    } catch (e) { showToast("保存失敗: " + e.message, "error"); }
    setLoading(false);
  };

  const handleSwap = (id1, id2) => setAssignments((p) => { const n = { ...p }; const t = n[id1]; n[id1] = n[id2]; n[id2] = t; return n; });
  const handleMove = (responseId, slotKey) => {
    setAssignments((p) => ({ ...p, [responseId]: slotKey }));
    setUnassigned((p) => p.filter((r) => r.id !== responseId));
  };
  const handleEditAssignments = () => { setConfirmed(false); setEvent((p) => ({ ...p, status: "collecting" })); };

  const handleCopyParentUrl = () => {
    const base = `${window.location.origin}${window.location.pathname}`;
    const url = `${base}?parent=1`;
    navigator.clipboard.writeText(url).then(() => showToast("保護者用URLをコピーしました", "success")).catch(() => {
      // フォールバック：テキストエリアで手動コピー
      const ta = document.createElement("textarea");
      ta.value = url; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
      showToast("保護者用URLをコピーしました", "success");
    });
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: font, display: "flex", justifyContent: "center", alignItems: "center" }}>
      <Spinner message={loadingMsg} />
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: font, color: C.text }}>
      <header style={{
        background: C.primary, color: "#fff", padding: "0 20px", height: 56,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: isParentMode ? "default" : "pointer" }}
          onClick={() => { if (!isParentMode && event) { setPage("dashboard"); setParentView(false); } }}>
          <span style={{ fontSize: 22 }}>📅</span>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>面談日程くん</span>
          {isParentMode && event && <span style={{ fontSize: 13, fontWeight: 400, opacity: 0.85, marginLeft: 4 }}>— {event.name}</span>}
        </div>
        {/* 保護者モード：ナビなし */}
        {!isParentMode && event && !parentView && (
          <nav style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {[
              { key: "dashboard", label: "📊 ダッシュボード" },
              { key: "assignment", label: "🗓 割り当て" },
              { key: "preview", label: "👤 保護者フォーム" },
              { key: "home", label: "⚙️ イベント設定" },
            ].map((tab) => (
              <button key={tab.key} onClick={() => tab.key === "preview" ? setParentView(true) : setPage(tab.key)}
                style={{ ...btn("transparent", "rgba(255,255,255,0.8)", "sm"), borderBottom: page === tab.key ? "2px solid #fff" : "2px solid transparent", borderRadius: 0, color: page === tab.key ? "#fff" : "rgba(255,255,255,0.7)", fontWeight: page === tab.key ? 700 : 400, fontSize: 13 }}>
                {tab.label}
              </button>
            ))}
            {/* 保護者用URLコピーボタン */}
            <button onClick={handleCopyParentUrl}
              style={{ ...btn("rgba(255,255,255,0.15)", "#fff", "sm"), border: "1px solid rgba(255,255,255,0.35)", borderRadius: 8, marginLeft: 8 }}>
              🔗 保護者用URL
            </button>
          </nav>
        )}
        {!isParentMode && parentView && <button onClick={() => setParentView(false)} style={btn("rgba(255,255,255,0.2)", "#fff", "sm")}>✕ 教員画面に戻る</button>}
      </header>

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px" }}>
        {parentView ? (
          <ParentForm event={event} allSlots={allSlots} form={parentForm} setForm={setParentForm} onSubmit={handleParentSubmit} confirmed={confirmed} assignments={assignments} responses={responses} loading={loading} />
        ) : page === "home" ? (
          <EventSetup onCreate={handleCreateEvent} existingEvent={event} />
        ) : page === "dashboard" ? (
          <Dashboard event={event} responses={responses} allSlots={allSlots} onRunAssignment={handleRunAssignment} onOpenParentForm={() => setParentView(true)} onRefresh={handleRefresh} onManualAdd={handleManualAdd} />
        ) : page === "assignment" ? (
          <AssignmentView event={event} responses={responses} allSlots={allSlots} assignments={assignments} unassigned={unassigned} onSwap={handleSwap} onMove={handleMove} onConfirm={() => handleSaveAssignments(true)} confirmed={confirmed} onRerun={handleRunAssignment} onSave={() => handleSaveAssignments(false)} onEdit={handleEditAssignments} />
        ) : null}
      </main>
      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: "", type: "" })} />
    </div>
  );
}

// ═══════════════════════════════════════════
//  Event Setup Page
// ═══════════════════════════════════════════
function EventSetup({ onCreate, existingEvent }) {
  const [name, setName] = useState(existingEvent?.name || "");
  const [dates, setDates] = useState(existingEvent?.dates || []);
  const [dateInput, setDateInput] = useState("");
  const [startTime, setStartTime] = useState(existingEvent?.startTime || "14:00");
  const [endTime, setEndTime] = useState(existingEvent?.endTime || "17:00");
  const [slotMinutes, setSlotMinutes] = useState(existingEvent?.slotMinutes || 15);
  const [excludedSlots, setExcludedSlots] = useState(existingEvent?.excludedSlots || []);

  const previewSlots = useMemo(() => dates.length === 0 ? [] : generateSlots(dates, startTime, endTime, slotMinutes, []), [dates, startTime, endTime, slotMinutes]);
  const slotsByDate = useMemo(() => { const g = {}; previewSlots.forEach((s) => { if (!g[s.date]) g[s.date] = []; g[s.date].push(s); }); return g; }, [previewSlots]);
  const totalAvailable = previewSlots.length - excludedSlots.length;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: C.primaryDark }}>{existingEvent ? "イベント設定を変更" : "新しい面談イベントを作成"}</h1>
        <p style={{ color: C.textSub, fontSize: 14, margin: "6px 0 0" }}>実施日・時間帯を設定し、保護者アンケートを開始します</p>
        {existingEvent && <div style={{ marginTop: 10, padding: "8px 14px", background: C.accentLight, borderRadius: 8, fontSize: 13, color: C.accent, fontWeight: 600 }}>⚠ 再作成すると既存データはリセットされます</div>}
      </div>
      <div style={{ display: "grid", gap: 20 }}>
        <div style={cardStyle}>
          <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>基本情報</h3>
          <div style={{ marginBottom: 16 }}><label style={labelStyle}>イベント名</label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="例：1学期 個人懇談 2年1組" /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div><label style={labelStyle}>開始時刻</label><input style={inputStyle} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
            <div><label style={labelStyle}>終了時刻</label><input style={inputStyle} type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
            <div><label style={labelStyle}>1コマ（分）</label>
              <select style={inputStyle} value={slotMinutes} onChange={(e) => setSlotMinutes(Number(e.target.value))}>
                {[10, 15, 20, 30].map((m) => <option key={m} value={m}>{m}分</option>)}
              </select>
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>実施日</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {dates.map((d) => (
              <span key={d} style={{ background: C.primaryLight, color: C.primary, padding: "6px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
                {formatDate(d)}<span style={{ cursor: "pointer", opacity: 0.6, fontSize: 16 }} onClick={() => setDates(dates.filter((x) => x !== d))}>×</span>
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ ...inputStyle, flex: 1 }} type="date" value={dateInput} onChange={(e) => setDateInput(e.target.value)} />
            <button style={btn(C.primary, "#fff", "sm")} onClick={() => { if (dateInput && !dates.includes(dateInput)) { setDates([...dates, dateInput].sort()); setDateInput(""); } }}>追加</button>
          </div>
        </div>

        {dates.length > 0 && (
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>タイムスロット設定</h3>
              <span style={{ fontSize: 13, color: C.textSub }}>合計 <strong style={{ color: C.primary }}>{totalAvailable}</strong> 枠</span>
            </div>
            <p style={{ fontSize: 13, color: C.textSub, margin: "0 0 12px" }}>休憩枠をクリックして除外できます</p>
            <div style={{ overflowX: "auto" }}>
              <div style={{ display: "flex", gap: 12, minWidth: dates.length * 140 }}>
                {dates.map((date) => (
                  <div key={date} style={{ flex: 1, minWidth: 120 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, marginBottom: 8, textAlign: "center", padding: "6px 0", background: C.primaryLight, borderRadius: 8 }}>{formatDate(date)}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {(slotsByDate[date] || []).map((slot) => {
                        const excluded = excludedSlots.includes(slot.key);
                        return (<button key={slot.key} onClick={() => setExcludedSlots((p) => excluded ? p.filter((k) => k !== slot.key) : [...p, slot.key])} style={{ padding: "7px 8px", fontSize: 13, fontFamily: font, border: `1px solid ${excluded ? C.danger : C.border}`, borderRadius: 6, background: excluded ? C.dangerLight : "#fff", color: excluded ? C.danger : C.text, cursor: "pointer", textDecoration: excluded ? "line-through" : "none", textAlign: "center" }}>{slot.time}</button>);
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <button style={{ ...btn(C.primary, "#fff", "lg"), width: "100%", justifyContent: "center", opacity: dates.length === 0 || !name ? 0.5 : 1, fontSize: 16, padding: "16px 0", borderRadius: 12 }} disabled={dates.length === 0 || !name} onClick={() => onCreate({ name, dates, startTime, endTime, slotMinutes, excludedSlots })}>
          📅 イベントを作成（GASに保存）
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
//  Manual Add Modal
// ═══════════════════════════════════════════
function ManualAddModal({ event, allSlots, onSubmit, onClose }) {
  const slotsByDate = useMemo(() => { const g = {}; allSlots.forEach((s) => { if (!g[s.date]) g[s.date] = []; g[s.date].push(s); }); return g; }, [allSlots]);
  const [form, setForm] = useState({ studentName: "", className: "", hasSibling: false, siblingName: "", siblingClass: "", selectedSlots: [], allDayDates: [] });
  const isValid = form.studentName && form.className && (form.selectedSlots.length > 0 || form.allDayDates.length > 0);
  const toggleSlot = (key) => setForm((p) => ({ ...p, selectedSlots: p.selectedSlots.includes(key) ? p.selectedSlots.filter((k) => k !== key) : [...p.selectedSlots, key] }));
  const toggleAllDay = (date) => setForm((p) => ({ ...p, allDayDates: p.allDayDates.includes(date) ? p.allDayDates.filter((d) => d !== date) : [...p.allDayDates, date] }));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ ...cardStyle, width: "100%", maxWidth: 580, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>＋ 児童を手動追加</h3>
          <button onClick={onClose} style={{ ...btn("#fff", C.textSub, "sm"), border: `1px solid ${C.border}` }}>✕ 閉じる</button>
        </div>
        <p style={{ fontSize: 13, color: C.textSub, margin: "0 0 18px" }}>電話などで希望を確認した保護者の情報を直接入力してください。自動割り当ての対象に含まれます。</p>

        <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
          <div><label style={labelStyle}>児童名 *</label><input style={inputStyle} value={form.studentName} onChange={(e) => setForm({ ...form, studentName: e.target.value })} placeholder="例：田中 太郎" /></div>
          <div><label style={labelStyle}>クラス *</label>
            <select style={inputStyle} value={form.className} onChange={(e) => setForm({ ...form, className: e.target.value })}>
              <option value="">選択してください</option>
              {[1,2,3,4,5,6].flatMap((g) => [1,2,3].map((c) => <option key={`${g}-${c}`} value={`${g}年${c}組`}>{g}年{c}組</option>))}
            </select>
          </div>
          <div>
            <div onClick={() => setForm({ ...form, hasSibling: !form.hasSibling })} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "10px 14px", borderRadius: 8, background: form.hasSibling ? C.accentLight : "#F8F8F6", border: `1px solid ${form.hasSibling ? C.accent : C.border}` }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${form.hasSibling ? C.accent : C.border}`, background: form.hasSibling ? C.accent : "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14, fontWeight: 700 }}>{form.hasSibling ? "✓" : ""}</div>
              <span style={{ fontSize: 14, fontWeight: 600 }}>同じ学校に兄弟姉妹がいる</span>
            </div>
            {form.hasSibling && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
                <div><label style={labelStyle}>兄弟の名前</label><input style={inputStyle} value={form.siblingName} onChange={(e) => setForm({ ...form, siblingName: e.target.value })} placeholder="例：田中 次郎" /></div>
                <div><label style={labelStyle}>兄弟のクラス</label>
                  <select style={inputStyle} value={form.siblingClass} onChange={(e) => setForm({ ...form, siblingClass: e.target.value })}>
                    <option value="">選択してください</option>
                    {[1,2,3,4,5,6].flatMap((g) => [1,2,3].map((c) => <option key={`${g}-${c}`} value={`${g}年${c}組`}>{g}年{c}組</option>))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <label style={{ ...labelStyle, margin: 0 }}>希望日時 *</label>
            <span style={{ fontSize: 13, color: C.primary, fontWeight: 700 }}>
              {form.selectedSlots.length > 0 && `${form.selectedSlots.length} 枠`}
              {form.selectedSlots.length > 0 && form.allDayDates.length > 0 && " + "}
              {form.allDayDates.length > 0 && `${form.allDayDates.length} 日（終日）`}
              {form.selectedSlots.length === 0 && form.allDayDates.length === 0 && "未選択"}
            </span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <div style={{ display: "flex", gap: 8, minWidth: (event?.dates?.length || 3) * 110 }}>
              {(event?.dates || []).map((date) => {
                const isAllDay = form.allDayDates.includes(date);
                return (
                  <div key={date} style={{ flex: 1, minWidth: 100 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: isAllDay ? C.selectedText : C.primary, marginBottom: 6, textAlign: "center", padding: "5px 0", background: isAllDay ? C.selected : C.primaryLight, borderRadius: 8 }}>{formatDate(date)}</div>
                    <button onClick={() => toggleAllDay(date)} style={{ width: "100%", padding: "7px 4px", fontSize: 11, fontFamily: font, fontWeight: 700, border: isAllDay ? `2px solid ${C.selected}` : `1px dashed ${C.primary}`, borderRadius: 8, background: isAllDay ? C.selected : "#fff", color: isAllDay ? C.selectedText : C.primary, cursor: "pointer", textAlign: "center", marginBottom: 4 }}>
                      {isAllDay ? "✓ 終日OK" : "終日OK"}
                    </button>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, opacity: isAllDay ? 0.4 : 1 }}>
                      {(slotsByDate[date] || []).map((slot) => {
                        const sel = form.selectedSlots.includes(slot.key);
                        return (<button key={slot.key} onClick={() => !isAllDay && toggleSlot(slot.key)} style={{ padding: "8px 4px", fontSize: 12, fontFamily: font, fontWeight: 600, border: sel ? `2px solid ${C.selected}` : `1px solid ${C.border}`, borderRadius: 8, background: sel ? C.selected : "#fff", color: sel ? C.selectedText : C.text, cursor: isAllDay ? "default" : "pointer", textAlign: "center" }}>{slot.time}</button>);
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={onClose} style={{ ...btn("#fff", C.textSub, "md"), border: `1px solid ${C.border}`, flex: 1, justifyContent: "center" }}>キャンセル</button>
          <button onClick={() => isValid && onSubmit(form)} style={{ ...btn(C.primary, "#fff", "md"), flex: 2, justifyContent: "center", opacity: isValid ? 1 : 0.4 }} disabled={!isValid}>＋ 追加する</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
//  Dashboard Page
// ═══════════════════════════════════════════
function Dashboard({ event, responses, allSlots, onRunAssignment, onOpenParentForm, onRefresh, onManualAdd }) {
  const [filterClass, setFilterClass] = useState("");
  const [showManualAdd, setShowManualAdd] = useState(false);
  const submitted = responses.filter((r) => r.submittedAt);
  const filteredSubmitted = filterClass ? submitted.filter((r) => r.className === filterClass) : submitted;
  const slotCounts = useMemo(() => { const c = {}; allSlots.forEach((s) => { c[s.key] = 0; }); submitted.forEach((r) => { r.preferredSlots.forEach((k) => { if (c[k] !== undefined) c[k]++; }); }); return c; }, [submitted, allSlots]);
  const maxCount = Math.max(...Object.values(slotCounts), 1);
  const slotsByDate = useMemo(() => { const g = {}; allSlots.forEach((s) => { if (!g[s.date]) g[s.date] = []; g[s.date].push(s); }); return g; }, [allSlots]);
  const getHeatColor = (count) => { if (count === 0) return "#F5F5F5"; const r = count / maxCount; return r < 0.33 ? C.heatLow : r < 0.66 ? C.heatMid : C.heatHigh; };

  return (
    <div>
      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: C.primaryDark }}>{event.name}</h1>
          <p style={{ color: C.textSub, fontSize: 14, margin: "6px 0 0" }}>回答状況と希望分布</p>
        </div>
        <button onClick={onRefresh} style={{ ...btn("#fff", C.primary, "sm"), border: `1px solid ${C.primary}` }}>🔄 最新データ取得</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "回答済み", value: submitted.length, color: C.success, bg: C.successLight, icon: "✓" },
          { label: "全スロット", value: allSlots.length, color: C.primary, bg: C.primaryLight, icon: "📅" },
          { label: "兄弟あり", value: submitted.filter((r) => r.hasSibling).length, color: C.accent, bg: C.accentLight, icon: "👥" },
        ].map((s) => (
          <div key={s.label} style={{ ...cardStyle, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: s.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: s.color }}>{s.icon}</div>
            <div><div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div><div style={{ fontSize: 12, color: C.textSub }}>{s.label}</div></div>
          </div>
        ))}
      </div>

      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700 }}>希望分布ヒートマップ</h3>
        <p style={{ fontSize: 12, color: C.textSub, margin: "0 0 16px" }}>色が濃いほど希望が集中（数字＝希望者数）</p>
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "flex", gap: 12, minWidth: event.dates.length * 140 }}>
            {event.dates.map((date) => (
              <div key={date} style={{ flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, marginBottom: 8, textAlign: "center", padding: "6px 0", background: C.primaryLight, borderRadius: 8 }}>{formatDate(date)}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {(slotsByDate[date] || []).map((slot) => {
                    const count = slotCounts[slot.key] || 0;
                    return (<div key={slot.key} style={{ padding: "7px 8px", fontSize: 12, borderRadius: 6, background: getHeatColor(count), color: count / maxCount > 0.5 ? "#fff" : C.text, fontWeight: 600, display: "flex", justifyContent: "space-between" }}><span>{slot.time}</span><span>{count}</span></div>);
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 12, justifyContent: "center", fontSize: 11, color: C.textSub }}>
          {[["#F5F5F5", "0"], [C.heatLow, "少"], [C.heatMid, "中"], [C.heatHigh, "多"]].map(([bg, l]) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 14, height: 14, borderRadius: 3, background: bg, border: `1px solid ${C.border}` }} /> {l}</span>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <button style={{ ...btn(C.primary, "#fff"), flex: 1, justifyContent: "center" }} onClick={onRunAssignment}>🤖 自動割り当て実行</button>
        <button style={{ ...btn(C.card, C.primary), flex: 1, justifyContent: "center", border: `1px solid ${C.primary}` }} onClick={onOpenParentForm}>👁 保護者フォーム確認</button>
      </div>

      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            回答一覧（{filteredSubmitted.length}{filterClass ? `/${submitted.length}` : ""}件）
          </h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)}
              style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 13 }}>
              {CLASS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button onClick={() => setShowManualAdd(true)} style={{ ...btn(C.primary, "#fff", "sm"), whiteSpace: "nowrap" }}>＋ 手動追加</button>
          </div>
        </div>
        {filteredSubmitted.length === 0 ? (
          <p style={{ textAlign: "center", color: C.textSub, padding: 20 }}>
            {submitted.length === 0 ? "まだ回答がありません。保護者にフォームリンクを配布してください。" : "該当するクラスの回答がありません。"}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ borderBottom: `2px solid ${C.border}` }}>
                {["児童名", "クラス", "兄弟", "希望枠数", "回答日"].map((h) => (<th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: C.textSub, fontSize: 12 }}>{h}</th>))}
              </tr></thead>
              <tbody>{filteredSubmitted.map((r) => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "8px 10px", fontWeight: 600 }}>
                    {r.studentName}
                    {r.parentName === "（手動追加）" && <span style={{ fontSize: 10, color: C.accent, background: C.accentLight, borderRadius: 6, padding: "1px 6px", marginLeft: 6, fontWeight: 600 }}>手動</span>}
                    {r.isSynthetic && <span style={{ fontSize: 10, color: "#7c3aed", background: "#ede9fe", borderRadius: 6, padding: "1px 6px", marginLeft: 6, fontWeight: 600 }}>自動</span>}
                  </td>
                  <td style={{ padding: "8px 10px" }}>{r.className}</td>
                  <td style={{ padding: "8px 10px" }}>{r.hasSibling && <span style={{ fontSize: 11, background: C.accentLight, color: C.accent, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>兄弟あり</span>}</td>
                  <td style={{ padding: "8px 10px" }}>{(r.preferredSlots?.length || 0) > 0 ? `${r.preferredSlots.length} 枠` : (r.allDayDates || []).length > 0 ? `${r.allDayDates.length} 日（終日）` : r.isSynthetic ? "（兄弟に準ずる）" : "—"}</td>
                  <td style={{ padding: "8px 10px", color: C.textSub }}>{new Date(r.submittedAt).toLocaleDateString("ja-JP")}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      {showManualAdd && (
        <ManualAddModal event={event} allSlots={allSlots}
          onSubmit={(formData) => { onManualAdd(formData); setShowManualAdd(false); }}
          onClose={() => setShowManualAdd(false)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
//  Assignment View Page
// ═══════════════════════════════════════════
function AssignmentView({ event, responses, allSlots, assignments, unassigned, onSwap, onMove, onConfirm, confirmed, onRerun, onSave, onEdit }) {
  const [swapMode, setSwapMode] = useState(null);
  const [tab, setTab] = useState("timetable");
  const [filterClass, setFilterClass] = useState("");
  const slotsByDate = useMemo(() => { const g = {}; allSlots.forEach((s) => { if (!g[s.date]) g[s.date] = []; g[s.date].push(s); }); return g; }, [allSlots]);
  const responseMap = useMemo(() => { const m = {}; responses.forEach((r) => { m[r.id] = r; }); return m; }, [responses]);
  // クラス別独立タイムテーブル：フィルター中のクラスの割り当てのみ表示
  const slotAssignment = useMemo(() => {
    const m = {};
    Object.entries(assignments).forEach(([rId, sKey]) => {
      const r = responseMap[rId]; if (!r) return;
      if (!filterClass || r.className === filterClass) {
        if (!m[sKey]) m[sKey] = rId; // 全クラス表示時は最初の1件のみ（概観用）
      }
    });
    return m;
  }, [assignments, responseMap, filterClass]);
  const siblingColorMap = useMemo(() => { const m = {}; let ci = 0; responses.forEach((r) => { if (r.siblingGroupId && !m[r.siblingGroupId]) { m[r.siblingGroupId] = C.siblingColors[ci % C.siblingColors.length]; ci++; } }); return m; }, [responses]);

  // Detect sibling groups not placed on the same date
  const siblingMismatchIds = useMemo(() => {
    const groups = {};
    responses.forEach((r) => { if (r.siblingGroupId) { if (!groups[r.siblingGroupId]) groups[r.siblingGroupId] = []; groups[r.siblingGroupId].push(r); } });
    const ids = new Set();
    Object.values(groups).forEach((members) => {
      const dates = members.map((m) => assignments[m.id]?.split("_")[0]).filter(Boolean);
      const uniqueDates = new Set(dates);
      if (uniqueDates.size > 1 || dates.length < members.length) members.forEach((m) => ids.add(m.id));
    });
    return ids;
  }, [responses, assignments]);

  // 統計：フィルター中のクラスのみ or 全体
  const statsEntries = useMemo(() =>
    Object.entries(assignments).filter(([rId]) => !filterClass || responseMap[rId]?.className === filterClass),
    [assignments, responseMap, filterClass]
  );
  const assignedCount = statsEntries.length;
  const inPrefCount = statsEntries.filter(([rId, sKey]) => {
    const r = responseMap[rId]; if (!r) return false;
    return r.preferredSlots?.includes(sKey) || (r.allDayDates || []).includes(sKey?.split("_")[0]);
  }).length;
  const satisfactionRate = assignedCount > 0 ? Math.round((inPrefCount / assignedCount) * 100) : 0;

  // クラス別独立タイムテーブル：常に全日付・全スロットを表示
  const filteredDates = event.dates;
  const getSlotsForDate = (date) => slotsByDate[date] || [];

  // クラスフィルター：一覧表用
  const filteredAssignedResponses = useMemo(() => {
    const base = responses.filter((r) => assignments[r.id]);
    return filterClass ? base.filter((r) => r.className === filterClass) : base;
  }, [responses, assignments, filterClass]);

  // 希望枠外の児童（割り当て済みだが希望に一致していない）
  const outOfPrefResponses = useMemo(() => {
    return filteredAssignedResponses.filter((r) => {
      if (r.isSynthetic) return false; // 自動生成は除外
      const sKey = assignments[r.id];
      const inPref = r.preferredSlots?.includes(sKey) || (r.allDayDates || []).includes(sKey?.split("_")[0]);
      return !inPref;
    });
  }, [filteredAssignedResponses, assignments]);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: C.primaryDark }}>割り当て結果</h1>
        <p style={{ color: C.textSub, fontSize: 14, margin: "6px 0 0" }}>{confirmed ? "✅ 確定済み — スプレッドシートに保存されています" : "確認後、手動調整→保存/確定してください"}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "割り当て済み", value: `${assignedCount}人`, color: C.success, tabKey: null },
          { label: "希望枠一致率", value: `${satisfactionRate}%`, color: C.primary, tabKey: null },
          { label: "希望枠外", value: `${outOfPrefResponses.length}人`, color: outOfPrefResponses.length > 0 ? C.accent : C.textSub, tabKey: "outofpref" },
          { label: "割り振り不可", value: `${(filterClass ? unassigned.filter(r => r.className === filterClass) : unassigned).length}人`, color: (filterClass ? unassigned.filter(r => r.className === filterClass) : unassigned).length > 0 ? C.danger : C.textSub, tabKey: null },
        ].map((s) => (
          <div key={s.label}
            onClick={() => s.tabKey && setTab(s.tabKey)}
            style={{ ...cardStyle, padding: "14px 18px", textAlign: "center", cursor: s.tabKey ? "pointer" : "default",
              border: s.tabKey && tab === s.tabKey ? `2px solid ${s.color}` : cardStyle.border }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: C.textSub }}>{s.label}</div>
            {s.tabKey && <div style={{ fontSize: 10, color: s.color, marginTop: 2 }}>クリックで確認</div>}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        {[
          { key: "timetable", label: "タイムテーブル" },
          { key: "list", label: "一覧表" },
          { key: "outofpref", label: `希望枠外${outOfPrefResponses.length > 0 ? ` (${outOfPrefResponses.length})` : ""}`, warn: outOfPrefResponses.length > 0 },
        ].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ ...btn(tab === t.key ? (t.warn ? C.accent : C.primary) : "#fff", tab === t.key ? "#fff" : (t.warn ? C.accent : C.text), "sm"), border: tab === t.key ? "none" : `1px solid ${t.warn ? C.accent : C.border}` }}>{t.label}</button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: C.textSub, fontWeight: 600 }}>クラスで絞り込み：</span>
          <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)}
            style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 13 }}>
            {CLASS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {siblingMismatchIds.size > 0 && (
        <div style={{ ...cardStyle, marginBottom: 16, borderColor: C.accent, background: C.accentLight }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.accent, marginBottom: 6 }}>⚠ 兄弟が別日に配置されています</div>
          <div style={{ fontSize: 13, color: C.text }}>
            {[...new Set(responses.filter((r) => siblingMismatchIds.has(r.id)).map((r) => r.siblingGroupId))].map((gid) => {
              const members = responses.filter((r) => r.siblingGroupId === gid);
              return (<div key={gid} style={{ marginTop: 4 }}>{members.map((m) => { const sk = assignments[m.id]; return `${m.studentName}（${sk ? formatDate(sk.split("_")[0]) + " " + sk.split("_")[1] : "未割当"}）`; }).join(" / ")}</div>);
            })}
          </div>
          {!confirmed && <p style={{ fontSize: 12, color: C.accent, margin: "8px 0 0" }}>タイムテーブルで枠をクリックして入れ替えてください</p>}
        </div>
      )}

      {tab === "timetable" ? (
        <div style={{ ...cardStyle, marginBottom: 20 }}>
          {!confirmed && !swapMode && (
            <p style={{ fontSize: 12, color: C.accent, margin: "0 0 12px", fontWeight: 600 }}>
              💡 名前の枠をクリック→別の枠（空き枠でも可）をクリックで移動・入れ替え
              {!filterClass && <span style={{ color: C.danger, marginLeft: 8 }}>※ 手動調整はクラスを選択してから行ってください</span>}
            </p>
          )}
          {swapMode && (() => { const sr = responseMap[swapMode]; const isPlaceMode = unassigned.some((u) => u.id === swapMode); return (
            <div style={{ marginBottom: 12, padding: "10px 14px", background: isPlaceMode ? C.primaryLight : C.accentLight, border: `2px solid ${isPlaceMode ? C.primary : C.accent}`, borderRadius: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: isPlaceMode ? C.primary : C.accent }}>{isPlaceMode ? "📌" : "✋"} {sr?.studentName} さんを{isPlaceMode ? "配置" : "移動"}中</span>
              <span style={{ fontSize: 12, color: C.text }}>—</span>
              <span style={{ fontSize: 12, color: C.success, fontWeight: 600 }}>■ 緑の枠が希望日時</span>
              <span style={{ fontSize: 12, color: C.textSub }}>／ 希望外の枠にも移動できます</span>
              <button onClick={() => setSwapMode(null)} style={{ ...btn("#fff", C.textSub, "sm"), border: `1px solid ${C.border}`, marginLeft: "auto" }}>キャンセル</button>
            </div>
          ); })()}
          {!filterClass && (
            <div style={{ textAlign: "center", padding: "16px 0 8px", color: C.textSub, fontSize: 13 }}>
              上のプルダウンでクラスを選択すると、そのクラス担任のタイムテーブルが表示されます。<br />
              <span style={{ fontSize: 12 }}>（全クラス表示中はクラスごとに同一スロットを共有しない概観表示になります）</span>
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <div style={{ display: "flex", gap: 12, minWidth: filteredDates.length * 160 }}>
              {filteredDates.map((date) => {
                const swapResp = swapMode ? responseMap[swapMode] : null;
                const dateIsPreferred = swapResp && (swapResp.allDayDates || []).includes(date);
                const slotsToShow = getSlotsForDate(date);
                return (
                <div key={date} style={{ flex: 1, minWidth: 150 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: swapMode && dateIsPreferred ? C.selectedText : C.primary, marginBottom: 8, textAlign: "center", padding: "6px 0", background: swapMode && dateIsPreferred ? C.selected : C.primaryLight, borderRadius: 8 }}>{formatDate(date)}{swapMode && dateIsPreferred && " ✓終日"}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {slotsToShow.map((slot) => {
                      const rId = slotAssignment[slot.key]; const resp = rId ? responseMap[rId] : null;
                      const isSrc = swapMode === rId; const isTgt = swapMode && rId && swapMode !== rId;
                      const inPref = resp && (resp.preferredSlots?.includes(slot.key) || (resp.allDayDates || []).includes(slot.date));
                      const sibCol = resp?.siblingGroupId ? siblingColorMap[resp.siblingGroupId] : null;
                      const sibMismatch = rId && siblingMismatchIds.has(rId);
                      // 移動モード時：この空き枠が移動対象者の希望かどうか
                      const isPreferredTarget = swapMode && !rId && swapResp && (
                        (swapResp.preferredSlots || []).includes(slot.key) || (swapResp.allDayDates || []).includes(slot.date)
                      );
                      return (
                        <div key={slot.key} onClick={() => { if (confirmed) return; const isPlaceMode = swapMode && unassigned.some((u) => u.id === swapMode); if (!swapMode && rId) { setSwapMode(rId); } else if (swapMode && !rId) { onMove(swapMode, slot.key); setSwapMode(null); } else if (swapMode && rId && swapMode !== rId && !isPlaceMode) { onSwap(swapMode, rId); setSwapMode(null); } else { setSwapMode(null); } }}
                          style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6,
                            border: isSrc ? `2px solid ${C.accent}` : isPreferredTarget ? `2px solid ${C.success}` : sibMismatch ? `2px solid ${C.accent}` : isTgt ? `2px dashed ${C.accent}` : swapMode && !rId ? `1px dashed #CCC` : `1px solid ${C.border}`,
                            background: isSrc ? C.accentLight : isPreferredTarget ? C.successLight : sibMismatch ? C.accentLight : resp ? "#fff" : swapMode && !rId ? "#F5F5F5" : "#FAFAFA",
                            cursor: confirmed ? "default" : (swapMode ? "pointer" : resp ? "pointer" : "default"),
                            display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 32,
                            opacity: swapMode && !rId && !isPreferredTarget ? 0.55 : 1,
                          }}>
                          <span style={{ color: isPreferredTarget ? C.success : C.textSub, fontWeight: 600, minWidth: 40 }}>{slot.time}</span>
                          {resp ? (
                            <span style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, justifyContent: "flex-end" }}>
                              {sibCol && <span style={{ width: 8, height: 8, borderRadius: "50%", background: sibCol }} />}
                              <span style={{ fontWeight: 600, fontSize: 11, color: inPref ? C.text : C.danger, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: 80 }}>{resp.studentName}</span>
                              {sibMismatch && <span style={{ fontSize: 10, color: C.accent }}>👥</span>}
                              {!inPref && <span style={{ fontSize: 10, color: C.danger }}>⚠</span>}
                            </span>
                          ) : isPreferredTarget ? (
                            <span style={{ color: C.success, fontSize: 13, fontWeight: 700 }}>○</span>
                          ) : <span style={{ color: "#CCC", fontSize: 11 }}>—</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 14, fontSize: 11, color: C.textSub }}><span>⚠ = 希望枠外</span><span>● = 兄弟（同色＝同一家庭）</span><span>👥 = 兄弟が別日配置</span></div>
        </div>
      ) : tab === "list" ? (
        <div style={{ ...cardStyle, marginBottom: 20 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ borderBottom: `2px solid ${C.border}` }}>
              {["児童名", "クラス", "割り当て枠", "希望一致"].map((h) => (<th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: C.textSub, fontSize: 12 }}>{h}</th>))}
            </tr></thead>
            <tbody>{filteredAssignedResponses.sort((a, b) => (assignments[a.id] || "").localeCompare(assignments[b.id] || "")).map((r) => {
              const sKey = assignments[r.id]; const inP = r.preferredSlots?.includes(sKey) || (r.allDayDates || []).includes(sKey?.split("_")[0]);
              return (<tr key={r.id} style={{ borderBottom: `1px solid ${C.border}`, background: (!inP && !r.isSynthetic) ? "#fff8f8" : "transparent" }}>
                <td style={{ padding: "8px 10px", fontWeight: 600 }}>
                  {r.studentName}
                  {r.parentName === "（手動追加）" && <span style={{ fontSize: 10, color: C.accent, background: C.accentLight, borderRadius: 6, padding: "1px 6px", marginLeft: 6, fontWeight: 600 }}>手動</span>}
                  {r.isSynthetic && <span style={{ fontSize: 10, color: "#7c3aed", background: "#ede9fe", borderRadius: 6, padding: "1px 6px", marginLeft: 6, fontWeight: 600 }}>自動</span>}
                </td>
                <td style={{ padding: "8px 10px" }}>{r.className}</td>
                <td style={{ padding: "8px 10px" }}>{formatDate(sKey.split("_")[0])} {sKey.split("_")[1]}</td>
                <td style={{ padding: "8px 10px" }}><span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: inP || r.isSynthetic ? C.successLight : C.dangerLight, color: inP || r.isSynthetic ? C.success : C.danger }}>{inP || r.isSynthetic ? "○" : "×"}</span></td>
              </tr>);
            })}</tbody>
          </table>
        </div>
      ) : tab === "outofpref" ? (
        <div style={{ ...cardStyle, marginBottom: 20 }}>
          {outOfPrefResponses.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: C.success, fontSize: 15, fontWeight: 700 }}>
              ✅ 全員が希望枠に割り当て済みです
            </div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.accent }}>⚠ 希望枠外に割り当て済みの児童（{outOfPrefResponses.length}名）</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: C.textSub }}>タイムテーブルで枠をクリックして希望枠へ移動できます</p>
                </div>
                {!confirmed && <button onClick={() => setTab("timetable")} style={{ ...btn(C.primary, "#fff", "sm") }}>タイムテーブルで調整</button>}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ borderBottom: `2px solid ${C.border}` }}>
                  {["児童名", "クラス", "現在の割り当て", "希望日時", ""].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: C.textSub, fontSize: 12 }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>{outOfPrefResponses.sort((a, b) => (a.className || "").localeCompare(b.className || "")).map((r) => {
                  const sKey = assignments[r.id];
                  const allDayLabels = (r.allDayDates || []).map((d) => `${formatDate(d)}（終日）`);
                  const slotLabels = (r.preferredSlots || []).map((k) => { const [d, t] = k.split("_"); return `${formatDate(d)} ${t}`; });
                  const prefLabels = [...allDayLabels, ...slotLabels];
                  return (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}`, background: swapMode === r.id ? C.accentLight : "#fff8f8" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 600, color: C.accent }}>{r.studentName}</td>
                      <td style={{ padding: "8px 10px" }}>{r.className}</td>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                        <span style={{ background: C.dangerLight, color: C.danger, borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 600 }}>
                          {formatDate(sKey.split("_")[0])} {sKey.split("_")[1]}
                        </span>
                      </td>
                      <td style={{ padding: "8px 10px", fontSize: 12, lineHeight: 1.7 }}>
                        {prefLabels.length > 0
                          ? prefLabels.map((label, i) => (
                              <span key={i} style={{ display: "inline-block", background: C.successLight, color: C.success, borderRadius: 6, padding: "1px 8px", marginRight: 4, marginBottom: 2, fontWeight: 600, fontSize: 11 }}>{label}</span>
                            ))
                          : <span style={{ color: C.textSub, fontSize: 11 }}>希望なし（終日可）</span>}
                      </td>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                        {!confirmed && (
                          swapMode === r.id
                            ? <button onClick={() => setSwapMode(null)} style={{ ...btn("#fff", C.accent, "sm"), border: `1px solid ${C.accent}` }}>キャンセル</button>
                            : <button onClick={() => { setSwapMode(r.id); setTab("timetable"); }} style={{ ...btn(C.accent, "#fff", "sm") }}>✋ 移動する</button>
                        )}
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </>
          )}
        </div>
      ) : null}

      {(() => {
        const visibleUnassigned = filterClass ? unassigned.filter((r) => r.className === filterClass) : unassigned;
        if (visibleUnassigned.length === 0) return null;
        return (
          <div style={{ ...cardStyle, marginBottom: 20, border: `2px solid ${C.danger}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.danger }}>
                ⚠ 割り振り不可（{visibleUnassigned.length}名{filterClass ? ` / ${filterClass}` : ""}）
              </h3>
              <span style={{ fontSize: 12, color: C.textSub }}>「配置する」を押してタイムテーブルの空き枠をクリックしてください</span>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {["児童名", "クラス", "希望日時", ""].map((h) => (
                  <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 700, color: C.textSub, fontSize: 12 }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>{visibleUnassigned.map((r) => {
                const allDayLabels = (r.allDayDates || []).map((d) => `${formatDate(d)}（終日）`);
                const slotLabels = (r.preferredSlots || []).map((k) => { const [d, t] = k.split("_"); return `${formatDate(d)} ${t}`; });
                const prefLabels = [...allDayLabels, ...slotLabels];
                return (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}`, background: swapMode === r.id ? C.primaryLight : "transparent" }}>
                    <td style={{ padding: "8px 10px", fontWeight: 600, color: C.danger }}>{r.studentName}</td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{r.className}</td>
                    <td style={{ padding: "8px 10px", fontSize: 12, color: C.text, lineHeight: 1.7 }}>
                      {prefLabels.length > 0
                        ? prefLabels.map((label, i) => (
                            <span key={i} style={{ display: "inline-block", background: C.successLight, color: C.success, borderRadius: 6, padding: "1px 8px", marginRight: 4, marginBottom: 2, fontWeight: 600, fontSize: 11 }}>{label}</span>
                          ))
                        : <span style={{ color: C.textSub }}>希望なし</span>}
                    </td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                      {!confirmed && (
                        swapMode === r.id
                          ? <button onClick={() => setSwapMode(null)} style={{ ...btn("#fff", C.accent, "sm"), border: `1px solid ${C.accent}` }}>キャンセル</button>
                          : <button onClick={() => { setSwapMode(r.id); setTab("timetable"); }} style={{ ...btn(C.primary, "#fff", "sm") }}>▶ 配置する</button>
                      )}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        );
      })()}

      {!confirmed ? (
        <div style={{ display: "flex", gap: 12 }}>
          <button style={{ ...btn("#fff", C.text), border: `1px solid ${C.border}`, flex: 1, justifyContent: "center" }} onClick={onRerun}>🔄 再割り当て</button>
          <button style={{ ...btn("#fff", C.primary), border: `1px solid ${C.primary}`, flex: 1, justifyContent: "center" }} onClick={onSave}>💾 一時保存</button>
          <button style={{ ...btn(C.primary, "#fff"), flex: 1, justifyContent: "center" }} onClick={onConfirm}>✅ 確定する</button>
        </div>
      ) : (
        <div>
          <div style={{ ...cardStyle, background: C.successLight, border: `1px solid ${C.success}`, textAlign: "center", padding: 20, marginBottom: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.success, marginBottom: 4 }}>✅ 日程が確定されました</div>
            <p style={{ fontSize: 13, color: C.textSub, margin: 0 }}>スプレッドシート「割り当て」シートに保存済み</p>
          </div>
          <button style={{ ...btn("#fff", C.accent), border: `1px solid ${C.accent}`, width: "100%", justifyContent: "center" }} onClick={onEdit}>✏️ 手動調整モードに戻る</button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
//  Parent Form Page
// ═══════════════════════════════════════════
function ParentForm({ event, allSlots, form, setForm, onSubmit, confirmed, assignments, responses, loading }) {
  const slotsByDate = useMemo(() => { const g = {}; allSlots.forEach((s) => { if (!g[s.date]) g[s.date] = []; g[s.date].push(s); }); return g; }, [allSlots]);

  if (confirmed) {
    const exResp = responses.find((r) => assignments[r.id]);
    const sKey = exResp ? assignments[exResp.id] : null;
    return (
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📅</div>
          <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 800, color: C.primaryDark }}>面談日時が確定しました</h2>
          <p style={{ color: C.textSub, fontSize: 14, margin: "0 0 20px" }}>{event.name}</p>
          {exResp && sKey && (
            <div style={{ background: C.primaryLight, borderRadius: 12, padding: 20, marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: C.textSub, marginBottom: 4 }}>{exResp.studentName} さんの面談</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: C.primary }}>{formatDate(sKey.split("_")[0])}</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: C.primaryDark, marginTop: 4 }}>{sKey.split("_")[1]}〜</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const toggleSlot = (key) => setForm((p) => ({ ...p, selectedSlots: p.selectedSlots.includes(key) ? p.selectedSlots.filter((k) => k !== key) : [...p.selectedSlots, key] }));
  const toggleAllDay = (date) => setForm((p) => ({ ...p, allDayDates: p.allDayDates.includes(date) ? p.allDayDates.filter((d) => d !== date) : [...p.allDayDates, date] }));
  const isValid = form.studentName && form.className && (form.selectedSlots.length > 0 || form.allDayDates.length > 0);

  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <div style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.primaryDark})`, borderRadius: 16, padding: 24, color: "#fff", marginBottom: 20, textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>📅</div>
        <h2 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 800 }}>{event?.name || "個人懇談"}</h2>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.85 }}>ご都合の良い日時をお選びください（複数可・終日OKも選択できます）</p>
      </div>

      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700 }}>お子さまの情報</h3>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label style={labelStyle}>児童名</label><input style={inputStyle} value={form.studentName} onChange={(e) => setForm({ ...form, studentName: e.target.value })} placeholder="例：田中 太郎" /></div>
            <div><label style={labelStyle}>クラス</label>
              <select style={inputStyle} value={form.className} onChange={(e) => setForm({ ...form, className: e.target.value })}>
                <option value="">選択してください</option>
                {[1,2,3,4,5,6].flatMap((g) => [1,2,3].map((c) => <option key={`${g}-${c}`} value={`${g}年${c}組`}>{g}年{c}組</option>))}
              </select>
            </div>
          </div>
          <div>
            <div onClick={() => setForm({ ...form, hasSibling: !form.hasSibling })} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "10px 14px", borderRadius: 8, background: form.hasSibling ? C.accentLight : "#F8F8F6", border: `1px solid ${form.hasSibling ? C.accent : C.border}` }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${form.hasSibling ? C.accent : C.border}`, background: form.hasSibling ? C.accent : "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14, fontWeight: 700 }}>{form.hasSibling ? "✓" : ""}</div>
              <span style={{ fontSize: 14, fontWeight: 600 }}>同じ学校に兄弟姉妹がいる</span>
            </div>
            {form.hasSibling && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
                <div><label style={labelStyle}>兄弟の名前</label><input style={inputStyle} value={form.siblingName} onChange={(e) => setForm({ ...form, siblingName: e.target.value })} placeholder="例：田中 次郎" /></div>
                <div><label style={labelStyle}>兄弟のクラス</label>
                  <select style={inputStyle} value={form.siblingClass} onChange={(e) => setForm({ ...form, siblingClass: e.target.value })}>
                    <option value="">選択してください</option>
                    {[1,2,3,4,5,6].flatMap((g) => [1,2,3].map((c) => <option key={`${g}-${c}`} value={`${g}年${c}組`}>{g}年{c}組</option>))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>ご希望の日時</h3>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.primary }}>
            {form.selectedSlots.length > 0 && `${form.selectedSlots.length} 枠`}
            {form.selectedSlots.length > 0 && form.allDayDates.length > 0 && " + "}
            {form.allDayDates.length > 0 && `${form.allDayDates.length} 日（終日）`}
            {form.selectedSlots.length === 0 && form.allDayDates.length === 0 && "未選択"}
            {" 選択中"}
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "flex", gap: 8, minWidth: (event?.dates?.length || 3) * 110 }}>
            {(event?.dates || []).map((date) => {
              const isAllDay = form.allDayDates.includes(date);
              return (
                <div key={date} style={{ flex: 1, minWidth: 100 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: isAllDay ? C.selectedText : C.primary, marginBottom: 6, textAlign: "center", padding: "5px 0", background: isAllDay ? C.selected : C.primaryLight, borderRadius: 8 }}>{formatDate(date)}</div>
                  <button onClick={() => toggleAllDay(date)} style={{ width: "100%", padding: "7px 4px", fontSize: 12, fontFamily: font, fontWeight: 700, border: isAllDay ? `2px solid ${C.selected}` : `1px dashed ${C.primary}`, borderRadius: 8, background: isAllDay ? C.selected : "#fff", color: isAllDay ? C.selectedText : C.primary, cursor: "pointer", textAlign: "center", marginBottom: 4 }}>
                    {isAllDay ? "✓ 終日OK" : "終日OK"}
                  </button>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, opacity: isAllDay ? 0.4 : 1 }}>
                    {(slotsByDate[date] || []).map((slot) => {
                      const sel = form.selectedSlots.includes(slot.key);
                      return (<button key={slot.key} onClick={() => !isAllDay && toggleSlot(slot.key)} style={{ padding: "10px 6px", fontSize: 13, fontFamily: font, fontWeight: 600, border: sel ? `2px solid ${C.selected}` : `1px solid ${C.border}`, borderRadius: 8, background: sel ? C.selected : "#fff", color: sel ? C.selectedText : C.text, cursor: isAllDay ? "default" : "pointer", textAlign: "center" }}>{slot.time}</button>);
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <button style={{ ...btn(C.primary, "#fff", "lg"), width: "100%", justifyContent: "center", opacity: isValid ? 1 : 0.4, borderRadius: 12, padding: "16px 0", fontSize: 16 }} disabled={!isValid || loading} onClick={onSubmit}>回答を送信する</button>
      {!isValid && <p style={{ fontSize: 12, color: C.danger, textAlign: "center", marginTop: 8 }}>{!form.studentName || !form.className ? "お子さまの情報をすべて入力してください" : "ご希望の日時を少なくとも1つ選択してください"}</p>}
    </div>
  );
}
