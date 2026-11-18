import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { useForm, useLoad, useTitle } from '../../lib/hooks.js';
import { hostOf } from '../../lib/format.js';
import { Button, Confirm, Empty, Field, LoadError, Modal, Notice, Skeleton, Spinner, useToast } from '../../components/ui.jsx';
import { Icon } from '../../components/Icon.jsx';
import { AdminOnly, SectionHeader } from './AdminLayout.jsx';

export default function LinksAdmin() {
  useTitle('Liens');
  return <AdminOnly><LinksPage /></AdminOnly>;
}

function LinksPage() {
  const toast = useToast();
  const { data, error, loading, reload, setData } = useLoad(() => api('/resources').then((d) => d.resources), []);
  const [editing, setEditing] = useState(null);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const saver = useRef({ running: false, next: null });

  useEffect(() => {
    if (status !== 'saved') return undefined;
    const t = setTimeout(() => setStatus(''), 2500);
    return () => clearTimeout(t);
  }, [status]);

  // Saves the new order. Only one request at a time, and only the latest order is sent.
  const reorder = (next) => {
    setData(next);
    setStatus('saving');
    const s = saver.current;
    s.next = next.map((r) => r.id);
    if (s.running) return;
    s.running = true;
    (async () => {
      try {
        while (s.next) {
          const ids = s.next;
          s.next = null;
          await api('/admin/resources/order', { method: 'PUT', body: { ids } });
        }
        setStatus('saved');
      } catch (e) {
        s.next = null;
        setStatus('');
        toast(e.message, 'error');
        reload();
      } finally {
        s.running = false;
      }
    })();
  };

  return (
    <div>
      <SectionHeader title="Liens" actions={<>
        <SaveStatus status={status} />
        <Button icon="plus" onClick={() => setEditing({ title: '', url: 'https://', description: '' })}>Ajouter un lien</Button>
      </>}>
        Les liens apparaissent sur la page « Liens » dans cet ordre. Pour le changer, faites glisser un lien par sa poignée ou utilisez les flèches. Un nouveau lien s'ajoute en tête de liste.
      </SectionHeader>
      {error && <LoadError error={error} onRetry={reload} />}
      {loading && !data && <Skeleton className="h-64" />}
      {data?.length === 0 && <Empty icon="link" title="Aucun lien" />}
      {data?.length > 0 && <SortableLinks links={data} onReorder={reorder} onEdit={setEditing} onDelete={setDel} />}
      {editing && <LinkForm link={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      <Confirm open={!!del} onClose={() => setDel(null)} busy={busy} tone="danger" confirmLabel="Supprimer" title="Supprimer le lien"
        onConfirm={async () => {
          setBusy(true);
          try { await api(`/admin/resources/${del.id}`, { method: 'DELETE' }); toast('Lien supprimé'); setDel(null); reload(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
        }}>
        <p>« {del?.title} » sera retiré de la page Liens.</p>
      </Confirm>
    </div>
  );
}

function SaveStatus({ status }) {
  return (
    <span className="flex items-center gap-1.5 self-center text-sm text-muted" role="status" aria-live="polite">
      {status === 'saving' && <><Spinner size={14} /> Enregistrement…</>}
      {status === 'saved' && <><Icon name="check" size={16} className="text-success" /> Ordre enregistré</>}
    </span>
  );
}

/** Moves the item at `from` so that it ends up at index `to`. */
function moved(list, from, to) {
  const next = [...list];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

/**
 * The links in their display order. A link is moved by dragging its handle (mouse or finger),
 * or with its arrow buttons, which also work from the keyboard.
 */
function SortableLinks({ links, onReorder, onEdit, onDelete }) {
  const listRef = useRef(null);
  const dragRef = useRef(null);
  const [drag, setDrag] = useState(null); // { from, to, dy, height }
  const sortable = links.length > 1;

  const start = (e, index) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const rects = [...listRef.current.children].map((el) => el.getBoundingClientRect());
    dragRef.current = {
      from: index,
      startY: e.pageY,
      // Middles in page coordinates, so scrolling during the drag does not throw the slots off.
      mids: rects.map((r) => r.top + window.scrollY + r.height / 2),
      height: rects[index].height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ from: index, to: index, dy: 0, height: rects[index].height });
  };

  const move = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = e.pageY - d.startY;
    const middle = d.mids[d.from] + dy;
    d.to = d.mids.filter((m, i) => i !== d.from && m < middle).length;
    setDrag({ from: d.from, to: d.to, dy, height: d.height });
  };

  const end = (commit) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    setDrag(null);
    if (commit && d.to !== undefined && d.to !== d.from) onReorder(moved(links, d.from, d.to));
  };

  const step = (index, delta, id) => {
    onReorder(moved(links, index, index + delta));
    // The button keeps focus as its row moves; at the top or bottom it gets disabled, so hand focus to the other arrow.
    requestAnimationFrame(() => {
      const self = document.querySelector(`[data-move="${id}-${delta < 0 ? 'up' : 'down'}"]`);
      if (self?.disabled) document.querySelector(`[data-move="${id}-${delta < 0 ? 'down' : 'up'}"]`)?.focus();
    });
  };

  // Where each row sits while a link is dragged: the dragged one follows the pointer, the ones it passes make room.
  const offset = (i) => {
    if (!drag) return 0;
    if (i === drag.from) return drag.dy;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.height;
    if (drag.from > drag.to && i >= drag.to && i < drag.from) return drag.height;
    return 0;
  };

  return (
    <ul ref={listRef} className={`card divide-y divide-line ${drag ? 'select-none' : ''}`}>
      {links.map((r, i) => {
        const dragged = drag?.from === i;
        return (
          <li key={r.id}
            style={{ transform: `translateY(${offset(i)}px)`, transition: drag && !dragged ? 'transform 150ms ease' : 'none' }}
            className={`relative flex items-center gap-2 bg-surface px-2 py-3 first:rounded-t-2xl last:rounded-b-2xl sm:gap-3 sm:px-3 ${dragged ? 'z-10 rounded-2xl shadow-xl ring-1 ring-line-strong' : ''}`}>
            {sortable && (
              <span
                onPointerDown={(e) => start(e, i)} onPointerMove={move} onPointerUp={() => end(true)} onPointerCancel={() => end(false)}
                title="Faire glisser pour déplacer"
                className={`flex h-10 w-7 shrink-0 touch-none items-center justify-center rounded-lg text-muted hover:bg-sunken hover:text-ink ${dragged ? 'cursor-grabbing' : 'cursor-grab'}`}>
                <Icon name="grip" />
              </span>
            )}
            <div className={`min-w-0 flex-1 ${sortable ? '' : 'pl-2'}`}>
              <p className="font-semibold">{r.title} <span className="font-normal text-muted">· {hostOf(r.url)}</span></p>
              {r.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{r.description}</p>}
            </div>
            {/* On a phone the buttons sit in two columns (arrows, then edit/delete) to leave room for the text. */}
            <div className="grid shrink-0 grid-flow-col grid-rows-2 gap-x-0.5 sm:flex sm:items-center sm:gap-1">
              {sortable && (
                <>
                  <Button variant="ghost" size="sm" icon="arrow-up" aria-label={`Monter « ${r.title} »`} title="Monter"
                    data-move={`${r.id}-up`} disabled={i === 0} onClick={() => step(i, -1, r.id)} />
                  <Button variant="ghost" size="sm" icon="arrow-down" aria-label={`Descendre « ${r.title} »`} title="Descendre"
                    data-move={`${r.id}-down`} disabled={i === links.length - 1} onClick={() => step(i, 1, r.id)} />
                  <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden="true" />
                </>
              )}
              <Button variant="ghost" size="sm" icon="edit" aria-label={`Modifier « ${r.title} »`} title="Modifier" onClick={() => onEdit(r)} />
              <Button variant="ghost" size="sm" icon="trash" aria-label={`Supprimer « ${r.title} »`} title="Supprimer" onClick={() => onDelete(r)} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function LinkForm({ link, onClose, onSaved }) {
  const toast = useToast();
  const form = useForm({ title: link.title, url: link.url, description: link.description || '' });
  const save = form.submit(async (v) => {
    await api(link.id ? `/admin/resources/${link.id}` : '/admin/resources', { method: link.id ? 'PUT' : 'POST', body: v });
    toast(link.id ? 'Lien enregistré' : 'Lien ajouté');
    onSaved();
  });
  return (
    <Modal open onClose={onClose} title={link.id ? 'Modifier le lien' : 'Ajouter un lien'} footer={
      <><Button variant="secondary" onClick={onClose}>Annuler</Button><Button onClick={save} busy={form.busy}>Enregistrer</Button></>
    }>
      <form onSubmit={save} className="space-y-5" noValidate>
        {form.message && Object.keys(form.errors).length === 0 && <Notice tone="error">{form.message}</Notice>}
        <Field label="Titre" error={form.errors.title} htmlFor="title"><input className="input" {...form.field('title')} /></Field>
        <Field label="Adresse" error={form.errors.url} htmlFor="url"><input className="input" type="url" inputMode="url" {...form.field('url')} /></Field>
        <Field label="Description" error={form.errors.description} htmlFor="description"><textarea className="input" {...form.field('description')} /></Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
