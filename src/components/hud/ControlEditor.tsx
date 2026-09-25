'use client';

import { useEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { CONTROL_IDS, fitControl, loadTouchLayout, presetLayout, saveTouchLayout } from '@/engine/touch-layout';
import type { ControlId, ControlPlacement, TouchLayout } from '@/engine/touch-layout';
import './control-editor.css';

const LABELS: Record<ControlId, string> = {
  move: 'Move', fire: 'Fire', 'fire-left': 'Left fire', aim: 'Scope', grapple: 'Grapple',
  jump: 'Jump', slide: 'Slide / Dash', reload: 'Reload', weapon: 'Weapon',
};
const stop = (event: SyntheticEvent) => event.stopPropagation();

/** The caller opens this from a menu, with gameplay paused/blocked and touches cleared. */
export function ControlEditor({ onClose, onSave }: {
  onClose: () => void;
  onSave: (layout: TouchLayout) => void;
}) {
  const [layout, setLayout] = useState(loadTouchLayout);
  const [selected, setSelected] = useState<ControlId>('move');
  const [error, setError] = useState('');
  const [area, setArea] = useState({ width: 788, height: 366 });
  const dialog = useRef<HTMLDialogElement>(null);
  const safe = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const modal = dialog.current!;
    // The native top layer avoids the menu's scale-to-fit and traps focus.
    modal.showModal();
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setArea({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(safe.current!);
    return () => { observer.disconnect(); modal.close(); };
  }, []);

  const choosePreset = (preset: TouchLayout['preset']) => {
    setLayout(presetLayout(preset)); setSelected('move'); setError('');
  };
  const update = (field: keyof ControlPlacement, value: number) => {
    setLayout(current => ({ ...current, controls: {
      ...current.controls, [selected]: { ...current.controls[selected], [field]: value },
    } }));
    setError('');
  };
  const save = () => {
    if (!saveTouchLayout(layout)) {
      setError('Cannot save controls on this device. Allow local storage, then try again.');
      return;
    }
    onSave(layout); onClose();
  };
  const placement = layout.controls[selected];
  const visible = CONTROL_IDS.filter(id => id !== 'fire-left' || layout.secondFire);

  return <dialog ref={dialog} className="control-editor" aria-labelledby="control-editor-title"
    data-ui-block="" data-ui-input-block=""
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onPointerDown={stop} onPointerMove={stop} onPointerUp={stop} onPointerCancel={stop}
    onMouseDown={stop} onMouseMove={stop} onMouseUp={stop} onClick={stop}
    onTouchStart={stop} onTouchMove={stop} onTouchEnd={stop} onWheel={stop}
    onKeyDown={stop} onKeyUp={stop}>
    <header className="control-editor-toolbar">
      <div><p className="control-editor-eyebrow">MOBILE CONTROLS</p><h1 id="control-editor-title">Edit controls</h1></div>
      <div className="control-editor-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" onClick={() => choosePreset(layout.preset)}>Reset</button>
        <button type="button" className="control-editor-save" onClick={save}>Save</button>
      </div>
    </header>
    <div className="control-editor-options">
      <div role="group" aria-label="Layout preset">
        <button type="button" aria-pressed={layout.preset === 'thumbs'} onClick={() => choosePreset('thumbs')}>Two thumbs</button>
        <button type="button" aria-pressed={layout.preset === 'claw'} onClick={() => choosePreset('claw')}>Four-finger claw</button>
      </div>
      <label><input type="checkbox" checked={layout.secondFire} onChange={event => {
        setLayout({ ...layout, secondFire: event.target.checked });
        if (!event.target.checked && selected === 'fire-left') setSelected('fire');
        setError('');
      }} /> Second fire button</label>
    </div>
    <p className="control-editor-help">Select a control, then use the sliders. This preview does not control the game. Scroll to see the full layout.</p>
    <div className="control-editor-preview-scroll" role="region" aria-label="Scrollable landscape preview" tabIndex={0}>
      <div className="control-editor-preview">
        <div ref={safe} className="control-editor-safe">
          <span className="control-editor-pause" aria-label="Pause area, cannot be moved">Pause</span>
          <span className="control-editor-look" aria-hidden="true">LOOK AREA<br />KEEP CLEAR</span>
          {visible.map(id => {
            const box = fitControl(id, layout.controls[id], area.width, area.height);
            return <button type="button" key={id} className="control-editor-target" data-control={id}
              aria-label={`Select ${LABELS[id]}`} aria-pressed={selected === id}
              onClick={() => setSelected(id)} style={{
                left: box.x, top: box.y, width: box.width, height: box.height, opacity: layout.controls[id].opacity,
              }}>{LABELS[id]}</button>;
          })}
        </div>
      </div>
    </div>
    <section className="control-editor-settings" aria-label="Selected control settings">
      <label className="control-editor-select">Control<select aria-label="Control" value={selected} onChange={event => setSelected(event.target.value as ControlId)}>
        {visible.map(id => <option key={id} value={id}>{LABELS[id]}</option>)}
      </select></label>
      <div className="control-editor-sliders">
        {([
          { field: 'x', label: 'Position X', min: 0, max: 100, factor: 100, unit: '%' },
          { field: 'y', label: 'Position Y', min: 0, max: 100, factor: 100, unit: '%' },
          { field: 'size', label: selected === 'weapon' ? 'Width' : 'Size', min: 44, max: 160, factor: 1, unit: 'px' },
          { field: 'opacity', label: 'Opacity', min: 25, max: 100, factor: 100, unit: '%' },
        ] as const).map(({ field, label, min, max, factor, unit }) => <label key={field}>
          <span>{label}</span><output>{Math.round(placement[field] * factor)}{unit}</output>
          <input type="range" aria-label={label} min={min} max={max} step={1}
            value={Math.round(placement[field] * factor)} onChange={event => update(field, Number(event.target.value) / factor)} />
        </label>)}
      </div>
      <p className="control-editor-help">Pause stays clear. Targets stay at least 44 × 44 px. Default controls fit short screens; custom controls can overlap. Reset restores the selected preset. Only Save keeps changes.</p>
      <p className="control-editor-error" role="alert">{error}</p>
    </section>
  </dialog>;
}
