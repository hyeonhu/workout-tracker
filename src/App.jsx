import { useEffect, useMemo, useState } from "react";
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
  PROFILE_LIST,
  ROUTINES,
  createInitialState,
  instanceView,
  migrateState,
  profileById,
  sessionSummary,
  weightBasisLabel,
} from "./routines";
import { complianceSeries, dateKey, progressionSeries, sessionVolume, toDate, weeklyMuscleVolume } from "./analytics";
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
  const [tab, setTab] = useState("today");
  const [entries, setEntries] = useState({});
  const [sessionNotes, setSessionNotes] = useState("");
  const [kneeApprovals, setKneeApprovals] = useState({});
  const [recoveryCode, setRecoveryCode] = useState(() => localStorage.getItem("recoveryCode") || "");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [status, setStatus] = useState("준비 중");
  const [busy, setBusy] = useState(false);

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
      if (snapshot.data().schemaVersion !== 2) await setDoc(stateRef, migrated);
      setStatus("저장됨");
    });
    return unsubscribe;
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
    if (!user || !ownerUid || recoveryCode) return;
    const code = makeRecoveryCode();
    setDoc(doc(db, "recoveryCodes", code), { uid: ownerUid, createdAt: serverTimestamp() }).then(() => {
      localStorage.setItem("recoveryCode", code);
      setRecoveryCode(code);
    });
  }, [user, ownerUid, recoveryCode]);

  const appState = state ? migrateState(state) : null;
  const routine = ROUTINES[Number(appState?.currentRoutineIndex || 0)] || ROUTINES[0];
  const pendingKnee = appState
    ? routine.exercises.filter((exercise) => exercise.anchorSession && profileById(exercise.profileId).kneeSensitive && instanceView(exercise, appState).kneeCheckPending)
    : [];

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
  }, [appState?.currentRoutineIndex, appState?.sessionCount]);

  async function saveState(nextState) {
    if (!ownerUid) return;
    await setDoc(doc(db, "users", ownerUid, "state", "current"), migrateState(nextState));
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
        setTab("log");
        return;
      }
      const result = completeSession(appState, routine, entries, kneeApprovals, sessionNotes.trim());
      await addDoc(collection(db, "users", ownerUid, "history"), {
        date: serverTimestamp(),
        sessionId: routine.id,
        routine: routine.name,
        routineTitle: routine.title,
        notes: result.notes,
        kneeConfirmations: result.kneeConfirmations,
        exercises: result.historyExercises,
      });
      await saveState(result.nextState);
      setTab("today");
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
            <h1 className="text-2xl font-bold tracking-normal text-app-text">운동 트래커</h1>
          </div>
          <div className="rounded-full border border-app-line px-3 py-1 text-xs text-app-muted">{status}</div>
        </div>
      </header>

      <main className="mx-auto min-h-[calc(100vh-160px)] w-full max-w-[480px] px-4 pb-28 pt-4">
        {tab === "today" && <TodayView state={appState} currentRoutine={routine} onLog={() => setTab("log")} onSettings={() => setTab("settings")} />}
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
            onFinish={finishSession}
            busy={busy}
          />
        )}
        {tab === "history" && <HistoryView history={history} />}
        {tab === "settings" && (
          <SettingsView
            state={appState}
            recoveryCode={recoveryCode}
            recoveryInput={recoveryInput}
            setRecoveryInput={setRecoveryInput}
            onRecover={recover}
            onProfile={updateProfile}
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
                onClick={() => setTab(item.id)}
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

function TodayView({ state, currentRoutine, onLog, onSettings }) {
  const [open, setOpen] = useState(() => ({ [currentRoutine.id]: true }));

  useEffect(() => {
    setOpen((prev) => ({ ...prev, [currentRoutine.id]: true }));
  }, [currentRoutine.id]);

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
          open={Boolean(open[routine.id])}
          current={routine.id === currentRoutine.id}
          onToggle={() => setOpen((prev) => ({ ...prev, [routine.id]: !prev[routine.id] }))}
        />
      ))}
    </section>
  );
}

