import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createGame } from './game/engine.js';
import { MODULES, START, CAPS } from './data/modules.js';

const ICONS = { solar: '⚡', water: '💧', greenhouse: '🍠', habitat: '🌬', node: '🔗', lab: '⭐' };

function Bar({ label, icon, value, max, color }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="bar">
      <div className="bar-head">
        <span>{icon} {label}</span>
        <span className="bar-val">{Math.round(value)} / {max}</span>
      </div>
      <div className="bar-track"><div className="bar-fill" style={{ width: pct + '%', background: color }} /></div>
    </div>
  );
}

export default function App() {
  const mount = useRef(null);
  const engine = useRef(null);
  const [state, setState] = useState({
    balance: START.balance, energy: START.energy, water: START.water,
    food: START.food, air: START.air, science: 0, count: 0, models: '0/6', toast: null
  });
  const [placing, setPlacing] = useState(null);

  const [fatal, setFatal] = useState(null);

  useEffect(() => {
    try {
      engine.current = createGame(mount.current, setState);
    } catch (e) {
      console.error(e);
      setFatal(String(e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e));
    }
    return () => engine.current?.dispose();
  }, []);

  const pick = useCallback((def) => {
    const next = placing?.id === def.id ? null : def;
    setPlacing(next);
    engine.current?.setPlacing(next);
  }, [placing]);

  if (fatal) {
    return (
      <div style={{ padding: 24, color: '#ffb4b4', font: '13px/1.5 Menlo,monospace', whiteSpace: 'pre-wrap', background: '#3a1010', margin: 16, borderRadius: 10 }}>
        {'Движок упал:\n' + fatal}
      </div>
    );
  }

  const nodeBonus = 0; // лимит энергии показываем базовый; фактический считает движок
  const eCap = CAPS.energy + (state.count > 0 ? 0 : 0) + nodeBonus;

  return (
    <div className="app">
      <div className="scene" ref={mount} />

      <header className="topbar glass">
        <div className="brand">
          <span className="logo">🥔</span>
          <div>
            <b>МОДУЛИ КОЛОНИИ</b>
            <small>пилот · прототип ARES-1</small>
          </div>
        </div>
        <div className="balance">
          <span className="burn-tag">BURN</span>
          <b>{state.balance}</b> <span>🥔</span>
        </div>
        <div className="meta">📦 {state.count} модулей · ⭐ {Math.floor(state.science)} науки · 🧩 модели {state.models}</div>
      </header>

      <aside className="stats glass">
        <Bar icon="⚡" label="Энергия" value={state.energy} max={140} color="#f6c453" />
        <Bar icon="💧" label="Вода" value={state.water} max={CAPS.water} color="#5aa9e6" />
        <Bar icon="🍠" label="Еда" value={state.food} max={CAPS.food} color="#e8925c" />
        <Bar icon="🌬" label="Воздух" value={state.air} max={CAPS.air} color="#7fd8be" />
        <div className="hint">
          {placing ? <>Ставьте: <b>{placing.name}</b> — клик по клетке · ESC отмена</>
            : <>Выберите модуль внизу и соберите станцию. Клик — поставить.</>}
        </div>
      </aside>

      {state.toast && <div className="toast">{state.toast}</div>}

      <footer className="catalog glass">
        {MODULES.map((m) => (
          <button
            key={m.id}
            className={'card' + (placing?.id === m.id ? ' active' : '') + (state.balance < m.cost ? ' poor' : '')}
            onClick={() => pick(m)}
            title={m.desc}
          >
            <div className="card-top">
              <span className="card-icon" style={{ background: m.color }}>{ICONS[m.id]}</span>
              <span className="card-tag">{m.tag}</span>
            </div>
            <b>{m.name}</b>
            <span className="card-effect">{m.effect}</span>
            <span className="card-cost">🔥 {m.cost} 🥔</span>
          </button>
        ))}
      </footer>
    </div>
  );
}
