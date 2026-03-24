import { useState, useMemo, useEffect } from "react";
import { gasGet, gasPost } from "./api";

// ─── Utilities ───
const generateId = () => Math.random().toString(36).substr(2, 9);
const formatDate = (dateStr) => {
  const d = new Date(dateStr + "T00:00:00");
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
function runAssignment(responses, allSlots) {
  const assigned = {};
  const usedSlots = new Set();
  const unassigned = [];
  const siblingGroups = {};
  const standalone = [];

  responses.forEach((r) => {
    if (r.hasSibling && r.siblingGroupId) {
      if (!siblingGroups[r.siblingGroupId]) siblingGroups[r.siblingGroupId] = [];
      siblingGroups[r.siblingGroupId].push(r);
    } else {
      standalone.push(r);
    }
  });

  Object.entries(siblingGroups).forEach(([, members]) => {
    const slotsByDate = {};
    allSlots.forEach((s) => { if (!slotsByDate[s.date]) slotsByDate[s.date] = []; slotsByDate[s.date].push(s); });
    let placed = false;
    for (const date of Object.keys(slotsByDate)) {
      const dateSlots = slotsByDate[date].filter((s) => !usedSlots.has(s.key));
      for (let i = 0; i <= dateSlots.length - members.length; i++) {
        const consecutive = dateSlots.slice(i, i + members.length);
        const bestMatch = findBestSiblingMatch(members, consecutive);
        if (bestMatch) {
          const score = bestMatch.filter(({ response, slot }) => response.preferredSlots.includes(slot.key)).length;
          if (score > 0) {
            bestMatch.forEach(({ response, slot }) => { assigned[response.id] = slot.key; usedSlots.add(slot.key); });
            placed = true; break;
          }
        }
      }
      if (placed) break;
    }
    if (!placed) members.forEach((m) => standalone.push(m));
  });

  standalone.sort((a, b) => a.preferredSlots.length - b.preferredSlots.length);
  standalone.forEach((r) => {
    const available = r.preferredSlots.filter((s) => !usedSlots.has(s));
    if (available.length > 0) {
      const pop = {};
      available.forEach((s) => { pop[s] = responses.filter((resp) => resp.preferredSlots.includes(s)).length; });
      available.sort((a, b) => pop[a] - pop[b]);
      assigned[r.id] = available[0]; usedSlots.add(available[0]);
    } else {
      const remaining = allSlots.filter((s) => !usedSlots.has(s.key));
      if (remaining.length > 0) {
        assigned[r.id] = remaining[0].key; usedSlots.add(remaining[0].key);
        unassigned.push({ ...r, reason: "希望枠外に配置" });
      } else {
        unassigned.push({ ...r, reason: "空き枠なし" });
      }
    }
  });
  return { assigned, unassigned };
}

function findBestSiblingMatch(members, slots) {
  if (members.length === 0) return [];
  if (members.length === 1) return [{ response: members[0], slot: slots[0] }];
  const perms = permutations(members);
  let bestScore = -1, bestMatch = null;
  perms.forEach((perm) => {
    let score = 0;
    perm.forEach((m, idx) => { if (m.preferredSlots.includes(slots[idx].key)) score++; });
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
  const [parentForm, setParentForm] = useState({
    studentName: "", parentName: "", className: "",
    hasSibling: false, siblingName: "", siblingClass: "", selectedSlots: [],
  });

  useEffect(() => {
    (async () => {
      try {
        const data = await gasGet("getEvent");
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

        setLoadingMsg("回答データを読み込み中...");
        const respData = await gasGet("getResponses");
        if (respData.responses) {
          setResponses(respData.responses.map((r) => ({
            ...r, siblingGroupId: r.hasSibling ? `sib_${r.studentName}_${r.siblingName}` : null,
          })));
        }

        const assignData = await gasGet("getAssignments");
        if (assignData.assignments?.length > 0) {
          const map = {};
          assignData.assignments.forEach((a) => { map[a.responseId] = a.slotKey; });
          setAssignments(map);
          setPage("assignment");
        } else {
          setPage("dashboard");
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
        studentName: parentForm.studentName, parentName: parentForm.parentName,
        className: parentForm.className, hasSibling: parentForm.hasSibling,
        siblingName: parentForm.siblingName || "", siblingClass: parentForm.siblingClass || "",
        preferredSlots: parentForm.selectedSlots,
      });
      if (result.error) { showToast(result.error, "error"); setLoading(false); return; }
      const newResp = {
        id: result.responseId || generateId(),
        studentName: parentForm.studentName, parentName: parentForm.parentName,
        className: parentForm.className, hasSibling: parentForm.hasSibling,
        siblingName: parentForm.siblingName, siblingClass: parentForm.siblingClass,
        siblingGroupId: parentForm.hasSibling ? `sib_${parentForm.studentName}_${parentForm.siblingName}` : null,
        preferredSlots: parentForm.selectedSlots, submittedAt: new Date().toISOString(),
      };
      setResponses((prev) => [...prev.filter((r) => !(r.studentName === newResp.studentName && r.className === newResp.className)), newResp]);
      setParentView(false);
      setParentForm({ studentName: "", parentName: "", className: "", hasSibling: false, siblingName: "", siblingClass: "", selectedSlots: [] });
      showToast(result.updated ? "回答を更新しました" : "回答を送信しました");
    } catch (e) { showToast("送信失敗: " + e.message, "error"); }
    setLoading(false);
  };

  const handleRefresh = async () => {
    setLoading(true); setLoadingMsg("最新データを取得中...");
    try {
      const respData = await gasGet("getResponses");
      if (respData.responses) {
        const resps = respData.responses.map((r) => ({ ...r, siblingGroupId: r.hasSibling ? `sib_${r.studentName}_${r.siblingName}` : null }));
        setResponses(resps);
        showToast(`${resps.length}件の回答を読み込みました`);
      }
    } catch (e) { showToast("取得失敗", "error"); }
    setLoading(false);
  };

  const handleRunAssignment = () => {
    const valid = responses.filter((r) => r.submittedAt && r.preferredSlots.length > 0);
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
        return { responseId: rId, studentName: r?.studentName || "", className: r?.className || "", slotKey: sKey, inPreference: r?.preferredSlots.includes(sKey) || false, siblingGroupId: r?.siblingGroupId || "" };
      });
      const result = await gasPost({ action: "saveAssignments", assignments: arr, confirm });
      if (result.error) { showToast(result.error, "error"); setLoading(false); return; }
      if (confirm) { setConfirmed(true); setEvent((p) => ({ ...p, status: "confirmed" })); showToast("日程を確定しました！"); }
      else showToast("割り当てを保存しました");
    } catch (e) { showToast("保存失敗: " + e.message, "error"); }
    setLoading(false);
  };

  const handleSwap = (id1, id2) => setAssignments((p) => { const n = { ...p }; const t = n[id1]; n[id1] = n[id2]; n[id2] = t; return n; });

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
        <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => { if (event) { setPage("dashboard"); setParentView(false); } }}>
          <span style={{ fontSize: 22 }}>📅</span>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>面談日程くん</span>
        </div>
        {event && !parentView && (
          <nav style={{ display: "flex", gap: 4 }}>
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
          </nav>
        )}
        {parentView && <button onClick={() => setParentView(false)} style={btn("rgba(255,255,255,0.2)", "#fff", "sm")}>✕ 教員画面に戻る</button>}
      </header>

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px" }}>
        {parentView ? (
          <ParentForm event={event} allSlots={allSlots} form={parentForm} setForm={setParentForm} onSubmit={handleParentSubmit} confirmed={confirmed} assignments={assignments} responses={responses} loading={loading} />
        ) : page === "home" ? (
          <EventSetup onCreate={handleCreateEvent} existingEvent={event} />
        ) : page === "dashboard" ? (
          <Dashboard event={event} responses={responses} allSlots={allSlots} onRunAssignment={handleRunAssignment} onOpenParentForm={() => setParentView(true)} onRefresh={handleRefresh} />
        ) : page === "assignment" ? (
          <AssignmentView event={event} responses={responses} allSlots={allSlots} assignments={assignments} unassigned={unassigned} onSwap={handleSwap} onConfirm={() => handleSaveAssignments(true)} confirmed={confirmed} onRerun={handleRunAssignment} onSave={() => handleSaveAssignments(false)} />
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
//  Dashboard Page
// ═══════════════════════════════════════════
function Dashboard({ event, responses, allSlots, onRunAssignment, onOpenParentForm, onRefresh }) {
  const submitted = responses.filter((r) => r.submittedAt);
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
        <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>回答一覧（{submitted.length}件）</h3>
        {submitted.length === 0 ? (
          <p style={{ textAlign: "center", color: C.textSub, padding: 20 }}>まだ回答がありません。保護者にフォームリンクを配布してください。</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ borderBottom: `2px solid ${C.border}` }}>
                {["児童名", "クラス", "兄弟", "希望枠数", "回答日"].map((h) => (<th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: C.textSub, fontSize: 12 }}>{h}</th>))}
              </tr></thead>
              <tbody>{submitted.map((r) => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "8px 10px", fontWeight: 600 }}>{r.studentName}</td>
                  <td style={{ padding: "8px 10px" }}>{r.className}</td>
                  <td style={{ padding: "8px 10px" }}>{r.hasSibling && <span style={{ fontSize: 11, background: C.accentLight, color: C.accent, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>兄弟あり</span>}</td>
                  <td style={{ padding: "8px 10px" }}>{r.preferredSlots.length} 枠</td>
                  <td style={{ padding: "8px 10px", color: C.textSub }}>{new Date(r.submittedAt).toLocaleDateString("ja-JP")}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
//  Assignment View Page
// ═══════════════════════════════════════════
function AssignmentView({ event, responses, allSlots, assignments, unassigned, onSwap, onConfirm, confirmed, onRerun, onSave }) {
  const [swapMode, setSwapMode] = useState(null);
  const [tab, setTab] = useState("timetable");
  const slotsByDate = useMemo(() => { const g = {}; allSlots.forEach((s) => { if (!g[s.date]) g[s.date] = []; g[s.date].push(s); }); return g; }, [allSlots]);
  const slotAssignment = useMemo(() => { const m = {}; Object.entries(assignments).forEach(([rId, sKey]) => { m[sKey] = rId; }); return m; }, [assignments]);
  const responseMap = useMemo(() => { const m = {}; responses.forEach((r) => { m[r.id] = r; }); return m; }, [responses]);
  const siblingColorMap = useMemo(() => { const m = {}; let ci = 0; responses.forEach((r) => { if (r.siblingGroupId && !m[r.siblingGroupId]) { m[r.siblingGroupId] = C.siblingColors[ci % C.siblingColors.length]; ci++; } }); return m; }, [responses]);

  const assignedCount = Object.keys(assignments).length;
  const inPrefCount = Object.entries(assignments).filter(([rId, sKey]) => responseMap[rId]?.preferredSlots.includes(sKey)).length;
  const satisfactionRate = assignedCount > 0 ? Math.round((inPrefCount / assignedCount) * 100) : 0;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: C.primaryDark }}>割り当て結果</h1>
        <p style={{ color: C.textSub, fontSize: 14, margin: "6px 0 0" }}>{confirmed ? "✅ 確定済み — スプレッドシートに保存されています" : "確認後、手動調整→保存/確定してください"}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "割り当て済み", value: `${assignedCount}人`, color: C.success },
          { label: "希望枠一致率", value: `${satisfactionRate}%`, color: C.primary },
          { label: "希望枠外", value: `${unassigned.filter((u) => u.reason === "希望枠外に配置").length}人`, color: unassigned.length > 0 ? C.danger : C.textSub },
        ].map((s) => (
          <div key={s.label} style={{ ...cardStyle, padding: "14px 18px", textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: C.textSub }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {[{ key: "timetable", label: "タイムテーブル" }, { key: "list", label: "一覧表" }].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ ...btn(tab === t.key ? C.primary : "#fff", tab === t.key ? "#fff" : C.text, "sm"), border: tab === t.key ? "none" : `1px solid ${C.border}` }}>{t.label}</button>
        ))}
      </div>

      {tab === "timetable" ? (
        <div style={{ ...cardStyle, marginBottom: 20 }}>
          {!confirmed && <p style={{ fontSize: 12, color: C.accent, margin: "0 0 12px", fontWeight: 600 }}>💡 枠をクリック→別の枠をクリックで入れ替え</p>}
          <div style={{ overflowX: "auto" }}>
            <div style={{ display: "flex", gap: 12, minWidth: event.dates.length * 160 }}>
              {event.dates.map((date) => (
                <div key={date} style={{ flex: 1, minWidth: 150 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, marginBottom: 8, textAlign: "center", padding: "6px 0", background: C.primaryLight, borderRadius: 8 }}>{formatDate(date)}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {(slotsByDate[date] || []).map((slot) => {
                      const rId = slotAssignment[slot.key]; const resp = rId ? responseMap[rId] : null;
                      const isSrc = swapMode === rId; const isTgt = swapMode && rId && swapMode !== rId;
                      const inPref = resp && resp.preferredSlots.includes(slot.key);
                      const sibCol = resp?.siblingGroupId ? siblingColorMap[resp.siblingGroupId] : null;
                      return (
                        <div key={slot.key} onClick={() => { if (confirmed) return; if (!swapMode && rId) setSwapMode(rId); else if (swapMode && rId && swapMode !== rId) { onSwap(swapMode, rId); setSwapMode(null); } else setSwapMode(null); }}
                          style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: isSrc ? `2px solid ${C.accent}` : isTgt ? `2px dashed ${C.accent}` : `1px solid ${C.border}`, background: isSrc ? C.accentLight : resp ? "#fff" : "#FAFAFA", cursor: confirmed ? "default" : resp ? "pointer" : "default", display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 32 }}>
                          <span style={{ color: C.textSub, fontWeight: 600, minWidth: 40 }}>{slot.time}</span>
                          {resp ? (
                            <span style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, justifyContent: "flex-end" }}>
                              {sibCol && <span style={{ width: 8, height: 8, borderRadius: "50%", background: sibCol }} />}
                              <span style={{ fontWeight: 600, fontSize: 11, color: inPref ? C.text : C.danger, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: 80 }}>{resp.studentName}</span>
                              {!inPref && <span style={{ fontSize: 10, color: C.danger }}>⚠</span>}
                            </span>
                          ) : <span style={{ color: "#CCC", fontSize: 11 }}>—</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 14, fontSize: 11, color: C.textSub }}><span>⚠ = 希望枠外</span><span>● = 兄弟（同色＝同一家庭）</span></div>
        </div>
      ) : (
        <div style={{ ...cardStyle, marginBottom: 20 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ borderBottom: `2px solid ${C.border}` }}>
              {["児童名", "クラス", "割り当て枠", "希望一致"].map((h) => (<th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: C.textSub, fontSize: 12 }}>{h}</th>))}
            </tr></thead>
            <tbody>{responses.filter((r) => assignments[r.id]).sort((a, b) => (assignments[a.id] || "").localeCompare(assignments[b.id] || "")).map((r) => {
              const sKey = assignments[r.id]; const inP = r.preferredSlots.includes(sKey);
              return (<tr key={r.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: "8px 10px", fontWeight: 600 }}>{r.studentName}</td>
                <td style={{ padding: "8px 10px" }}>{r.className}</td>
                <td style={{ padding: "8px 10px" }}>{formatDate(sKey.split("_")[0])} {sKey.split("_")[1]}</td>
                <td style={{ padding: "8px 10px" }}><span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: inP ? C.successLight : C.dangerLight, color: inP ? C.success : C.danger }}>{inP ? "○" : "×"}</span></td>
              </tr>);
            })}</tbody>
          </table>
        </div>
      )}

      {unassigned.filter((u) => u.reason === "空き枠なし").length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 20, borderColor: C.danger }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: C.danger }}>⚠ 割り当て不能</h3>
          {unassigned.filter((u) => u.reason === "空き枠なし").map((r) => (<div key={r.id} style={{ padding: "6px 0", fontSize: 13 }}><strong>{r.studentName}</strong> — {r.reason}</div>))}
        </div>
      )}

      {!confirmed ? (
        <div style={{ display: "flex", gap: 12 }}>
          <button style={{ ...btn("#fff", C.text), border: `1px solid ${C.border}`, flex: 1, justifyContent: "center" }} onClick={onRerun}>🔄 再割り当て</button>
          <button style={{ ...btn("#fff", C.primary), border: `1px solid ${C.primary}`, flex: 1, justifyContent: "center" }} onClick={onSave}>💾 一時保存</button>
          <button style={{ ...btn(C.primary, "#fff"), flex: 1, justifyContent: "center" }} onClick={onConfirm}>✅ 確定する</button>
        </div>
      ) : (
        <div style={{ ...cardStyle, background: C.successLight, border: `1px solid ${C.success}`, textAlign: "center", padding: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.success, marginBottom: 4 }}>✅ 日程が確定されました</div>
          <p style={{ fontSize: 13, color: C.textSub, margin: 0 }}>スプレッドシート「割り当て」シートに保存済み</p>
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
  const isValid = form.studentName && form.parentName && form.className && form.selectedSlots.length >= 5;

  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <div style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.primaryDark})`, borderRadius: 16, padding: 24, color: "#fff", marginBottom: 20, textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>📅</div>
        <h2 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 800 }}>{event?.name || "個人懇談"}</h2>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.85 }}>ご都合の良い日時を5つ以上お選びください</p>
      </div>

      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700 }}>お子さまの情報</h3>
        <div style={{ display: "grid", gap: 12 }}>
          <div><label style={labelStyle}>児童名</label><input style={inputStyle} value={form.studentName} onChange={(e) => setForm({ ...form, studentName: e.target.value })} placeholder="例：田中 太郎" /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label style={labelStyle}>保護者名</label><input style={inputStyle} value={form.parentName} onChange={(e) => setForm({ ...form, parentName: e.target.value })} placeholder="例：田中 花子" /></div>
            <div><label style={labelStyle}>クラス</label><input style={inputStyle} value={form.className} onChange={(e) => setForm({ ...form, className: e.target.value })} placeholder="例：2年1組" /></div>
          </div>
          <div>
            <div onClick={() => setForm({ ...form, hasSibling: !form.hasSibling })} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "10px 14px", borderRadius: 8, background: form.hasSibling ? C.accentLight : "#F8F8F6", border: `1px solid ${form.hasSibling ? C.accent : C.border}` }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${form.hasSibling ? C.accent : C.border}`, background: form.hasSibling ? C.accent : "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14, fontWeight: 700 }}>{form.hasSibling ? "✓" : ""}</div>
              <span style={{ fontSize: 14, fontWeight: 600 }}>同じ学校に兄弟姉妹がいる</span>
            </div>
            {form.hasSibling && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
                <div><label style={labelStyle}>兄弟の名前</label><input style={inputStyle} value={form.siblingName} onChange={(e) => setForm({ ...form, siblingName: e.target.value })} placeholder="例：田中 次郎" /></div>
                <div><label style={labelStyle}>兄弟のクラス</label><input style={inputStyle} value={form.siblingClass} onChange={(e) => setForm({ ...form, siblingClass: e.target.value })} placeholder="例：4年2組" /></div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>ご希望の日時</h3>
          <span style={{ fontSize: 13, fontWeight: 700, color: form.selectedSlots.length >= 5 ? C.success : C.danger }}>{form.selectedSlots.length} 枠選択中{form.selectedSlots.length < 5 && ` （あと${5 - form.selectedSlots.length}つ）`}</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "flex", gap: 8, minWidth: (event?.dates?.length || 3) * 110 }}>
            {(event?.dates || []).map((date) => (
              <div key={date} style={{ flex: 1, minWidth: 100 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.primary, marginBottom: 6, textAlign: "center", padding: "5px 0", background: C.primaryLight, borderRadius: 8 }}>{formatDate(date)}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {(slotsByDate[date] || []).map((slot) => {
                    const sel = form.selectedSlots.includes(slot.key);
                    return (<button key={slot.key} onClick={() => toggleSlot(slot.key)} style={{ padding: "10px 6px", fontSize: 13, fontFamily: font, fontWeight: 600, border: sel ? `2px solid ${C.selected}` : `1px solid ${C.border}`, borderRadius: 8, background: sel ? C.selected : "#fff", color: sel ? C.selectedText : C.text, cursor: "pointer", textAlign: "center" }}>{slot.time}</button>);
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <button style={{ ...btn(C.primary, "#fff", "lg"), width: "100%", justifyContent: "center", opacity: isValid ? 1 : 0.4, borderRadius: 12, padding: "16px 0", fontSize: 16 }} disabled={!isValid || loading} onClick={onSubmit}>回答を送信する</button>
      {!isValid && <p style={{ fontSize: 12, color: C.danger, textAlign: "center", marginTop: 8 }}>{!form.studentName || !form.parentName || !form.className ? "お子さまの情報をすべて入力してください" : `あと${5 - form.selectedSlots.length}つ以上の日時を選択してください`}</p>}
    </div>
  );
}
