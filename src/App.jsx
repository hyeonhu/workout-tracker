import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronDown,
  ClipboardList,
  Copy,
  Dumbbell,
  History,
  Minus,
  Plus,
  RotateCcw,
  Save,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { addDoc, collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db, ensureAnonymousUser } from "./firebase";
import {
  CATEGORY_META,
  MUSCLE_GROUPS,
  ROUTINES,
  createInitialState,
  instanceView,
  migrateState,
  profileById,
  sessionSummary,
  weightBasisLabel,
} from "./routines";
import {
  formatWeightDisplay,
  hasAdjustableBaseWeight,
  miniWarmupHelperText,
  normalizeTotalLoad,
  warmupHelperText,
} from "./load.js";
import {
  bodyweightWeeklyAverage,
  complianceSeries,
  dateKey,
  plateauRecommendations,
  plannedWeeklySetBalance,
  progressionSeries,
  sessionVolume,
  toDate,
  weeklyDirectHardSets,
  weeklyMuscleVolume,
} from "./analytics";
import { applyDeload, completeSession, sum } from "./progression";

const tabs = [
  { id: "today", label: "오늘", icon: Activity },
  { id: "log", label: "기록", icon: ClipboardList },
  { id: "history", label: "히스토리", icon: History },
  { id: "settings", label: "설정", icon: Settings },
];

