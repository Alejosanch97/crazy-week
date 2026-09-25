import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  ChevronLeft,
  Shuffle,
  SkipForward,
  Undo2,
  Loader2,
  CheckCircle2,
  CloudOff,
  RefreshCw,
  X,
  ClipboardList,
  PartyPopper,
  Users,
  Copy,
  BookOpen,
} from "lucide-react";
import "../styles/diaUniversitario.css";

/* ───────────────────────── Configuración ───────────────────────── */

const API_URL = "https://script.google.com/macros/s/AKfycbyBGgwudAMUBWj4beridtqkWjPNfJvvEyEyFkF62pyTOCFPFeRPG309S-vMlnV2LDo6Ow/exec";
const CACHE_KEY = "dia_universitario_2026_v1";
const REFRESCO_MS = 30000; // trae inscripciones de otros equipos cada 30 s
const INSCRIPCIONES_CERRADAS = true; // true = nadie puede inscribir ni devolver

const COLORES = ["#FF5D8F", "#22B892", "#4DA8FF", "#F5A516", "#9B6CFF", "#FF7B4A", "#13A9B8", "#D9559A"];

const NIVELES = {
  PRIMARIA: {
    titulo: "Primaria",
    emoji: "🎒",
    horas: ["7:00 – 8:45", "9:30 – 11:00", "11:00 – 1:15", "1:15 – 2:45"],
    cursos: [
      { id: "FIRST GRADE", label: "Primero", corto: "1°" },
      { id: "SECOND GRADE", label: "Segundo", corto: "2°" },
      { id: "THIRD GRADE", label: "Tercero", corto: "3°" },
      { id: "FOURTH GRADE", label: "Cuarto", corto: "4°" },
      { id: "FIFTH GRADE", label: "Quinto", corto: "5°" },
    ],
  },
  BACHILLERATO: {
    titulo: "Bachillerato",
    emoji: "🎓",
    horas: ["7:00 – 8:45", "8:45 – 11:00", "11:00 – 12:30", "1:15 – 2:50"],
    cursos: [
      { id: "SIXTH GRADE", label: "Sexto", corto: "6°" },
      { id: "SEVENTH GRADE", label: "Séptimo", corto: "7°" },
      { id: "EIGHTH GRADE", label: "Octavo", corto: "8°" },
      { id: "NINTH GRADE", label: "Noveno", corto: "9°" },
      { id: "TENTH GRADE", label: "Décimo", corto: "10°" },
      { id: "ELEVENTH GRADE", label: "Undécimo", corto: "11°" },
    ],
  },
};

const CURSO_INFO = Object.values(NIVELES)
  .flatMap((n) => n.cursos)
  .reduce((acc, c) => ({ ...acc, [c.id]: c }), {});

/* ───────────────────────── Utilidades ───────────────────────── */

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const barajar = (lista) => {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// "🧸 Mi títere | Stefany | Salón 1°" -> { emoji, nombre, docente, salon }
const parseClase = (texto = "") => {
  const [titulo = "", docente = "", salon = ""] = texto.split("|").map((t) => t.trim());
  const espacio = titulo.indexOf(" ");
  return espacio > 0
    ? { emoji: titulo.slice(0, espacio), nombre: titulo.slice(espacio + 1), docente, salon }
    : { emoji: "📚", nombre: titulo, docente, salon };
};

const iniciales = (e) => `${(e.nombre || "")[0] || ""}${(e.apellido || "")[0] || ""}`.toUpperCase();
const primerNombre = (e) => (e.nombre || "").split(" ")[0];

const DEVICE = (() => {
  try {
    let d = localStorage.getItem("dia_u_device");
    if (!d) {
      d = `equipo-${Math.random().toString(36).slice(2, 6)}`;
      localStorage.setItem("dia_u_device", d);
    }
    return d;
  } catch {
    return "equipo";
  }
})();

const leerCache = () => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) || null;
  } catch {
    return null;
  }
};

const guardarCache = (estado) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(estado));
  } catch (e) {
    console.error(e);
  }
};

// Estado del servidor + operaciones que aún no llegan = lo que se ve en pantalla
const reconstruir = (servidor, cola) => {
  const mapa = {};
  servidor.forEach((i) => {
    mapa[i.id_estudiante] = { id_horario: i.id_horario, pendiente: false };
  });
  cola.forEach((op) => {
    if (op.op === "inscribir") mapa[op.id_estudiante] = { id_horario: op.id_horario, pendiente: true };
    else delete mapa[op.id_estudiante];
  });
  return mapa;
};

const getJSON = async (action) => {
  const res = await fetch(`${API_URL}?action=${action}`);
  const json = await res.json();
  if (json.status !== "success") throw new Error(json.message);
  return json;
};

