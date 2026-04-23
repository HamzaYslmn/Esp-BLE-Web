import { useEffect, useState } from 'react';
import {
  loadLabels,
  saveLabels,
  loadTimerOverrides,
  saveTimerOverrides,
  type Labels,
  type TimerOverrides,
  type WidgetSpec,
} from './widgets';
import { EditTimerCard, RenameCard, WidgetCard } from './WidgetView';
import { useApp } from './store';

interface Props {
  deviceName: string;
  send:       (cmd: string) => Promise<void>;
}

export function Board({ deviceName, send }: Props) {
  const catalog       = useApp((s) => s.catalog);
  const catalogReady  = useApp((s) => s.catalogReady);
  const editing       = useApp((s) => s.editing);

  const [labels,    setLabels]    = useState<Labels>(() => loadLabels(deviceName));
  const [timerSecs, setTimerSecs] = useState<TimerOverrides>(() => loadTimerOverrides(deviceName));
  const [selected,  setSelected]  = useState<string | null>(null);

  // Reload saved overrides when the connected device changes.
  useEffect(() => {
    setLabels(loadLabels(deviceName));
    setTimerSecs(loadTimerOverrides(deviceName));
    setSelected(null);
  }, [deviceName]);

  // Clear selection whenever we leave edit mode.
  useEffect(() => { if (!editing) setSelected(null); }, [editing]);

  // Persist any user-driven changes.
  useEffect(() => { saveLabels(deviceName, labels); }, [deviceName, labels]);
  useEffect(() => { saveTimerOverrides(deviceName, timerSecs); }, [deviceName, timerSecs]);

  const renameWidget = (id: string, name: string, original: string) => {
    const trimmed = name.trim();
    setLabels((prev) => {
      const next = { ...prev };
      if (!trimmed || trimmed === original) delete next[id];
      else next[id] = trimmed;
      return next;
    });
  };

  const setTimerSeconds = (id: string, secs: number | null) => {
    setTimerSecs((prev) => {
      const next = { ...prev };
      if (secs == null || secs <= 0) delete next[id];
      else next[id] = secs;
      return next;
    });
  };

  if (!catalogReady && catalog.length === 0) {
    return (
      <section className="center" style={{ flex: 1 }}>
        <p className="muted">Reading widget catalog from device…</p>
      </section>
    );
  }

  // Visible widget count (separators don't count).
  const widgetCount = catalog.filter((w) => w.kind !== 'separator').length;

  return (
    <>
      <section className={`grid ${editing ? 'editing' : ''}`}>
        {catalog.map((spec) => {
          const isSep    = spec.kind === 'separator';
          const display: WidgetSpec = {
            ...spec,
            label:   labels[spec.id]    ?? spec.label,
            seconds: spec.kind === 'timer' ? (timerSecs[spec.id] ?? spec.seconds) : spec.seconds,
          };
          const isSelected = editing && selected === spec.id;

          if (isSelected && spec.kind === 'timer') {
            return (
              <div key={spec.id} className="cell cell-edit-timer">
                <EditTimerCard
                  id={spec.id}
                  originalLabel={spec.label}
                  originalSeconds={spec.seconds ?? 0}
                  onCompleteCmd={spec.onCompleteCmd}
                  currentLabel={labels[spec.id]}
                  currentSeconds={timerSecs[spec.id]}
                  onLabelChange={(v) => renameWidget(spec.id, v, spec.label)}
                  onSecondsChange={(n) => setTimerSeconds(spec.id, n)}
                  onCommit={() => setSelected(null)}
                />
              </div>
            );
          }
          if (isSelected) {
            return (
              <div key={spec.id} className="cell">
                <RenameCard
                  id={spec.id}
                  original={spec.label}
                  current={labels[spec.id]}
                  onChange={(v) => renameWidget(spec.id, v, spec.label)}
                  onCommit={() => setSelected(null)}
                />
              </div>
            );
          }
          const editable = editing && !(isSep && !spec.label);
          return (
            <div
              key={spec.id}
              className={`cell ${isSep ? 'cell-separator' : ''} ${editable ? 'editable' : ''}`}
              onClick={editable ? () => setSelected(spec.id) : undefined}
            >
              <WidgetCard spec={display} send={send} />
            </div>
          );
        })}
      </section>

      <footer className="bar board-foot">
        <small className="muted">
          {editing
            ? 'Tap a card to rename it'
            : `${widgetCount} widget${widgetCount === 1 ? '' : 's'}`}
        </small>
      </footer>
    </>
  );
}
