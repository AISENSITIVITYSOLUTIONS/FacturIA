// Buscador del catálogo Z E-Scooters para la sección «Conceptos».
// - Catálogo: /data/catalogo.json (generado desde el Excel con scripts/catalogo_a_json.py).
// - Búsqueda sin acentos, por palabras, con tolerancia a «48v» / «48 V».
// - Teclado: «/» o Ctrl+K para buscar, ↑ ↓ para moverse, Enter para agregar, Esc para cerrar.

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const RECENT_KEY = "facturai.finder.recent";
const MAX_RESULTS = 60;

export const STATUS = {
  disponible: { label: "Disponible", tone: "ok" },
  oferta: { label: "Oferta", tone: "accent" },
  desde: { label: "Desde", tone: "neutral" },
  preorden: { label: "Pre orden", tone: "violet" },
  verificar: { label: "Por verificar", tone: "warn" },
  agotado: { label: "Agotado", tone: "danger" },
  guardado: { label: "Guardado", tone: "neutral" }
};

const CATEGORIES = [
  { id: "all", label: "Todo" },
  { id: "scooters", label: "Scooters" },
  { id: "monociclos", label: "Monociclos" },
  { id: "nosfet", label: "Nosfet" },
  { id: "energia", label: "Baterías" },
  { id: "refacciones", label: "Refacciones" },
  { id: "guardados", label: "Guardados" }
];

const ICONS = {
  scooters: '<circle cx="5.5" cy="17" r="2.3"/><circle cx="18.5" cy="17" r="2.3"/><path d="M7.8 17h8.4M18.5 17 15 5M12.5 5H17"/>',
  nosfet: '<circle cx="5.5" cy="17" r="2.3"/><circle cx="18.5" cy="17" r="2.3"/><path d="M7.8 17h8.4M18.5 17 15 5M12.5 5H17M3 12h5"/>',
  monociclos: '<circle cx="12" cy="14" r="6"/><circle cx="12" cy="14" r="1.5"/><path d="M10 4h4M12 4v4"/>',
  energia: '<rect x="4" y="7" width="15" height="11" rx="2"/><path d="M19 11h2v3h-2M11 9.5 9 13h3l-2 3.5"/>',
  refacciones: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.5 2.5-2.3-.7-.7-2.3z"/>',
  guardados: '<path d="M7 4h10v16l-5-3.5L7 20z"/>'
};

/* --------------------------------------------------------- Normalización */

// Normaliza carácter por carácter para conservar la posición de cada letra
// y poder resaltar coincidencias sobre el texto original.
function fold(text) {
  let out = "";
  for (const ch of String(text)) {
    out += ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().charAt(0) || " ";
  }
  return out;
}
const compact = (s) => s.replace(/[^a-z0-9]/g, "");

function tokenize(query) {
  const raw = fold(query).trim();
  const price = [];
  const words = [];
  raw.split(/\s+/).filter(Boolean).forEach((t) => {
    const m = t.match(/^([<>])\$?(\d[\d,]*)$/);
    if (m) price.push({ op: m[1], value: Number(m[2].replace(/,/g, "")) });
    else words.push(t);
  });
  // «48 v» → «48v»: une números con su unidad.
  const merged = [];
  words.forEach((w) => {
    const prev = merged[merged.length - 1];
    if (prev && /^\d+(\.\d+)?$/.test(prev) && /^(v|ah|a|w|mm)$/.test(w)) merged[merged.length - 1] = prev + w;
    else merged.push(w);
  });
  return { words: merged, price };
}

/* ---------------------------------------------------------------- Índice */

const VEHICLES = new Set(["scooters", "monociclos", "nosfet"]);
const KIND = { scooters: "Scooter eléctrico", nosfet: "Scooter eléctrico", monociclos: "Monociclo eléctrico" };