const postJSON = async (body) => {
  const res = await fetch(API_URL, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  const json = JSON.parse(await res.text());
  if (json.status !== "success") throw new Error(json.message);
  return json;
};

/* ───────────────────────── Componente principal ───────────────────────── */

export const Home = () => {
  const cacheRef = useRef(undefined);
  if (cacheRef.current === undefined) cacheRef.current = leerCache();
  const cache = cacheRef.current;

  const [datos, setDatos] = useState(cache?.datos ?? null); // { horarios, cupos, estudiantes }
  const [inscritos, setInscritos] = useState(cache?.inscritos ?? {}); // id_estudiante -> { id_horario, pendiente }
  const [ordenes, setOrdenes] = useState(cache?.ordenes ?? {}); // course -> [ids sorteados]
  const [pendientes, setPendientes] = useState(cache?.cola?.length ?? 0);
  const [sync, setSync] = useState("idle"); // idle | syncing | offline
  const [errorCarga, setErrorCarga] = useState(null);
  const [nivel, setNivel] = useState(null);
  const [curso, setCurso] = useState(null);
  const [verResumen, setVerResumen] = useState(false);
  const [verPorHorario, setVerPorHorario] = useState(false);
  const [verPorMateria, setVerPorMateria] = useState(false);
  const [aviso, setAviso] = useState(null); // { texto, tipo, color }

  const colaRef = useRef(cache?.cola ?? []);
  const enviandoRef = useRef(false);
  const versionRef = useRef(0);
  const avisoTimer = useRef(null);

  const mostrarAviso = useCallback((texto, tipo = "ok", color) => {
    clearTimeout(avisoTimer.current);
    setAviso({ texto, tipo, color, key: uid() });
    avisoTimer.current = setTimeout(() => setAviso(null), tipo === "error" ? 4500 : 2200);
  }, []);

  /* ── Persistencia local: todo sobrevive a un refresh o a perder internet ── */
  useEffect(() => {
    guardarCache({ datos, inscritos, ordenes, cola: colaRef.current });
  }, [datos, inscritos, ordenes, pendientes]);

  /* ── Cola de sincronización: envía lotes en segundo plano ── */
  const enviarCola = useCallback(async () => {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    let espera = 1500;

    try {
      while (colaRef.current.length) {
        setSync("syncing");
        const lote = colaRef.current.slice(0, 40);

        try {
          const res = await postJSON({
            action: "sincronizar",
            dispositivo: DEVICE,
            ops: lote.map(({ opId, op, id_estudiante, id_horario }) => ({ opId, op, id_estudiante, id_horario })),
          });

          const enviados = new Set(lote.map((o) => o.opId));
          colaRef.current = colaRef.current.filter((o) => !enviados.has(o.opId));
          setPendientes(colaRef.current.length);

          const fallo = res.resultados.find((r) => !r.ok);
          if (fallo) {
            const op = lote.find((o) => o.opId === fallo.opId);
            mostrarAviso(`${op?.nombre ?? "Estudiante"}: ${fallo.error}. Elige otro horario.`, "error");
          }

          setInscritos(reconstruir(res.inscripciones, colaRef.current));
          espera = 1500;
        } catch (e) {
          console.error("Sync:", e);
          setSync("offline");
          await sleep(espera);
          espera = Math.min(espera * 2, 15000);
        }
      }
      setSync("idle");
    } finally {
      enviandoRef.current = false;
    }
  }, [mostrarAviso]);

  const encolar = useCallback(
    (op) => {
      colaRef.current = [...colaRef.current, op];
      versionRef.current++;
      setPendientes(colaRef.current.length);
      enviarCola();
    },
    [enviarCola]
  );

  /* ── Carga inicial ── */
  const cargarTodo = useCallback(async () => {
    setErrorCarga(null);
    try {
      const res = await getJSON("bootstrap");
      setDatos({ horarios: res.horarios, cupos: res.cupos, estudiantes: res.estudiantes });
      setInscritos(reconstruir(res.inscripciones, colaRef.current));
    } catch (e) {
      console.error(e);
      setErrorCarga(e.message || "No se pudo conectar");
    }
  }, []);

  useEffect(() => {
    cargarTodo();
    if (colaRef.current.length) enviarCola();
  }, [cargarTodo, enviarCola]);

  /* ── Refresco liviano: trae lo que inscriben otros computadores ── */
  useEffect(() => {
    const t = setInterval(async () => {
      if (enviandoRef.current || colaRef.current.length) return;
      const version = versionRef.current;
      try {
        const res = await getJSON("inscripciones");
        if (version === versionRef.current && !colaRef.current.length) {
          setInscritos(reconstruir(res.inscripciones, []));
        }
      } catch {
        /* silencioso: se reintenta en el próximo ciclo */
      }
    }, REFRESCO_MS);
    return () => clearInterval(t);
  }, []);

  /* ───────── Datos derivados ───────── */

  const estPorId = useMemo(() => {
    const m = {};
    (datos?.estudiantes || []).forEach((e) => (m[e.id] = e));
    return m;
  }, [datos]);

  const horariosNivel = useMemo(
    () => (datos?.horarios || []).filter((h) => h.nivel === nivel),
    [datos, nivel]
  );

  const colorDe = useCallback(
    (idHorario) => {
      const h = (datos?.horarios || []).find((x) => x.id_horario === idHorario);
      const lista = (datos?.horarios || []).filter((x) => x.nivel === h?.nivel);
      return COLORES[Math.max(0, lista.indexOf(h)) % COLORES.length];
    },
    [datos]
  );

  const cupoMapa = useMemo(() => {
    const m = {};
    (datos?.cupos || []).forEach((c) => (m[`${c.id_horario}|${c.course}`] = c.cupo));
    return m;
  }, [datos]);

  const ocupados = useMemo(() => {
    const m = {};
    Object.entries(inscritos).forEach(([id, ins]) => {
      const e = estPorId[id];
      if (!e) return;
      const k = `${ins.id_horario}|${e.course}`;
      m[k] = (m[k] || 0) + 1;
    });
    return m;
  }, [inscritos, estPorId]);

  const cupoDe = (idH, course) => cupoMapa[`${idH}|${course}`] || 0;
  const libres = (idH, course) => cupoDe(idH, course) - (ocupados[`${idH}|${course}`] || 0);

  const cursosNivel = nivel ? NIVELES[nivel].cursos : [];

  const libresHorario = (idH) => cursosNivel.reduce((s, c) => s + libres(idH, c.id), 0);
  const totalHorario = (idH) => cursosNivel.reduce((s, c) => s + cupoDe(idH, c.id), 0);

  const estudiantesDe = useCallback(
    (course) => (datos?.estudiantes || []).filter((e) => e.course === course),
    [datos]
  );

  const inscritosEn = (course) => estudiantesDe(course).filter((e) => inscritos[e.id]).length;

  const resumenNivel = (clave) => {
    const lista = (datos?.estudiantes || []).filter((e) => e.nivel === clave);
    return { total: lista.length, listos: lista.filter((e) => inscritos[e.id]).length };
  };

  /* ── Orden sorteado del curso activo ── */
  const orden = useMemo(() => {
    if (!curso) return [];
    const ids = estudiantesDe(curso).map((e) => e.id);
    const guardado = (ordenes[curso] || []).filter((id) => ids.includes(id));
    const nuevos = ids.filter((id) => !guardado.includes(id));
    return [...guardado, ...nuevos];
  }, [curso, ordenes, estudiantesDe]);

  const turno = orden.filter((id) => !inscritos[id]);
  const actual = turno.length ? estPorId[turno[0]] : null;
  const yaEligieron = orden.filter((id) => inscritos[id]).map((id) => estPorId[id]);

  /* ───────── Acciones ───────── */

  const abrirCurso = (course) => {
    if (!ordenes[course]) {
      setOrdenes((o) => ({ ...o, [course]: barajar(estudiantesDe(course).map((e) => e.id)) }));
    }
    setCurso(course);
  };

  const volverASortear = () => {
    if (!window.confirm("¿Sortear de nuevo el orden de los que faltan?")) return;
    setOrdenes((o) => {
      const hechos = orden.filter((id) => inscritos[id]);
      return { ...o, [curso]: [...hechos, ...barajar(turno)] };
    });
  };

  const saltar = () => {
    if (!actual) return;
    setOrdenes((o) => ({ ...o, [curso]: [...orden.filter((id) => id !== actual.id), actual.id] }));
  };

  const inscribir = (est, horario) => {
    if (INSCRIPCIONES_CERRADAS) {
      mostrarAviso("Las inscripciones están cerradas", "error");
      return;
    }
    if (libres(horario.id_horario, est.course) <= 0) {
      mostrarAviso(`${horario.nombre} ya no tiene cupos para este curso`, "error");
      return;
    }
    setInscritos((prev) => ({ ...prev, [est.id]: { id_horario: horario.id_horario, pendiente: true } }));
    encolar({
      opId: uid(),
      op: "inscribir",
      id_estudiante: est.id,
      id_horario: horario.id_horario,
      nombre: primerNombre(est),
    });
    mostrarAviso(`${primerNombre(est)} quedó en ${horario.nombre}`, "ok", colorDe(horario.id_horario));
  };

  const deshacer = (est) => {
    if (INSCRIPCIONES_CERRADAS) {
      mostrarAviso("Las inscripciones están cerradas", "error");
      return;
    }
    setInscritos((prev) => {
      const next = { ...prev };
      delete next[est.id];
      return next;
    });
    encolar({ opId: uid(), op: "desinscribir", id_estudiante: est.id, nombre: primerNombre(est) });
    mostrarAviso(`${primerNombre(est)} vuelve a la fila`, "info");
  };

  /* ───────── Vistas ───────── */

  const barraSync = <SyncPill estado={sync} pendientes={pendientes} />;

  if (!datos) {
    return (
      <div className="du-app du-center">
        {errorCarga ? (
          <div className="du-empty">
            <span className="du-empty-emoji">🔌</span>
            <h2>No pudimos traer la información</h2>
            <p>Revisa la conexión a internet y la URL del Apps Script.</p>
            <button className="du-btn du-btn--primary" onClick={cargarTodo}>
              <RefreshCw size={18} /> Intentar de nuevo
            </button>
          </div>
        ) : (
          <div className="du-empty">
            <Loader2 className="du-spin" size={36} />
            <p>Preparando los horarios…</p>
          </div>
        )}
      </div>
    );
  }

  // 1 ─ Elegir nivel
  if (!nivel) {
    return (
      <div className="du-app">
        <header className="du-top">
          <div className="du-brand">
            <span className="du-brand-mark">🎓</span>
            <span>Instituto CREAR</span>
          </div>
          {barraSync}
        </header>

        <section className="du-hero">
          <p className="du-hero-date">Lunes 28 de septiembre</p>
          <h1 className="du-hero-title">Crear University Day</h1>
          <p className="du-hero-sub">
            {INSCRIPCIONES_CERRADAS
              ? "🔒 Inscripciones cerradas. Puedes consultar las listas por horario o por materia."
              : "Elige el nivel para empezar las inscripciones."}
          </p>
        </section>

        <div className="du-levels">
          {Object.entries(NIVELES).map(([clave, n]) => {
            const r = resumenNivel(clave);
            const pct = r.total ? Math.round((r.listos / r.total) * 100) : 0;
            return (
              <button key={clave} className={`du-level du-level--${clave.toLowerCase()}`} onClick={() => setNivel(clave)}>
                <span className="du-level-emoji">{n.emoji}</span>
                <span className="du-level-name">{n.titulo}</span>
                <span className="du-level-meta">
                  {r.listos} de {r.total} inscritos
                </span>
                <span className="du-progress">
                  <span style={{ width: `${pct}%` }} />
                </span>
              </button>
            );
          })}
        </div>

        <div className="du-home-actions">
          <button className="du-btn du-btn--primary du-btn--big" onClick={() => setVerPorHorario(true)}>
            <Users size={20} /> Ver inscritos por horario
          </button>
          <button className="du-btn du-btn--primary du-btn--big" onClick={() => setVerPorMateria(true)}>
            <BookOpen size={20} /> Ver inscritos por materia
          </button>
        </div>

        {verPorMateria && (
          <PorMateria
            datos={datos}
            inscritos={inscritos}
            onClose={() => setVerPorMateria(false)}
            onCopiado={() => mostrarAviso("Lista copiada. Pégala en Excel o Sheets", "ok")}
          />
        )}

        {verPorHorario && (
          <PorHorario
            datos={datos}
            inscritos={inscritos}
            onClose={() => setVerPorHorario(false)}
            onCopiado={() => mostrarAviso("Lista copiada. Pégala en Excel o Sheets", "ok")}
          />
        )}
        <Aviso aviso={aviso} />
      </div>
    );
  }

  // 2 ─ Horarios del nivel + elegir curso
  if (!curso) {
    return (
      <div className="du-app">
        <header className="du-top">
          <button className="du-back" onClick={() => setNivel(null)}>
            <ChevronLeft size={20} /> Niveles
          </button>
          <div className="du-top-actions">
            {barraSync}
            <button className="du-icon-btn" onClick={() => setVerResumen(true)} aria-label="Ver inscritos por horario">
              <ClipboardList size={20} />
            </button>
          </div>
        </header>

        <h1 className="du-page-title">
          {NIVELES[nivel].emoji} Horarios de {NIVELES[nivel].titulo}
        </h1>

        <section className="du-section">
          <h2 className="du-section-title">¿Qué curso pasa ahora?</h2>
          <div className="du-courses">
            {cursosNivel.map((c) => {
              const total = estudiantesDe(c.id).length;
              const listos = inscritosEn(c.id);
              const completo = total > 0 && listos === total;
              return (
                <button
                  key={c.id}
                  className={`du-course ${completo ? "du-course--done" : ""}`}
                  onClick={() => abrirCurso(c.id)}
                  disabled={!total}
                >
                  <span className="du-course-num">{c.corto}</span>
                  <span className="du-course-name">{c.label}</span>
                  <span className="du-course-meta">
                    {completo ? "Completo ✓" : `${listos}/${total}`}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="du-section">
          <h2 className="du-section-title">Cupos disponibles</h2>
          <div className="du-schedules">
            {horariosNivel.map((h, i) => (
              <HorarioCard
                key={h.id_horario}
                horario={h}
                horas={NIVELES[nivel].horas}
                color={COLORES[i % COLORES.length]}
                libres={libresHorario(h.id_horario)}
                total={totalHorario(h.id_horario)}
              />
            ))}
          </div>
        </section>

        {verResumen && (
          <Resumen
            titulo={NIVELES[nivel].titulo}
            horarios={horariosNivel}
            inscritos={inscritos}
            estudiantes={(datos.estudiantes || []).filter((e) => e.nivel === nivel)}
            cursos={cursosNivel}
            onClose={() => setVerResumen(false)}
          />
        )}
        <Aviso aviso={aviso} />
      </div>
    );
  }

  // 3 ─ Turnos del curso
  const info = CURSO_INFO[curso];
  const posicion = orden.length - turno.length + 1;

  return (
    <div className="du-app">
      <header className="du-top">
        <button className="du-back" onClick={() => setCurso(null)}>
          <ChevronLeft size={20} /> Cursos
        </button>
        <div className="du-top-actions">
          {barraSync}
          <button className="du-icon-btn" onClick={volverASortear} aria-label="Sortear de nuevo" disabled={!turno.length || INSCRIPCIONES_CERRADAS}>
            <Shuffle size={20} />
          </button>
        </div>
      </header>

      <div className="du-turn-layout">
        <aside className="du-turn-side">
          {actual ? (
            <div className="du-carnet" key={actual.id}>
              <div className="du-carnet-band">
                <span className="du-carnet-hole" aria-hidden="true" />
                <span>Carnet universitario</span>
              </div>
              <div className="du-carnet-body">
                <span className="du-avatar">{iniciales(actual)}</span>
                <p className="du-carnet-turn">
                  Turno {posicion} de {orden.length}
                </p>
                <h2 className="du-carnet-name">{actual.nombre}</h2>
                <p className="du-carnet-last">{actual.apellido}</p>
                <span className="du-carnet-course">
                  {info.corto} {info.label}
                </span>
              </div>
              <div className="du-carnet-foot">
                <button className="du-btn du-btn--ghost" onClick={saltar} disabled={turno.length < 2 || INSCRIPCIONES_CERRADAS}>                 <SkipForward size={18} /> Pasa al final
                </button>
              </div>
            </div>
          ) : (
            <div className="du-carnet du-carnet--done">
              <PartyPopper size={44} />
              <h2>¡{info.label} quedó completo!</h2>
              <p>Todos los estudiantes tienen horario.</p>
              <button className="du-btn du-btn--primary" onClick={() => setCurso(null)}>
                Elegir otro curso
              </button>
            </div>
          )}

          {yaEligieron.length > 0 && (
            <div className="du-done-list">
              <h3>
                Ya eligieron <span>{yaEligieron.length}</span>
              </h3>
              <ul>
                {[...yaEligieron].reverse().map((e) => {
                  const ins = inscritos[e.id];
                  const h = horariosNivel.find((x) => x.id_horario === ins.id_horario);
                  return (
                    <li key={e.id}>
                      <span className="du-dot" style={{ background: colorDe(ins.id_horario) }} />
                      <span className="du-done-name">
                        {primerNombre(e)} {e.apellido.split(" ")[0]}
                      </span>
                      <span className="du-done-hor">{h?.nombre}</span>
                      {ins.pendiente ? (
                        <Loader2 size={15} className="du-spin du-muted" aria-label="Guardando" />
                      ) : (
                        <CheckCircle2 size={15} className="du-ok" aria-label="Guardado" />
                      )}
                      {!INSCRIPCIONES_CERRADAS && (
                        <button className="du-undo" onClick={() => deshacer(e)} aria-label={`Quitar a ${e.nombre}`}>
                          <Undo2 size={15} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </aside>

        <main className="du-turn-main">
          <h2 className="du-section-title">
            {actual ? `${primerNombre(actual)}, ¿qué horario eliges?` : "Horarios de este curso"}
          </h2>
          <div className="du-schedules du-schedules--pick">
            {horariosNivel.map((h, i) => {
              const quedan = libres(h.id_horario, curso);
              return (
                <HorarioCard
                  key={h.id_horario}
                  horario={h}
                  horas={NIVELES[nivel].horas}
                  color={COLORES[i % COLORES.length]}
                  libres={quedan}
                  total={cupoDe(h.id_horario, curso)}
                  asientos
                  onPick={actual && quedan > 0 && !INSCRIPCIONES_CERRADAS ? () => inscribir(actual, h) : undefined}
                />
              );
            })}
          </div>
        </main>
      </div>
      <Aviso aviso={aviso} />
    </div>
  );
};

/* ───────────────────────── Piezas ───────────────────────── */

const HorarioCard = ({ horario, color, libres, total, horas = [], asientos = false, onPick }) => {
  const lleno = libres <= 0;
  const Tag = onPick ? "button" : "div";

  return (
    <Tag
      className={`du-sched ${onPick ? "du-sched--pick" : ""} ${lleno ? "du-sched--full" : ""}`}
      style={{ "--c": color }}
      onClick={onPick}
      {...(onPick ? { type: "button" } : {})}
    >
      <div className="du-sched-head">
        <span className="du-sched-name">{horario.nombre}</span>
        <span className="du-sched-count">
          {lleno ? "Lleno" : `${libres} ${libres === 1 ? "cupo" : "cupos"}`}
        </span>
      </div>

      {asientos && total > 0 && (
        <div className="du-seats" aria-label={`${libres} de ${total} cupos libres`}>
          {Array.from({ length: total }).map((_, i) => (
            <span key={i} className={i < total - libres ? "du-seat du-seat--taken" : "du-seat"} />
          ))}
        </div>
      )}

      <ol className="du-blocks">
        {horario.bloques.map((b, i) => {
          const c = parseClase(b);
          return (
            <li key={i}>
              <span className="du-block-time">{horas[i] || ""}</span>
              <span className="du-block-emoji" aria-hidden="true">
                {c.emoji}
              </span>
              <span className="du-block-info">
                <strong>{c.nombre}</strong>
                {c.docente && <small className="du-block-teacher">{c.docente}</small>}
                <small>{c.salon}</small>
              </span>
            </li>
          );
        })}
      </ol>
    </Tag>
  );
};

const SyncPill = ({ estado, pendientes }) => {
  if (estado === "offline") {
    return (
      <span className="du-sync du-sync--offline">
        <CloudOff size={16} /> Sin conexión, {pendientes} en espera
      </span>
    );
  }
  if (estado === "syncing" || pendientes > 0) {
    return (
      <span className="du-sync du-sync--busy">
        <Loader2 size={16} className="du-spin" /> Guardando {pendientes}
      </span>
    );
  }
  return (
    <span className="du-sync du-sync--ok">
      <CheckCircle2 size={16} /> Todo guardado
    </span>
  );
};

const Aviso = ({ aviso }) =>
  aviso ? (
    <div
      key={aviso.key}
      className={`du-toast du-toast--${aviso.tipo}`}
      style={aviso.color ? { "--c": aviso.color } : undefined}
      role="status"
    >
      {aviso.texto}
    </div>
  ) : null;

const Resumen = ({ titulo, horarios, inscritos, estudiantes, cursos, onClose }) => {
  const ordenCurso = cursos.map((c) => c.id);
  const corto = Object.fromEntries(cursos.map((c) => [c.id, c.corto]));

  return (
    <div className="du-overlay" onClick={onClose}>
      <div className="du-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Inscritos por horario">
        <div className="du-modal-head">
          <h2>Inscritos de {titulo}</h2>
          <button className="du-icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>
        <div className="du-modal-body">
          {horarios.map((h, i) => {
            const lista = estudiantes
              .filter((e) => inscritos[e.id]?.id_horario === h.id_horario)
              .sort(
                (a, b) =>
                  ordenCurso.indexOf(a.course) - ordenCurso.indexOf(b.course) ||
                  a.apellido.localeCompare(b.apellido)
              );
            return (
              <section key={h.id_horario} className="du-roster" style={{ "--c": COLORES[i % COLORES.length] }}>
                <h3>
                  {h.nombre} <span>{lista.length}</span>
                </h3>
                {lista.length === 0 ? (
                  <p className="du-muted">Aún nadie en este horario.</p>
                ) : (
                  <ul>
                    {lista.map((e) => (
                      <li key={e.id}>
                        <span className="du-roster-grade">{corto[e.course]}</span>
                        {e.apellido} {e.nombre}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const PorHorario = ({ datos, inscritos, onClose, onCopiado }) => {
  const [nivelSel, setNivelSel] = useState("PRIMARIA");
  const [idSel, setIdSel] = useState(null);

  const horarios = (datos?.horarios || []).filter((h) => h.nivel === nivelSel);
  const activo = horarios.find((h) => h.id_horario === idSel) || horarios[0];
  const idxActivo = Math.max(0, horarios.indexOf(activo));
  const color = COLORES[idxActivo % COLORES.length];
  const cursos = NIVELES[nivelSel].cursos;

  const estudiantesNivel = (datos?.estudiantes || []).filter((e) => e.nivel === nivelSel);
  const deHorario = (idH) => estudiantesNivel.filter((e) => inscritos[e.id]?.id_horario === idH);

  const lista = activo ? deHorario(activo.id_horario) : [];
  const grupos = cursos
    .map((c) => ({
      curso: c,
      estudiantes: lista
        .filter((e) => e.course === c.id)
        .sort((a, b) => a.apellido.localeCompare(b.apellido) || a.nombre.localeCompare(b.nombre)),
    }))
    .filter((g) => g.estudiantes.length);

  const cambiarNivel = (clave) => {
    setNivelSel(clave);
    setIdSel(null);
  };

  const copiar = async () => {
    let n = 0;
    const filas = [
      `${activo?.nombre} – ${NIVELES[nivelSel].titulo}`,
      "N°\tCurso\tApellidos\tNombres",
      ...grupos.flatMap((g) =>
        g.estudiantes.map((e) => `${++n}\t${g.curso.label}\t${e.apellido}\t${e.nombre}`)
      ),
    ];
    try {
      await navigator.clipboard.writeText(filas.join("\n"));
      onCopiado?.();
    } catch {
      window.prompt("Copia la lista:", filas.join("\n"));
    }
  };

  let contador = 0;

  return (
    <div className="du-overlay" onClick={onClose}>
      <div className="du-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Inscritos por horario">
        <div className="du-modal-head">
          <h2>Inscritos por horario</h2>
          <button className="du-icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>

        <div className="du-modal-body du-modal-body--list">
          <div className="du-tabs">
            {Object.entries(NIVELES).map(([clave, n]) => (
              <button
                key={clave}
                className={`du-tab ${nivelSel === clave ? "du-tab--on" : ""}`}
                onClick={() => cambiarNivel(clave)}
              >
                {n.emoji} {n.titulo}
              </button>
            ))}
          </div>

          <div className="du-chips">
            {horarios.map((h, i) => (
              <button
                key={h.id_horario}
                className={`du-chip ${activo?.id_horario === h.id_horario ? "du-chip--on" : ""}`}
                style={{ "--c": COLORES[i % COLORES.length] }}
                onClick={() => setIdSel(h.id_horario)}
              >
                {h.nombre} <span>{deHorario(h.id_horario).length}</span>
              </button>
            ))}
          </div>

          {activo && (
            <section className="du-list" style={{ "--c": color }}>
              <div className="du-list-head">
                <h3>
                  {activo.nombre} <span>{lista.length} estudiantes</span>
                </h3>
                <button className="du-btn du-btn--ghost" onClick={copiar} disabled={!lista.length}>
                  <Copy size={16} /> Copiar lista
                </button>
              </div>

              {grupos.length === 0 ? (
                <p className="du-muted du-list-empty">Aún nadie inscrito en este horario.</p>
              ) : (
                grupos.map((g) => (
                  <div key={g.curso.id} className="du-list-group">
                    <h4>
                      {g.curso.corto} {g.curso.label} <span>{g.estudiantes.length}</span>
                    </h4>
                    <ol>
                      {g.estudiantes.map((e) => (
                        <li key={e.id}>
                          <span className="du-list-num">{++contador}</span>
                          <span>
                            {e.apellido} {e.nombre}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

const PorMateria = ({ datos, inscritos, onClose, onCopiado }) => {
  const [nivelSel, setNivelSel] = useState("PRIMARIA");
  const [materiaSel, setMateriaSel] = useState(null);

  const horas = NIVELES[nivelSel].horas;
  const cursos = NIVELES[nivelSel].cursos;
  const horarios = (datos?.horarios || []).filter((h) => h.nivel === nivelSel);
  const estudiantesNivel = (datos?.estudiantes || []).filter((e) => e.nivel === nivelSel);

  // Junta cada materia con todas las veces que aparece (horario + hora)
  const mapa = {};
  horarios.forEach((h) => {
    (h.bloques || []).forEach((b, i) => {
      const c = parseClase(b);
      if (!c.nombre) return;
      if (!mapa[c.nombre]) mapa[c.nombre] = { ...c, sesiones: [] };
      mapa[c.nombre].sesiones.push({ id_horario: h.id_horario, horario: h.nombre, hora: horas[i] || "" });
    });
  });
  const materias = Object.values(mapa).sort((a, b) => a.nombre.localeCompare(b.nombre));

  const activa = materias.find((m) => m.nombre === materiaSel) || materias[0];
  const idxActiva = Math.max(0, materias.indexOf(activa));
  const color = COLORES[idxActiva % COLORES.length];

  const alumnosDe = (mat) =>
    estudiantesNivel.filter((e) => mat.sesiones.some((s) => s.id_horario === inscritos[e.id]?.id_horario));
  const sesionDe = (e) => activa?.sesiones.find((s) => s.id_horario === inscritos[e.id]?.id_horario);
  const cuantosEnSesion = (s) => estudiantesNivel.filter((e) => inscritos[e.id]?.id_horario === s.id_horario).length;

  const lista = activa ? alumnosDe(activa) : [];
  const grupos = cursos
    .map((c) => ({
      curso: c,
      estudiantes: lista
        .filter((e) => e.course === c.id)
        .sort((a, b) => a.apellido.localeCompare(b.apellido) || a.nombre.localeCompare(b.nombre)),
    }))
    .filter((g) => g.estudiantes.length);

  const cambiarNivel = (clave) => {
    setNivelSel(clave);
    setMateriaSel(null);
  };

  const copiar = async () => {
    let n = 0;
    const filas = [
      `${activa?.nombre} – ${NIVELES[nivelSel].titulo}${activa?.docente ? ` – ${activa.docente}` : ""}`,
      "N°\tCurso\tApellidos\tNombres\tHorario\tHora",
      ...grupos.flatMap((g) =>
        g.estudiantes.map((e) => {
          const s = sesionDe(e);
          return `${++n}\t${g.curso.label}\t${e.apellido}\t${e.nombre}\t${s?.horario ?? ""}\t${s?.hora ?? ""}`;
        })
      ),
    ];
    try {
      await navigator.clipboard.writeText(filas.join("\n"));
      onCopiado?.();
    } catch {
      window.prompt("Copia la lista:", filas.join("\n"));
    }
  };

  let contador = 0;

  return (
    <div className="du-overlay" onClick={onClose}>
      <div className="du-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Inscritos por materia">
        <div className="du-modal-head">
          <h2>Inscritos por materia</h2>
          <button className="du-icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>

        <div className="du-modal-body du-modal-body--list">
          <div className="du-tabs">
            {Object.entries(NIVELES).map(([clave, n]) => (
              <button
                key={clave}
                className={`du-tab ${nivelSel === clave ? "du-tab--on" : ""}`}
                onClick={() => cambiarNivel(clave)}
              >
                {n.emoji} {n.titulo}
              </button>
            ))}
          </div>

          <div className="du-chips">
            {materias.map((m, i) => (
              <button
                key={m.nombre}
                className={`du-chip ${activa?.nombre === m.nombre ? "du-chip--on" : ""}`}
                style={{ "--c": COLORES[i % COLORES.length] }}
                onClick={() => setMateriaSel(m.nombre)}
              >
                {m.emoji} {m.nombre} <span>{alumnosDe(m).length}</span>
              </button>
            ))}
          </div>

          {activa && (
            <section className="du-list" style={{ "--c": color }}>
              <div className="du-list-head">
                <div>
                  <h3>
                    {activa.emoji} {activa.nombre} <span>{lista.length} estudiantes</span>
                  </h3>
                  <p className="du-materia-info">
                    {[activa.docente, activa.salon].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <button className="du-btn du-btn--ghost" onClick={copiar} disabled={!lista.length}>
                  <Copy size={16} /> Copiar lista
                </button>
              </div>

              <div className="du-sesiones">
                {activa.sesiones.map((s) => (
                  <span key={`${s.id_horario}-${s.hora}`} className="du-sesion">
                    <strong>{s.horario}</strong> {s.hora} <em>{cuantosEnSesion(s)}</em>
                  </span>
                ))}
              </div>

              {grupos.length === 0 ? (
                <p className="du-muted du-list-empty">Aún nadie inscrito en esta materia.</p>
              ) : (
                grupos.map((g) => (
                  <div key={g.curso.id} className="du-list-group du-list-group--materia">
                    <h4>
                      {g.curso.corto} {g.curso.label} <span>{g.estudiantes.length}</span>
                    </h4>
                    <ol>
                      {g.estudiantes.map((e) => {
                        const s = sesionDe(e);
                        return (
                          <li key={e.id}>
                            <span className="du-list-num">{++contador}</span>
                            <span className="du-list-name">
                              {e.apellido} {e.nombre}
                            </span>
                            <span className="du-list-tag">
                              {s?.horario} · {s?.hora}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                ))
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
};