function SessionAccordion({ routine, state, open, current, onToggle }) {
  const summary = sessionSummary(routine);
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
          </div>
        </div>
        <ChevronDown className={`h-5 w-5 text-app-muted transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-app-line p-4">
          {routine.exercises.map((exercise) => (
            <ExerciseCard key={exercise.id} exercise={exercise} view={instanceView(exercise, state)} />
          ))}
        </div>
      )}
    </article>
  );
}

function LogView({ state, routine, entries, setEntries, pendingKnee, kneeApprovals, setKneeApprovals, notes, setNotes, onFinish, busy }) {
  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-app-line bg-app-card p-4">
        <h2 className="text-2xl font-black text-white">{routine.name}</h2>
        <p className="text-sm text-app-muted">{routine.day}요일 · {routine.title}</p>
      </div>

      {pendingKnee.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <h2 className="font-bold text-amber-100">무릎 상태 체크</h2>
          <p className="mt-1 text-sm text-amber-100/80">지난 세션 이후 통증, 부종, 불안정이 없었어?</p>
          <div className="mt-3 space-y-3">
            {pendingKnee.map((exercise) => (
              <div key={exercise.id} className="space-y-2">
                <span className="text-sm font-bold text-white">{profileById(exercise.profileId).name}</span>
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
          <ExerciseLogCard key={exercise.id} exercise={exercise} view={view}>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-app-muted">{formatWeight(view.weight, view)}</span>
              <span className="font-bold text-white">총 {sum(reps)} {view.isTime ? "초" : "회"}</span>
            </div>
            <div className="mt-3 space-y-2">
              {reps.map((rep, index) => (
                <RepInput
                  key={`${exercise.id}-${index}`}
                  value={rep}
                  min={exercise.min}
                  max={exercise.max}
                  unit={view.isTime ? "초" : "회"}
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
        );
      })}

      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="오늘 컨디션, 통증, 특이사항"
        className="min-h-24 w-full rounded-lg border border-app-line bg-app-card p-4 text-white outline-none focus:border-app-accent"
      />

      <button onClick={onFinish} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-md bg-app-accent py-4 text-lg font-black text-white disabled:opacity-50">
        <Save className="h-5 w-5" />
        세션 완료
      </button>
    </section>
  );
}

function HistoryView({ history }) {
  const [open, setOpen] = useState({});
  const groups = useMemo(() => groupHistoryByDate(history), [history]);

  if (!history.length) return <Empty title="아직 기록이 없어" text="첫 세션을 완료하면 여기에 쌓입니다." />;

  return (
    <section className="space-y-4">
      <AnalyticsDashboard history={history} />
      {groups.map((group) => (
        <article key={group.key} className="overflow-hidden rounded-lg border border-app-line bg-app-card">
          <button onClick={() => setOpen((prev) => ({ ...prev, [group.key]: !prev[group.key] }))} className="flex w-full items-center justify-between gap-3 p-4 text-left">
            <div>
              <h2 className="font-bold text-white">{group.label}</h2>
              <p className="mt-1 text-sm text-app-muted">{group.sessions.length}세션 · 총 볼륨 {formatNumber(group.volume)}</p>
            </div>
            <ChevronDown className={`h-5 w-5 text-app-muted transition ${open[group.key] ? "rotate-180" : ""}`} />
          </button>
          {open[group.key] && (
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

function AnalyticsDashboard({ history }) {
  const weekly = useMemo(() => weeklyMuscleVolume(history, 10), [history]);
  const progression = useMemo(() => progressionSeries(history), [history]);
  const compliance = useMemo(() => complianceSeries(history, 10), [history]);
  return (
    <div className="space-y-4">
      <WeeklyMuscleVolumeChart rows={weekly} />
      <ProgressionCharts series={progression} />
      <ComplianceChart rows={compliance} />
    </div>
  );
}

function WeeklyMuscleVolumeChart({ rows }) {
  const latest = rows[rows.length - 1];
  const max = Math.max(...rows.flatMap((row) => Object.values(row.muscles)), 1);
  return (
    <section className="rounded-lg border border-app-line bg-app-card p-4">
      <h2 className="font-bold text-white">주간 근육군 볼륨</h2>
      <p className="mt-1 text-sm text-app-muted">최근 10주, 균형과 급증 여부 확인용</p>
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
      <p className="mt-1 text-sm text-app-muted">무게 추세와 총 반복수</p>
      <div className="mt-4 space-y-3">
        {series.map((item) => (
          <MiniLineChart key={item.profileId} title={item.name} points={item.points} />
        ))}
      </div>
    </section>
  );
}

function MiniLineChart({ title, points }) {
  const recent = points.slice(-8);
  const width = 260;
  const height = 72;
  const max = Math.max(...recent.map((point) => point.weight), 1);
  const min = Math.min(...recent.map((point) => point.weight), 0);
  const span = Math.max(1, max - min);
  const path = recent
    .map((point, index) => {
      const x = recent.length === 1 ? width : (index / (recent.length - 1)) * width;
      const y = height - ((point.weight - min) / span) * (height - 12) - 6;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const latest = recent[recent.length - 1];

  return (
    <div className="rounded-md bg-app-bg p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-white">{title}</span>
        <span className="text-xs text-app-muted">{latest ? `${latest.weight}kg · ${latest.totalReps}` : "기록 없음"}</span>
      </div>
      {recent.length ? (
        <svg viewBox={`0 0 ${width} ${height}`} className="h-20 w-full overflow-visible">
          <path d={path} fill="none" stroke="#6366f1" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          {recent.map((point, index) => {
            const x = recent.length === 1 ? width / 2 : (index / (recent.length - 1)) * width;
            const y = height - ((point.weight - min) / span) * (height - 12) - 6;
            return <circle key={`${point.id}-${index}`} cx={x} cy={y} r="4" fill="#10b981" />;
          })}
        </svg>
      ) : (
        <p className="py-5 text-center text-sm text-app-muted">아직 기록 없음</p>
      )}
    </div>
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

function SessionHistoryCard({ session }) {
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

function SettingsView({ state, recoveryCode, recoveryInput, setRecoveryInput, onRecover, onProfile, onDeload, onReset, busy }) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    await navigator.clipboard.writeText(recoveryCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-app-line bg-app-card p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-app-accent" />
          <h2 className="font-bold text-white">복구 코드</h2>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 rounded-md bg-app-bg px-3 py-3 text-xl font-black tracking-[0.18em] text-white">{recoveryCode || "생성 중"}</div>
          <button onClick={copyCode} className="rounded-md bg-app-accent p-3 text-white" title="복사">
            <Copy className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-2 text-sm text-app-muted">{copied ? "복사됨" : "브라우저 데이터를 지웠을 때 이 코드로 다시 연결합니다."}</p>
        <div className="mt-4 flex gap-2">
          <input value={recoveryInput} onChange={(event) => setRecoveryInput(event.target.value.toUpperCase())} placeholder="복구 코드 입력" className="min-w-0 flex-1 rounded-md border border-app-line bg-app-bg px-3 text-white outline-none focus:border-app-accent" />
          <button onClick={onRecover} disabled={busy} className="rounded-md border border-app-line px-4 font-bold text-white disabled:opacity-50">
            연결
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-app-line bg-app-card p-4">
        <h2 className="font-bold text-white">운동별 중량</h2>
        <div className="mt-3 space-y-3">
          {PROFILE_LIST.map((profile) => {
            const data = state.profileData[profile.id] || {};
            return (
              <div key={profile.id} className="rounded-md bg-app-bg p-3">
                <div className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block text-sm font-semibold text-white">{profile.name}</span>
                    <span className="text-xs text-app-muted">{profile.displayNote || weightBasisLabel(profile)}</span>
                  </span>
                  {profile.kneeSensitive && <Badge amber>무릎</Badge>}
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
      </div>

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
    </section>
  );
}

function ExerciseCard({ exercise, view }) {
  return (
    <ExerciseLogCard exercise={exercise} view={view}>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Info label="현재" value={view.initialized || view.isTime ? formatWeight(view.weight, view) : "설정 필요"} />
        <Info label="목표" value={`총 ${Number(view.targetTotal || exercise.defaultSets * exercise.min)} ${view.isTime ? "초" : "회"} 이상`} />
        <Info label="구성" value={`${view.currentSets || exercise.defaultSets}세트 x ${exercise.min}~${exercise.max}${view.isTime ? "초" : "회"}`} />
        <Info label="정체" value={`${view.stagnationCount || 0}회`} warn={Number(view.stagnationCount || 0) > 0} />
      </div>
      {view.kneeCheckPending && <p className="mt-3 rounded-md bg-amber-500/15 px-3 py-2 text-sm text-amber-200">무릎 상태 체크 대기 중</p>}
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
            {view.currentSets || exercise.defaultSets}세트 · {exercise.min}~{exercise.max}
            {view.isTime ? "초" : "회"} {exercise.anchorSession ? "· 앵커" : "· 공유 중량"}
          </p>
        </div>
        <span className="shrink-0 rounded-md px-2 py-1 text-xs font-bold text-white" style={{ backgroundColor: meta.color }}>
          {view.kneeSensitive ? "무릎 주의" : meta.label}
        </span>
      </div>
      {children}
    </article>
  );
}

function RepInput({ value, min, max, unit, onChange }) {
  const number = Number(value || 0);
  const tone = number >= max ? "border-emerald-500 text-emerald-200" : number < min ? "border-red-500 text-red-200" : "border-app-line text-white";
  return (
    <div className="grid grid-cols-[44px_1fr_44px] items-center gap-2">
      <button onClick={() => onChange(Math.max(0, number - 1))} className="flex h-11 items-center justify-center rounded-md bg-app-bg text-white">
        <Minus className="h-5 w-5" />
      </button>
      <div className={`flex h-11 items-center rounded-md border bg-app-bg ${tone}`}>
        <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value || 0))} className="min-w-0 flex-1 bg-transparent px-3 text-center font-bold outline-none" />
        <span className="pr-3 text-sm text-app-muted">{unit}</span>
      </div>
      <button onClick={() => onChange(number + 1)} className="flex h-11 items-center justify-center rounded-md bg-app-bg text-white">
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

function Badge({ children, amber }) {
  return <span className={`rounded-md px-2 py-1 text-xs font-bold ${amber ? "bg-amber-500/20 text-amber-200" : "bg-app-bg text-app-muted"}`}>{children}</span>;
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
    const key = dateKey(session.date);
    if (!groups.has(key)) groups.set(key, { key, label: formatDateOnly(session.date), sessions: [], volume: 0 });
    const group = groups.get(key);
    group.sessions.push(session);
    group.volume += sessionVolume(session);
  }
  return Array.from(groups.values()).sort((a, b) => (a.key < b.key ? 1 : -1));
}

function formatWeight(weight, profile) {
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

function makeRecoveryCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}