function indexItem(item) {
  // En la lista se muestra «Marca Modelo»; la descripción completa va al CFDI.
  let title = item.description;
  if (VEHICLES.has(item.cat)) {
    title = fold(item.model).startsWith(fold(item.line)) ? item.model : `${item.line} ${item.model}`;
  }
  const text = fold(title);
  const hay = fold([item.description, item.brand, item.line, item.model, item.cat_label, item.product_key].join(" "));
  return { ...item, _title: title, _text: text, _hay: hay, _compact: compact(hay) };
}

function score(item, q) {
  let total = 0;
  for (const w of q.words) {
    const cw = compact(w);
    const at = item._hay.indexOf(w);
    if (at === -1) {
      if (cw && item._compact.includes(cw)) { total += 1; continue; }
      return -1;
    }
    total += 2;
    if (at === 0 || /[\s(/-]/.test(item._hay[at - 1])) total += 4;
    if (fold(item.model).startsWith(w)) total += 6;
    if (fold(item.brand) === w) total += 3;
  }
  for (const p of q.price) {
    if (p.op === "<" && !(item.price <= p.value)) return -1;
    if (p.op === ">" && !(item.price >= p.value)) return -1;
  }
  if (item.status === "agotado") total -= 3;
  if (item.legacy) total -= 1;
  return total;
}

function highlight(original, folded, words) {
  const marks = new Array(original.length).fill(false);
  words.forEach((w) => {
    if (!w) return;
    let from = 0;
    for (;;) {
      const at = folded.indexOf(w, from);
      if (at === -1) break;
      for (let i = at; i < at + w.length; i++) marks[i] = true;
      from = at + w.length;
    }
  });
  const frag = document.createDocumentFragment();
  let buf = "";
  let state = false;
  const flush = () => {
    if (!buf) return;
    if (state) { const m = document.createElement("mark"); m.textContent = buf; frag.append(m); }
    else frag.append(buf);
    buf = "";
  };
  [...original].forEach((ch, i) => {
    if (marks[i] !== state) { flush(); state = marks[i]; }
    buf += ch;
  });
  flush();
  return frag;
}

function readRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
}
function writeRecent(ids) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, 6))); } catch { /* sin almacenamiento */ }
}

function svg(paths, cls = "") {
  return `<svg aria-hidden="true" viewBox="0 0 24 24" class="${cls}">${paths}</svg>`;
}

/* ------------------------------------------------------------- Montaje */

