const WorkoutPrint = (() => {
  const BRAND = "Плавательный остров VIP";
  const LEFT = 12;
  const TOP = 11;
  const WIDTH = 186;
  const GAP = 6;
  const HALF = 148.5;
  const INK = "#171717";
  const MUTED = "#555555";
  const LINE = "#b8b8b8";
  const MM_PER_POINT = 25.4 / 72;
  const number = new Intl.NumberFormat("ru-RU");
  let resources;

  function fromPool(workout, title, context) {
    const parts = workout.items
      ? [{ items: workout.items }]
      : [
          { label: "Разминка", items: (workout.warm || []).map(row => row[1]) },
          { label: "Основная часть", items: (workout.main || []).map(row => row[1]) },
          { label: "Откуп", items: (workout.cool || []).map(row => row[1]) },
        ];
    const shorthand = parts.flatMap(part => part.items).join(" ");
    const notes = [
      workout.items ? workout.note : null,
      /\bi\d/.test(shorthand) ? "i - отдых в секундах." : null,
      /\bp\s*[:≤]|\bp\s+\d/.test(shorthand) ? "p - пульс, удары за 10 секунд." : null,
      workout.safe && "Безопасность. " + workout.safe,
    ].filter(Boolean);
    return {
      title,
      context,
      volume: workout.vol ? number.format(workout.vol) + " м" : "",
      sections: parts.filter(part => part.items.length).map(part => ({
        ...part, items: part.items.map(text => ({ text, task: true })),
      })),
      notes,
    };
  }

  function fromLand(screen) {
    const sections = [];
    let part;
    const add = item => {
      if (!part) {
        part = { items: [] };
        sections.push(part);
      }
      part.items.push(item);
    };
    for (const [type, value] of screen.print) {
      if (type === "h2" || type === "h3") {
        part = { label: value, items: [] };
        sections.push(part);
      } else if (type === "p" || type === "warn") {
        if (value) add({ text: type === "warn" ? "Безопасность. " + value : value });
      } else if (type === "ul" || type === "num") {
        value.forEach(text => add({ text, task: true }));
      } else if (type === "circuit" || type === "workout-table") {
        const rows = type === "circuit" ? value : value.rows;
        const columns = type === "circuit" ? [] : value.columns || [];
        for (const exercise of rows) {
          const doses = exercise.values || [exercise.amount];
          const dose = doses.flatMap((amount, i) => {
            if (amount === "" || amount == null) return [];
            const column = columns[i];
            return columns.length > 1 ? [(column.label || column) + " - " + amount] : [amount];
          }).join(" / ");
          const text = exercise.note ? exercise.name + " (" + exercise.note + ")" : exercise.name;
          add({ text, dose, task: true });
        }
      } else if (type === "tbl") {
        const [head, ...rows] = value;
        for (const [label, ...values] of rows) {
          add({
            text: label,
            dose: values.map((value, i) => values.length === 1 ? value : head[i + 1] + " - " + value).join(" / "),
            task: true,
          });
        }
      }
    }
    return { title: screen.title, context: screen.printContext ?? screen.lede, sections: sections.filter(part => part.items.length), notes: [] };
  }

  const clean = value => String(value ?? "")
    .replace(/[–—−]/g, "-")
    .replace(/\b(\d+)\s*[xх×]\s*(\d+)\s*м(?=[^а-яё]|$)/gi, "$1 × $2 м")
    .replace(/(\d)м(?=[^а-яё]|$)/gi, "$1 м")
    .replace(/\s+/g, " ").trim();
  const lineHeight = size => size * MM_PER_POINT * 1.23;

  function wrap(doc, text, width, size, style = "normal") {
    doc.setFont("LiberationSans", style);
    doc.setFontSize(size);
    return doc.splitTextToSize(clean(text), width);
  }

  function header(doc, card) {
    doc.setTextColor(MUTED);
    doc.setFont("LiberationSans", "bold");
    doc.setFontSize(8);
    doc.text(BRAND, LEFT, TOP, { baseline: "top" });
    if (card.volume) {
      doc.setTextColor(INK);
      doc.setFontSize(12);
      doc.text(clean(card.volume), LEFT + WIDTH, TOP + 3.6, { align: "right", baseline: "top" });
    }

    const title = wrap(doc, card.title, WIDTH - (card.volume ? 34 : 0), 16, "bold");
    let y = TOP + 5;
    doc.setTextColor(INK);
    title.forEach(line => {
      doc.text(line, LEFT, y, { baseline: "top" });
      y += lineHeight(16);
    });
    if (card.context) {
      const context = wrap(doc, card.context, WIDTH, 8.7);
      doc.setTextColor(MUTED);
      context.forEach(line => {
        doc.text(line, LEFT, y, { baseline: "top" });
        y += lineHeight(8.7);
      });
    }
    y += 1.5;
    doc.setDrawColor(LINE);
    doc.setLineWidth(0.22);
    doc.line(LEFT, y, LEFT + WIDTH, y);
    return y + 2.6;
  }

  function measure(doc, card, width, size) {
    const labelSize = size + 0.4;
    const step = lineHeight(size);
    const rows = [];
    for (const { label, items } of card.sections) {
      if (label) {
        const lines = wrap(doc, label, width, labelSize, "bold");
        rows.push({ heading: true, lines, height: lines.length * lineHeight(labelSize) + 2.1 });
      }
      let sequence = 0;
      for (const item of items) {
        const mark = item.task ? String(++sequence) + "." : "";
        const inset = mark ? 6 : 0;
        const dose = clean(item.dose);
        doc.setFont("LiberationSans", "bold");
        doc.setFontSize(size);
        const doseWidth = doc.getTextWidth(dose);
        const sideBySide = Boolean(dose && doseWidth < width * 0.36);
        const text = dose && !sideBySide ? item.text + " - " + dose : item.text;
        const lines = wrap(doc, text, width - inset - (sideBySide ? doseWidth + 3 : 0), size);
        rows.push({ mark, inset, lines, dose: sideBySide ? dose : "", section: label, height: lines.length * step + 1.15 });
      }
    }
    const notes = card.notes.flatMap(note => wrap(doc, note, WIDTH, 8.5));
    return { rows, notes, notesHeight: notes.length ? notes.length * lineHeight(8.5) + 3.3 : 0 };
  }

  function layout(doc, card, start) {
    const fit = (columns, size, bottom) => {
      const width = (WIDTH - GAP * (columns - 1)) / columns;
      const { rows, notes, notesHeight } = measure(doc, card, width, size);
      const height = bottom - start - notesHeight;
      const total = rows.reduce((sum, row) => sum + row.height, 0);
      if (columns === 1) return total <= height ? { width, size, columns: [rows], notes, bottom } : null;

      let best = null;
      let leftHeight = 0;
      for (let split = 1; split < rows.length; split++) {
        leftHeight += rows[split - 1].height;
        const continuation = !rows[split].heading && rows[split].section;
        const extra = continuation ? lineHeight(size + 0.4) + 2.1 : 0;
        const rightHeight = total - leftHeight + extra;
        if (rows[split - 1].heading || leftHeight > height || rightHeight > height) continue;
        const cost = Math.abs(leftHeight - rightHeight) + (continuation ? 8 : 0);
        if (!best || cost < best.cost) best = { split, cost, continuation, extra };
      }
      if (!best) return null;
      const right = rows.slice(best.split);
      if (best.continuation) {
        const lines = wrap(doc, best.continuation + " (продолжение)", width, size + 0.4, "bold");
        if (lines.length === 1) right.unshift({ heading: true, lines, height: best.extra });
      }
      return { width, size, columns: [rows.slice(0, best.split), right], notes, bottom };
    };

    // Keep half an A4 sheet when it can be read comfortably.
    for (const size of [11, 10.5, 10, 9.5]) {
      for (const columns of [1, 2]) {
        const result = fit(columns, size, HALF - 9);
        if (result) return result;
      }
    }
    const full = fit(2, 10.5, 286);
    if (full) return full;

    // Longer future workouts keep their text and continue on another page.
    const size = 10.5;
    const { rows, notes } = measure(doc, card, WIDTH, size);
    return { width: WIDTH, size, columns: [rows], notes, bottom: 286, paginated: true };
  }

  function drawRow(doc, row, x, y, width, size) {
    if (row.heading) {
      doc.setTextColor(INK);
      doc.setFont("LiberationSans", "bold");
      doc.setFontSize(size + 0.4);
      row.lines.forEach((line, i) => doc.text(line, x, y + i * lineHeight(size + 0.4), { baseline: "top" }));
      return;
    }
    doc.setFont("LiberationSans", "normal");
    doc.setFontSize(size);
    doc.setTextColor(MUTED);
    if (row.mark) doc.text(row.mark, x, y, { baseline: "top" });
    doc.setTextColor(INK);
    row.lines.forEach((line, i) => doc.text(line, x + row.inset, y + i * lineHeight(size), { baseline: "top" }));
    if (row.dose) {
      doc.setFont("LiberationSans", "bold");
      doc.text(row.dose, x + width, y, { align: "right", baseline: "top" });
    }
  }

  function cutLine(doc) {
    doc.setDrawColor(LINE);
    doc.setLineWidth(0.18);
    doc.setLineDashPattern([1, 1], 0);
    doc.line(LEFT, HALF, LEFT + WIDTH, HALF);
    doc.setLineDashPattern([], 0);
    doc.setFont("LiberationSans", "normal");
    doc.setFontSize(8);
    doc.setTextColor(MUTED);
    doc.text("Сложить или отрезать", LEFT + WIDTH, HALF + 2, { align: "right", baseline: "top" });
  }

  function createPdf(jsPDF, fonts, card) {
    const doc = new jsPDF({ unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
    for (const [style, filename, data] of fonts) {
      doc.addFileToVFS(filename, data);
      doc.addFont(filename, "LiberationSans", style);
    }
    doc.setProperties({ title: card.title, author: BRAND });
    const start = header(doc, card);
    const plan = layout(doc, card, start);
    let lastY = start;
    const nextPage = () => {
      doc.addPage();
      return header(doc, card);
    };
    plan.columns.forEach((rows, column) => {
      const x = LEFT + column * (plan.width + GAP);
      let y = start;
      rows.forEach((row, i) => {
        const following = row.heading ? rows[i + 1]?.height || 0 : 0;
        if (plan.paginated && y + row.height + following > plan.bottom) y = nextPage();
        drawRow(doc, row, x, y, plan.width, plan.size);
        y += row.height;
      });
      lastY = plan.paginated ? y : Math.max(lastY, y);
    });

    let noteY = lastY + 2;
    for (const line of plan.notes) {
      if (noteY + lineHeight(8.5) > plan.bottom) noteY = nextPage();
      doc.setFont("LiberationSans", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(MUTED);
      doc.text(line, LEFT, noteY, { baseline: "top" });
      noteY += lineHeight(8.5);
    }
    if (plan.bottom < HALF) cutLine(doc);
    return doc;
  }

  const fontFiles = [
    ["normal", "LiberationSans-Regular.ttf"],
    ["bold", "LiberationSans-Bold.ttf"],
  ];

  function load() {
    if (resources) return resources;
    const library = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "workout-print/jspdf-4.2.1.min.js";
      script.onload = () => window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error("PDF library unavailable"));
      script.onerror = () => { script.remove(); reject(new Error("PDF library unavailable")); };
      document.head.appendChild(script);
    });
    const fonts = Promise.all(fontFiles.map(async ([style, filename]) => {
      const response = await fetch("workout-print/" + filename);
      if (!response.ok) throw new Error("PDF font unavailable");
      const bytes = new Uint8Array(await response.arrayBuffer());
      let data = "";
      for (let offset = 0; offset < bytes.length; offset += 8192) {
        data += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      }
      return [style, filename, data];
    }));
    resources = Promise.all([library, fonts]).catch(error => {
      resources = null;
      throw error;
    });
    return resources;
  }

  function save(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function offerBrowser(container, openBrowser) {
    if (!openBrowser || container.querySelector(".workout-print-browser")) return;
    const button = document.createElement("button");
    button.className = "workout-print-browser";
    button.type = "button";
    button.textContent = "Открыть в браузере";
    button.addEventListener("click", openBrowser);
    container.appendChild(button);
  }

  async function download(button, card, openBrowser) {
    const container = button.parentElement;
    const status = container.querySelector("[data-print-status]");
    const filename = [card.title, card.volume, card.context?.split(" · ")[0], BRAND]
      .filter(Boolean).join(" - ").slice(0, 140).replace(/[<>:"/\\|?*]/g, "-") + ".pdf";
    const share = window.Telegram?.WebApp?.initData && typeof navigator.canShare === "function" && typeof navigator.share === "function";
    button.disabled = true;
    status.textContent = "Готовим PDF…";
    let usedShare = false;
    try {
      const [jsPDF, fonts] = await load();
      const pdf = createPdf(jsPDF, fonts, card);
      const blob = pdf.output("blob");
      const file = share ? new File([blob], filename, { type: "application/pdf" }) : null;
      if (file && navigator.canShare({ files: [file] })) {
        const shareFile = async () => {
          try {
            await navigator.share({ files: [file] });
          } catch (error) {
            if (error.name !== "AbortError") {
              save(file, filename);
              offerBrowser(container, openBrowser);
            }
          }
        };
        const ready = document.createElement("button");
        ready.className = "ref-btn workout-print-button";
        ready.type = "button";
        ready.textContent = "Сохранить PDF";
        ready.addEventListener("click", shareFile);
        button.replaceWith(ready);
        usedShare = true;
        if (navigator.userActivation?.isActive) await shareFile();
        else status.textContent = "PDF готов.";
      } else {
        save(blob, filename);
        status.textContent = "";
      }
    } catch {
      status.textContent = "PDF не загрузился. Попробуйте ещё раз.";
    } finally {
      button.disabled = false;
    }
    if (!usedShare) offerBrowser(container, openBrowser);
  }

  return { fromPool, fromLand, createPdf, download };
})();
