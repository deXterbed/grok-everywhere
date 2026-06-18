// Enhanced markdown parser for rendering Grok responses
export function parseMarkdown(text) {
  if (!text) return "";

  // Extract math blocks before HTML escaping so LaTeX isn't mangled
  const displayMathBlocks = [];
  const inlineMathBlocks = [];
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (match, math) => {
    displayMathBlocks.push(math.trim());
    return `%%DISPLAYMATH_${displayMathBlocks.length - 1}%%`;
  });
  text = text.replace(/\$(.+?)\$/g, (match, math) => {
    inlineMathBlocks.push(math);
    return `%%INLINEMATH_${inlineMathBlocks.length - 1}%%`;
  });

  // Escape HTML first to prevent XSS
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Split into lines for better processing
  const lines = html.split("\n");
  const processedLines = [];
  let inCodeBlock = false;
  let codeBlockContent = [];
  let codeBlockLanguage = "";
  let inTable = false;
  let tableRows = [];

  function flushTable() {
    if (!tableRows.length) return;
    const parsed = tableRows.map((r) =>
      r
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim()),
    );
    const isSep = (row) => row.every((c) => /^[\-:]+$/.test(c));
    const headers = parsed[0];
    const body = parsed.slice(1).filter((r) => !isSep(r));
    const thead = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`;
    const tbody = `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>`;
    processedLines.push(`<table>${thead}${tbody}</table>`);
    tableRows = [];
    inTable = false;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Handle code blocks
    if (line.trim().startsWith("```")) {
      flushTable();
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLanguage = line.trim().substring(3).trim();
        codeBlockContent = [];
      } else {
        inCodeBlock = false;
        const codeContent = codeBlockContent.join("\n");
        const languageClass = codeBlockLanguage
          ? ` class="language-${codeBlockLanguage}"`
          : "";
        processedLines.push(
          `<pre><code${languageClass}>${codeContent}</code></pre>`,
        );
        codeBlockContent = [];
        codeBlockLanguage = "";
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Handle markdown tables (lines starting with |)
    if (line.trim().startsWith("|")) {
      inTable = true;
      tableRows.push(line.trim());
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Process non-code block lines
    let processedLine = line;

    // Headers (must be at start of line)
    if (line.match(/^#{1,6}\s/)) {
      const headerMatch = line.match(/^(#{1,6})\s(.+)$/);
      if (headerMatch) {
        const level = headerMatch[1].length;
        const text = headerMatch[2];
        processedLine = `<h${level}>${text}</h${level}>`;
      }
    }
    // Blockquotes
    else if (line.match(/^>\s/)) {
      const quoteText = line.substring(2);
      processedLine = `<blockquote>${quoteText}</blockquote>`;
    }
    // Lists
    else if (line.match(/^[\*\-\+]\s/)) {
      const listText = line.substring(2);
      processedLine = `<li>${listText}</li>`;
    } else if (line.match(/^\d+\.\s/)) {
      const listText = line.replace(/^\d+\.\s/, "");
      processedLine = `<li>${listText}</li>`;
    }
    // Regular paragraphs
    else if (line.trim()) {
      processedLine = `<p>${line}</p>`;
    }
    // Empty lines
    else {
      processedLine = "";
    }

    processedLines.push(processedLine);
  }

  // Flush any trailing table
  flushTable();

  // Join processed lines
  html = processedLines.join("\n");

  // Protect code blocks from inline processing by stashing them in placeholders
  const codeBlocks = [];
  html = html.replace(/<pre><code[^>]*>[\s\S]*?<\/code><\/pre>/g, (match) => {
    codeBlocks.push(match);
    return `%%CODEBLOCK_${codeBlocks.length - 1}%%`;
  });

  // Process inline elements
  // Bold and italic
  html = html.replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");

  // Inline code (not inside code blocks — they're stashed)
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Links (only allow safe protocols)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
    const safeProtocols = /^(https?:\/\/|mailto:|ftp:\/\/|\/)/i;
    if (safeProtocols.test(url.trim())) {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    }
    // Strip unsafe URLs, keep the text only
    return text;
  });

  // Wrap consecutive list items in ul
  html = html.replace(/(<li>.*?<\/li>)(\s*<li>.*?<\/li>)*/gs, function (match) {
    const items = match.match(/<li>.*?<\/li>/g);
    if (items && items.length > 0) {
      return "<ul>" + items.join("") + "</ul>";
    }
    return match;
  });

  // Restore stashed code blocks
  html = html.replace(/%%CODEBLOCK_(\d+)%%/g, (match, index) => {
    return codeBlocks[parseInt(index)] || match;
  });

  // Render math blocks
  html = html.replace(/%%DISPLAYMATH_(\d+)%%/g, (match, index) => {
    const math = displayMathBlocks[parseInt(index)];
    if (!math) return match;
    return `<div class="math-display">${renderLatex(math)}</div>`;
  });
  html = html.replace(/%%INLINEMATH_(\d+)%%/g, (match, index) => {
    const math = inlineMathBlocks[parseInt(index)];
    if (!math) return match;
    return `<span class="math-inline">${renderLatex(math)}</span>`;
  });

  return html;
}

function renderLatex(latex) {
  // Handle fractions: \frac{a}{b}
  latex = latex.replace(
    /\\frac\{([^}]*)\}\{([^}]*)\}/g,
    '<span class="frac"><span class="num">$1</span><span class="den">$2</span></span>',
  );

  // Handle superscripts: x^{y} and x^y
  latex = latex.replace(/\^\{([^}]*)\}/g, "<sup>$1</sup>");
  latex = latex.replace(/\^([a-zA-Z0-9])/g, "<sup>$1</sup>");

  // Handle subscripts: x_{y} and x_y
  latex = latex.replace(/\_\{([^}]*)\}/g, "<sub>$1</sub>");
  latex = latex.replace(/\_([a-zA-Z0-9])/g, "<sub>$1</sub>");

  // Handle \left and \right
  latex = latex.replace(/\\left\s*([\(\[\{\|\\.])/g, "$1");
  latex = latex.replace(/\\right\s*([\)\]\}\|\\.])/g, "$1");

  // Handle \sqrt[n]{x}
  latex = latex.replace(
    /\\sqrt\[([^\]]*)\]\{([^}]*)\}/g,
    '<span class="sqrt"><sup class="sqrt-root">$1</sup>√<span class="sqrt-content">$2</span></span>',
  );
  // Handle \sqrt{x}
  latex = latex.replace(
    /\\sqrt\{([^}]*)\}/g,
    '<span class="sqrt">√<span class="sqrt-content">$1</span></span>',
  );

  // Handle \binom{n}{k}
  latex = latex.replace(
    /\\binom\{([^}]*)\}\{([^}]*)\}/g,
    '<span class="binom"><span class="binom-top">$1</span><span class="binom-bottom">$2</span></span>',
  );

  // Handle \text{...}
  latex = latex.replace(/\\text\{([^}]*)\}/g, "$1");

  // Handle \mathrm, \mathbf, etc.
  latex = latex.replace(
    /\\(?:mathrm|mathbf|mathit|mathsf|mathtt|mathcal|mathbb|mathfrak)\{([^}]*)\}/g,
    "$1",
  );

  // Handle common functions (sin, cos, etc.)
  const functions = [
    "sin",
    "cos",
    "tan",
    "cot",
    "sec",
    "csc",
    "sinh",
    "cosh",
    "tanh",
    "coth",
    "arcsin",
    "arccos",
    "arctan",
    "log",
    "ln",
    "lg",
    "exp",
    "det",
    "dim",
    "hom",
    "ker",
    "max",
    "min",
    "sup",
    "inf",
    "lim",
    "limsup",
    "liminf",
    "gcd",
    "lcm",
  ];
  for (const fn of functions) {
    latex = latex.replace(
      new RegExp(`\\\\${fn}\\b`, "g"),
      `<span class="math-fn">${fn}</span>`,
    );
  }

  // Handle Greek letters and symbols (sorted longest-first to avoid partial matches)
  const symbols = {
    "\\aleph": "ℵ",
    "\\hbar": "ℏ",
    "\\ell": "ℓ",
    "\\Re": "ℜ",
    "\\Im": "ℑ",
    "\\imath": "ı",
    "\\jmath": "ȷ",
    "\\nabla": "∇",
    "\\partial": "∂",
    "\\infty": "∞",
    "\\emptyset": "∅",
    "\\varnothing": "∅",
    "\\forall": "∀",
    "\\exists": "∃",
    "\\nexists": "∄",
    "\\neg": "¬",
    "\\wedge": "∧",
    "\\vee": "∨",
    "\\oplus": "⊕",
    "\\otimes": "⊗",
    "\\odot": "⊙",
    "\\circ": "∘",
    "\\bullet": "•",
    "\\diamond": "⋄",
    "\\Box": "□",
    "\\Diamond": "◇",
    "\\triangle": "△",
    "\\angle": "∠",
    "\\perp": "⟂",
    "\\parallel": "∥",
    "\\prime": "′",
    "\\rightarrow": "→",
    "\\leftarrow": "←",
    "\\Rightarrow": "⇒",
    "\\Leftarrow": "⇐",
    "\\mapsto": "↦",
    "\\implies": "⟹",
    "\\iff": "⟺",
    "\\to": "→",
    "\\gets": "←",
    "\\uparrow": "↑",
    "\\downarrow": "↓",
    "\\Uparrow": "⇑",
    "\\Downarrow": "⇓",
    "\\nearrow": "↗",
    "\\searrow": "↘",
    "\\swarrow": "↙",
    "\\nwarrow": "↖",
    "\\approx": "≈",
    "\\neq": "≠",
    "\\leq": "≤",
    "\\ge": "≥",
    "\\ll": "≪",
    "\\gg": "≫",
    "\\prec": "≺",
    "\\succ": "≻",
    "\\preceq": "⪯",
    "\\succeq": "⪰",
    "\\subset": "⊂",
    "\\supset": "⊃",
    "\\subseteq": "⊆",
    "\\supseteq": "⊇",
    "\\sqsubset": "⊏",
    "\\sqsupset": "⊐",
    "\\sqsubseteq": "⊑",
    "\\sqsupseteq": "⊒",
    "\\subsetneq": "⊊",
    "\\supsetneq": "⊋",
    "\\nsubseteq": "⊈",
    "\\nsupseteq": "⊉",
    "\\in": "∈",
    "\\notin": "∉",
    "\\ni": "∋",
    "\\owns": "∋",
    "\\cup": "∪",
    "\\cap": "∩",
    "\\sim": "∼",
    "\\cong": "≅",
    "\\simeq": "≃",
    "\\equiv": "≡",
    "\\propto": "∝",
    "\\models": "⊨",
    "\\dashv": "⊣",
    "\\vdash": "⊢",
    "\\smile": "⌣",
    "\\frown": "⌢",
    "\\bowtie": "⋈",
    "\\Join": "⋈",
    "\\cdot": "·",
    "\\times": "×",
    "\\div": "÷",
    "\\pm": "±",
    "\\mp": "∓",
    "\\sum": "∑",
    "\\prod": "∏",
    "\\int": "∫",
    "\\oint": "∮",
    "\\dots": "…",
    "\\cdots": "…",
    "\\ldots": "…",
    "\\vdots": "⋮",
    "\\ddots": "⋱",
    "\\langle": "⟨",
    "\\rangle": "⟩",
    "\\lfloor": "⌊",
    "\\rfloor": "⌋",
    "\\lceil": "⌈",
    "\\rceil": "⌉",
    "\\alpha": "α",
    "\\beta": "β",
    "\\gamma": "γ",
    "\\delta": "δ",
    "\\epsilon": "ε",
    "\\varepsilon": "ε",
    "\\zeta": "ζ",
    "\\eta": "η",
    "\\theta": "θ",
    "\\vartheta": "ϑ",
    "\\iota": "ι",
    "\\kappa": "κ",
    "\\lambda": "λ",
    "\\mu": "μ",
    "\\nu": "ν",
    "\\xi": "ξ",
    "\\pi": "π",
    "\\varpi": "ϖ",
    "\\rho": "ρ",
    "\\varrho": "ϱ",
    "\\sigma": "σ",
    "\\varsigma": "ς",
    "\\tau": "τ",
    "\\upsilon": "υ",
    "\\phi": "φ",
    "\\varphi": "φ",
    "\\chi": "χ",
    "\\psi": "ψ",
    "\\omega": "ω",
    "\\Gamma": "Γ",
    "\\Delta": "Δ",
    "\\Theta": "Θ",
    "\\Lambda": "Λ",
    "\\Xi": "Ξ",
    "\\Pi": "Π",
    "\\Sigma": "Σ",
    "\\Phi": "Φ",
    "\\Psi": "Ψ",
    "\\Omega": "Ω",
    "\\colon": ":",
    "\\backslash": "\\",
    "\\%": "%",
    "\\_": "_",
    "\\{": "{",
    "\\}": "}",
    "\\#": "#",
    "\\&": "&",
    "\\clubsuit": "♣",
    "\\diamondsuit": "♦",
    "\\heartsuit": "♥",
    "\\spadesuit": "♠",
    "\\flat": "♭",
    "\\natural": "♮",
    "\\sharp": "♯",
    "\\S": "§",
    "\\P": "¶",
    "\\dag": "†",
    "\\ddag": "‡",
    "\\copyright": "©",
    "\\pounds": "£",
    "\\degree": "°",
  };

  const sortedCmds = Object.keys(symbols).sort((a, b) => b.length - a.length);
  for (const cmd of sortedCmds) {
    latex = latex.replace(
      new RegExp(cmd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      symbols[cmd],
    );
  }

  // Handle spaces
  latex = latex.replace(/\\[,;:\!]/g, " ");
  latex = latex.replace(/\\quad/g, "  ");
  latex = latex.replace(/\\qquad/g, "    ");
  latex = latex.replace(/\\ /g, " ");

  return latex;
}
