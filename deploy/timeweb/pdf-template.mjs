// Compact A4 renderer. Kept on the server; downloads require a paid entitlement.
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


export { createPdf };
