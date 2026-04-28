import { useEffect, useMemo, useState } from "react";
import {
  Activity,
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
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { auth, db, ensureAnonymousUser } from "./firebase";
import {
  ALL_EXERCISES,
  CATEGORY_META,
  ROUTINES,
  TRACKED_EXERCISES,
  createInitialState,
  dataWithSharedLoad,
  defaultIncrementFor,
  groupMembers,
  weightBasisLabel,
} from "./routines";
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
      setState(snapshot.data());
      setStatus("저장됨");
    });
    return unsubscribe;
  }, [user, ownerUid]);

  useEffect(() => {
    if (!user || !ownerUid) return undefined;
    const historyRef = collection(db, "users", ownerUid, "history");
    const unsubscribe = onSnapshot(historyRef, (snapshot) => {
      const rows = snapshot.docs
        .map((historyDoc) => ({ id: historyDoc.id, ...historyDoc.data() }))
        .sort((a, b) => dateMs(b.date) - dateMs(a.date))
        .slice(0, 30);
      setHistory(rows);
    });
    return unsubscribe;
  }, [user, ownerUid]);

  useEffect(() => {
    if (!user || !ownerUid || recoveryCode) return;
    const code = makeRecoveryCode();
    setDoc(doc(db, "recoveryCodes", code), { uid: ownerUid, createdAt: serverTimestamp() }).then(() => {
      localStorage.setItem("recoveryCode", code);
      setRecoveryCode(code);
    });
  }, [user, ownerUid, recoveryCode]);

  const routine = ROUTINES[Number(state?.currentRoutineIndex || 0)] || ROUTINES[0];
  const exerciseData = state?.exerciseData || {};

  useEffect(() => {
    if (!state) return;
    const nextEntries = {};
    for (const exercise of routine.exercises) {
      const data = dataWithSharedLoad(exercise, exerciseData);
      const sets = Number(data?.currentSets || exercise.defaultSets);
      const source = data?.lastReps?.length ? data.lastReps : Array(sets).fill(exercise.min);
      nextEntries[exercise.id] = Array.from({ length: sets }, (_, index) => Number(source[index] || exercise.min));
    }
    setEntries(nextEntries);
    setKneeApprovals({});
  }, [state?.currentRoutineIndex, state?.sessionCount]);

  const pendingKnee = routine.exercises.filter((exercise) => dataWithSharedLoad(exercise, exerciseData)?.kneeCheckPending);
  const initializedCount = TRACKED_EXERCISES.filter((exercise) => dataWithSharedLoad(exercise, exerciseData)?.initialized).length;

  async function saveState(nextState) {
    if (!ownerUid) return;
    await setDoc(doc(db, "users", ownerUid, "state", "current"), nextState);
  }

  async function updateWeight(id, value) {
    const exercise = ALL_EXERCISES.find((item) => item.id === id);
    const members = groupMembers(exercise.groupId);
    const nextExerciseData = { ...exerciseData };
    for (const member of members) {
      nextExerciseData[member.id] = {
        ...(nextExerciseData[member.id] || {}),
        weight: Number(value || 0),
        incrementStep: Number(dataWithSharedLoad(member, exerciseData).incrementStep || defaultIncrementFor(member)),
        initialized: Number(value) > 0 || member.isTime,
        currentSets: Number(nextExerciseData[member.id]?.currentSets || member.defaultSets || 1),
      };
    }
    const nextState = {
      ...state,
      exerciseData: nextExerciseData,
      updatedAt: Date.now(),
    };
    setState(nextState);
    await saveState(nextState);
  }

  async function updateIncrement(id, value) {
    const exercise = ALL_EXERCISES.find((item) => item.id === id);
    const members = groupMembers(exercise.groupId);
    const nextExerciseData = { ...exerciseData };
    for (const member of members) {
      nextExerciseData[member.id] = {
        ...(nextExerciseData[member.id] || {}),
        incrementStep: Math.max(0, Number(value || 0)),
        currentSets: Number(nextExerciseData[member.id]?.currentSets || member.defaultSets || 1),
      };
    }
    const nextState = {
      ...state,
      exerciseData: nextExerciseData,
      updatedAt: Date.now(),
    };
    setState(nextState);
    await saveState(nextState);
  }

  async function finishSession() {
    setBusy(true);
    try {
      const missingKnee = pendingKnee.some((exercise) => kneeApprovals[exercise.id] === undefined);
      if (missingKnee) {
        setStatus("무릎 체크를 먼저 선택해줘");
        setTab("log");
        return;
      }
      const { nextState, historyExercises } = completeSession(state, routine, entries, kneeApprovals);
      await addDoc(collection(db, "users", ownerUid, "history"), {
        date: serverTimestamp(),
        routine: routine.name,
        routineTitle: routine.title,
        exercises: historyExercises,
      });
      await saveState(nextState);
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
    const nextState = applyDeload(state);
    await saveState({ ...nextState, lastDeloadAt: Date.now() });
    setStatus("디로드 적용됨");
  }

  if (!state) {
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
        {tab === "today" && (
          <TodayView
            routine={routine}
            exerciseData={exerciseData}
            initializedCount={initializedCount}
            onLog={() => setTab("log")}
            onSettings={() => setTab("settings")}
          />
        )}
        {tab === "log" && (
          <LogView
            routine={routine}
            exerciseData={exerciseData}
            entries={entries}
            setEntries={setEntries}
            pendingKnee={pendingKnee}
            kneeApprovals={kneeApprovals}
            setKneeApprovals={setKneeApprovals}
            onFinish={finishSession}
            busy={busy}
          />
        )}
        {tab === "history" && <HistoryView history={history} />}
        {tab === "settings" && (
          <SettingsView
            exerciseData={exerciseData}
            recoveryCode={recoveryCode}
            recoveryInput={recoveryInput}
            setRecoveryInput={setRecoveryInput}
            onRecover={recover}
            onWeight={updateWeight}
            onIncrement={updateIncrement}
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
                className={`flex h-14 flex-col items-center justify-center gap-1 rounded-md text-xs transition ${
                  active ? "bg-app-accent text-white" : "text-app-muted"
                }`}
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

function TodayView({ routine, exerciseData, initializedCount, onLog, onSettings }) {
  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-app-line bg-app-card p-4 shadow-glow">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-app-muted">{routine.day}요일 루틴</p>
            <h2 className="text-3xl font-black text-white">{routine.name}</h2>
            <p className="mt-1 text-sm text-app-muted">{routine.title}</p>
          </div>
          <div className="rounded-md bg-app-accent px-3 py-2 text-sm font-bold text-white">
            {initializedCount}/{TRACKED_EXERCISES.length}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={onLog} className="rounded-md bg-app-accent py-3 font-bold text-white">
            기록하기
          </button>
          <button onClick={onSettings} className="rounded-md border border-app-line py-3 font-bold text-app-text">
            중량 설정
          </button>
        </div>
      </div>

      {routine.exercises.map((exercise) => {
        const data = dataWithSharedLoad(exercise, exerciseData);
        const target = Number(data.targetTotal || exercise.defaultSets * exercise.min);
        return (
          <ExerciseCard key={exercise.id} exercise={exercise} data={data}>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <Info label="현재" value={data.initialized || exercise.isTime ? formatWeight(data.weight, exercise) : "설정 필요"} />
              <Info label="목표" value={`총 ${target} ${exercise.isTime ? "초" : "회"} 이상`} />
              <Info label="구성" value={`${data.currentSets || exercise.defaultSets}세트 x ${exercise.min}~${exercise.max}${exercise.isTime ? "초" : "회"}`} />
              <Info label="정체" value={`${data.stagnationCount || 0}회`} warn={Number(data.stagnationCount || 0) > 0} />
            </div>
            {data.kneeCheckPending && (
              <p className="mt-3 rounded-md bg-amber-500/15 px-3 py-2 text-sm text-amber-200">무릎 상태 체크 대기 중</p>
            )}
          </ExerciseCard>
        );
      })}
    </section>
  );
}

function LogView({ routine, exerciseData, entries, setEntries, pendingKnee, kneeApprovals, setKneeApprovals, onFinish, busy }) {
  return (
    <section className="space-y-4">
      {pendingKnee.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <h2 className="font-bold text-amber-100">무릎 상태 체크</h2>
          <p className="mt-1 text-sm text-amber-100/80">지난 세션 이후 통증, 부종, 불안정이 없었어?</p>
          <div className="mt-3 space-y-3">
            {pendingKnee.map((exercise) => (
              <div key={exercise.id} className="flex items-center justify-between gap-2">
                <span className="text-sm text-white">{exercise.name}</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setKneeApprovals((prev) => ({ ...prev, [exercise.id]: true }))}
                    className={`rounded-md px-3 py-2 text-sm ${kneeApprovals[exercise.id] === true ? "bg-emerald-500 text-white" : "bg-app-card text-app-muted"}`}
                  >
                    문제 없음
                  </button>
                  <button
                    onClick={() => setKneeApprovals((prev) => ({ ...prev, [exercise.id]: false }))}
                    className={`rounded-md px-3 py-2 text-sm ${kneeApprovals[exercise.id] === false ? "bg-red-500 text-white" : "bg-app-card text-app-muted"}`}
                  >
                    불편했음
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {routine.exercises.map((exercise) => {
        const data = dataWithSharedLoad(exercise, exerciseData);
        const reps = entries[exercise.id] || [];
        return (
          <ExerciseCard key={exercise.id} exercise={exercise} data={data}>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-app-muted">{formatWeight(data.weight, exercise)}</span>
              <span className="font-bold text-white">총 {sum(reps)} {exercise.isTime ? "초" : "회"}</span>
            </div>
            <div className="mt-3 space-y-2">
              {reps.map((rep, index) => (
                <RepInput
                  key={`${exercise.id}-${index}`}
                  value={rep}
                  min={exercise.min}
                  max={exercise.max}
                  unit={exercise.isTime ? "초" : "회"}
                  onChange={(value) =>
                    setEntries((prev) => ({
                      ...prev,
                      [exercise.id]: prev[exercise.id].map((item, itemIndex) => (itemIndex === index ? value : item)),
                    }))
                  }
                />
              ))}
            </div>
          </ExerciseCard>
        );
      })}
      <button
        onClick={onFinish}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-app-accent py-4 text-lg font-black text-white disabled:opacity-50"
      >
        <Save className="h-5 w-5" />
        세션 완료
      </button>
    </section>
  );
}

function HistoryView({ history }) {
  if (!history.length) {
    return <Empty title="아직 기록이 없어" text="첫 세션을 완료하면 여기에 쌓입니다." />;
  }

  return (
    <section className="space-y-3">
      <VolumeChart history={history} />
      {history.map((session) => (
        <article key={session.id} className="rounded-lg border border-app-line bg-app-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white">{session.routine} · {session.routineTitle}</h2>
              <p className="text-sm text-app-muted">{formatDate(session.date)}</p>
            </div>
            <span className="rounded-md bg-app-bg px-2 py-1 text-xs text-app-muted">{session.exercises?.length || 0}종목</span>
          </div>
          <div className="mt-3 space-y-2">
            {(session.exercises || []).map((exercise) => (
              <div key={exercise.id} className="rounded-md bg-app-bg px-3 py-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold text-white">{exercise.name}</span>
                  <span className="text-app-muted">{exercise.totalReps}</span>
                </div>
                <p className="mt-1 text-app-muted">
                  {formatHistoryWeight(exercise)} · {exercise.reps?.join(", ")}
                </p>
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}

function VolumeChart({ history }) {
  const points = useMemo(() => {
    return history
      .slice(0, 12)
      .reverse()
      .map((session) => {
        const exercises = session.exercises || [];
        const totalReps = exercises.reduce((acc, exercise) => acc + Number(exercise.totalReps || 0), 0);
        const volume = exercises.reduce((acc, exercise) => {
          const weight = Number(exercise.weight || 0);
          return acc + weight * Number(exercise.totalReps || 0);
        }, 0);
        return {
          id: session.id,
          label: session.routine,
          date: formatShortDate(session.date),
          totalReps,
          volume,
        };
      });
  }, [history]);
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  const maxVolume = Math.max(...points.map((point) => point.volume), 1);
  const maxReps = Math.max(...points.map((point) => point.totalReps), 1);
  const volumeDiff = latest && previous ? latest.volume - previous.volume : 0;
  const repsDiff = latest && previous ? latest.totalReps - previous.totalReps : 0;

  return (
    <div className="rounded-lg border border-app-line bg-app-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-white">진행 차트</h2>
          <p className="mt-1 text-sm text-app-muted">최근 12세션 기준</p>
        </div>
        <div className="text-right text-xs text-app-muted">
          <p>볼륨 {formatSigned(volumeDiff)}</p>
          <p>반복 {formatSigned(repsDiff)}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Info label="최근 볼륨" value={formatNumber(latest?.volume || 0)} />
        <Info label="최근 총합" value={`${latest?.totalReps || 0}회`} />
      </div>
      <div className="mt-4 h-40 rounded-md bg-app-bg p-3">
        <div className="flex h-full items-end gap-2">
          {points.map((point) => (
            <div key={point.id} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <div className="relative flex h-28 w-full items-end justify-center rounded-sm bg-[#1b1b27]">
                <div
                  className="absolute bottom-0 w-full rounded-sm bg-app-accent"
                  style={{ height: `${Math.max(4, (point.volume / maxVolume) * 100)}%` }}
                  title={`볼륨 ${formatNumber(point.volume)}`}
                />
                <div
                  className="absolute bottom-0 w-1/2 rounded-sm bg-emerald-400/80"
                  style={{ height: `${Math.max(4, (point.totalReps / maxReps) * 100)}%` }}
                  title={`반복 ${point.totalReps}`}
                />
              </div>
              <span className="text-[10px] font-bold text-white">{point.label}</span>
              <span className="text-[10px] text-app-muted">{point.date}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex gap-3 text-xs text-app-muted">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-app-accent" />추적 볼륨</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-400" />총 반복수</span>
      </div>
    </div>
  );
}

function SettingsView({
  exerciseData,
  recoveryCode,
  recoveryInput,
  setRecoveryInput,
  onRecover,
  onWeight,
  onIncrement,
  onDeload,
  onReset,
  busy,
}) {
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
          <div className="flex-1 rounded-md bg-app-bg px-3 py-3 text-xl font-black tracking-[0.18em] text-white">
            {recoveryCode || "생성 중"}
          </div>
          <button onClick={copyCode} className="rounded-md bg-app-accent p-3 text-white" title="복사">
            <Copy className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-2 text-sm text-app-muted">{copied ? "복사됨" : "브라우저 데이터를 지웠을 때 이 코드로 다시 연결합니다."}</p>
        <div className="mt-4 flex gap-2">
          <input
            value={recoveryInput}
            onChange={(event) => setRecoveryInput(event.target.value.toUpperCase())}
            placeholder="복구 코드 입력"
            className="min-w-0 flex-1 rounded-md border border-app-line bg-app-bg px-3 text-white outline-none focus:border-app-accent"
          />
          <button onClick={onRecover} disabled={busy} className="rounded-md border border-app-line px-4 font-bold text-white disabled:opacity-50">
            연결
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-app-line bg-app-card p-4">
        <h2 className="font-bold text-white">중량과 증량폭</h2>
        <div className="mt-3 space-y-3">
          {TRACKED_EXERCISES.map((exercise) => {
            const data = dataWithSharedLoad(exercise, exerciseData);
            return (
              <div key={exercise.id} className="rounded-md bg-app-bg p-3">
                <div className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block text-sm font-semibold text-white">{exercise.name}</span>
                    <span className="text-xs text-app-muted">
                      {weightBasisLabel(exercise)} · {exercise.min}~{exercise.max}
                      {exercise.isTime ? "초" : "회"}
                    </span>
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label>
                    <span className="mb-1 block text-xs text-app-muted">현재</span>
                    <input
                      type="number"
                      step="0.5"
                      value={data.weight || ""}
                      placeholder="kg"
                      onChange={(event) => onWeight(exercise.id, event.target.value)}
                      disabled={exercise.isTime}
                      className="h-11 w-full rounded-md border border-app-line bg-[#0f0f16] px-2 text-right text-white outline-none focus:border-app-accent disabled:opacity-40"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs text-app-muted">증량폭</span>
                    <input
                      type="number"
                      step="0.5"
                      value={data.incrementStep ?? defaultIncrementFor(exercise)}
                      placeholder="kg"
                      onChange={(event) => onIncrement(exercise.id, event.target.value)}
                      disabled={exercise.isTime}
                      className="h-11 w-full rounded-md border border-app-line bg-[#0f0f16] px-2 text-right text-white outline-none focus:border-app-accent disabled:opacity-40"
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-app-line bg-app-card p-4">
        <h2 className="font-bold text-white">과부하 규칙</h2>
        <p className="mt-2 text-sm leading-6 text-app-muted">
          지난 총합보다 1회 이상 늘면 성공. 모든 세트가 상한에 닿으면 설정한 증량폭만큼 자동 증량합니다.
          바벨은 한쪽 원판 기준, 덤벨은 개당 기준으로 적으면 됩니다. 무릎 주의 종목은 다음 세션의 무릎 체크가 통과해야 증량됩니다.
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

function ExerciseCard({ exercise, data, children }) {
  const meta = CATEGORY_META[exercise.category];
  return (
    <article className="rounded-lg border border-app-line bg-app-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-keep text-lg font-bold text-white">{exercise.name}</h3>
          <p className="mt-1 text-sm text-app-muted">{data.currentSets || exercise.defaultSets}세트 · {exercise.min}~{exercise.max}{exercise.isTime ? "초" : "회"}</p>
        </div>
        <span className="shrink-0 rounded-md px-2 py-1 text-xs font-bold text-white" style={{ backgroundColor: meta.color }}>
          {meta.label}
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
        <input
          type="number"
          value={value}
          onChange={(event) => onChange(Number(event.target.value || 0))}
          className="min-w-0 flex-1 bg-transparent px-3 text-center font-bold outline-none"
        />
        <span className="pr-3 text-sm text-app-muted">{unit}</span>
      </div>
      <button onClick={() => onChange(number + 1)} className="flex h-11 items-center justify-center rounded-md bg-app-bg text-white">
        <Plus className="h-5 w-5" />
      </button>
    </div>
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

function formatWeight(weight, exercise) {
  if (exercise.isTime || exercise.equipment === "bodyweight") return "체중";
  if (exercise.equipment === "barbell") return `${Number(weight || 0)}kg / 한쪽`;
  if (exercise.equipment === "dumbbell") return `${Number(weight || 0)}kg / 개당`;
  return `${Number(weight || 0)}kg`;
}

function formatHistoryWeight(historyExercise) {
  const exercise = ALL_EXERCISES.find((item) => item.id === historyExercise.id);
  if (!exercise) return `${Number(historyExercise.weight || 0)}kg`;
  return formatWeight(historyExercise.weight, exercise);
}

function formatDate(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : new Date();
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatShortDate(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : new Date();
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
  }).format(date);
}

function formatSigned(value) {
  const number = Math.round(Number(value || 0));
  if (number > 0) return `+${formatNumber(number)}`;
  return formatNumber(number);
}

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(Math.round(Number(value || 0)));
}

function dateMs(value) {
  if (!value) return 0;
  if (value.toMillis) return value.toMillis();
  if (value.toDate) return value.toDate().getTime();
  return new Date(value).getTime();
}

function makeRecoveryCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}