export function mountFinder(root, { onPick }) {
  const input = root.querySelector("[data-finder-input]");
  const panel = root.querySelector("[data-finder-panel]");
  const list = root.querySelector("[data-finder-list]");
  const filters = root.querySelector("[data-finder-filters]");
  const count = root.querySelector("[data-finder-count]");
  const meta = root.querySelector("[data-finder-meta]");

  let items = [];
  let saved = [];
  let category = "all";
  let results = [];
  let active = -1;

  const all = () => items.concat(saved);

  function renderFilters() {
    const pool = all();
    filters.replaceChildren(...CATEGORIES.map((c) => {
      const n = c.id === "all" ? pool.length : pool.filter((i) => i.cat === c.id).length;
      if (!n && c.id !== "all") return document.createComment(c.id);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "seg";
      b.setAttribute("aria-pressed", String(c.id === category));
      b.dataset.cat = c.id;
      b.innerHTML = `<span></span><b class="mono"></b>`;
      b.firstChild.textContent = c.label;
      b.lastChild.textContent = n;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => {
        category = c.id;
        renderFilters();
        search();
        open();
        input.focus();
      });
      return b;
    }));
  }

  function search() {
    const q = tokenize(input.value);
    const pool = all().filter((i) => category === "all" || i.cat === category);
    let groups;
    if (!q.words.length && !q.price.length) {
      const recentIds = readRecent();
      const recent = recentIds.map((id) => pool.find((i) => i.id === id)).filter(Boolean);
      const sorted = pool.filter((i) => !recentIds.includes(i.id)).sort((a, b) =>
        (a.status === "agotado") - (b.status === "agotado") || (a.legacy - b.legacy) || 0);
      groups = [];
      if (recent.length) groups.push({ title: "Recientes", items: recent });
      if (category === "all") {
        CATEGORIES.slice(1).forEach((c) => {
          const part = sorted.filter((i) => i.cat === c.id).slice(0, 6);
          if (part.length) groups.push({ title: c.label, items: part, more: sorted.filter((i) => i.cat === c.id).length - part.length, cat: c.id });
        });
      } else {
        groups.push({ title: CATEGORIES.find((c) => c.id === category).label, items: sorted.slice(0, MAX_RESULTS) });
      }
    } else {
      const ranked = pool.map((i) => [i, score(i, q)]).filter(([, s]) => s >= 0)
        .sort((a, b) => b[1] - a[1] || a[0].price - b[0].price).map(([i]) => i);
      groups = [{ title: ranked.length ? `${ranked.length} resultado${ranked.length === 1 ? "" : "s"}` : "", items: ranked.slice(0, MAX_RESULTS), total: ranked.length }];
    }
    render(groups, q.words);
  }

  function render(groups, words) {
    results = [];
    const nodes = [];
    groups.forEach((g) => {
      if (g.title) {
        const h = document.createElement("div");
        h.className = "finder-group";
        h.setAttribute("role", "presentation");
        h.textContent = g.title;
        if (g.more > 0) {
          const more = document.createElement("button");
          more.type = "button";
          more.className = "finder-more";
          more.textContent = `Ver ${g.more} más`;
          more.addEventListener("mousedown", (e) => e.preventDefault());
          more.addEventListener("click", () => { category = g.cat; renderFilters(); search(); });
          h.append(more);
        }
        nodes.push(h);
      }
      g.items.forEach((item) => {
        const idx = results.push(item) - 1;
        nodes.push(row(item, idx, words));
      });
    });
    if (!results.length) {
      const empty = document.createElement("div");
      empty.className = "finder-empty";
      empty.innerHTML = `${svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>')}<strong>Sin coincidencias</strong><span>Prueba con la marca, el voltaje (48v) o el modelo. También puedes capturar el concepto a mano.</span>`;
      nodes.push(empty);
    }
    list.replaceChildren(...nodes);
    setActive(results.length ? 0 : -1, false);
    list.scrollTop = 0;
  }

  function row(item, idx, words) {
    const el = document.createElement("div");
    el.className = "finder-row";
    el.id = `finder-opt-${idx}`;
    el.setAttribute("role", "option");
    el.dataset.idx = idx;
    el.dataset.status = item.status;

    const tile = document.createElement("span");
    tile.className = "finder-tile";
    tile.dataset.cat = item.cat;
    tile.innerHTML = svg(ICONS[item.cat] || ICONS.refacciones);

    const body = document.createElement("span");
    body.className = "finder-body";
    const title = document.createElement("span");
    title.className = "finder-title";
    title.append(highlight(item._title, item._text, words));
    title.title = item.description;
    const sub = document.createElement("span");
    sub.className = "finder-sub";
    const parts = VEHICLES.has(item.cat)
      ? [KIND[item.cat]]
      : [item.cat_label, item.brand && item.brand !== "Z" ? item.brand : (item.line || "")].filter(Boolean);
    sub.append(parts.join(" · "));
    const key = document.createElement("span");
    key.className = "mono finder-key";
    key.textContent = item.product_key;
    sub.append(key);
    if (item.legacy) { const t = document.createElement("span"); t.className = "finder-legacy"; t.textContent = "lista anterior"; sub.append(t); }
    body.append(title, sub);

    const st = STATUS[item.status] || STATUS.disponible;
    const pill = document.createElement("span");
    pill.className = "finder-pill";
    pill.dataset.tone = st.tone;
    pill.textContent = st.label;

    const price = document.createElement("span");
    price.className = "finder-price";
    const amount = document.createElement("b");
    amount.className = "mono";
    amount.textContent = (item.status === "desde" ? "desde " : "") + money.format(item.price);
    const note = document.createElement("small");
    note.textContent = item.tax_included === false ? "+ IVA" : "IVA incluido";
    price.append(amount, note);

    el.append(tile, body, pill, price);

    if (item.url) {
      const link = document.createElement("a");
      link.className = "finder-link";
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.title = "Ver ficha del producto";
      link.setAttribute("aria-label", `Ficha de ${item.description}`);
      link.innerHTML = svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>');
      link.addEventListener("mousedown", (e) => e.preventDefault());
      link.addEventListener("click", (e) => e.stopPropagation());
      el.append(link);
    }

    el.addEventListener("mousedown", (e) => e.preventDefault());
    el.addEventListener("mousemove", () => { if (active !== idx) setActive(idx, false); });
    el.addEventListener("click", () => pick(idx));
    return el;
  }

  function setActive(idx, scroll = true) {
    list.querySelector(".finder-row[aria-selected='true']")?.setAttribute("aria-selected", "false");
    active = idx;
    if (idx < 0) { input.removeAttribute("aria-activedescendant"); return; }
    const el = list.querySelector(`#finder-opt-${idx}`);
    if (!el) return;
    el.setAttribute("aria-selected", "true");
    input.setAttribute("aria-activedescendant", el.id);
    if (scroll) el.scrollIntoView({ block: "nearest" });
  }

  function pick(idx) {
    const item = results[idx];
    if (!item) return;
    writeRecent([item.id, ...readRecent().filter((id) => id !== item.id)]);
    onPick(item);
    input.value = "";
    close();
    root.classList.add("is-picked");
    setTimeout(() => root.classList.remove("is-picked"), 700);
  }

  function open() {
    if (!panel.hidden) return;
    panel.hidden = false;
    root.classList.add("is-open");
    input.setAttribute("aria-expanded", "true");
    search();
  }
  function close() {
    panel.hidden = true;
    root.classList.remove("is-open");
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  input.addEventListener("focus", open);
  input.addEventListener("click", open);
  input.addEventListener("input", () => { open(); search(); });
  input.addEventListener("blur", () => setTimeout(() => { if (!root.contains(document.activeElement)) close(); }, 120));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); open(); setActive(Math.min(results.length - 1, active + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(0, active - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (!panel.hidden && active >= 0) pick(active); }
    else if (e.key === "Escape") { if (input.value) { input.value = ""; search(); } else { close(); input.blur(); } }
  });
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ((e.key === "/" && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
      if (!root.offsetParent) return;
      e.preventDefault();
      input.focus();
      input.scrollIntoView({ block: "center" });
    }
  });
  document.addEventListener("pointerdown", (e) => { if (!root.contains(e.target)) close(); });

  return {
    async load(url) {
      const data = await fetch(url).then((r) => { if (!r.ok) throw new Error("catálogo"); return r.json(); });
      items = data.items.map(indexItem);
      count.textContent = items.length;
      if (meta) {
        const v = (data.source || "").match(/v(\d+)[_.](\d+)/i);
        meta.textContent = `Catálogo Z E-Scooters${v ? ` v${v[1]}.${v[2]}` : ""} · precios públicos con IVA`;
      }
      input.placeholder = `Buscar entre ${items.length} productos: modelo, marca, voltaje…`;
      renderFilters();
      root.hidden = false;
    },
    setSaved(rows) {
      const seen = new Set(items.map((i) => fold(i.description)));
      const unique = new Map();
      rows.forEach((p) => {
        const k = fold(p.description || "");
        if (!k.trim() || seen.has(k) || unique.has(k)) return;
        unique.set(k, indexItem({
          id: `guardado-${p.id || k}`, cat: "guardados", cat_label: "Conceptos guardados",
          brand: "", line: p.unit_key || "", model: p.description, description: p.description,
          product_key: String(p.product_key || ""), unit_key: p.unit_key || "H87",
          price: Number(p.unit_price || 0), tax_included: false, status: "guardado", url: ""
        }));
      });
      saved = [...unique.values()];
      renderFilters();
    }
  };
}
