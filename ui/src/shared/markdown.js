const MATH_PATTERN = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$((?:\\.|[^$\n])+?)(?<!\\)\$/g;
const CODE_SEGMENT_PATTERN = /(```[\s\S]*?```|`[^`\n]*`)/g;

const CODE_LANGUAGE_LABELS = {
  py: "Python", python: "Python", js: "JavaScript", javascript: "JavaScript",
  ts: "TypeScript", typescript: "TypeScript", jsx: "JSX", tsx: "TSX",
  rs: "Rust", rust: "Rust", sh: "Bash", bash: "Bash", shell: "Shell",
  powershell: "PowerShell", ps1: "PowerShell", json: "JSON", html: "HTML",
  css: "CSS", sql: "SQL", go: "Go", java: "Java", c: "C", cpp: "C++",
};

if (window.marked?.setOptions) window.marked.setOptions({ gfm: true, breaks: true });

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function extractMath(text) {
  const formulas = [];
  const markdown = String(text).split(CODE_SEGMENT_PATTERN).map((segment, index) => {
    if (index % 2) return segment;
    MATH_PATTERN.lastIndex = 0;
    return segment.replace(MATH_PATTERN, (source, dollarBlock, bracketBlock, parenInline, dollarInline) => {
      const expression = dollarBlock ?? bracketBlock ?? parenInline ?? dollarInline;
      const token = `FLUXMATH${formulas.length}TOKEN`;
      formulas.push({ token, source, expression, displayMode: dollarBlock !== undefined || bracketBlock !== undefined });
      return token;
    });
  }).join("");
  return { markdown, formulas };
}

function renderMathInMarkdown(html, formulas) {
  return formulas.reduce((result, formula) => {
    let rendered = escapeHtml(formula.source);
    if (window.katex) {
      try {
        rendered = window.katex.renderToString(formula.expression, {
          displayMode: formula.displayMode, throwOnError: false, strict: "ignore", trust: false,
        });
      } catch {
        // Preserve the original formula if KaTeX cannot render it.
      }
    }
    return result.replaceAll(formula.token, rendered);
  }, html);
}

export function renderMarkdown(text) {
  const parsed = extractMath(String(text || ""));
  try {
    if (window.marked?.parse) return renderMathInMarkdown(window.marked.parse(parsed.markdown), parsed.formulas);
  } catch (error) {
    console.warn("md", error);
  }
  return renderMathInMarkdown(escapeHtml(parsed.markdown).replace(/\n/g, "<br>"), parsed.formulas);
}

function highlightCode(code, language) {
  const source = code.textContent || "";
  const keywordPattern = /\b(?:and|as|async|await|break|case|catch|class|const|continue|def|do|else|enum|except|export|extends|false|False|finally|fn|for|from|function|if|impl|import|in|interface|let|loop|match|mod|mut|new|None|null|of|or|pass|pub|raise|return|self|static|struct|super|switch|this|throw|trait|true|True|try|type|typeof|undefined|use|var|where|while|with|yield)\b/;
  const tokenPattern = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b(?:and|as|async|await|break|case|catch|class|const|continue|def|do|else|enum|except|export|extends|false|False|finally|fn|for|from|function|if|impl|import|in|interface|let|loop|match|mod|mut|new|None|null|of|or|pass|pub|raise|return|self|static|struct|super|switch|this|throw|trait|true|True|try|type|typeof|undefined|use|var|where|while|with|yield)\b)/g;
  code.innerHTML = source.split(tokenPattern).map((token) => {
    if (!token) return "";
    let kind = "";
    if (/^(?:\/\*|\/\/|#)/.test(token)) kind = "comment";
    else if (/^["'`]/.test(token)) kind = "string";
    else if (/^\d/.test(token)) kind = "number";
    else if (keywordPattern.test(token)) kind = "keyword";
    const safe = escapeHtml(token);
    return kind ? `<span class="code-token-${kind}">${safe}</span>` : safe;
  }).join("");
  code.dataset.highlighted = language || "plain";
}

export function enhanceCodeBlocks(root) {
  if (!root) return;
  root.querySelectorAll("pre").forEach((pre) => {
    if (pre.closest(".code-block-shell")) return;
    const code = pre.querySelector("code");
    const languageClass = [...(code?.classList || [])].find((name) => name.startsWith("language-"));
    const language = languageClass ? languageClass.slice(9).toLowerCase() : "";
    if (code) highlightCode(code, language);
    const shell = document.createElement("div");
    shell.className = "code-block-shell";
    const header = document.createElement("div");
    header.className = "code-block-header";
    const label = document.createElement("span");
    label.className = "code-language";
    label.innerHTML = `<span class="code-language-icon">&lt;/&gt;</span>${escapeHtml(CODE_LANGUAGE_LABELS[language] || language || "Code")}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy";
    button.innerHTML = '<span class="code-copy-glyph" aria-hidden="true"></span>';
    button.setAttribute("aria-label", "复制代码");
    button.title = "复制代码";
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const text = code ? code.innerText : pre.innerText;
      const done = (copied) => {
        button.classList.toggle("copied", copied);
        button.setAttribute("aria-label", copied ? "已复制" : "复制代码");
        button.title = copied ? "已复制" : "复制代码";
        setTimeout(() => {
          button.classList.remove("copied");
          button.setAttribute("aria-label", "复制代码");
          button.title = "复制代码";
        }, 1200);
      };
      try {
        await navigator.clipboard.writeText(text.replace(/\n$/, ""));
        done(true);
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand("copy");
          done(true);
        } catch {
          done(false);
        }
        textarea.remove();
      }
    });
    pre.replaceWith(shell);
    header.append(label);
    // 功能9：复制按钮移出 header，作为 shell 的直接子元素实现 sticky 跟随滚动
    shell.append(button, header, pre);
  });
}