export default function App() {
  const [user, setUser] = useState(null);
  const [ownerUid, setOwnerUid] = useState(() => localStorage.getItem("ownerUid") || "");
  const [state, setState] = useState(null);
  const [history, setHistory] = useState([]);
  const [bodyweightLogs, setBodyweightLogs] = useState([]);
  const [tab, setTab] = useState("today");
  const [entries, setEntries] = useState({});
  const [sessionNotes, setSessionNotes] = useState("");
  const [sessionBodyweight, setSessionBodyweight] = useState("");
  const [sessionBodyweightContext, setSessionBodyweightContext] = useState("post_workout");
  const [kneeApprovals, setKneeApprovals] = useState({});
  const [logFocusExerciseId, setLogFocusExerciseId] = useState("");
  const [recoveryCode, setRecoveryCode] = useState(() => localStorage.getItem("recoveryCode") || "");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [status, setStatus] = useState("준비 중");
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [busy, setBusy] = useState(false);
  const [todayOpenSections, setTodayOpenSections] = useState({});
  const [historyOpenDates, setHistoryOpenDates] = useState({});
  const [historyAnalyticsOpen, setHistoryAnalyticsOpen] = useState(true);
  const [settingsOpenSections, setSettingsOpenSections] = useState({});
  const [settingsOnlyToday, setSettingsOnlyToday] = useState(true);
  const scrollPositionsRef = useRef({});
  const previousTabRef = useRef(tab);
  const skipScrollRestoreRef = useRef(false);
  const routinePointerRepairRef = useRef("");
  const appState = state ? migrateState(state) : null;
  const routine = ROUTINES[Number(appState?.currentRoutineIndex || 0)] || ROUTINES[0];
  const pendingKnee = appState
    ? routine.exercises.filter((exercise) => {
        const profile = profileById(exercise.profileId);
        const view = instanceView(exercise, appState);
        return exercise.anchorSession && (profile.kneeSensitive || profile.hamstringSensitive) && view.recoveryCheckPending;
      })
    : [];

  function changeTab(nextTab, options = {}) {
    if (typeof window !== "undefined") {
      scrollPositionsRef.current[previousTabRef.current] = window.scrollY;
    }
    previousTabRef.current = nextTab;
    skipScrollRestoreRef.current = options.restoreScroll === false;
    setTab(nextTab);
  }

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (skipScrollRestoreRef.current) {
      skipScrollRestoreRef.current = false;
      return undefined;
    }
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: scrollPositionsRef.current[tab] || 0, behavior: "auto" });
    });
    return () => cancelAnimationFrame(frame);
  }, [tab]);

  useEffect(() => {
    const unsubscribe = ensureAnonymousUser(async (nextUser) => {
      setUser(nextUser);
      if (!ownerUid) {
        setOwnerUid(nextUser.uid);
        localStorage.setItem("ownerUid", nextUser.uid);
      }
    });
    return unsubscribe;
  }, [ownerUid]);

  useEffect(() => {
    if (!user || !ownerUid) return undefined;
    const stateRef = doc(db, "users", ownerUid, "state", "current");
    const unsubscribe = onSnapshot(stateRef, async (snapshot) => {
      if (!snapshot.exists()) {
        const fresh = createInitialState();
        await setDoc(stateRef, fresh);
        setState(fresh);
        return;
      }
      const migrated = migrateState(snapshot.data());
      setState(migrated);
      if (snapshot.data().schemaVersion !== 3) await setDoc(stateRef, migrated);
      setStatus("저장됨");
    });
    return unsubscribe;
  }, [user, ownerUid]);

  useEffect(() => {
    if (!user || !ownerUid) return undefined;
    return onSnapshot(collection(db, "users", ownerUid, "bodyweight"), (snapshot) => {
      const rows = snapshot.docs
        .map((weightDoc) => ({ id: weightDoc.id, ...weightDoc.data() }))
        .sort((a, b) => toDate(b.date || b.createdAt) - toDate(a.date || a.createdAt))
        .slice(0, 180);
      setBodyweightLogs(rows);
    });
  }, [user, ownerUid]);

  useEffect(() => {
    if (!user || !ownerUid) return undefined;
    return onSnapshot(collection(db, "users", ownerUid, "history"), (snapshot) => {
      const rows = snapshot.docs
        .map((historyDoc) => ({ id: historyDoc.id, ...historyDoc.data() }))
        .sort((a, b) => toDate(b.date) - toDate(a.date))
        .slice(0, 120);
      setHistory(rows);
    });
  }, [user, ownerUid]);

  useEffect(() => {
    if (!appState || !history.length || !ownerUid) return;
    const latest = history[0];
    const latestIndex = ROUTINES.findIndex((item) => item.id === latest.sessionId);
    const currentIndex = Number(appState.currentRoutineIndex || 0);
    if (latestIndex < 0 || latestIndex !== currentIndex) return;

    const repairKey = `${ownerUid}:${latest.id || latest.completedAtLocal || latest.localDateKey || latest.sessionId}`;
    if (routinePointerRepairRef.current === repairKey) return;
    routinePointerRepairRef.current = repairKey;

    const repairedState = {
      ...appState,
      currentRoutineIndex: (currentIndex + 1) % ROUTINES.length,
      updatedAt: Date.now(),
    };

    setState(repairedState);
    saveState(repairedState).catch(() => {
      routinePointerRepairRef.current = "";
    });
  }, [appState, history, ownerUid]);

  useEffect(() => {
    if (!user || !ownerUid || recoveryCode) return;
    const code = makeRecoveryCode();
    setDoc(doc(db, "recoveryCodes", code), { uid: ownerUid, createdAt: serverTimestamp() }).then(() => {
      localStorage.setItem("recoveryCode", code);
      setRecoveryCode(code);
    });
  }, [user, ownerUid, recoveryCode]);

  useEffect(() => {
    function updateOnlineStatus() {
      setIsOnline(navigator.onLine);
      setStatus(navigator.onLine ? "온라인" : "오프라인");
    }
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  useEffect(() => {
    if (!appState) return;
    const nextEntries = {};
    for (const exercise of routine.exercises) {
      const view = instanceView(exercise, appState);
      const sets = Number(view.currentSets || exercise.defaultSets);
      const source = view.lastReps?.length ? view.lastReps : Array(sets).fill(exercise.min);
      nextEntries[exercise.id] = Array.from({ length: sets }, (_, index) => Number(source[index] || exercise.min));
    }
    setEntries(nextEntries);
    setKneeApprovals({});
    setSessionNotes("");
    setSessionBodyweight("");
    setSessionBodyweightContext("post_workout");
  }, [appState?.currentRoutineIndex, appState?.sessionCount]);

  async function saveState(nextState) {
    if (!ownerUid) return;
    setStatus(isOnline ? "저장 중" : "오프라인 대기");
    await setDoc(doc(db, "users", ownerUid, "state", "current"), migrateState(nextState));
    setStatus(isOnline ? "저장됨" : "오프라인 대기");
  }

  async function updateProfile(profileId, patch) {
    const nextState = {
      ...appState,
      profileData: {
        ...appState.profileData,
        [profileId]: {
          ...appState.profileData[profileId],
          ...patch,
        },
      },
      updatedAt: Date.now(),
    };
    setState(nextState);
    await saveState(nextState);
  }

  async function finishSession() {
    setBusy(true);
    try {
      if (pendingKnee.some((exercise) => kneeApprovals[exercise.id] === undefined)) {
        setStatus("무릎 체크를 먼저 선택해줘");
        changeTab("log");
        return;
      }
      setStatus(isOnline ? "저장 중" : "오프라인 대기");
      const completedAt = new Date();
      const result = completeSession(appState, routine, entries, kneeApprovals, sessionNotes.trim());
      if (Number(sessionBodyweight) > 0) await addBodyweight(sessionBodyweight, "", sessionBodyweightContext, completedAt);
      await addDoc(collection(db, "users", ownerUid, "history"), {
        date: serverTimestamp(),
        localDateKey: dateKey(completedAt),
        localDateLabel: formatDateOnly(completedAt),
        completedAtLocal: completedAt.toISOString(),
        sessionId: routine.id,
        routine: routine.name,
        routineTitle: routine.title,
        notes: result.notes,
        kneeConfirmations: result.kneeConfirmations,
        recoveryConfirmations: result.recoveryConfirmations,
        exercises: result.historyExercises,
      });
      await saveState(result.nextState);
      changeTab("today");
      setStatus("세션 완료");
    } finally {
      setBusy(false);
    }
  }

  async function recover() {
    const code = recoveryInput.trim().toUpperCase();
    if (!code || !user) return;
    setBusy(true);
    try {
      const recoveryDoc = await getDoc(doc(db, "recoveryCodes", code));
      if (!recoveryDoc.exists()) {
        setStatus("복구 코드를 찾지 못했어");
        return;
      }
      const recoveredUid = recoveryDoc.data().uid;
      await setDoc(doc(db, "userAccess", recoveredUid, "uids", user.uid), {
        uid: user.uid,
        code,
        createdAt: serverTimestamp(),
      });
      localStorage.setItem("ownerUid", recoveredUid);
      localStorage.setItem("recoveryCode", code);
      setOwnerUid(recoveredUid);
      setRecoveryCode(code);
      setRecoveryInput("");
      setStatus("복구 연결됨");
    } finally {
      setBusy(false);
    }
  }

  async function changeRecoveryCode(nextCode) {
    const code = nextCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!code || !user || !ownerUid) return false;
    if (code.length < 4 || code.length > 20) {
      setStatus("복구 코드는 4~20자로 입력해줘");
      return false;
    }
    setBusy(true);
    try {
      const nextRef = doc(db, "recoveryCodes", code);
      const nextDoc = await getDoc(nextRef);
      if (nextDoc.exists() && nextDoc.data().uid !== ownerUid) {
        setStatus("이미 사용 중인 복구 코드야");
        return false;
      }
      await setDoc(
        nextRef,
        {
          uid: ownerUid,
          createdAt: nextDoc.exists() ? nextDoc.data().createdAt || serverTimestamp() : serverTimestamp(),
          updatedAt: serverTimestamp(),
          custom: true,
          primary: true,
        },
        { merge: true }
      );
      localStorage.setItem("recoveryCode", code);
      setRecoveryCode(code);
      setRecoveryInput("");
      setStatus("복구 코드 변경됨");
      return true;
    } catch (error) {
      console.error(error);
      setStatus(`복구 코드 변경 실패: ${error?.code || "알 수 없음"}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addBodyweight(value, note = "", context = "other", measuredAt = new Date()) {
    const number = Number(value);
    if (!number || !ownerUid) return;
    setStatus(isOnline ? "저장 중" : "오프라인 대기");
    await addDoc(collection(db, "users", ownerUid, "bodyweight"), {
      value: number,
      note,
      context,
      date: measuredAt,
      localDateKey: dateKey(measuredAt),
      createdAt: serverTimestamp(),
    });
    setStatus(isOnline ? "저장됨" : "오프라인 대기");
  }

  async function saveRecommendationCooldown(key) {
    if (!key) return;
    const nextState = {
      ...appState,
      recommendationCooldowns: {
        ...(appState.recommendationCooldowns || {}),
        [key]: Date.now(),
      },
      updatedAt: Date.now(),
    };
    setState(nextState);
    await saveState(nextState);
  }

  async function resetAll() {
    if (!confirm("전체 운동 상태를 초기화할까요? 히스토리는 남겨둡니다.")) return;
    const fresh = createInitialState();
    await saveState(fresh);
    setState(fresh);
  }

  async function manualDeload() {
    const nextState = applyDeload(appState);
    await saveState({ ...nextState, lastDeloadAt: Date.now() });
    setStatus("디로드 적용됨");
  }

  if (!appState) {
    return (
      <Shell>
        <div className="flex min-h-screen items-center justify-center px-5 text-center text-app-muted">
          <div>
            <Dumbbell className="mx-auto mb-4 h-10 w-10 text-app-accent" />
            <p>운동 기록장을 여는 중...</p>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="sticky top-0 z-20 border-b border-app-line bg-app-bg/95 px-5 pb-4 pt-[calc(env(safe-area-inset-top)+16px)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-[480px] items-center justify-between">
          <div>
            <p className="text-xs text-app-muted">근비대 4분할</p>
            <h1 className="text-2xl font-bold tracking-normal text-app-text">증량일지</h1>
          </div>
          <div className={`rounded-full border px-3 py-1 text-xs ${isOnline ? "border-app-line text-app-muted" : "border-amber-500/50 text-amber-200"}`}>{status}</div>
        </div>
      </header>

      <main className="mx-auto min-h-[calc(100vh-160px)] w-full max-w-[480px] px-4 pb-28 pt-4">
        {tab === "today" && (
          <TodayView
            state={appState}
            currentRoutine={routine}
            openSections={todayOpenSections}
            setOpenSections={setTodayOpenSections}
            onLog={(exerciseId = "") => {
              setLogFocusExerciseId(exerciseId);
              changeTab("log", { restoreScroll: !exerciseId });
            }}
            onSettings={() => changeTab("settings")}
          />
        )}
        {tab === "log" && (
          <LogView
            state={appState}
            routine={routine}
            entries={entries}
            setEntries={setEntries}
            pendingKnee={pendingKnee}
            kneeApprovals={kneeApprovals}
            setKneeApprovals={setKneeApprovals}
            notes={sessionNotes}
            setNotes={setSessionNotes}
            bodyweight={sessionBodyweight}
            setBodyweight={setSessionBodyweight}
            bodyweightContext={sessionBodyweightContext}
            setBodyweightContext={setSessionBodyweightContext}
            focusExerciseId={logFocusExerciseId}
            onFocusHandled={() => setLogFocusExerciseId("")}
            onFinish={finishSession}
            busy={busy}
          />
        )}
        {tab === "history" && (
          <HistoryView
            history={history}
            bodyweightLogs={bodyweightLogs}
            recommendationCooldowns={appState.recommendationCooldowns || {}}
            openDates={historyOpenDates}
            setOpenDates={setHistoryOpenDates}
            analyticsOpen={historyAnalyticsOpen}
            setAnalyticsOpen={setHistoryAnalyticsOpen}
            onRecommendationCooldown={saveRecommendationCooldown}
            onBodyweight={addBodyweight}
          />
        )}
        {tab === "settings" && (
          <SettingsView
            state={appState}
            recoveryCode={recoveryCode}
            recoveryInput={recoveryInput}
            setRecoveryInput={setRecoveryInput}
            onRecover={recover}
            onChangeRecoveryCode={changeRecoveryCode}
            onProfile={updateProfile}
            currentRoutine={routine}
            history={history}
            bodyweightLogs={bodyweightLogs}
            openSections={settingsOpenSections}
            setOpenSections={setSettingsOpenSections}
            onlyToday={settingsOnlyToday}
            setOnlyToday={setSettingsOnlyToday}
            onDeload={manualDeload}
            onReset={resetAll}
            busy={busy}
          />
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-app-line bg-[#101018]/95 px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2 backdrop-blur">
        <div className="mx-auto grid max-w-[480px] grid-cols-4 gap-1">
          {tabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => changeTab(item.id)}
                className={`flex h-14 flex-col items-center justify-center gap-1 rounded-md text-xs transition ${active ? "bg-app-accent text-white" : "text-app-muted"}`}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>
    </Shell>
  );
}

function TodayView({ state, currentRoutine, openSections, setOpenSections, onLog, onSettings }) {

  useEffect(() => {
    setOpenSections((prev) => (Object.keys(prev).length ? prev : { [currentRoutine.id]: true }));
  }, [currentRoutine.id, setOpenSections]);

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-app-line bg-app-card p-4 shadow-glow">
        <p className="text-sm text-app-muted">오늘 배정</p>
        <div className="mt-1 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-3xl font-black text-white">{currentRoutine.name}</h2>
            <p className="mt-1 text-sm text-app-muted">{currentRoutine.day}요일 · {currentRoutine.title}</p>
          </div>
          <button onClick={onLog} className="rounded-md bg-app-accent px-4 py-3 font-bold text-white">
            기록
          </button>
        </div>
        <button onClick={onSettings} className="mt-3 w-full rounded-md border border-app-line py-3 font-bold text-app-text">
          중량 설정
        </button>
      </div>

      {ROUTINES.map((routine) => (
        <SessionAccordion
          key={routine.id}
          routine={routine}
          state={state}
          open={Boolean(openSections[routine.id])}
          current={routine.id === currentRoutine.id}
          onToggle={() => setOpenSections((prev) => ({ ...prev, [routine.id]: !prev[routine.id] }))}
          onExerciseTap={(exerciseId) => onLog(exerciseId)}
        />
      ))}
    </section>
  );
}

function SessionAccordion({ routine, state, open, current, onToggle, onExerciseTap }) {
  const summary = sessionSummary(routine);
  const firstExercise = routine.exercises[0];
  const firstView = firstExercise ? instanceView(firstExercise, state) : null;
  const warmupText = current && firstView ? warmupHelperText(firstExercise, firstView) : null;
  return (
    <article className={`overflow-hidden rounded-lg border bg-app-card transition ${current ? "border-app-accent" : "border-app-line"}`}>
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-3 p-4 text-left">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-black text-white">{routine.name}</h3>
            <span className="rounded-md bg-app-bg px-2 py-1 text-xs text-app-muted">{routine.day}</span>
            {current && <span className="rounded-md bg-app-accent px-2 py-1 text-xs font-bold text-white">오늘</span>}
          </div>
          <p className="mt-1 text-sm text-app-muted">{routine.title}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <Badge>{summary.exerciseCount}종목</Badge>
            <Badge>{summary.totalSets}세트</Badge>
            {summary.hasKneeSensitive && <Badge amber>무릎 민감 종목 있음</Badge>}
            {summary.hasHamstringSensitive && <Badge rose>햄스트링 민감 종목 있음</Badge>}
          </div>
        </div>
        <ChevronDown className={`h-5 w-5 text-app-muted transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-app-line p-4">
          {warmupText ? (
            <div className="whitespace-pre-line rounded-md bg-app-bg px-3 py-3 text-sm leading-6 text-amber-200">
              {warmupText}
            </div>
          ) : null}
          {routine.exercises.map((exercise, index) => (
            <button key={exercise.id} onClick={() => onExerciseTap(exercise.id)} className="block w-full text-left">
              <ExerciseCard
                exercise={exercise}
                view={instanceView(exercise, state)}
                helperText={current && index > 0 ? miniWarmupHelperText(exercise) : null}
              />
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function LogView({
  state,
  routine,
  entries,
  setEntries,
  pendingKnee,
  kneeApprovals,
  setKneeApprovals,
  notes,
  setNotes,
  bodyweight,
  setBodyweight,
  bodyweightContext,
  setBodyweightContext,
  focusExerciseId,
  onFocusHandled,
  onFinish,
  busy,
}) {
  const summary = sessionDraftSummary(routine, state, entries);

  useEffect(() => {
    if (!focusExerciseId) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`log-${focusExerciseId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      onFocusHandled();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusExerciseId, onFocusHandled]);

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-app-line bg-app-card p-4">
        <h2 className="text-2xl font-black text-white">{routine.name}</h2>
        <p className="text-sm text-app-muted">{routine.day}요일 · {routine.title}</p>
      </div>

      {pendingKnee.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <h2 className="font-bold text-amber-100">회복 상태 체크</h2>
          <p className="mt-1 text-sm text-amber-100/80">지난 앵커 세션에서 상한을 달성했어요. 다음 증량 전에 부위별 회복 상태를 확인합니다.</p>
          <div className="mt-3 space-y-3">
            {pendingKnee.map((exercise) => (
              <div key={exercise.id} className="space-y-2">
                <span className="text-sm font-bold text-white">{profileById(exercise.profileId).name}</span>
                <p className="text-xs text-amber-100/80">{recoveryCheckText(profileById(exercise.profileId))}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setKneeApprovals((prev) => ({ ...prev, [exercise.id]: true }))} className={`rounded-md px-3 py-3 text-sm ${kneeApprovals[exercise.id] === true ? "bg-emerald-500 text-white" : "bg-app-card text-app-muted"}`}>
                    문제 없음
                  </button>
                  <button onClick={() => setKneeApprovals((prev) => ({ ...prev, [exercise.id]: false }))} className={`rounded-md px-3 py-3 text-sm ${kneeApprovals[exercise.id] === false ? "bg-red-500 text-white" : "bg-app-card text-app-muted"}`}>
                    불편했음
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {routine.exercises.map((exercise) => {
        const view = instanceView(exercise, state);
        const reps = entries[exercise.id] || [];
        return (
          <div key={exercise.id} id={`log-${exercise.id}`} className="scroll-mt-24">
          <ExerciseLogCard exercise={exercise} view={view}>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-app-muted">{formatWeight(view.weight, view)}</span>
              <span className="font-bold text-white">총 {sum(reps)} {view.isTime ? "초" : "회"}</span>
            </div>
            <QuickInputBar
              exercise={exercise}
              view={view}
              reps={reps}
              setEntries={setEntries}
            />
            <div className="mt-3 space-y-2">
              {reps.map((rep, index) => (
                <RepInput
                  key={`${exercise.id}-${index}`}
                  label={`${index + 1}\uC138\uD2B8`}
                  value={rep}
                  min={exercise.min}
                  max={exercise.max}
                  unit={view.isTime ? "\uCD08" : "\uD68C"}
                  onChange={(value) =>
                    setEntries((prev) => ({
                      ...prev,
                      [exercise.id]: (prev[exercise.id] || []).map((item, itemIndex) => (itemIndex === index ? value : item)),
                    }))
                  }
                />
              ))}
            </div>
          </ExerciseLogCard>
          </div>
        );
      })}

      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="오늘 컨디션, 통증, 특이사항"
        className="min-h-24 w-full rounded-lg border border-app-line bg-app-card p-4 text-white outline-none focus:border-app-accent"
      />

      <div className="rounded-lg border border-app-line bg-app-card p-4">
        <h2 className="font-bold text-white">체중 선택 기록</h2>
        <p className="mt-1 text-sm text-app-muted">운동 직후 기록이 필요할 때만 입력해도 됩니다.</p>
        <div className="mt-3 grid grid-cols-[1fr_132px] gap-2">
          <input
            type="number"
            step="0.1"
            value={bodyweight}
            onChange={(event) => setBodyweight(event.target.value)}
            placeholder="kg"
            className="min-w-0 rounded-md border border-app-line bg-app-bg px-3 text-white outline-none focus:border-app-accent"
          />
          <select
            value={bodyweightContext}
            onChange={(event) => setBodyweightContext(event.target.value)}
            className="rounded-md border border-app-line bg-app-bg px-2 text-sm text-white outline-none focus:border-app-accent"
          >
            <option value="post_workout">운동 후</option>
            <option value="morning_fasted">아침 공복</option>
            <option value="other">기타</option>
          </select>
        </div>
      </div>

      <SessionDraftSummary summary={summary} />

      <button onClick={onFinish} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-md bg-app-accent py-4 text-lg font-black text-white disabled:opacity-50">
        <Save className="h-5 w-5" />
        세션 완료
      </button>
    </section>
  );
}

function QuickInputBar({ exercise, view, reps, setEntries }) {
  const last = Array.isArray(view.lastReps) && view.lastReps.length ? view.lastReps : Array(reps.length).fill(exercise.min);

  function setExerciseReps(nextReps) {
    setEntries((prev) => ({ ...prev, [exercise.id]: nextReps }));
  }

  return (
    <div className="mt-3 grid grid-cols-4 gap-2">
      <button onClick={() => setExerciseReps(last.map((rep) => Number(rep || exercise.min)))} className="rounded-md bg-app-bg px-2 py-2 text-xs font-bold text-app-muted">
        지난값
      </button>
      <button onClick={() => setExerciseReps(reps.map((rep) => Number(rep || 0) + 1))} className="rounded-md bg-app-bg px-2 py-2 text-xs font-bold text-app-muted">
        전부 +1
      </button>
      <button onClick={() => setExerciseReps(reps.map(() => Number(reps[0] || exercise.min)))} className="rounded-md bg-app-bg px-2 py-2 text-xs font-bold text-app-muted">
        첫세트
      </button>
      <button onClick={() => setExerciseReps(reps.map(() => exercise.min))} className="rounded-md bg-app-bg px-2 py-2 text-xs font-bold text-app-muted">
        하한
      </button>
    </div>
  );
}

function SessionDraftSummary({ summary }) {
  return (
    <div className="rounded-lg border border-app-line bg-app-card p-4">
      <h2 className="font-bold text-white">완료 전 요약</h2>
      <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <Info label="총합" value={`${summary.totalReps}회`} />
        <Info label="성공 예상" value={`${summary.improvedCount}종목`} />
        <Info label="상한 달성" value={`${summary.topReadyCount}종목`} />
      </div>
      {summary.stallRiskCount > 0 && (
        <p className="mt-3 rounded-md bg-amber-500/15 px-3 py-2 text-sm text-amber-200">
          정체 가능 종목 {summary.stallRiskCount}개. 완료 후 앱이 자동으로 카운트를 반영합니다.
        </p>
      )}
    </div>
  );
}

function HistoryView({ history, bodyweightLogs, recommendationCooldowns, openDates, setOpenDates, analyticsOpen, setAnalyticsOpen, onRecommendationCooldown, onBodyweight }) {
  const groups = useMemo(() => groupHistoryByDate(history), [history]);

  if (!history.length) {
    return (
      <section className="space-y-4">
        <AnalyticsDashboard
          history={history}
          bodyweightLogs={bodyweightLogs}
          recommendationCooldowns={recommendationCooldowns}
          onRecommendationCooldown={onRecommendationCooldown}
          onBodyweight={onBodyweight}
        />
        <Empty title="아직 운동 기록이 없어" text="첫 세션을 완료하면 날짜별 히스토리가 쌓입니다." />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <article className="overflow-hidden rounded-lg border border-app-line bg-app-card">
        <button onClick={() => setAnalyticsOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 p-4 text-left">
          <div>
            <h2 className="font-bold text-white">대시보드</h2>
            <p className="mt-1 text-sm text-app-muted">주요 운동 진행, 체중 추세, 고급 분석</p>
          </div>
          <ChevronDown className={`h-5 w-5 text-app-muted transition ${analyticsOpen ? "rotate-180" : ""}`} />
        </button>
        {analyticsOpen && (
          <div className="space-y-4 border-t border-app-line p-4">
            <AnalyticsDashboard
              history={history}
              bodyweightLogs={bodyweightLogs}
              recommendationCooldowns={recommendationCooldowns}
              onRecommendationCooldown={onRecommendationCooldown}
              onBodyweight={onBodyweight}
            />
          </div>
        )}
      </article>
      {groups.map((group) => (
        <article key={group.key} className="overflow-hidden rounded-lg border border-app-line bg-app-card">
          <button onClick={() => setOpenDates((prev) => ({ ...prev, [group.key]: !prev[group.key] }))} className="flex w-full items-center justify-between gap-3 p-4 text-left">
            <div>
              <h2 className="font-bold text-white">{group.label}</h2>
              <p className="mt-1 text-sm text-app-muted">{group.sessions.length}세션 · 총 볼륨 {formatNumber(group.volume)}</p>
            </div>
            <ChevronDown className={`h-5 w-5 text-app-muted transition ${openDates[group.key] ? "rotate-180" : ""}`} />
          </button>
          {openDates[group.key] && (
            <div className="space-y-3 border-t border-app-line p-4">
              {group.sessions.map((session) => (
                <SessionHistoryCard key={session.id} session={session} />
              ))}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

function AnalyticsDashboard({ history, bodyweightLogs, recommendationCooldowns, onRecommendationCooldown, onBodyweight }) {
  const weekly = useMemo(() => weeklyMuscleVolume(history, 10), [history]);
  const progression = useMemo(() => progressionSeries(history), [history]);
  const compliance = useMemo(() => complianceSeries(history, 10), [history]);
  const bodyweight = useMemo(() => bodyweightWeeklyAverage(bodyweightLogs, 10), [bodyweightLogs]);
  const directSets = useMemo(() => weeklyDirectHardSets(history, 4), [history]);
  const recommendations = useMemo(
    () => plateauRecommendations(history, bodyweightLogs, 4, recommendationCooldowns),
    [history, bodyweightLogs, recommendationCooldowns]
  );
  return (
    <div className="space-y-4">
      <ProgressionCharts series={progression} />
      <BodyweightCard rows={bodyweight} logs={bodyweightLogs} onSave={onBodyweight} />
      <RecommendationCard recommendations={recommendations} onCooldown={onRecommendationCooldown} />
      <ComplianceChart rows={compliance} />
      <DirectHardSetsSummary rows={directSets} />
      <AdvancedAnalytics rows={weekly} />
    </div>
  );
}

function WeeklyMuscleVolumeChart({ rows }) {
  const latest = rows[rows.length - 1];
  const max = Math.max(...rows.flatMap((row) => Object.values(row.muscles)), 1);
  return (
    <section className="rounded-lg border border-app-line bg-app-card p-4">
      <h2 className="font-bold text-white">주간 근육군 볼륨</h2>
      <p className="mt-1 text-sm text-app-muted">최근 10주. 같은 주의 운동은 주 시작일 막대 하나에 합산됩니다.</p>
      <div className="mt-4 space-y-2">
        {MUSCLE_GROUPS.map((muscle) => {
          const value = latest?.muscles[muscle.id] || 0;
          return (
            <div key={muscle.id} className="grid grid-cols-[80px_1fr_54px] items-center gap-2 text-xs">
              <span className="text-app-muted">{muscle.label}</span>
              <div className="h-3 overflow-hidden rounded-full bg-app-bg">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, (value / max) * 100)}%`, backgroundColor: muscle.color }} />
              </div>
              <span className="text-right text-app-muted">{formatNumber(value)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex h-20 items-end gap-1">
        {rows.map((row) => {
          const total = Object.values(row.muscles).reduce((acc, value) => acc + value, 0);
          const maxTotal = Math.max(...rows.map((item) => Object.values(item.muscles).reduce((acc, value) => acc + value, 0)), 1);
          return (
            <div key={row.week} className="flex flex-1 flex-col items-center gap-1">
              <div className="w-full rounded-sm bg-app-accent" style={{ height: `${Math.max(4, (total / maxTotal) * 64)}px` }} />
              <span className="text-[10px] text-app-muted">{row.label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ProgressionCharts({ series }) {
  return (
    <section className="rounded-lg border border-app-line bg-app-card p-4">
      <h2 className="font-bold text-white">주요 운동 진행</h2>
      <p className="mt-1 text-sm text-app-muted">벤치/덤벨숄더/RDL은 e1RM, 나머지는 작업중량 기준</p>
      <div className="mt-4 space-y-3">
        {series.map((item) => (
          <MiniLineChart key={item.profileId} title={item.name} points={item.points} />
        ))}
      </div>
    </section>
  );
}

function MiniLineChartLegacy({ title, points }) {
  const recent = points.slice(-8);
  const width = 260;
  const height = 72;
  const max = Math.max(...recent.map((point) => point.metric || point.normalizedTotalLoad || point.weight), 1);
  const min = Math.min(...recent.map((point) => point.metric || point.normalizedTotalLoad || point.weight), 0);
  const span = Math.max(1, max - min);
  const path = recent
    .map((point, index) => {
      const x = recent.length === 1 ? width : (index / (recent.length - 1)) * width;
      const y = height - (((point.metric || point.normalizedTotalLoad || point.weight) - min) / span) * (height - 12) - 6;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const latest = recent[recent.length - 1];

  return (
    <div className="rounded-md bg-app-bg p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-white">{title}</span>
        <span className="text-xs text-app-muted">
          {latest ? `${latest.metricLabel} ${latest.metric} · ${latest.displayWeight}kg · ${latest.totalReps}회` : "기록 없음"}
        </span>
      </div>
      {recent.length ? (
        <svg viewBox={`0 0 ${width} ${height}`} className="h-20 w-full overflow-visible">
          <path d={path} fill="none" stroke="#6366f1" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          {recent.map((point, index) => {
            const x = recent.length === 1 ? width / 2 : (index / (recent.length - 1)) * width;
            const y = height - (((point.metric || point.normalizedTotalLoad || point.weight) - min) / span) * (height - 12) - 6;
            return <circle key={`${point.id}-${index}`} cx={x} cy={y} r="4" fill="#10b981" />;
          })}
        </svg>
      ) : (
        <p className="py-5 text-center text-sm text-app-muted">아직 기록 없음</p>
      )}
    </div>
  );
}

function BodyweightCard({ rows, logs, onSave }) {
  const [value, setValue] = useState("");
  const [context, setContext] = useState("morning_fasted");
  const recent = rows.filter((row) => row.average > 0);
  const latest = logs[0];
  const max = Math.max(...recent.map((row) => row.average), 1);
  const min = Math.min(...recent.map((row) => row.average), 0);
  const span = Math.max(1, max - min);

  async function save() {
    await onSave(value, "", context);
    setValue("");
  }

  return (
    <section className="rounded-lg border border-app-line bg-app-card p-4">
      <h2 className="font-bold text-white">체중 추세</h2>
      <p className="mt-1 text-sm text-app-muted">주간 평균은 아침 공복 값을 우선 사용하고, 없으면 전체 입력값으로 대체합니다.</p>
      <div className="mt-4 grid grid-cols-[1fr_132px_64px] gap-2">
        <input
          type="number"
          step="0.1"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={latest ? `최근 ${latest.value}kg` : "체중 kg"}
          className="min-w-0 flex-1 rounded-md border border-app-line bg-app-bg px-3 text-white outline-none focus:border-app-accent"
        />
        <select
          value={context}
          onChange={(event) => setContext(event.target.value)}
          className="rounded-md border border-app-line bg-app-bg px-2 text-sm text-white outline-none focus:border-app-accent"
        >
          <option value="morning_fasted">아침 공복</option>
          <option value="post_workout">운동 후</option>
          <option value="other">기타</option>
        </select>
        <button onClick={save} className="rounded-md bg-app-accent px-4 py-3 font-bold text-white">저장</button>
      </div>
      <div className="mt-4 flex h-20 items-end gap-2">
        {rows.map((row) => (
          <div key={row.week} className="flex flex-1 flex-col items-center gap-1">
            <div
              className={`w-full rounded-sm ${row.average ? "bg-emerald-500" : "bg-app-bg"}`}
              style={{ height: `${row.average ? Math.max(4, ((row.average - min) / span) * 56 + 4) : 4}px` }}
            />
            <span className={`text-[10px] ${row.confidence === "fallback" ? "text-amber-200" : "text-app-muted"}`}>
              {row.average ? `${row.average}${row.confidence === "fallback" ? "*" : ""}` : "-"}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-app-muted">* 표시는 해당 주에 아침 공복 기록이 없어 전체 입력값으로 계산한 낮은 신뢰 평균입니다.</p>
    </section>
  );
}

function RecommendationCard({ recommendations, onCooldown }) {
  return (
    <section className="rounded-lg border border-app-line bg-app-card p-4">
      <h2 className="font-bold text-white">정체 추천</h2>
      {recommendations.length ? (
        <div className="mt-3 space-y-2">
          {recommendations.map((item, index) => (
            <div key={`${item.type}-${index}`} className="rounded-md bg-app-bg p-3">
              <p className="font-bold text-white">{item.title}</p>
              <p className="mt-1 text-sm text-app-muted">{item.text}</p>
              <button onClick={() => onCooldown(item.key)} className="mt-2 rounded-md border border-app-line px-3 py-2 text-xs font-bold text-app-muted">
                2주간 숨김
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-app-muted">아직 정체 추천을 낼 만큼 기록이 충분하지 않거나, 진행이 정상 범위입니다.</p>
      )}
    </section>
  );
}

function DirectHardSetsSummary({ rows }) {
  const latest = rows[rows.length - 1];
  if (!latest) return null;
  const total = Object.values(latest.muscles).reduce((acc, value) => acc + value, 0);
  return (
    <section className="rounded-lg border border-app-line bg-app-card p-4">
      <h2 className="font-bold text-white">직접 하드세트</h2>
      <p className="mt-1 text-sm text-app-muted">추천 엔진 내부 기준입니다. 워밍업과 간접 보조 기여는 제외합니다.</p>
      <p className="mt-3 text-2xl font-black text-white">{total}세트</p>
    </section>
  );
}

function AdvancedAnalytics({ rows }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="overflow-hidden rounded-lg border border-app-line bg-app-card">
      <button onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 p-4 text-left">
        <div>
          <h2 className="font-bold text-white">고급 분석</h2>
          <p className="mt-1 text-sm text-app-muted">근육군별 주간 kg 볼륨 추세</p>
        </div>
        <ChevronDown className={`h-5 w-5 text-app-muted transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-app-line p-4">
          <WeeklyMuscleVolumeChart rows={rows} />
        </div>
      )}
    </article>
  );
}

function ComplianceChart({ rows }) {
  return (
    <section className="rounded-lg border border-app-line bg-app-card p-4">
      <h2 className="font-bold text-white">주간 수행</h2>
      <div className="mt-4 flex h-16 items-end gap-2">
        {rows.map((row) => (
          <div key={row.week} className="flex flex-1 flex-col items-center gap-1">
            <div className="w-full rounded-sm bg-emerald-500" style={{ height: `${Math.max(4, (row.sessions / 4) * 48)}px` }} />
            <span className="text-[10px] text-app-muted">{row.sessions}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SessionHistoryCardLegacy({ session }) {
  return (
    <div className="rounded-md bg-app-bg p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-white">{session.routine} · {session.routineTitle}</h3>
          <p className="text-xs text-app-muted">{formatDate(session.date)}</p>
        </div>
        <span className="text-xs text-app-muted">{formatNumber(sessionVolume(session))}</span>
      </div>
      {session.notes && <p className="mt-3 rounded-md bg-app-card px-3 py-2 text-sm text-app-muted">{session.notes}</p>}
      {session.recoveryConfirmations || session.kneeConfirmations ? (
        <div className="mt-3 rounded-md bg-app-card px-3 py-2 text-xs text-app-muted">
          {Object.values(session.recoveryConfirmations || session.kneeConfirmations || {}).map((item, index) => (
            <span key={index} className="mr-2">
              {item.type === "hamstring" ? "햄스트링" : "무릎"} {item.clean ? "문제 없음" : "불편함"}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-3 space-y-2">
        {(session.exercises || []).map((exercise) => (
          <div key={exercise.id} className="rounded-md bg-app-card px-3 py-2 text-sm">
            <div className="flex justify-between gap-2">
              <span className="font-semibold text-white">{exercise.name}</span>
              <span className="text-app-muted">{exercise.totalReps}</span>
            </div>
            <p className="mt-1 text-app-muted">
              {(exercise.sets || []).map((set) => `${set.weight}kg x ${set.reps}`).join(" / ") || `${exercise.weight}kg · ${exercise.reps?.join(", ")}`}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsSessionAccordionLegacy({ routine, state, open, onToggle, onProfile }) {
  const summary = sessionSummary(routine);
  return (
    <article className="overflow-hidden rounded-md bg-app-bg">
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-3 p-3 text-left">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-black text-white">{routine.name}</h3>
            <span className="rounded-md bg-app-card px-2 py-1 text-xs text-app-muted">{routine.day}</span>
            {summary.hasKneeSensitive && <Badge amber>무릎</Badge>}
            {summary.hasHamstringSensitive && <Badge rose>햄스트링</Badge>}
          </div>
          <p className="mt-1 text-xs text-app-muted">
            {summary.exerciseCount}종목 · {summary.totalSets}세트
          </p>
        </div>
        <ChevronDown className={`h-5 w-5 text-app-muted transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-app-line p-3">
          {routine.exercises.map((exercise) => {
            const profile = profileById(exercise.profileId);
            const data = state.profileData[profile.id] || {};
            const sharedCount = ROUTINES.flatMap((item) => item.exercises).filter((item) => item.profileId === profile.id).length;
            return (
              <div key={exercise.id} className="rounded-md bg-[#0f0f16] p-3">
                <div className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block text-sm font-semibold text-white">{profile.name}</span>
                    <span className="text-xs text-app-muted">
                      {profile.displayNote || weightBasisLabel(profile)}
                      {sharedCount > 1 ? ` · ${sharedCount}개 세션 공유` : ""}
                      {exercise.anchorSession ? " · 앵커" : " · 공유만"}
                    </span>
                  </span>
                  {profile.kneeSensitive && <Badge amber>무릎</Badge>}
                  {profile.hamstringSensitive && <Badge rose>햄스트링</Badge>}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <NumberField
                    label="현재"
                    value={data.weight || ""}
                    disabled={profile.isTime}
                    onChange={(value) => onProfile(profile.id, { weight: Number(value || 0), initialized: Number(value) > 0 || profile.isTime })}
                  />
                  <NumberField
                    label="증량폭"
                    value={data.incrementStep ?? profile.defaultIncrement}
                    disabled={profile.isTime}
                    onChange={(value) => onProfile(profile.id, { incrementStep: Math.max(0, Number(value || 0)) })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

function SettingsView({
  state,
  recoveryCode,
  recoveryInput,
  setRecoveryInput,
  onRecover,
  onChangeRecoveryCode,
  onProfile,
  currentRoutine,
  history,
  bodyweightLogs,
  openSections,
  setOpenSections,
  onlyToday,
  setOnlyToday,
  onDeload,
  onReset,
  busy,
}) {
  const [copied, setCopied] = useState(false);
  const [customRecoveryCode, setCustomRecoveryCode] = useState("");
  const [recoveryEditOpen, setRecoveryEditOpen] = useState(false);
  const visibleRoutines = onlyToday ? [currentRoutine] : ROUTINES;

  useEffect(() => {
    setOpenSections((prev) => (Object.keys(prev).length ? prev : { [currentRoutine.id]: true }));
  }, [currentRoutine.id, setOpenSections]);

  async function copyCode() {
    await navigator.clipboard.writeText(recoveryCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-app-line bg-app-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-white">세션별 중량</h2>
            <p className="mt-1 text-sm text-app-muted">같은 운동 변형은 어느 세션에서 바꿔도 같이 적용됩니다.</p>
          </div>
          <button
            onClick={() => setOnlyToday((value) => !value)}
            className={`shrink-0 rounded-md px-3 py-2 text-xs font-bold ${onlyToday ? "bg-app-accent text-white" : "bg-app-bg text-app-muted"}`}
          >
            {onlyToday ? "오늘만" : "전체"}
          </button>
        </div>
        <div className="mt-3 space-y-3">
          {visibleRoutines.map((routine) => (
            <SettingsSessionAccordion
              key={routine.id}
              routine={routine}
              state={state}
              open={Boolean(openSections[routine.id])}
              onToggle={() => setOpenSections((prev) => ({ ...prev, [routine.id]: !prev[routine.id] }))}
              onProfile={onProfile}
            />
          ))}
        </div>
      </div>

      <PlannedSetBalanceCard />

      <div className="rounded-lg border border-app-line bg-app-card p-4">
        <h2 className="font-bold text-white">과부하 규칙</h2>
        <p className="mt-2 text-sm leading-6 text-app-muted">
          총 반복수가 지난 같은 세션보다 늘면 성공입니다. 상한을 모두 채우면 앵커 세션에서만 공유 중량이 올라가고, 정체 카운트는 세션별로 따로 쌓입니다.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={onDeload} className="flex items-center justify-center gap-2 rounded-md border border-app-line py-3 font-bold text-white">
            <RotateCcw className="h-4 w-4" />
            디로드
          </button>
          <button onClick={onReset} className="rounded-md border border-red-500/50 py-3 font-bold text-red-200">
            전체 초기화
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-app-line bg-app-card p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-app-accent" />
          <h2 className="font-bold text-white">복구 코드</h2>
        </div>
        <p className="mt-2 rounded-md bg-app-bg px-3 py-2 text-sm text-amber-200">브라우저 데이터를 지워도 이 코드로 다시 연결할 수 있어요. 기존 코드를 바꿔도 예전 코드는 내 데이터에 묶여 있어서 다른 사람이 가져갈 수 없어요.</p>
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 rounded-md bg-app-bg px-3 py-3 text-xl font-black tracking-[0.18em] text-white">{recoveryCode || "생성 중"}</div>
          <button onClick={copyCode} className="rounded-md bg-app-accent p-3 text-white" title="복사">
            <Copy className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-2 text-sm text-app-muted">{copied ? "복사됨" : "현재 표시된 코드가 대표 복구 코드입니다."}</p>
        <button
          type="button"
          onClick={() => setRecoveryEditOpen((value) => !value)}
          className="mt-4 flex w-full items-center justify-between rounded-md border border-app-line bg-app-bg px-3 py-3 text-left font-bold text-white"
        >
          복구 코드 변경 / 연결
          <ChevronDown className={`h-5 w-5 text-app-muted transition ${recoveryEditOpen ? "rotate-180" : ""}`} />
        </button>
        {recoveryEditOpen && (
          <div className="mt-3 space-y-3 rounded-md border border-app-line bg-app-bg p-3">
            <div className="rounded-md border border-app-line bg-[#0f0f16] p-3">
              <p className="text-sm font-bold text-white">내 복구 코드 직접 설정</p>
              <p className="mt-1 text-xs text-app-muted">영문과 숫자 4~20자로 설정할 수 있어요. 이미 다른 사람이 쓰는 코드는 사용할 수 없어요.</p>
              <div className="mt-3 space-y-2">
                <input
                  value={customRecoveryCode}
                  onChange={(event) => setCustomRecoveryCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                  placeholder="예: HYEONHU2026"
                  className="h-12 w-full rounded-md border border-app-line bg-app-bg px-3 text-white outline-none focus:border-app-accent"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const changed = await onChangeRecoveryCode(customRecoveryCode);
                    if (changed) setCustomRecoveryCode("");
                  }}
                  disabled={busy || customRecoveryCode.length < 4}
                  className="h-12 w-full rounded-md bg-app-accent px-4 font-bold text-white disabled:opacity-50"
                >
                  변경
                </button>
              </div>
            </div>
            <div className="rounded-md border border-app-line bg-[#0f0f16] p-3">
              <p className="text-sm font-bold text-white">다른 기기 코드 연결</p>
              <div className="mt-3 space-y-2">
                <input value={recoveryInput} onChange={(event) => setRecoveryInput(event.target.value.toUpperCase())} placeholder="복구 코드 입력" className="h-12 w-full rounded-md border border-app-line bg-app-bg px-3 text-white outline-none focus:border-app-accent" />
                <button type="button" onClick={onRecover} disabled={busy} className="h-12 w-full rounded-md border border-app-line px-4 font-bold text-white disabled:opacity-50">
                  연결
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function PlannedSetBalanceCard() {
  const balance = useMemo(() => plannedWeeklySetBalance(ROUTINES), []);
  const max = Math.max(...Object.values(balance), 1);
  return (
    <section className="rounded-lg border border-app-line bg-app-card p-4">
      <h2 className="font-bold text-white">계획 세트 밸런스</h2>
      <p className="mt-1 text-sm text-app-muted">루틴이 의도한 주간 직접 세트 분포입니다. 실제 수행 차트가 아니라 계획 카드입니다.</p>
      <div className="mt-4 space-y-2">
        {MUSCLE_GROUPS.map((muscle) => (
          <div key={muscle.id} className="grid grid-cols-[86px_1fr_36px] items-center gap-2 text-xs">
            <span className="text-app-muted">{muscle.label}</span>
            <div className="h-3 overflow-hidden rounded-full bg-app-bg">
              <div className="h-full rounded-full" style={{ width: `${(balance[muscle.id] / max) * 100}%`, backgroundColor: muscle.color }} />
            </div>
            <span className="text-right text-app-muted">{balance[muscle.id]}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ExerciseCard({ exercise, view, helperText }) {
  const unit = view.isTime ? "\uCD08" : "\uD68C";
  const lower = lowerBoundReps(exercise, view);
  const last = lastResultReps(exercise, view);
  const next = nextSuccessReps(exercise, view);

  return (
    <ExerciseLogCard exercise={exercise} view={view}>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Info label="\uD604\uC7AC" value={view.initialized || view.isTime ? formatWeight(view.weight, view) : "\uC124\uC815 \uD544\uC694"} />
        <Info label="\uAD6C\uC131" value={`${view.currentSets || exercise.defaultSets}\uC138\uD2B8 x ${exercise.min}~${exercise.max}${unit}`} />
        <Info label="\uD558\uD55C" value={formatRepSequence(lower)} />
        <Info label="\uC9C0\uB09C \uAE30\uB85D" value={formatRepSequence(last)} />
        <Info label="\uB2E4\uC74C \uC131\uACF5" value={`\uCD1D ${nextSuccessTotal(exercise, view)}${unit}+ \u00B7 ${formatRepSequence(next)}`} />
        <Info label="\uC815\uCCB4" value={`${view.stagnationCount || 0}\uD68C`} warn={Number(view.stagnationCount || 0) > 0} />
      </div>
      {helperText ? <p className="mt-3 text-sm text-amber-200">{helperText}</p> : null}
      {view.kneeCheckPending ? <p className="mt-3 rounded-md bg-amber-500/15 px-3 py-2 text-sm text-amber-200">\uBB34\uB98E \uC0C1\uD0DC \uCCB4\uD06C \uB300\uAE30 \uC911</p> : null}
      {view.hamstringCheckPending ? <p className="mt-3 rounded-md bg-rose-500/15 px-3 py-2 text-sm text-rose-200">\uD584\uC2A4\uD2B8\uB9C1 \uC0C1\uD0DC \uCCB4\uD06C \uB300\uAE30 \uC911</p> : null}
    </ExerciseLogCard>
  );
}

function ExerciseLogCard({ exercise, view, children }) {
  const meta = CATEGORY_META[view.category];
  return (
    <article className="rounded-lg border border-app-line bg-app-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-keep text-lg font-bold text-white">{view.name}</h3>
          <p className="mt-1 text-sm text-app-muted">
            {view.currentSets || exercise.defaultSets}\uC138\uD2B8 \u00B7 {exercise.min}~{exercise.max}
            {view.isTime ? "\uCD08" : "\uD68C"} {exercise.anchorSession ? "\u00B7 \uC575\uCEE4" : "\u00B7 \uACF5\uC720 \uC911\uB7C9"}
          </p>
        </div>
        <span className="shrink-0 rounded-md px-2 py-1 text-xs font-bold text-white" style={{ backgroundColor: meta.color }}>
          {view.kneeSensitive ? "\uBB34\uB98E \uC8FC\uC758" : view.hamstringSensitive ? "\uD584\uC2A4\uD2B8\uB9C1 \uC8FC\uC758" : meta.label}
        </span>
      </div>
      {children}
    </article>
  );
}

function RepInput({ label, value, min, max, unit, onChange }) {
  const number = Number(value || 0);
  const tone = number >= max ? "border-emerald-500 text-emerald-200" : number < min ? "border-red-500 text-red-200" : "border-app-line text-white";
  return (
    <div className="grid w-full min-w-0 grid-cols-[72px_52px_minmax(88px,112px)_52px] justify-center gap-2">
      <div className="flex h-12 items-center justify-center rounded-md bg-app-bg text-sm font-bold text-white">
        {label}
      </div>
      <button type="button" onClick={() => onChange(Math.max(0, number - 1))} className="flex h-12 w-[52px] items-center justify-center rounded-md bg-app-bg text-white">
        <Minus className="h-5 w-5" />
      </button>
      <div className={`flex h-12 min-w-0 items-center rounded-md border bg-app-bg ${tone}`}>
        <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value || 0))} className="min-w-0 flex-1 bg-transparent px-2 text-center font-bold outline-none" />
        <span className="shrink-0 pr-2 text-xs text-app-muted">{unit}</span>
      </div>
      <button type="button" onClick={() => onChange(number + 1)} className="flex h-12 w-[52px] items-center justify-center rounded-md bg-app-bg text-white">
        <Plus className="h-5 w-5" />
      </button>
    </div>
  );
}

function NumberField({ label, value, onChange, disabled }) {
  return (
    <label>
      <span className="mb-1 block text-xs text-app-muted">{label}</span>
      <input type="number" step="0.5" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-md border border-app-line bg-[#0f0f16] px-2 text-right text-white outline-none focus:border-app-accent disabled:opacity-40" />
    </label>
  );
}

function Info({ label, value, warn }) {
  return (
    <div className="rounded-md bg-app-bg p-3">
      <p className="text-xs text-app-muted">{label}</p>
      <p className={`mt-1 font-bold ${warn ? "text-amber-200" : "text-white"}`}>{value}</p>
    </div>
  );
}

function Badge({ children, amber, rose }) {
  const tone = amber ? "bg-amber-500/20 text-amber-200" : rose ? "bg-rose-500/20 text-rose-200" : "bg-app-bg text-app-muted";
  return <span className={`rounded-md px-2 py-1 text-xs font-bold ${tone}`}>{children}</span>;
}

function Empty({ title, text }) {
  return (
    <div className="rounded-lg border border-app-line bg-app-card p-8 text-center">
      <Dumbbell className="mx-auto mb-3 h-9 w-9 text-app-accent" />
      <h2 className="font-bold text-white">{title}</h2>
      <p className="mt-2 text-sm text-app-muted">{text}</p>
    </div>
  );
}

function Shell({ children }) {
  return <div className="min-h-screen bg-app-bg text-app-text">{children}</div>;
}

function groupHistoryByDate(history) {
  const groups = new Map();
  for (const session of history) {
    const key = session.localDateKey || dateKey(session.date);
    if (!groups.has(key)) groups.set(key, { key, label: session.localDateLabel || formatDateOnly(session.date), sessions: [], volume: 0 });
    const group = groups.get(key);
    group.sessions.push(session);
    group.volume += sessionVolume(session);
  }
  return Array.from(groups.values()).sort((a, b) => (a.key < b.key ? 1 : -1));
}

function sessionDraftSummary(routine, state, entries) {
  return routine.exercises.reduce(
    (acc, exercise) => {
      const view = instanceView(exercise, state);
      const reps = entries[exercise.id] || [];
      const total = sum(reps);
      const previous = sum(view.lastReps || []);
      const allAtTop = reps.length > 0 && reps.every((rep) => Number(rep) >= exercise.max);
      acc.totalReps += total;
      if (total > previous) acc.improvedCount += 1;
      if (previous > 0 && total <= previous) acc.stallRiskCount += 1;
      if (allAtTop) acc.topReadyCount += 1;
      return acc;
    },
    { totalReps: 0, improvedCount: 0, stallRiskCount: 0, topReadyCount: 0 }
  );
}

function recoveryCheckText(profile) {
  if (profile.hamstringSensitive) {
    return "다음날 날카로운 뒤허벅지 통증, 비정상적 국소 근육통, 회복 지연이 없었는지 확인";
  }
  if (profile.kneeSensitive) {
    return "다음날 통증, 부종, 불안정감/꺾임이 없었는지 확인";
  }
  return "다음날 회복 상태 확인";
}

function formatWeightLegacy(weight, profile) {
  if (profile.isTime || profile.equipment === "bodyweight") return "체중";
  if (profile.equipment === "barbell") return `${Number(weight || 0)}kg / 한쪽`;
  if (profile.equipment === "dumbbell") return `${Number(weight || 0)}kg / 개당`;
  if (profile.equipment === "machine_side") return `${Number(weight || 0)}kg / 한쪽`;
  return `${Number(weight || 0)}kg`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(toDate(value));
}

function formatDateOnly(value) {
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(toDate(value));
}

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(Math.round(Number(value || 0)));
}

function MiniLineChart({ title, points }) {
  const recent = points.slice(-8);
  const width = 260;
  const height = 72;
  const max = Math.max(...recent.map((point) => point.metric || point.normalizedTotalLoad || point.weight), 1);
  const min = Math.min(...recent.map((point) => point.metric || point.normalizedTotalLoad || point.weight), 0);
  const span = Math.max(1, max - min);
  const path = recent
    .map((point, index) => {
      const x = recent.length === 1 ? width : (index / (recent.length - 1)) * width;
      const y = height - (((point.metric || point.normalizedTotalLoad || point.weight) - min) / span) * (height - 12) - 6;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const latest = recent[recent.length - 1];

  return (
    <div className="rounded-md bg-app-bg p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-white">{title}</span>
        <span className="text-xs text-app-muted">{latest ? `${latest.metricLabel} ${latest.metric} · ${latest.displayWeightText} · ${latest.totalReps}회` : "기록 없음"}</span>
      </div>
      {recent.length ? (
        <svg viewBox={`0 0 ${width} ${height}`} className="h-20 w-full overflow-visible">
          <path d={path} fill="none" stroke="#6366f1" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          {recent.map((point, index) => {
            const x = recent.length === 1 ? width / 2 : (index / (recent.length - 1)) * width;
            const y = height - (((point.metric || point.normalizedTotalLoad || point.weight) - min) / span) * (height - 12) - 6;
            return <circle key={`${point.id}-${index}`} cx={x} cy={y} r="4" fill="#10b981" />;
          })}
        </svg>
      ) : (
        <p className="py-5 text-center text-sm text-app-muted">기록 없음</p>
      )}
    </div>
  );
}

function SettingsSessionAccordion({ routine, state, open, onToggle, onProfile }) {
  const summary = sessionSummary(routine);
  return (
    <article className="overflow-hidden rounded-md bg-app-bg">
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-3 p-3 text-left">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-black text-white">{routine.name}</h3>
            <span className="rounded-md bg-app-card px-2 py-1 text-xs text-app-muted">{routine.day}</span>
            {summary.hasKneeSensitive && <Badge amber>무릎</Badge>}
            {summary.hasHamstringSensitive && <Badge rose>햄스트링</Badge>}
          </div>
          <p className="mt-1 text-xs text-app-muted">
            {summary.exerciseCount}종목 · {summary.totalSets}세트
          </p>
        </div>
        <ChevronDown className={`h-5 w-5 text-app-muted transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-app-line p-3">
          {routine.exercises.map((exercise) => {
            const profile = profileById(exercise.profileId);
            const data = state.profileData[profile.id] || {};
            const sharedCount = ROUTINES.flatMap((item) => item.exercises).filter((item) => item.profileId === profile.id).length;
            return (
              <div key={exercise.id} className="rounded-md bg-[#0f0f16] p-3">
                <div className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block text-sm font-semibold text-white">{profile.name}</span>
                    <span className="text-xs text-app-muted">
                      {profile.displayNote || weightBasisLabel(profile)}
                      {sharedCount > 1 ? ` · ${sharedCount}세션 공유` : ""}
                      {exercise.anchorSession ? " · 앵커" : " · 공유만"}
                    </span>
                  </span>
                  {profile.kneeSensitive && <Badge amber>무릎</Badge>}
                  {profile.hamstringSensitive && <Badge rose>햄스트링</Badge>}
                </div>
                <div className={`mt-3 grid gap-2 ${hasAdjustableBaseWeight(profile) ? "grid-cols-3" : "grid-cols-2"}`}>
                  <NumberField
                    label="입력 중량"
                    value={data.weight || ""}
                    disabled={profile.isTime}
                    onChange={(value) => onProfile(profile.id, { weight: Number(value || 0), initialized: Number(value) > 0 || profile.isTime })}
                  />
                  <NumberField
                    label="증량폭"
                    value={data.incrementStep ?? profile.defaultIncrement}
                    disabled={profile.isTime}
                    onChange={(value) => onProfile(profile.id, { incrementStep: Math.max(0, Number(value || 0)) })}
                  />
                  {hasAdjustableBaseWeight(profile) ? (
                    <NumberField
                      label="바/기구"
                      value={data.baseWeight ?? profile.baseWeight ?? 0}
                      disabled={profile.isTime}
                      onChange={(value) => onProfile(profile.id, { baseWeight: Math.max(0, Number(value || 0)) })}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

function SessionHistoryCard({ session }) {
  return (
    <div className="rounded-md bg-app-bg p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-white">{session.routine}</h3>
          <p className="mt-1 text-xs text-app-muted">{formatDate(session.date)}</p>
        </div>
        <span className="text-sm font-bold text-white">{formatNumber(sessionVolume(session))}</span>
      </div>
      {session.notes ? <p className="mt-3 rounded-md bg-app-card px-3 py-2 text-sm text-app-muted">{session.notes}</p> : null}
      {session.recoveryConfirmations || session.kneeConfirmations ? (
        <div className="mt-3 rounded-md bg-app-card px-3 py-2 text-xs text-app-muted">
          {Object.values(session.recoveryConfirmations || session.kneeConfirmations || {}).map((item, index) => (
            <span key={index} className="mr-2">
              {item.type === "hamstring" ? "햄스트링" : "무릎"} {item.clean ? "문제 없음" : "불편함"}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-3 space-y-2">
        {(session.exercises || []).map((exercise) => {
          const profile = profileById(exercise.profileId);
          const setLine =
            (exercise.sets || [])
              .map((set) => `${formatWeightDisplay(set.weight, profile, { baseWeight: set.baseWeight ?? exercise.baseWeight ?? profile?.baseWeight })} x ${set.reps}`)
              .join(" / ") ||
            `${formatWeightDisplay(exercise.weight, profile, { baseWeight: exercise.baseWeight ?? profile?.baseWeight })} · ${exercise.reps?.join(", ") || ""}`;
          return (
            <div key={exercise.id} className="rounded-md bg-app-card px-3 py-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="font-semibold text-white">{exercise.name}</span>
                <span className="text-app-muted">{exercise.totalReps}</span>
              </div>
              <p className="mt-1 text-app-muted">{setLine}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatWeight(weight, profile) {
  return formatWeightDisplay(weight, profile, {
    baseWeight: profile.baseWeight,
    includeTotal: profile.displayMode === "per_side_plus_bar" || profile.displayMode === "per_side" || profile.displayMode === "per_hand",
  });
}

function makeRecoveryCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}
